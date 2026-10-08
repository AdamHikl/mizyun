-- COMM-12/14: transactional capture is an outbox, not external durability.
-- ACK only follows the external sink's durable receipt. Unacknowledged rows
-- never expire. Replay is permitted only inside the offline Dev restore target.
begin;
create table public.community_revocation_events (
 event_id uuid primary key default gen_random_uuid(),
 user_id uuid not null,
 kind text not null check(kind in ('withdrawal','account_erasure','block','sanction','activity','routine','media','comment','message','relationship','invitation','source_workout','group','group_post','challenge','group_membership','messaging_optout','discovery_optout','reaction','challenge_membership','challenge_contribution')),
 generation integer check(generation>0), target_id uuid, related_user_id uuid,
 created_at timestamptz not null default clock_timestamp(),
 acknowledged_at timestamptz, checkpoint text,
 check((acknowledged_at is null and checkpoint is null) or (acknowledged_at is not null and checkpoint ~ '^[a-f0-9]{64}$'))
);
-- Deliberately no Auth/content FK: capture survives cascade and primary cleanup.
create index community_revocation_events_user_id on public.community_revocation_events(user_id);
create index community_revocation_events_pending on public.community_revocation_events(created_at,event_id) where acknowledged_at is null;
alter table public.community_revocation_events enable row level security;
revoke all on public.community_revocation_events from public,anon,authenticated,service_role;

create table public.community_revocation_replays (
 event_id uuid primary key, user_id uuid not null,
 payload_digest text not null check(payload_digest ~ '^[a-f0-9]{64}$'),
 applied_at timestamptz not null default clock_timestamp()
);
create index community_revocation_replays_user_id on public.community_revocation_replays(user_id);
alter table public.community_revocation_replays enable row level security;
revoke all on public.community_revocation_replays from public,anon,authenticated,service_role;
-- Sanctions are a conservative hold, not an invented permanent ban. Their
-- expiry/reversal requires independently reconciled moderation authority.
create table public.community_restore_holds (
 user_id uuid not null, event_id uuid not null,
 reason text not null check(reason in ('sanction','account_erasure')),
 created_at timestamptz not null default clock_timestamp(), primary key(user_id,event_id)
);
create index community_restore_holds_user_id on public.community_restore_holds(user_id);
alter table public.community_restore_holds enable row level security;
revoke all on public.community_restore_holds from public,anon,authenticated,service_role;

create function public.community_restore_hold_guard() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if new.status='active' and exists(select 1 from public.community_restore_holds where user_id=new.user_id) then
 raise exception 'community_restore_hold';end if;return new;
end $$;
create trigger community_restore_hold_guard before insert or update on public.community_profiles
for each row execute function public.community_restore_hold_guard();

-- A search opt-out reduces authority even when growth is closed. Preserve the
-- original operation guard for every other profile/content/consent mutation.
create or replace function public.community_operation_guard() returns trigger
language plpgsql security definer set search_path='' as $$declare op text;u uuid;begin
 if TG_TABLE_NAME='community_profiles' then
 if new.status<>'active' then return new;end if;
 if TG_OP='UPDATE' and old.status='active' and old.is_searchable and not new.is_searchable
 and (to_jsonb(new)-array['is_searchable','updated_at'])=(to_jsonb(old)-array['is_searchable','updated_at'])
 then return new;end if;
 op:='enrollment';u:=new.user_id;
 elsif TG_TABLE_NAME='shared_activities' then
 if new.revoked_at is not null then return new;end if;
 op:='publish';u:=new.user_id;
 elsif TG_TABLE_NAME='community_relationships' then
 if new.status not in ('pending','approved') then return new;end if;
 op:='engagement';u:=case when new.status='approved' then new.target_user_id else new.follower_user_id end;
 elsif TG_TABLE_NAME='community_reactions' then op:='engagement';u:=new.user_id;
 else op:='discovery';u:=new.inviter_user_id;end if;
 if not public.community_operation_enabled(op,u) then raise exception 'community_unavailable';end if;return new;
end $$;

