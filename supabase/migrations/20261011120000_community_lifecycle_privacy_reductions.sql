-- COMM-12: complete own participation/settings export and record additional
-- privacy reductions. This remains an asynchronous outbox; restored traffic
-- stays quarantined and independent ledger coverage remains uncertified.
begin;

alter function public.community_export_page(text,text,integer)
 rename to community_export_page_before_privacy_reductions;
create function public.community_export_page(p_category text,p_after text default null,p_limit integer default 500)
returns table(item_key text,item jsonb) language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null or p_limit is null or p_limit not between 1 and 500 then raise exception 'community_access_denied';end if;
 if p_category='challengeMemberships' then
 return query select m.challenge_id::text,jsonb_build_object('challengeId',m.challenge_id,'generation',m.generation,'joinedAt',m.joined_at)
 from public.community_challenge_members m where m.user_id=auth.uid() and (p_after is null or m.challenge_id::text>p_after)
 order by m.challenge_id::text limit p_limit;
 elsif p_category='commentSettings' then
 return query select s.activity_id::text,jsonb_build_object('activityId',s.activity_id,'enabled',s.enabled)
 from public.community_comment_settings s where s.user_id=auth.uid() and (p_after is null or s.activity_id::text>p_after)
 order by s.activity_id::text limit p_limit;
 else return query select * from public.community_export_page_before_privacy_reductions(p_category,p_after,p_limit);end if;
