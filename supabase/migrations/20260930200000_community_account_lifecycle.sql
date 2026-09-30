-- COMM-12: narrowly scoped export, generation barriers and resumable expiry.
begin;
alter table public.community_publication_operations add column payload_digest text;
alter table public.community_publication_operations add column effect_id uuid;
update public.community_publication_operations set effect_id=activity_id,payload_digest=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
create function public.community_publication_tombstone_metadata() returns trigger language plpgsql security definer set search_path='' as $$ begin
 new.effect_id:=coalesce(new.effect_id,new.activity_id);
 new.payload_digest:=coalesce(new.payload_digest,encode(sha256(convert_to(new.payload::text,'UTF8')),'hex'));
 return new;
end $$;
create trigger community_publication_tombstone_metadata before insert on public.community_publication_operations for each row execute function public.community_publication_tombstone_metadata();
-- Erased reporters leave only a minimal appealable case if a live sanction needs it.
alter table public.community_reports alter column reporter_user_id drop not null;
alter table public.community_reports drop constraint community_reports_reporter_user_id_fkey;
alter table public.community_reports add constraint community_reports_reporter_user_id_fkey foreign key(reporter_user_id) references auth.users(id) on delete set null;
create function public.community_erased_case_reference() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if (old.reporter_user_id is not null and new.reporter_user_id is null) or (old.subject_user_id is not null and new.subject_user_id is null) then
 new.notes:=null;new.staff_notes:=null;new.evidence_snapshot:='{}';new.decision_reason:='Account removed; retained sanction appeal remains available.';
 end if;
 if old.subject_user_id is not null and new.subject_user_id is null then new.target_id:='deleted';end if;
 return new;
end $$;
create trigger community_erased_case_reference before update of reporter_user_id,subject_user_id on public.community_reports for each row execute function public.community_erased_case_reference();
create table public.community_withdrawal_jobs (
 user_id uuid not null references auth.users(id) on delete cascade,
 generation integer not null,
 requested_at timestamptz not null default now(),
 completed_at timestamptz,
 primary key(user_id,generation)
);
alter table public.community_withdrawal_jobs enable row level security;
revoke all on public.community_withdrawal_jobs from public,anon,authenticated;
grant all on public.community_withdrawal_jobs to service_role;
create function public.community_withdrawal_barrier() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 perform public.community_lock();
 if new.status='active' and exists(select 1 from public.community_withdrawal_jobs where user_id=new.user_id and completed_at is null) then raise exception 'community_conflict'; end if;
 if new.status='withdrawn' and old.status<>'withdrawn' then
 insert into public.community_withdrawal_jobs(user_id,generation) values(new.user_id,old.generation) on conflict do nothing;
 end if;
 return new;
end $$;
create trigger community_withdrawal_barrier before update on public.community_profiles
for each row execute function public.community_withdrawal_barrier();
-- Existing withdrawn data must be drained before reenrollment too.
insert into public.community_withdrawal_jobs(user_id,generation)
select user_id,generation from public.community_profiles where status='withdrawn';

create or replace function public.community_can_view_card(p_activity_id uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.shared_activities a join public.community_profiles p on p.user_id=a.user_id
 where a.id=p_activity_id and a.revoked_at is null and a.published_at>now()-interval '365 days' and a.enrollment_generation=p.generation
 and public.community_active(auth.uid()) and public.community_active(a.user_id)
 and not public.community_blocked_between(auth.uid(),a.user_id)
 and (a.user_id=auth.uid() or exists(select 1 from public.community_relationships r where r.follower_user_id=auth.uid() and r.target_user_id=a.user_id and r.status='approved')))