create function public.community_capture_revocation() returns trigger
language plpgsql security definer set search_path='' as $$
declare before_row jsonb;after_row jsonb;subject uuid;target uuid;peer uuid;gen integer;event_kind text;capture boolean:=false;
begin
 -- Suppression is scoped to this offline target; no live privacy mutation
 -- can suppress capture merely by setting the replay GUC.
 if current_database()='mizyun_restore' and current_setting('mizyun.restore_environment',true)='dev'
 and current_setting('mizyun.revocation_replaying',true)='on' then
 if TG_OP='DELETE' then return old;else return new;end if;end if;
 -- The source trigger runs after the existing community_lock_source trigger.
 if TG_ARGV[0]<>'source_workout' then perform public.community_lock();end if;
 if TG_OP<>'INSERT' then before_row:=to_jsonb(old);end if;
 if TG_OP<>'DELETE' then after_row:=to_jsonb(new);end if;
 event_kind:=TG_ARGV[0];
 case event_kind
 when 'withdrawal' then
 capture:=TG_OP='DELETE' or (old.status='active' and new.status<>'active');
 subject:=old.user_id;gen:=old.generation;
 when 'account_erasure' then
 if TG_TABLE_NAME='users' then capture:=true;subject:=old.id;target:=old.id;
 else
 capture:=new.status in ('in_progress','failed','completed') and (TG_OP='INSERT' or old.status='challenge_issued');
 subject:=new.user_id;target:=new.id;
 end if;
 when 'block' then capture:=true;subject:=new.blocker_user_id;peer:=new.blocked_user_id;target:=new.id;
 when 'sanction' then capture:=true;subject:=new.user_id;target:=new.id;
 when 'group_membership' then
 capture:=TG_OP='DELETE' or (old.state='member' and new.state<>'member');
 subject:=old.user_id;target:=old.group_id;gen:=old.generation;
 when 'challenge_membership' then
 capture:=true;subject:=old.user_id;target:=old.challenge_id;gen:=old.generation;
 when 'challenge_contribution' then
 capture:=true;subject:=old.user_id;target:=old.challenge_id;
 when 'messaging_optout' then
 capture:=TG_OP='DELETE' or (old.enabled and not new.enabled);
 subject:=old.user_id;target:=old.user_id;gen:=old.generation;
 when 'discovery_optout' then
 subject:=old.user_id;target:=old.user_id;gen:=old.generation;
 if TG_TABLE_NAME='community_profiles' then capture:=old.is_searchable and not new.is_searchable;
 else capture:=TG_OP='DELETE' or (old.enabled and not new.enabled);end if;
 when 'reaction' then
 capture:=true;subject:=old.user_id;target:=old.id;
 when 'relationship' then
 capture:=TG_OP='DELETE' or (old.status='approved' and new.status<>'approved');
 subject:=old.follower_user_id;peer:=old.target_user_id;target:=old.id;
 when 'source_workout' then
 capture:=TG_OP='DELETE' or old.details is distinct from new.details or old.completed_at is distinct from new.completed_at or old.updated_at is distinct from new.updated_at;
 subject:=old.user_id;target:=old.id;
 -- Only social references need a source tombstone; keep private edits out of
 -- the external ledger when no snapshot/contribution exists.
 capture:=capture and (exists(select 1 from public.shared_activities where source_workout_id=target)
 or exists(select 1 from public.community_routine_shares where source_workout_id=target)
 or exists(select 1 from public.community_challenge_contributions where source_workout_id=target));
 else
 subject:=coalesce((before_row->>'user_id')::uuid,(before_row->>'inviter_user_id')::uuid);
 target:=(before_row->>'id')::uuid;
 gen:=coalesce((before_row->>'enrollment_generation')::integer,(before_row->>'generation')::integer,(before_row->>'sender_generation')::integer);
 capture:=TG_OP='DELETE';
 if TG_OP='UPDATE' then
 if event_kind in ('activity','routine','invitation','group_post') then capture:=before_row->>'revoked_at' is null and after_row->>'revoked_at' is not null;
 elsif event_kind='comment' then capture:=before_row->>'removed_at' is null and after_row->>'removed_at' is not null;
 elsif event_kind='message' then capture:=before_row->>'deleted_at' is null and after_row->>'deleted_at' is not null;
 elsif event_kind='media' then capture:=after_row->>'state' in ('rejected','revoked') and before_row->>'state' is distinct from after_row->>'state';
 elsif event_kind='challenge' then capture:=before_row->>'canceled_at' is null and after_row->>'canceled_at' is not null;
 end if;
 end if;
 end case;
 if capture then insert into public.community_revocation_events(user_id,kind,generation,target_id,related_user_id)
 values(subject,event_kind,gen,target,peer);end if;
 if TG_OP='DELETE' then return old;else return new;end if;
