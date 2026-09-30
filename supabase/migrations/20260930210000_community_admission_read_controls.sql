begin;
-- Every new environment starts closed. Activation requires an explicit service decision.
alter table public.community_operations
 alter column enabled set default false,
 alter column enrollment set default false,
 alter column discovery set default false,
 alter column publish set default false,
 alter column engagement set default false,
 alter column cohort_required set default true;
update public.community_operations set enabled=false,enrollment=false,discovery=false,publish=false,engagement=false,delivery=false,cohort_required=true;
create function public.community_participation_enabled(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select enabled and (not cohort_required or exists(select 1 from public.community_pilot_cohort where user_id=p_user)) from public.community_operations where singleton),false)
$$;
-- Existing RLS/RPC authority uses this predicate, so global/cohort revocation also
-- denies feed, card, profile and notification reads independently of API flags.
create or replace function public.community_active(p_user_id uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select public.community_participation_enabled(p_user_id)
 and public.community_eligible(p_user_id) and not public.community_sanctioned(p_user_id)
 and exists(select 1 from public.community_profiles where user_id=p_user_id and status='active' and terms_version='2026-09-30' and terms_accepted_at is not null and adult_declared_at is not null)
$$;
alter function public.community_resolve_invitation(text) rename to community_resolve_invitation_ungated;
create function public.community_resolve_invitation(p_token text) returns table(invitation jsonb,inviter jsonb)
language plpgsql volatile security definer set search_path='' as $$begin
 if not public.community_operation_enabled('discovery',auth.uid()) then raise exception 'community_unavailable';end if;
 return query select * from public.community_resolve_invitation_ungated(p_token);
end $$;
-- Muting an existing approved relationship remains a privacy reduction during a
-- global freeze/cohort removal. It cannot expose content or create a relationship.
create or replace function public.community_set_mute(p_target_user_id uuid,p_muted boolean)
returns void language plpgsql security definer set search_path='' as $$begin
 perform public.community_lock();
 if auth.uid() is null or auth.uid()=p_target_user_id then raise exception 'community_unavailable';end if;
 if p_muted then
 if not exists(select 1 from public.community_relationships where follower_user_id=auth.uid() and target_user_id=p_target_user_id and status='approved') then raise exception 'community_unavailable';end if;
 insert into public.community_mutes(user_id,target_user_id) values(auth.uid(),p_target_user_id) on conflict do nothing;
 else delete from public.community_mutes where user_id=auth.uid() and target_user_id=p_target_user_id;end if;
end $$;
revoke all on function public.community_participation_enabled(uuid),public.community_resolve_invitation_ungated(text),public.community_resolve_invitation(text) from public,anon,authenticated;
grant execute on function public.community_participation_enabled(uuid),public.community_resolve_invitation_ungated(text) to service_role;
grant execute on function public.community_resolve_invitation(text) to authenticated,service_role;
create or replace function public.community_guard_relationship() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if new.id <> old.id or new.follower_user_id <> old.follower_user_id or new.target_user_id <> old.target_user_id then
  if auth.role() = 'authenticated' then raise exception 'community_conflict'; end if;
 end if;
 if auth.role() = 'authenticated' and new.created_at <> old.created_at and not (new.status = 'pending' and auth.uid() = old.follower_user_id and old.status in ('canceled','declined') and old.updated_at <= now() - interval '48 hours') then raise exception 'community_conflict'; end if;
 if auth.role() = 'authenticated' and not (new.status = 'pending' and auth.uid() = old.follower_user_id and old.status in ('canceled','declined') and old.updated_at <= now() - interval '48 hours') then
  if (new.status='approved' and (not public.community_active(auth.uid()) or not public.community_active(old.follower_user_id) or not public.community_active(old.target_user_id) or public.community_blocked_between(old.follower_user_id,old.target_user_id)))
    or (old.status <> 'pending' and old.status <> new.status) or not ((auth.uid() = old.target_user_id and new.status in ('approved','declined'))
      or (auth.uid() = old.follower_user_id and new.status = 'canceled')) then raise exception 'community_unavailable'; end if;
 end if;
 if auth.role() = 'authenticated' and new.status = 'approved' and old.status <> 'approved' then
   if (select count(*) from public.community_relationships where follower_user_id = old.follower_user_id and status = 'approved') >= 30
     or (select count(*) from public.community_relationships where target_user_id = old.target_user_id and status = 'approved') >= 30
     then raise exception 'community_rate_limited'; end if;
 end if;
 if new.status = old.status then new.updated_at := old.updated_at; else new.updated_at := now(); end if;
 return new;
end $$;

-- Auth erasure must take the social lock before locking its parent rows; inbox
-- FK inserts otherwise deadlock against cascades waiting for this same lock.
create trigger community_lock_auth_erasure before delete on auth.users
for each statement execute function public.community_lock_write();
-- Own reaction records remain manageable after browsing authority is revoked.
create policy community_reaction_owner_control_read on public.community_reactions for select to authenticated using(user_id=(select auth.uid()));
create policy community_reaction_owner_remove on public.community_reactions for delete to authenticated using(user_id=(select auth.uid()));
-- Queue age measures the original pending event, never its delayed retry time.
create or replace function public.community_operations_metrics() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'pendingDelivery',(select count(*) from public.community_notification_outbox where status='pending'),
 'oldestQueueSeconds',coalesce((select greatest(0,extract(epoch from now()-min(e.created_at))::bigint) from public.community_notification_outbox o join public.community_inbox_events e on e.id=o.event_id where o.status='pending'),0),
 'readyDelivery',(select count(*) from public.community_notification_outbox where status='pending' and next_attempt_at<=now()),
 'openReports',(select count(*) from public.community_reports where status in ('submitted','under_review')),
 'failedDelivery',(select count(*) from public.community_notification_outbox where status='failed'))
$$;
commit;