$$;
create function public.community_export_page(p_category text,p_after text default null,p_limit integer default 500)
returns table(item_key text,item jsonb) language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'community_access_denied'; end if;
 if p_limit is null or p_limit<1 or p_limit>500 then raise exception 'community_conflict'; end if;
 if p_category='identity' then
 return query select t.k,to_jsonb(t)-'k' from (select user_id::text as k,user_id,handle,display_name,avatar_symbol,bio,is_searchable,status,generation,terms_version,terms_accepted_at,adult_declared_at,created_at,updated_at from public.community_profiles where (user_id=auth.uid()) and (p_after is null or user_id::text>p_after) order by user_id::text limit p_limit) t;
 elsif p_category='relationships' then
 return query select t.k,to_jsonb(t)-'k' from (select id::text as k,id,follower_user_id,target_user_id,status,created_at,updated_at from public.community_relationships where (follower_user_id=auth.uid() or target_user_id=auth.uid()) and (p_after is null or id::text>p_after) order by id::text limit p_limit) t;
 elsif p_category='blocks' then
 return query select t.k,to_jsonb(t)-'k' from (select id::text as k,id,blocker_user_id,blocked_user_id,created_at from public.community_blocks where (blocker_user_id=auth.uid()) and (p_after is null or id::text>p_after) order by id::text limit p_limit) t;
 elsif p_category='mutes' then
 return query select t.k,to_jsonb(t)-'k' from (select target_user_id::text as k,target_user_id,created_at from public.community_mutes where (user_id=auth.uid()) and (p_after is null or target_user_id::text>p_after) order by target_user_id::text limit p_limit) t;
 elsif p_category='activities' then
 return query select t.k,to_jsonb(t)-'k' from (select id::text as k,id,source_workout_id,category,shared_day,duration_seconds,version,published_at,revoked_at from public.shared_activities where (user_id=auth.uid()) and (p_after is null or id::text>p_after) order by id::text limit p_limit) t;
 elsif p_category='reactions' then
 return query select t.k,to_jsonb(t)-'k' from (select id::text as k,id,activity_id,reaction,created_at,updated_at from public.community_reactions where (user_id=auth.uid()) and (p_after is null or id::text>p_after) order by id::text limit p_limit) t;
 elsif p_category='invitations' then
 return query select t.k,to_jsonb(t)-'k' from (select id::text as k,id,expires_at,revoked_at,created_at from public.community_invitations where (inviter_user_id=auth.uid()) and (p_after is null or id::text>p_after) order by id::text limit p_limit) t;
 elsif p_category='reports' then
 return query select t.k,to_jsonb(t)-'k' from (select id::text as k,id,target_type,target_id,reason,notes,status,created_at,updated_at from public.community_reports where (reporter_user_id=auth.uid()) and (p_after is null or id::text>p_after) order by id::text limit p_limit) t;
 elsif p_category='appeals' then
 return query select t.k,to_jsonb(t)-'k' from (select id::text as k,id,report_id,reason,status,resolved_at,created_at,updated_at from public.community_moderation_appeals where (appellant_user_id=auth.uid()) and (p_after is null or id::text>p_after) order by id::text limit p_limit) t;
 elsif p_category='notificationPreferences' then
 return query select t.k,to_jsonb(t)-'k' from (select user_id::text as k,requests,reactions,moderation,muted,timezone,quiet_start,quiet_end from public.community_notification_preferences where (user_id=auth.uid()) and (p_after is null or user_id::text>p_after) order by user_id::text limit p_limit) t;
 elsif p_category='inbox' then
 return query select t.k,to_jsonb(t)-'k' from (select id::text as k,id,actor_user_id,kind,target_id,created_at,read_at,expires_at from public.community_inbox_events where (user_id=auth.uid() and expires_at>now()) and (p_after is null or id::text>p_after) order by id::text limit p_limit) t;
 elsif p_category='pushRegistrations' then
 return query select t.k,to_jsonb(t)-'k' from (select installation_id::text as k,installation_id,generation,updated_at,expires_at from public.community_push_tokens where user_id=auth.uid() and (p_after is null or installation_id::text>p_after) order by installation_id::text limit p_limit) t;
 elsif p_category='delivery' then
 return query select t.k,to_jsonb(t)-'k' from (select id::text as k,id,event_id,status,attempts,next_attempt_at,expires_at from public.community_notification_outbox where user_id=auth.uid() and (p_after is null or id::text>p_after) order by id::text limit p_limit) t;
 else raise exception 'community_conflict'; end if;