end $$;
create trigger community_capture_withdrawal before update or delete on public.community_profiles for each row execute function public.community_capture_revocation('withdrawal');
create trigger community_capture_account_erasure after insert or update of status on public.account_deletion_jobs for each row execute function public.community_capture_revocation('account_erasure');
create trigger community_capture_auth_erasure before delete on auth.users for each row execute function public.community_capture_revocation('account_erasure');
create trigger community_capture_block before insert on public.community_blocks for each row execute function public.community_capture_revocation('block');
create trigger community_capture_sanction before insert on public.community_moderation_sanctions for each row execute function public.community_capture_revocation('sanction');
create trigger community_capture_relationship before update or delete on public.community_relationships for each row execute function public.community_capture_revocation('relationship');
create trigger z_community_capture_source before update or delete on public.workouts for each row execute function public.community_capture_revocation('source_workout');
create trigger community_capture_activity before update or delete on public.shared_activities for each row execute function public.community_capture_revocation('activity');
create trigger community_capture_routine before update or delete on public.community_routine_shares for each row execute function public.community_capture_revocation('routine');
create trigger community_capture_media before update or delete on public.community_media_assets for each row execute function public.community_capture_revocation('media');
create trigger community_capture_comment before update or delete on public.community_comments for each row execute function public.community_capture_revocation('comment');
create trigger community_capture_message before update or delete on public.community_messages for each row execute function public.community_capture_revocation('message');
create trigger community_capture_invitation before update or delete on public.community_invitations for each row execute function public.community_capture_revocation('invitation');
create trigger community_capture_group before delete on public.community_groups for each row execute function public.community_capture_revocation('group');
create trigger community_capture_group_post before update or delete on public.community_group_posts for each row execute function public.community_capture_revocation('group_post');
create trigger community_capture_challenge before update or delete on public.community_challenges for each row execute function public.community_capture_revocation('challenge');
create trigger community_capture_group_membership before update or delete on public.community_group_members for each row execute function public.community_capture_revocation('group_membership');
create trigger community_capture_challenge_membership before delete on public.community_challenge_members for each row execute function public.community_capture_revocation('challenge_membership');
create trigger community_capture_challenge_contribution before delete on public.community_challenge_contributions for each row execute function public.community_capture_revocation('challenge_contribution');
create trigger community_capture_messaging_optout before update or delete on public.community_messaging_preferences for each row execute function public.community_capture_revocation('messaging_optout');
create trigger community_capture_discovery_optout before update or delete on public.community_broader_discovery_preferences for each row execute function public.community_capture_revocation('discovery_optout');
create trigger community_capture_profile_discovery before update on public.community_profiles for each row execute function public.community_capture_revocation('discovery_optout');
create trigger community_capture_reaction before delete on public.community_reactions for each row execute function public.community_capture_revocation('reaction');

create function public.community_revocation_pending(p_limit integer default 100)
returns table(event_id uuid,user_id uuid,kind text,generation integer,target_id uuid,related_user_id uuid,created_at timestamptz)
language plpgsql security definer set search_path='' as $$begin
 if p_limit is null or p_limit not between 1 and 500 then raise exception 'community_invalid_action';end if;
 return query select e.event_id,e.user_id,e.kind,e.generation,e.target_id,e.related_user_id,e.created_at
 from public.community_revocation_events e where e.acknowledged_at is null order by e.created_at,e.event_id limit p_limit;
end $$;
create function public.community_revocation_ack(p_event_ids uuid[],p_checkpoint text)
returns integer language plpgsql security definer set search_path='' as $$declare n integer;begin
 if cardinality(p_event_ids) is null or cardinality(p_event_ids) not between 1 and 500
 or p_checkpoint is null or p_checkpoint !~ '^[a-f0-9]{64}$'
 or exists(select 1 from unnest(p_event_ids) x where x is null)
 or (select count(distinct x) from unnest(p_event_ids) x)<>cardinality(p_event_ids)
 then raise exception 'community_invalid_action';end if;
 perform 1 from public.community_revocation_events where event_id=any(p_event_ids) for update;
 if (select count(*) from public.community_revocation_events where event_id=any(p_event_ids))<>cardinality(p_event_ids)
 or exists(select 1 from public.community_revocation_events where event_id=any(p_event_ids) and checkpoint is not null and checkpoint<>p_checkpoint)
 then raise exception 'community_conflict';end if;
 update public.community_revocation_events set acknowledged_at=clock_timestamp(),checkpoint=p_checkpoint
 where event_id=any(p_event_ids) and acknowledged_at is null;get diagnostics n=row_count;return n;
end $$;

