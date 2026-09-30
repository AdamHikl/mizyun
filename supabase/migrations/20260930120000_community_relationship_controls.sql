-- COMM-04: limits survive edge removal; new request IDs and durable retry
-- receipts prevent old client operations from changing a later request.
begin;
create table public.community_follow_request_events (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
create index community_follow_request_events_user_time on public.community_follow_request_events(user_id,created_at);
create table public.community_follow_operations (
 user_id uuid not null references auth.users(id) on delete cascade,
 operation_id uuid not null,
 target_digest text not null,
 relationship_id uuid not null,
 primary key(user_id,operation_id)
);
alter table public.community_follow_request_events enable row level security;
alter table public.community_follow_operations enable row level security;
revoke all on public.community_follow_request_events,public.community_follow_operations from public,anon,authenticated;
grant all on public.community_follow_request_events,public.community_follow_operations to service_role;
insert into public.community_follow_request_events(user_id,created_at)
 select follower_user_id,created_at from public.community_relationships where created_at > now() - interval '1 day';
-- Cooldown authority survives block/withdrawal deleting a live request row.
create table public.community_follow_cooldowns (
 user_id uuid not null references auth.users(id) on delete cascade,
 target_user_id uuid not null references auth.users(id) on delete cascade,
 expires_at timestamptz not null,
 primary key(user_id,target_user_id)
);
alter table public.community_follow_cooldowns enable row level security;
revoke all on public.community_follow_cooldowns from public,anon,authenticated;
grant all on public.community_follow_cooldowns to service_role;
insert into public.community_follow_cooldowns(user_id,target_user_id,expires_at)
 select follower_user_id,target_user_id,updated_at + interval '48 hours'
 from public.community_relationships where status in ('declined','canceled') and updated_at > now()-interval '48 hours';
create function public.community_capture_follow_cooldown() returns trigger
language plpgsql security definer set search_path = '' as $$
declare edge public.community_relationships;
begin
 if tg_op = 'DELETE' then edge := old; else edge := new; end if;
 if edge.status in ('declined','canceled') and edge.updated_at + interval '48 hours' > now() then
  insert into public.community_follow_cooldowns(user_id,target_user_id,expires_at)
  values(edge.follower_user_id,edge.target_user_id,edge.updated_at + interval '48 hours')
  on conflict(user_id,target_user_id) do update set expires_at = greatest(public.community_follow_cooldowns.expires_at,excluded.expires_at);
 end if;
 return null;
end $$;
revoke all on function public.community_capture_follow_cooldown() from public,anon,authenticated;
create trigger community_capture_follow_cooldown after update of status or delete on public.community_relationships
for each row execute function public.community_capture_follow_cooldown();

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
create or replace function public.community_request_follow(p_target_user_id uuid,p_invitation_token text default null)
returns setof public.community_relationships language plpgsql security definer set search_path = '' as $$
 begin raise exception 'community_conflict'; end $$;
revoke all on function public.community_request_follow(uuid,text) from public,anon,authenticated;
revoke all on function public.community_request_follow(uuid,text,uuid) from public,anon;
grant execute on function public.community_request_follow(uuid,text,uuid) to authenticated;
create or replace function public.community_guard_relationship() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if new.id <> old.id or new.follower_user_id <> old.follower_user_id or new.target_user_id <> old.target_user_id then
  if auth.role() = 'authenticated' then raise exception 'community_conflict'; end if;
 end if;
 if auth.role() = 'authenticated' and new.created_at <> old.created_at and not (new.status = 'pending' and auth.uid() = old.follower_user_id and old.status in ('canceled','declined') and old.updated_at <= now() - interval '48 hours') then raise exception 'community_conflict'; end if;
 if auth.role() = 'authenticated' and not (new.status = 'pending' and auth.uid() = old.follower_user_id and old.status in ('canceled','declined') and old.updated_at <= now() - interval '48 hours') then
  if not public.community_active(auth.uid()) or not public.community_active(old.follower_user_id) or not public.community_active(old.target_user_id) or public.community_blocked_between(old.follower_user_id,old.target_user_id)
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
create table public.community_mutes (
 user_id uuid not null references auth.users(id) on delete cascade,
 target_user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(user_id,target_user_id), check(user_id <> target_user_id)
);
alter table public.community_mutes enable row level security;
create policy community_mutes_owner_read on public.community_mutes for select to authenticated using(user_id = (select auth.uid()));
revoke all on public.community_mutes from public,anon,authenticated;
grant select on public.community_mutes to authenticated;
grant all on public.community_mutes to service_role;
create function public.community_set_mute(p_target_user_id uuid,p_muted boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform public.community_lock();
 if auth.uid() is null or auth.uid() = p_target_user_id then raise exception 'community_unavailable'; end if;
 if p_muted then
   if not public.community_active(auth.uid()) or not public.community_active(p_target_user_id)
     or public.community_blocked_between(auth.uid(),p_target_user_id)
     or not exists(select 1 from public.community_relationships where follower_user_id = auth.uid() and target_user_id = p_target_user_id and status = 'approved')
     then raise exception 'community_unavailable'; end if;
   insert into public.community_mutes(user_id,target_user_id) values(auth.uid(),p_target_user_id) on conflict do nothing;
 else delete from public.community_mutes where user_id = auth.uid() and target_user_id = p_target_user_id;
 end if;
end $$;
revoke all on function public.community_set_mute(uuid,boolean) from public,anon;
grant execute on function public.community_set_mute(uuid,boolean) to authenticated;
-- Withdrawal or suspension cannot leave a preference to silently reactivate
-- against a later enrollment incarnation.
create function public.community_cleanup_mutes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if new.status <> 'active' then delete from public.community_mutes where user_id = new.user_id or target_user_id = new.user_id; end if;
 return new;
end $$;
revoke all on function public.community_cleanup_mutes() from public,anon,authenticated;
create trigger community_cleanup_mutes after update of status on public.community_profiles
for each row execute function public.community_cleanup_mutes();

create or replace function public.community_feed(p_limit integer,p_before_time timestamptz,p_before_id uuid)
returns setof public.shared_activities language plpgsql stable security definer set search_path = '' as $$
declare a public.shared_activities;
begin
 for a in select * from public.shared_activities s where public.community_can_view_card(s.id)
 and not exists(select 1 from public.community_mutes m where m.user_id = auth.uid() and m.target_user_id = s.user_id)
 and (p_before_time is null or (s.published_at,s.id) < (p_before_time,p_before_id))
 order by s.published_at desc,s.id desc limit greatest(1,least(coalesce(p_limit,20),50)) loop
 if a.user_id <> auth.uid() then a.source_workout_id := '00000000-0000-0000-0000-000000000000'; end if;
 return next a;
 end loop;
end $$;
-- A member-facing predicate must not identify who blocked whom. Missing,
-- inactive, unenrolled and blocked targets all produce the same unavailable bit.
create function public.community_is_unavailable(p_other_user_id uuid) returns table(is_unavailable boolean)
language sql stable security definer set search_path = '' as $$
 select not public.community_active(auth.uid()) or not public.community_active(p_other_user_id)
   or public.community_blocked_between(auth.uid(),p_other_user_id) where auth.uid() is not null
$$;
revoke all on function public.community_is_blocked(uuid) from public,anon,authenticated;
revoke all on function public.community_is_unavailable(uuid) from public,anon;
grant execute on function public.community_is_unavailable(uuid) to authenticated;
commit;