end $$;
create function public.community_withdrawal_batch(p_user_id uuid,p_generation integer,p_limit integer default 500)
returns table(deleted_count integer,complete boolean) language plpgsql security definer set search_path='' as $$
declare n integer:=0; c integer; pending boolean;
begin
 perform public.community_lock();
 if p_limit is null or p_limit<1 or p_limit>500 then raise exception 'community_conflict';end if;
 select true into pending from public.community_withdrawal_jobs where user_id=p_user_id and generation=p_generation and completed_at is null for update;
 if pending is distinct from true then return query select 0,true;return;end if;
 -- An impossible generation mismatch fails closed; never clean a later enrollment.
 if not exists(select 1 from public.community_profiles where user_id=p_user_id and generation=p_generation and status<>'active') then raise exception 'community_conflict';end if;
 delete from public.shared_activities where ctid in (select ctid from public.shared_activities where user_id=p_user_id limit p_limit); get diagnostics c=row_count;n:=n+c;
 delete from public.community_invitations where ctid in (select ctid from public.community_invitations where inviter_user_id=p_user_id limit p_limit); get diagnostics c=row_count;n:=n+c;
 update public.community_publication_operations set payload_digest=coalesce(payload_digest,encode(sha256(convert_to(payload::text,'UTF8')),'hex')),payload='{}',activity_id=null where ctid in (select ctid from public.community_publication_operations where user_id=p_user_id and enrollment_generation=p_generation and payload<>'{}' limit p_limit); get diagnostics c=row_count;n:=n+c;
 delete from public.community_inbox_events where ctid in (select ctid from public.community_inbox_events where user_id=p_user_id or actor_user_id=p_user_id limit p_limit); get diagnostics c=row_count;n:=n+c;
 delete from public.community_push_tokens where ctid in (select ctid from public.community_push_tokens where user_id=p_user_id limit p_limit); get diagnostics c=row_count;n:=n+c;
 pending:=exists(select 1 from public.shared_activities where user_id=p_user_id) or exists(select 1 from public.community_invitations where inviter_user_id=p_user_id) or exists(select 1 from public.community_publication_operations where user_id=p_user_id and enrollment_generation=p_generation and payload<>'{}') or exists(select 1 from public.community_inbox_events where user_id=p_user_id or actor_user_id=p_user_id) or exists(select 1 from public.community_push_tokens where user_id=p_user_id);
 if not pending then update public.community_withdrawal_jobs set completed_at=now() where user_id=p_user_id and generation=p_generation;end if;
 return query select n,not pending;
