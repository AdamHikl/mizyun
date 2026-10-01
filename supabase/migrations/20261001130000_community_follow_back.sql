-- Approved followers may receive a separate, approval-required follow-back request.
-- Preserve locked eligibility, blocking, operation replay, cooldowns and quotas.
create or replace function public.community_request_follow(p_target_user_id uuid,p_invitation_token text, p_operation_id uuid)
returns setof public.community_relationships language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); existing public.community_relationships; prior public.community_follow_operations;
begin
 perform public.community_lock();
 if p_operation_id is null then raise exception 'community_conflict'; end if;
 if p_operation_id is not null then
   select * into prior from public.community_follow_operations where user_id = caller and operation_id = p_operation_id;
   if found then
     if prior.target_digest <> pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_target_user_id::text,'UTF8')),'hex') then raise exception 'community_conflict'; end if;
     select * into existing from public.community_relationships where id = prior.relationship_id;
     if not found or not public.community_active(caller) or not public.community_active(p_target_user_id)
       or public.community_blocked_between(caller,p_target_user_id) then raise exception 'community_conflict'; end if;
     return next existing; return;
   end if;
 end if;
 if caller = p_target_user_id or not public.community_active(caller) or not public.community_active(p_target_user_id)
 or public.community_blocked_between(caller,p_target_user_id) then raise exception 'community_unavailable'; end if;
 if not exists(select 1 from public.community_profiles where user_id = p_target_user_id and is_searchable)
 and not exists(select 1 from public.community_relationships where follower_user_id = caller and target_user_id = p_target_user_id and status in ('approved','pending'))
 and not exists(select 1 from public.community_relationships where follower_user_id = p_target_user_id and target_user_id = caller and status = 'approved')
 and not exists(select 1 from public.community_resolve_invitation(p_invitation_token) i where i.inviter->>'user_id' = p_target_user_id::text)
 then raise exception 'community_unavailable'; end if;
 select * into existing from public.community_relationships where follower_user_id = caller and target_user_id = p_target_user_id;
 if existing.status in ('pending','approved') then
   if p_operation_id is not null then
     if (select count(*) from public.community_follow_request_events where user_id = caller and created_at >= (pg_catalog.date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')) >= 50
       or (select count(*) from public.community_follow_request_events where user_id = caller and created_at > now() - interval '1 minute') >= 10 then raise exception 'community_rate_limited'; end if;
     insert into public.community_follow_request_events(user_id) values(caller);
     insert into public.community_follow_operations(user_id,operation_id,target_digest,relationship_id) values(caller,p_operation_id,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_target_user_id::text,'UTF8')),'hex'),existing.id);
     delete from public.community_follow_request_events where created_at <= now() - interval '1 day';
   end if;
   return next existing; return;
 end if;
 if existing.updated_at > now() - interval '48 hours' or exists(select 1 from public.community_follow_cooldowns where user_id = caller and target_user_id = p_target_user_id and expires_at > now()) then raise exception 'community_rate_limited'; end if;
 -- Opportunistic cleanup supplements the monitored COMM-12 lifecycle job.
 delete from public.community_follow_cooldowns where expires_at <= now() - interval '24 hours';
 if (select count(*) from public.community_relationships where follower_user_id = caller and status = 'pending') >= 20
 or (select count(*) from public.community_relationships where target_user_id = p_target_user_id and status = 'pending') >= 50
 or (select count(*) from public.community_follow_request_events where user_id = caller and created_at >= (pg_catalog.date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')) >= 50
 or (select count(*) from public.community_follow_request_events where user_id = caller and created_at > now() - interval '1 minute') >= 10 then raise exception 'community_rate_limited'; end if;
 -- Every new request incarnation has a fresh opaque ID; delayed approval/cancel
 -- of a prior request cannot act on a new pending request.
 delete from public.community_relationships where id = existing.id;
 insert into public.community_relationships(follower_user_id,target_user_id,status) values(caller,p_target_user_id,'pending') returning * into existing;
 insert into public.community_follow_request_events(user_id) values(caller);
 delete from public.community_follow_request_events where created_at <= now() - interval '1 day';
 if p_operation_id is not null then insert into public.community_follow_operations(user_id,operation_id,target_digest,relationship_id) values(caller,p_operation_id,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_target_user_id::text,'UTF8')),'hex'),existing.id); end if;
 return next existing;
end $$;