create function public.community_revocation_replay(p_events jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e jsonb;eid uuid;subject uuid;target uuid;peer uuid;gen integer;k text;recorded timestamptz;hash text;prior text;n integer:=0;old_suppress text;
begin
 if current_database()<>'mizyun_restore' or current_setting('mizyun.restore_environment',true) is distinct from 'dev'
 or coalesce(current_setting('mizyun.restore_run_id',true),'') !~ '^[a-f0-9]{32}$'
 or not exists(select 1 from public.community_operations)
 or exists(select 1 from public.community_operations where enabled or enrollment or discovery or publish or engagement or delivery or not cohort_required)
 or exists(select 1 from public.community_pilot_cohort)
 or exists(select 1 from public.community_notification_outbox)
 or exists(select 1 from public.community_push_tokens)
 or exists(select 1 from public.community_feature_controls where enabled)
 or exists(select 1 from public.community_media_assets where state='approved')
 then raise exception 'community_restore_quarantine_required';end if;
 if p_events is null or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>500 then raise exception 'community_invalid_action';end if;
 perform public.community_lock();
 old_suppress:=current_setting('mizyun.revocation_replaying',true);
 perform set_config('mizyun.revocation_replaying','on',true);
 for e in select value from jsonb_array_elements(p_events) loop
 if jsonb_typeof(e)<>'object' or not e ?& array['event_id','user_id','kind','generation','target_id','related_user_id','created_at']
 or (e - array['event_id','user_id','kind','generation','target_id','related_user_id','created_at'])<>'{}'::jsonb
 then raise exception 'community_invalid_action';end if;
 eid:=(e->>'event_id')::uuid;subject:=(e->>'user_id')::uuid;k:=e->>'kind';gen:=(e->>'generation')::integer;
 target:=(e->>'target_id')::uuid;peer:=(e->>'related_user_id')::uuid;recorded:=(e->>'created_at')::timestamptz;
 if eid is null or subject is null or recorded is null or not isfinite(recorded)
 or (gen is not null and gen<1) or k is null or k not in ('withdrawal','account_erasure','block','sanction','activity','routine','media','comment','message','relationship','invitation','source_workout','group','group_post','challenge','group_membership','messaging_optout','discovery_optout','reaction','challenge_membership','challenge_contribution')
 or (k in ('withdrawal','activity','routine','media','comment','message','invitation','group_post','group_membership','messaging_optout','discovery_optout','challenge_membership') and gen is null) or (k<>'withdrawal' and target is null)
 or (k in ('block','relationship') and (peer is null or peer=subject))
 then raise exception 'community_invalid_action';end if;
 hash:=encode(sha256(convert_to(e::text,'UTF8')),'hex');
 select payload_digest into prior from public.community_revocation_replays where event_id=eid;
 if found then if prior<>hash then raise exception 'community_conflict';end if;continue;end if;
 if k='account_erasure' then
 insert into public.community_restore_holds(user_id,event_id,reason) values(subject,eid,'account_erasure') on conflict do nothing;
 -- Existing report/audit erasure guards minimize copied evidence. Media's
 -- delete trigger leaves physical cleanup tickets; bytes are a separate gate.
 delete from auth.users where id=subject;
 elsif k='sanction' then
 insert into public.community_restore_holds(user_id,event_id,reason) values(subject,eid,'sanction') on conflict do nothing;
 update public.community_profiles set status='withdrawn',is_searchable=false,updated_at=now() where user_id=subject and status='active';
 elsif k='withdrawal' then
 -- Older snapshots can precede the captured generation. Later enrollment
 -- must survive; all original cleanup triggers run only on matching/older rows.
 update public.community_profiles set status='withdrawn',is_searchable=false,updated_at=now() where user_id=subject and generation<=gen and status='active';
 update public.shared_activities set revoked_at=coalesce(revoked_at,recorded) where user_id=subject and enrollment_generation<=gen;
 update public.community_routine_shares set revoked_at=coalesce(revoked_at,recorded) where user_id=subject and enrollment_generation<=gen;
 update public.community_media_assets set state='revoked',updated_at=now() where user_id=subject and generation<=gen and state<>'revoked';
 delete from public.community_comments where user_id=subject and generation<=gen;
 delete from public.community_group_posts where user_id=subject and generation<=gen;
 delete from public.community_messages where (user_id=subject and sender_generation<=gen) or (recipient_id=subject and recipient_generation<=gen);
 delete from public.community_invitations where inviter_user_id=subject and enrollment_generation<=gen;
 elsif k='block' then
 if exists(select 1 from auth.users where id=subject) and exists(select 1 from auth.users where id=peer) then
 insert into public.community_blocks(id,blocker_user_id,blocked_user_id,created_at) values(target,subject,peer,recorded)
 on conflict(blocker_user_id,blocked_user_id) do nothing;
 end if;
 -- A restored existing block may predate recreated edges; always sever both.
 delete from public.community_relationships where (follower_user_id=subject and target_user_id=peer) or (follower_user_id=peer and target_user_id=subject);
 elsif k='relationship' then
 delete from public.community_relationships where id=target and follower_user_id=subject and target_user_id=peer;
 elsif k='group_membership' then
 delete from public.community_group_members where group_id=target and user_id=subject and generation<=gen;
 update public.community_group_posts set revoked_at=coalesce(revoked_at,recorded) where group_id=target and user_id=subject and generation<=gen;
 elsif k='messaging_optout' then
 update public.community_messaging_preferences set enabled=false where user_id=subject and generation<=gen;
 elsif k='discovery_optout' then
 update public.community_profiles set is_searchable=false where user_id=subject and generation<=gen and is_searchable;
 update public.community_broader_discovery_preferences set enabled=false where user_id=subject and generation<=gen;
 elsif k='reaction' then
 delete from public.community_reactions where id=target and user_id=subject;
 elsif k='challenge_membership' then
 delete from public.community_challenge_members where challenge_id=target and user_id=subject and generation<=gen;
 delete from public.community_challenge_contributions where challenge_id=target and user_id=subject and created_at<=recorded;
 elsif k='challenge_contribution' then
 -- The minimal event omits day/text: conservatively clear prior contributions
 -- in this exact challenge, never another member or later-created contribution.
 delete from public.community_challenge_contributions where challenge_id=target and user_id=subject and created_at<=recorded;
 elsif k='source_workout' then
 update public.shared_activities set revoked_at=coalesce(revoked_at,recorded) where user_id=subject and source_workout_id=target;
 update public.community_routine_shares set revoked_at=coalesce(revoked_at,recorded) where user_id=subject and source_workout_id=target;
 delete from public.community_challenge_contributions where user_id=subject and source_workout_id=target;
 elsif k='activity' then
 update public.shared_activities set revoked_at=coalesce(revoked_at,recorded) where id=target and user_id=subject and enrollment_generation<=gen;
 elsif k='routine' then
 update public.community_routine_shares set revoked_at=coalesce(revoked_at,recorded) where id=target and user_id=subject and enrollment_generation<=gen;
 elsif k='media' then
 update public.community_media_assets set state='revoked',updated_at=now() where id=target and user_id=subject and generation<=gen;
 elsif k='comment' then
 update public.community_comments set body=null,mentions='{}',removed_at=coalesce(removed_at,recorded),version=version+case when removed_at is null then 1 else 0 end where id=target and user_id=subject and generation<=gen;
 update public.community_comment_mentions set revoked=true where comment_id=target and exists(select 1 from public.community_comments c where c.id=target and c.user_id=subject and c.generation<=gen);
 elsif k='message' then
 update public.community_messages set body=null,deleted_at=coalesce(deleted_at,recorded),version=version+case when deleted_at is null then 1 else 0 end where id=target and user_id=subject and sender_generation<=gen;
 elsif k='invitation' then
 update public.community_invitations set revoked_at=coalesce(revoked_at,recorded) where id=target and inviter_user_id=subject and enrollment_generation<=gen;
 elsif k='group' then delete from public.community_groups where id=target and user_id=subject;
 elsif k='group_post' then update public.community_group_posts set revoked_at=coalesce(revoked_at,recorded) where id=target and user_id=subject and generation<=gen;
 elsif k='challenge' then update public.community_challenges set canceled_at=coalesce(canceled_at,recorded) where id=target and user_id=subject;
 end if;
 insert into public.community_revocation_replays(event_id,user_id,payload_digest) values(eid,subject,hash);n:=n+1;
 end loop;
 perform set_config('mizyun.revocation_replaying',coalesce(old_suppress,''),true);
 return jsonb_build_object('processedCount',jsonb_array_length(p_events),'appliedCount',n,'reopenPermitted',false,'reconciliationComplete',false,
 'holdsCount',(select count(*) from public.community_restore_holds));
end $$;
revoke all on function public.community_restore_hold_guard(),public.community_capture_revocation(),public.community_revocation_pending(integer),public.community_revocation_ack(uuid[],text),public.community_revocation_replay(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.community_revocation_pending(integer),public.community_revocation_ack(uuid[],text),public.community_revocation_replay(jsonb) to service_role;
commit;