end $$;
revoke all on function public.community_export_page(text,text,integer),public.community_export_page_before_privacy_reductions(text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.community_export_page(text,text,integer) to authenticated;

alter table public.community_revocation_events drop constraint community_revocation_events_kind_check;
alter table public.community_revocation_events add constraint community_revocation_events_kind_check
 check(kind in ('withdrawal','account_erasure','block','sanction','activity','routine','media','comment','message','relationship','invitation','source_workout','group','group_post','challenge','group_membership','messaging_optout','discovery_optout','reaction','challenge_membership','challenge_contribution','mute','mention_optout','comment_setting_optout','notification_optout'));

create function public.community_capture_privacy_reduction() returns trigger
language plpgsql security definer set search_path='' as $$
declare subject uuid;target uuid;peer uuid;gen integer;k text:=TG_ARGV[0];capture boolean:=false;
begin
 if current_database()='mizyun_restore' and current_setting('mizyun.restore_environment',true)='dev'
 and current_setting('mizyun.revocation_replaying',true)='on' then
 if TG_OP='DELETE' then return old;else return new;end if;end if;
 perform public.community_lock();
 if k='mute' then
 subject:=new.user_id;target:=new.target_user_id;peer:=new.target_user_id;capture:=true;
 select generation into gen from public.community_profiles where user_id=subject;
 elsif k='mention_optout' then
 subject:=old.user_id;target:=subject;capture:=old.allow_mentions and (TG_OP='DELETE' or not new.allow_mentions);
 select generation into gen from public.community_profiles where user_id=subject;
 elsif k='comment_setting_optout' then
 subject:=old.user_id;target:=old.activity_id;capture:=old.enabled and (TG_OP='DELETE' or not new.enabled);
 select enrollment_generation into gen from public.shared_activities where id=target and user_id=subject;
 elsif k='notification_optout' then
 subject:=new.user_id;target:=subject;
 -- An absent preference uses enabled defaults. Any changed nonempty quiet
 -- schedule may reduce delivery; replay conservatively mutes all delivery
 -- instead of copying timezone/quiet-hour data into the external ledger.
 if TG_OP='INSERT' then capture:=not new.requests or not new.reactions or not new.moderation or new.muted or new.quiet_start is not null;
 else capture:=(old.requests and not new.requests) or (old.reactions and not new.reactions) or (old.moderation and not new.moderation)
 or (not old.muted and new.muted) or (new.quiet_start is not null and (old.quiet_start is distinct from new.quiet_start or old.quiet_end is distinct from new.quiet_end or old.timezone is distinct from new.timezone));end if;
 select generation into gen from public.community_profiles where user_id=subject;
 elsif k='activity' then
 subject:=old.user_id;target:=old.id;gen:=old.enrollment_generation;
 -- An edited projection can remove disclosed health details without source
 -- edits or unpublish. Replay revokes the old artifact, never reconstructs it.
 capture:=old.revoked_at is null and new.revoked_at is null and
 ((old.workout_details is not null and old.workout_details is distinct from new.workout_details)
 or (old.duration_seconds is not null and new.duration_seconds is null));
 elsif k='comment' then
 subject:=old.user_id;target:=old.id;gen:=old.generation;
 capture:=old.removed_at is null and new.removed_at is null and
 (old.body is distinct from new.body or not (old.mentions <@ new.mentions));
 elsif k='message' then
 subject:=old.user_id;target:=old.id;gen:=old.sender_generation;
 capture:=old.deleted_at is null and new.deleted_at is null and old.body is distinct from new.body;
 end if;
 -- Cascading cleanup may run after a profile has gone. Withdrawal/account
 -- erasure already provide the authority barrier; never emit wildcard scope.
 if capture and gen is not null then
 insert into public.community_revocation_events(user_id,kind,generation,target_id,related_user_id) values(subject,k,gen,target,peer);end if;
 if TG_OP='DELETE' then return old;else return new;end if;
end $$;
create trigger community_capture_mute after insert on public.community_mutes for each row execute function public.community_capture_privacy_reduction('mute');
create trigger community_capture_mention_optout before update or delete on public.community_comment_preferences for each row execute function public.community_capture_privacy_reduction('mention_optout');
create trigger community_capture_comment_setting_optout before update or delete on public.community_comment_settings for each row execute function public.community_capture_privacy_reduction('comment_setting_optout');
create trigger community_capture_notification_optout after insert or update on public.community_notification_preferences for each row execute function public.community_capture_privacy_reduction('notification_optout');
create trigger community_capture_activity_reduction before update on public.shared_activities for each row execute function public.community_capture_privacy_reduction('activity');
create trigger community_capture_comment_reduction before update on public.community_comments for each row execute function public.community_capture_privacy_reduction('comment');
create trigger community_capture_message_reduction before update on public.community_messages for each row execute function public.community_capture_privacy_reduction('message');
revoke all on function public.community_capture_privacy_reduction() from public,anon,authenticated,service_role;

-- Retain the existing replay implementation for all earlier immutable events.
-- A wrapper extends its kind vocabulary without loosening the quarantine gate.
alter function public.community_revocation_replay(jsonb) rename to community_revocation_replay_before_privacy_reductions;
create function public.community_revocation_replay(p_events jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e jsonb;eid uuid;subject uuid;target uuid;peer uuid;gen integer;k text;recorded timestamptz;hash text;prior text;n integer:=0;proof jsonb;old_suppress text;
begin
 -- The existing function checks database/environment/run-id, operations,
 -- cohort, delivery/device/media quarantine and obtains the global lock.
 perform public.community_revocation_replay_before_privacy_reductions('[]'::jsonb);
 if p_events is null or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>500 then raise exception 'community_invalid_action';end if;
 old_suppress:=current_setting('mizyun.revocation_replaying',true);
 perform set_config('mizyun.revocation_replaying','on',true);
 for e in select value from jsonb_array_elements(p_events) loop
 k:=e->>'kind';
 if k is null or k not in ('mute','mention_optout','comment_setting_optout','notification_optout') then
 proof:=public.community_revocation_replay_before_privacy_reductions(jsonb_build_array(e));n:=n+(proof->>'appliedCount')::integer;continue;end if;
 if jsonb_typeof(e)<>'object' or not e ?& array['event_id','user_id','kind','generation','target_id','related_user_id','created_at']
 or (e-array['event_id','user_id','kind','generation','target_id','related_user_id','created_at'])<>'{}'::jsonb then raise exception 'community_invalid_action';end if;
 eid:=(e->>'event_id')::uuid;subject:=(e->>'user_id')::uuid;target:=(e->>'target_id')::uuid;
 peer:=(e->>'related_user_id')::uuid;gen:=(e->>'generation')::integer;recorded:=(e->>'created_at')::timestamptz;
 if eid is null or subject is null or target is null or gen is null or gen<1 or recorded is null or not isfinite(recorded)
 or (k='mute' and (peer is null or peer=subject or target<>peer))
 or (k<>'mute' and peer is not null) or (k in ('mention_optout','notification_optout') and target<>subject)
 then raise exception 'community_invalid_action';end if;
 hash:=encode(sha256(convert_to(e::text,'UTF8')),'hex');
 select payload_digest into prior from public.community_revocation_replays where event_id=eid;
 if found then if prior<>hash then raise exception 'community_conflict';end if;continue;end if;
 if k='mute' then
 if exists(select 1 from public.community_profiles where user_id=subject and generation<=gen)
 and exists(select 1 from auth.users where id=peer) then
 insert into public.community_mutes(user_id,target_user_id,created_at) values(subject,peer,recorded) on conflict do nothing;end if;
 elsif k='mention_optout' then
 update public.community_comment_preferences set allow_mentions=false where user_id=subject and exists(select 1 from public.community_profiles where user_id=subject and generation<=gen);
 update public.community_comment_mentions set revoked=true where user_id=subject and generation<=gen;
 elsif k='comment_setting_optout' then
 update public.community_comment_settings set enabled=false where user_id=subject and activity_id=target
 and exists(select 1 from public.shared_activities where id=target and user_id=subject and enrollment_generation<=gen);
 elsif k='notification_optout' then
 if exists(select 1 from public.community_profiles where user_id=subject and generation<=gen) then
 insert into public.community_notification_preferences(user_id,requests,reactions,moderation,muted) values(subject,false,false,false,true)
 on conflict(user_id) do update set requests=false,reactions=false,moderation=false,muted=true;end if;
 end if;
 insert into public.community_revocation_replays(event_id,user_id,payload_digest) values(eid,subject,hash);n:=n+1;
 end loop;
 perform set_config('mizyun.revocation_replaying',coalesce(old_suppress,''),true);
 return jsonb_build_object('processedCount',jsonb_array_length(p_events),'appliedCount',n,'reopenPermitted',false,'reconciliationComplete',false,
 'physicalStorageErasureVerified',false,'holdsCount',(select count(*) from public.community_restore_holds));
end $$;
revoke all on function public.community_revocation_replay(jsonb),public.community_revocation_replay_before_privacy_reductions(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.community_revocation_replay(jsonb) to service_role;
commit;