end $$;
-- Called before Auth erasure by the existing tombstoned deletion worker.
-- Every call validates its current lease; stale workers cannot erase new work.
create function public.community_account_cleanup_batch(p_user_id uuid,p_job_id uuid,p_worker_id text,p_limit integer default 500)
returns table(deleted_count integer,complete boolean) language plpgsql security definer set search_path='' as $$
declare n integer:=0;c integer;pending boolean;
begin
 perform public.community_lock();
 if p_limit is null or p_limit<1 or p_limit>500 then raise exception 'community_conflict';end if;
 if not exists(select 1 from public.account_deletion_jobs where id=p_job_id and user_id=p_user_id and status='in_progress' and worker_id=p_worker_id and lease_expires_at>now()) then raise exception 'community_access_denied';end if;
 update public.community_profiles set status='withdrawn',is_searchable=false where user_id=p_user_id and status='active';
 delete from public.shared_activities where ctid in (select ctid from public.shared_activities where user_id=p_user_id limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_relationships where ctid in (select ctid from public.community_relationships where follower_user_id=p_user_id or target_user_id=p_user_id limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_reactions where ctid in (select ctid from public.community_reactions where user_id=p_user_id limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_invitations where ctid in (select ctid from public.community_invitations where inviter_user_id=p_user_id limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_inbox_events where ctid in (select ctid from public.community_inbox_events where user_id=p_user_id or actor_user_id=p_user_id limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_push_tokens where ctid in (select ctid from public.community_push_tokens where user_id=p_user_id limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_notification_dedupe where ctid in (select ctid from public.community_notification_dedupe where user_id=p_user_id limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_notification_outbox where ctid in (select ctid from public.community_notification_outbox where user_id=p_user_id limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_report_receipts where ctid in (select ctid from public.community_report_receipts where user_id=p_user_id or subject_user_id=p_user_id limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_publication_operations where ctid in (select ctid from public.community_publication_operations where user_id=p_user_id limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_follow_operations where ctid in (select ctid from public.community_follow_operations where user_id=p_user_id limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_follow_cooldowns where ctid in (select ctid from public.community_follow_cooldowns where user_id=p_user_id or target_user_id=p_user_id limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_mutes where ctid in (select ctid from public.community_mutes where user_id=p_user_id or target_user_id=p_user_id limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_blocks where ctid in (select ctid from public.community_blocks where blocker_user_id=p_user_id or blocked_user_id=p_user_id limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_reports where ctid in (select ctid from public.community_reports where reporter_user_id=p_user_id and not exists(select 1 from public.community_moderation_sanctions s where s.report_id=community_reports.id and s.reversed_at is null and (s.kind='ban' or s.expires_at>now())) limit p_limit);get diagnostics c=row_count;n:=n+c;
 update public.community_reports set reporter_user_id=null,notes=null,staff_notes=null,evidence_snapshot='{}',decision_reason='Reporter account removed; sanction appeal remains available.' where ctid in (select ctid from public.community_reports where reporter_user_id=p_user_id limit p_limit);get diagnostics c=row_count;n:=n+c;
 update public.community_reports set subject_user_id=null,evidence_snapshot='{}',target_id='deleted' where ctid in (select ctid from public.community_reports where subject_user_id=p_user_id limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_moderation_appeals where ctid in (select ctid from public.community_moderation_appeals where appellant_user_id=p_user_id limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_notification_preferences where ctid in (select ctid from public.community_notification_preferences where user_id=p_user_id limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_discovery_attempts where ctid in (select ctid from public.community_discovery_attempts where user_id=p_user_id limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_invitation_usage where ctid in (select ctid from public.community_invitation_usage where user_id=p_user_id limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_publication_usage where ctid in (select ctid from public.community_publication_usage where user_id=p_user_id limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_follow_request_events where ctid in (select ctid from public.community_follow_request_events where user_id=p_user_id limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_report_usage where ctid in (select ctid from public.community_report_usage where user_id=p_user_id limit p_limit);get diagnostics c=row_count;n:=n+c;
 pending:=exists(select 1 from public.community_moderation_appeals where appellant_user_id=p_user_id) or exists(select 1 from public.community_notification_preferences where user_id=p_user_id) or exists(select 1 from public.community_discovery_attempts where user_id=p_user_id) or exists(select 1 from public.community_invitation_usage where user_id=p_user_id) or exists(select 1 from public.community_publication_usage where user_id=p_user_id) or exists(select 1 from public.community_follow_request_events where user_id=p_user_id) or exists(select 1 from public.community_report_usage where user_id=p_user_id) or exists(select 1 from public.shared_activities where user_id=p_user_id) or exists(select 1 from public.community_relationships where follower_user_id=p_user_id or target_user_id=p_user_id) or exists(select 1 from public.community_reactions where user_id=p_user_id) or exists(select 1 from public.community_invitations where inviter_user_id=p_user_id) or exists(select 1 from public.community_inbox_events where user_id=p_user_id or actor_user_id=p_user_id) or exists(select 1 from public.community_push_tokens where user_id=p_user_id) or exists(select 1 from public.community_notification_dedupe where user_id=p_user_id) or exists(select 1 from public.community_notification_outbox where user_id=p_user_id) or exists(select 1 from public.community_report_receipts where user_id=p_user_id or subject_user_id=p_user_id) or exists(select 1 from public.community_publication_operations where user_id=p_user_id) or exists(select 1 from public.community_follow_operations where user_id=p_user_id) or exists(select 1 from public.community_follow_cooldowns where user_id=p_user_id or target_user_id=p_user_id) or exists(select 1 from public.community_mutes where user_id=p_user_id or target_user_id=p_user_id) or exists(select 1 from public.community_blocks where blocker_user_id=p_user_id or blocked_user_id=p_user_id) or exists(select 1 from public.community_reports where reporter_user_id=p_user_id and not exists(select 1 from public.community_moderation_sanctions s where s.report_id=community_reports.id and s.reversed_at is null and (s.kind='ban' or s.expires_at>now()))) or exists(select 1 from public.community_reports where subject_user_id=p_user_id);
 return query select n,not pending;
end $$;
-- Retention has explicit expiry and cannot be extended by ordinary report writes.
alter table public.community_reports add column retention_expires_at timestamptz;
update public.community_reports set retention_expires_at=updated_at+interval '180 days' where status in ('resolved','dismissed');
create function public.community_case_retention() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.status in ('resolved','dismissed') and old.status not in ('resolved','dismissed') then new.retention_expires_at:=now()+interval '180 days';end if;return new;end $$;
create trigger community_case_retention before update on public.community_reports for each row execute function public.community_case_retention();
alter table public.community_moderation_actions add column retention_expires_at timestamptz not null default now()+interval '180 days';
update public.community_moderation_actions set retention_expires_at=created_at+interval '180 days';
create index community_reports_retention on public.community_reports(retention_expires_at);
create index community_actions_retention on public.community_moderation_actions(retention_expires_at);
create function public.community_retention_batch(p_limit integer default 500)
returns table(deleted_count integer) language plpgsql security definer set search_path='' as $$
declare n integer:=0;c integer;
begin
 perform public.community_lock();
 if p_limit is null or p_limit<1 or p_limit>500 then raise exception 'community_conflict';end if;
 delete from public.community_handle_quarantine where ctid in (select ctid from public.community_handle_quarantine where expires_at<=now() limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_follow_cooldowns where ctid in (select ctid from public.community_follow_cooldowns where expires_at<=now() limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_discovery_attempts where ctid in (select ctid from public.community_discovery_attempts where created_at<now()-interval '1 day' limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_invitation_usage where ctid in (select ctid from public.community_invitation_usage where utc_day<(now() at time zone 'UTC')::date limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_publication_usage where ctid in (select ctid from public.community_publication_usage where usage_day<(now() at time zone 'UTC')::date limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_follow_request_events where ctid in (select ctid from public.community_follow_request_events where created_at<=now()-interval '1 day' limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_report_receipts where ctid in (select ctid from public.community_report_receipts where expires_at<=now() limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_report_usage where ctid in (select ctid from public.community_report_usage where report_date<(now() at time zone 'UTC')::date limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_inbox_events where ctid in (select ctid from public.community_inbox_events where expires_at<=now() limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_push_tokens where ctid in (select ctid from public.community_push_tokens where expires_at<=now() limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_notification_dedupe where ctid in (select ctid from public.community_notification_dedupe where expires_at<=now() limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_notification_outbox where ctid in (select ctid from public.community_notification_outbox where expires_at<=now() limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_moderation_actions where ctid in (select ctid from public.community_moderation_actions where retention_expires_at<=now() limit p_limit);get diagnostics c=row_count;n:=n+c;
 update public.community_reports set notes=null,staff_notes=null,evidence_snapshot='{}' where ctid in (select ctid from public.community_reports where retention_expires_at<=now() and (notes is not null or staff_notes is not null or evidence_snapshot<>'{}') limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_reports where ctid in (select ctid from public.community_reports where retention_expires_at<=now() and not exists(select 1 from public.community_moderation_sanctions s where s.report_id=community_reports.id and s.reversed_at is null and (s.kind='ban' or s.expires_at>now())) limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_invitations where ctid in (select ctid from public.community_invitations where expires_at<=now() or revoked_at is not null limit p_limit);get diagnostics c=row_count;n:=n+c;
 update public.community_publication_operations set payload_digest=coalesce(payload_digest,encode(sha256(convert_to(payload::text,'UTF8')),'hex')),payload='{}',activity_id=null where ctid in (select o.ctid from public.community_publication_operations o where o.payload<>'{}' and (o.activity_id is null or not exists(select 1 from public.shared_activities a where a.id=o.activity_id and a.revoked_at is null and a.published_at>now()-interval '365 days')) limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.shared_activities where ctid in (select ctid from public.shared_activities where revoked_at<=now()-interval '30 days' or published_at<=now()-interval '365 days' limit p_limit);get diagnostics c=row_count;n:=n+c;
 update public.community_profiles set display_name='Former member',avatar_symbol='MZ',bio=null,terms_version=null,terms_accepted_at=null,adult_declared_at=null where ctid in (select p.ctid from public.community_profiles p join public.community_withdrawal_jobs j on j.user_id=p.user_id and j.generation=p.generation where p.status='withdrawn' and j.requested_at<=now()-interval '30 days' and (p.display_name<>'Former member' or p.avatar_symbol<>'MZ' or p.bio is not null or p.terms_accepted_at is not null or p.adult_declared_at is not null) limit p_limit);get diagnostics c=row_count;n:=n+c;
 return query select n;
end $$;
create function public.community_withdrawal_pending(p_limit integer default 10)
returns table(user_id uuid,generation integer) language plpgsql security definer set search_path='' as $$ begin
 if p_limit is null or p_limit<1 or p_limit>10 then raise exception 'community_conflict';end if;
 return query select j.user_id,j.generation from public.community_withdrawal_jobs j where j.completed_at is null order by j.requested_at,j.user_id limit p_limit;
end $$;
revoke all on function public.community_publication_tombstone_metadata(),public.community_withdrawal_pending(integer),public.community_erased_case_reference(),public.community_case_retention(),public.community_withdrawal_barrier(),public.community_export_page(text,text,integer),public.community_withdrawal_batch(uuid,integer,integer),public.community_account_cleanup_batch(uuid,uuid,text,integer),public.community_retention_batch(integer) from public,anon,authenticated;
grant execute on function public.community_export_page(text,text,integer) to authenticated;
grant execute on function public.community_withdrawal_pending(integer),public.community_withdrawal_batch(uuid,integer,integer),public.community_account_cleanup_batch(uuid,uuid,text,integer),public.community_retention_batch(integer) to service_role;
commit;
