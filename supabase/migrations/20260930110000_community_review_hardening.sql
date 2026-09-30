-- COMM-02/03/04/05/06 review: enforce consent, authorization and revocation at
-- the actual PostgREST/database boundary. Forward-only; no private health copy.
begin;
alter table public.community_profiles add column terms_version text;
alter table public.community_profiles add column terms_accepted_at timestamptz;
alter table public.community_profiles alter column is_searchable set default false;
alter table public.shared_activities add column enrollment_generation integer not null default 1;
alter table public.community_invitations add column enrollment_generation integer not null default 1;

create table public.community_publication_operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  enrollment_generation integer not null,
  activity_id uuid references public.shared_activities(id) on delete set null,
  activity_version integer not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);
alter table public.community_publication_operations enable row level security;
create policy community_operations_owner_read on public.community_publication_operations
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.community_publication_operations from public, anon, authenticated;
grant select on public.community_publication_operations to authenticated;
grant all on public.community_publication_operations to service_role;

-- Serialize social mutations before accessing rows. At the bounded pilot scale
-- a single transaction advisory lock also covers direct source/block mutations;
-- replace with ordered per-principal locks only with concurrency acceptance.
create function public.community_lock() returns void language sql volatile
security definer set search_path = '' as $$ select pg_catalog.pg_advisory_xact_lock(137, 1) $$;
create function public.community_lock_write() returns trigger language plpgsql
security definer set search_path = '' as $$
begin perform public.community_lock(); return null; end $$;
create trigger community_lock_profile before insert or update or delete on public.community_profiles
for each statement execute function public.community_lock_write();
create trigger community_lock_edge before insert or update or delete on public.community_relationships
for each statement execute function public.community_lock_write();
create trigger community_lock_block before insert or update or delete on public.community_blocks
for each statement execute function public.community_lock_write();
create trigger community_lock_card before insert or update or delete on public.shared_activities
for each statement execute function public.community_lock_write();
create trigger community_lock_invite before insert or update or delete on public.community_invitations
for each statement execute function public.community_lock_write();
create trigger community_lock_source before update or delete on public.workouts
for each statement execute function public.community_lock_write();

create function public.community_eligible(p_user_id uuid) returns boolean
language sql volatile security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id = p_user_id
    and p.birth_year between 1900 and extract(year from now())::integer - 18)
    and not exists(select 1 from public.account_deletion_jobs d where d.user_id = p_user_id
      and d.status in ('in_progress', 'completed', 'failed'))
$$;
create function public.community_active(p_user_id uuid) returns boolean
language sql volatile security definer set search_path = '' as $$
  select public.community_eligible(p_user_id) and exists(select 1 from public.community_profiles p
    where p.user_id = p_user_id and p.status = 'active' and p.terms_version = '2026-09-29'
    and p.terms_accepted_at is not null)
$$;
create function public.community_blocked_between(p_a uuid, p_b uuid) returns boolean
language sql volatile security definer set search_path = '' as $$
  select exists(select 1 from public.community_blocks b
    where (b.blocker_user_id = p_a and b.blocked_user_id = p_b)
       or (b.blocker_user_id = p_b and b.blocked_user_id = p_a))
$$;
create function public.community_is_blocked(p_other_user_id uuid) returns table(is_blocked boolean)
language sql stable security definer set search_path = '' as $$
 select public.community_blocked_between(auth.uid(), p_other_user_id) where auth.uid() is not null
$$;

-- Withdrawal/suspension cleans up in the same transaction, regardless of caller.
create function public.community_profile_cleanup() returns trigger language plpgsql
security definer set search_path = '' as $$
begin
 if new.status <> 'active' and (old.status = 'active' or new.generation <> old.generation) then
  update public.shared_activities set revoked_at = coalesce(revoked_at, now()) where user_id = new.user_id;
  delete from public.community_reactions where user_id = new.user_id;
  delete from public.community_relationships where follower_user_id = new.user_id or target_user_id = new.user_id;
  update public.community_invitations set revoked_at = coalesce(revoked_at, now()) where inviter_user_id = new.user_id;
 end if;
 return new;
end $$;
create trigger community_profile_cleanup after update on public.community_profiles
for each row execute function public.community_profile_cleanup();
-- Existing rows have no durable terms receipt; require a fresh explicit opt-in.
update public.community_profiles set status = 'withdrawn', is_searchable = false
where status = 'active';
-- Reconcile invalid sources and duplicate publications before uniqueness.
update public.shared_activities a set revoked_at = coalesce(a.revoked_at, now())
where not exists(select 1 from public.workouts w where w.id = a.source_workout_id and w.user_id = a.user_id
 and w.completed_at is not null and w.details #>> '{workoutLifecycle,kind}' = 'session');
delete from public.shared_activities a using public.shared_activities b
where a.user_id = b.user_id and a.source_workout_id = b.source_workout_id
 and (a.published_at, a.id) < (b.published_at, b.id);
create unique index shared_activities_author_source_unique on public.shared_activities(user_id, source_workout_id);

-- Raw table transports expose only the caller's identity/secrets/source IDs.
do $$ declare r record;
begin
 for r in select tablename, policyname from pg_catalog.pg_policies
 where schemaname = 'public' and tablename in ('community_profiles','shared_activities','community_invitations','community_reactions')
 loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop;
end $$;
revoke all on public.community_profiles, public.shared_activities, public.community_invitations from authenticated, anon;
grant select on public.community_profiles, public.shared_activities, public.community_invitations to authenticated;
grant update(revoked_at) on public.shared_activities, public.community_invitations to authenticated;
create policy community_profile_owner_read on public.community_profiles for select to authenticated using(user_id = (select auth.uid()));
create policy community_card_owner_read on public.shared_activities for select to authenticated using(user_id = (select auth.uid()));
create policy community_card_owner_revoke on public.shared_activities for update to authenticated
using(user_id = (select auth.uid())) with check(user_id = (select auth.uid()) and revoked_at is not null);
create policy community_invite_owner_read on public.community_invitations for select to authenticated using(inviter_user_id = (select auth.uid()));
create policy community_invite_owner_revoke on public.community_invitations for update to authenticated
using(inviter_user_id = (select auth.uid())) with check(inviter_user_id = (select auth.uid()) and revoked_at is not null);

create function public.community_save_profile(p_handle text,p_display_name text,p_avatar_symbol text,p_bio text,p_is_searchable boolean)
returns setof public.community_profiles language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); existing public.community_profiles;
begin
 perform public.community_lock();
 if caller is null or not public.community_eligible(caller) then raise exception 'community_unavailable'; end if;
 select * into existing from public.community_profiles where user_id = caller;
 if existing.status = 'suspended' then raise exception 'community_unavailable'; end if;
 if existing.user_id is not null and existing.handle <> p_handle then raise exception 'community_conflict'; end if;
 if p_handle in ('admin','administrator','support','mizyun','moderator','community','official','system','help','root','staff','api','www','null','undefined')
 then raise exception 'community_handle_taken'; end if;
 return query insert into public.community_profiles(user_id,handle,display_name,avatar_symbol,bio,is_searchable,status,generation,terms_version,terms_accepted_at)
 values(caller,p_handle,p_display_name,coalesce(p_avatar_symbol,'MZ'),p_bio,coalesce(p_is_searchable,false),'active',
 case when existing.status = 'withdrawn' then existing.generation + 1 else coalesce(existing.generation,1) end,'2026-09-29',now())
 on conflict(user_id) do update set display_name = excluded.display_name, avatar_symbol = excluded.avatar_symbol,
 bio = excluded.bio, is_searchable = excluded.is_searchable, status = 'active', generation = excluded.generation,
 terms_version = excluded.terms_version, terms_accepted_at = case when existing.status = 'active' then existing.terms_accepted_at else now() end, updated_at = now()
 returning *;
 exception when unique_violation then raise exception 'community_handle_taken';
end $$;
create function public.community_withdraw_profile() returns void language plpgsql security definer set search_path = '' as $$
begin
 perform public.community_lock();
 update public.community_profiles set status = 'withdrawn', is_searchable = false, updated_at = now()
 where user_id = auth.uid() and status = 'active';
end $$;

-- Changes to private eligibility and accepted deletion invalidate social state
-- in the same local transaction; restoring age does not restore old artifacts.
create trigger community_lock_private_profile before update on public.profiles
for each statement execute function public.community_lock_write();
create function public.community_eligibility_cleanup() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if not public.community_eligible(new.id) then
  update public.community_profiles set status = 'withdrawn', is_searchable = false, updated_at = now() where user_id = new.id and status = 'active';
 end if;
 return new;
end $$;
create trigger community_eligibility_cleanup after update of birth_year on public.profiles
for each row execute function public.community_eligibility_cleanup();
create trigger community_lock_account_deletion before insert or update on public.account_deletion_jobs
for each statement execute function public.community_lock_write();
create function public.community_deletion_cleanup() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if new.status in ('in_progress','completed','failed') then
  update public.community_profiles set status = 'withdrawn', is_searchable = false, updated_at = now() where user_id = new.user_id and status = 'active';
 end if;
 return new;
end $$;
create trigger community_deletion_cleanup after insert or update on public.account_deletion_jobs
for each row execute function public.community_deletion_cleanup();

-- Exact lookups minimize strangers/pending invite identities. Approved peers may
-- see the social bio; there is no enumerable public profile table.
create function public.community_get_profile(p_user_id uuid) returns setof public.community_profiles
language plpgsql stable security definer set search_path = '' as $$
declare caller uuid := auth.uid(); result public.community_profiles; approved boolean; related boolean;
begin
 if caller is null then return; end if;
 select * into result from public.community_profiles where user_id = p_user_id;
 if result.user_id is null then return; end if;
 if caller = p_user_id then return next result; return; end if;
 if not public.community_active(caller) or not public.community_active(p_user_id)
 or public.community_blocked_between(caller,p_user_id) then return; end if;
 select exists(select 1 from public.community_relationships where status = 'approved'
 and follower_user_id = caller and target_user_id = p_user_id) into approved;
 select exists(select 1 from public.community_relationships where status in ('pending','approved')
 and ((follower_user_id = caller and target_user_id = p_user_id) or (follower_user_id = p_user_id and target_user_id = caller))) into related;
 if not result.is_searchable and not approved and not related then return; end if;
 if not approved then result.bio := null; end if;
 result.generation := 1; result.terms_version := null; result.terms_accepted_at := null;
 return next result;
end $$;
create function public.community_profile_by_handle(p_handle text) returns setof public.community_profiles
language plpgsql stable security definer set search_path = '' as $$
declare target uuid;
begin
 select user_id into target from public.community_profiles where handle = p_handle;
 if target is not null then return query select * from public.community_get_profile(target); end if;
end $$;

-- Availability reveals only reservation, never the identity of a hidden owner.
create function public.community_handle_available(p_handle text) returns table(available boolean)
language sql stable security definer set search_path = '' as $$
 select not exists(select 1 from public.community_profiles where handle = p_handle and user_id <> auth.uid())
 where auth.uid() is not null
$$;
create function public.community_resolve_invitation(p_token text) returns table(invitation jsonb, inviter jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare i public.community_invitations; p public.community_profiles;
begin
 if not public.community_active(auth.uid()) then return; end if;
 select * into i from public.community_invitations where token = p_token and revoked_at is null and expires_at > now();
 if i.id is null or not public.community_active(i.inviter_user_id) or public.community_blocked_between(auth.uid(),i.inviter_user_id) then return; end if;
 select * into p from public.community_profiles where user_id = i.inviter_user_id;
 if p.generation <> i.enrollment_generation then return; end if;
 return query select to_jsonb(i), jsonb_build_object('user_id',p.user_id,'handle',p.handle,'display_name',p.display_name,
 'avatar_symbol',p.avatar_symbol,'bio',null,'is_searchable',p.is_searchable,'status','active','generation',1,'created_at',p.created_at,'updated_at',p.updated_at);
end $$;
create function public.community_create_invitation(p_token text,p_expires_in_days integer)
returns setof public.community_invitations language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); gen integer;
begin
 perform public.community_lock();
 if not public.community_active(caller) then raise exception 'community_unavailable'; end if;
 if p_token !~ '^[A-Za-z0-9_-]{22}$' or p_expires_in_days not between 1 and 7 then raise exception 'community_conflict'; end if;
 if (select count(*) from public.community_invitations where inviter_user_id = caller and created_at > now() - interval '1 day') >= 20
 or (select count(*) from public.community_invitations where inviter_user_id = caller and revoked_at is null and expires_at > now()) >= 20 then raise exception 'community_rate_limited'; end if;
 select generation into gen from public.community_profiles where user_id = caller;
 return query insert into public.community_invitations(token,inviter_user_id,expires_at,enrollment_generation)
 values(p_token,caller,now() + make_interval(days => p_expires_in_days),gen) returning *;
end $$;

-- Only the recipient approves a pending edge; endpoints and request identity
-- are immutable. Serialize block/approval/request to prevent late resurrection.
revoke insert on public.community_relationships from authenticated;
-- Preserve declined/canceled request rows as cooldown tombstones. A requester
-- cancels pending requests; only approved follows are directly removable.
alter policy community_relationships_delete on public.community_relationships
using(status = 'approved' and (follower_user_id = (select auth.uid()) or target_user_id = (select auth.uid())));
create function public.community_request_follow(p_target_user_id uuid,p_invitation_token text default null)
returns setof public.community_relationships language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); existing public.community_relationships;
begin
 perform public.community_lock();
 if caller = p_target_user_id or not public.community_active(caller) or not public.community_active(p_target_user_id)
 or public.community_blocked_between(caller,p_target_user_id) then raise exception 'community_unavailable'; end if;
 if not exists(select 1 from public.community_profiles where user_id = p_target_user_id and is_searchable)
 and not exists(select 1 from public.community_relationships where follower_user_id = caller and target_user_id = p_target_user_id and status in ('approved','pending'))
 and not exists(select 1 from public.community_resolve_invitation(p_invitation_token) i where i.inviter->>'user_id' = p_target_user_id::text)
 then raise exception 'community_unavailable'; end if;
 select * into existing from public.community_relationships where follower_user_id = caller and target_user_id = p_target_user_id;
 if existing.status in ('pending','approved') then return next existing; return; end if;
 if existing.updated_at > now() - interval '48 hours' then raise exception 'community_rate_limited'; end if;
 if (select count(*) from public.community_relationships where follower_user_id = caller and status = 'pending') >= 20
 or (select count(*) from public.community_relationships where follower_user_id = caller and created_at > now() - interval '1 day') >= 50
 or (select count(*) from public.community_relationships where follower_user_id = caller and created_at > now() - interval '1 minute') >= 10 then raise exception 'community_rate_limited'; end if;
 return query insert into public.community_relationships(follower_user_id,target_user_id,status) values(caller,p_target_user_id,'pending')
 on conflict(follower_user_id,target_user_id) do update set status = 'pending', created_at = now(), updated_at = now() returning *;
end $$;
create function public.community_guard_relationship() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if new.id <> old.id or new.follower_user_id <> old.follower_user_id or new.target_user_id <> old.target_user_id then
  if auth.role() = 'authenticated' then raise exception 'community_conflict'; end if;
 end if;
 if auth.role() = 'authenticated' and new.created_at <> old.created_at and not (new.status = 'pending' and auth.uid() = old.follower_user_id and old.status in ('canceled','declined') and old.updated_at <= now() - interval '48 hours') then raise exception 'community_conflict'; end if;
 if auth.role() = 'authenticated' and not (new.status = 'pending' and auth.uid() = old.follower_user_id and old.status in ('canceled','declined') and old.updated_at <= now() - interval '48 hours') then
  if not public.community_active(auth.uid()) or public.community_blocked_between(old.follower_user_id,old.target_user_id)
    or (old.status <> 'pending' and old.status <> new.status) or not ((auth.uid() = old.target_user_id and new.status in ('approved','declined'))
      or (auth.uid() = old.follower_user_id and new.status = 'canceled')) then raise exception 'community_unavailable'; end if;
 end if;
 new.updated_at := now(); return new;
end $$;
create trigger community_guard_relationship before update on public.community_relationships
for each row execute function public.community_guard_relationship();
create function public.community_relationship_cleanup() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if old.status = 'approved' then
 delete from public.community_reactions where user_id = old.follower_user_id
 and activity_id in(select id from public.shared_activities where user_id = old.target_user_id);
 end if;
 return old;
end $$;
create trigger community_relationship_cleanup after delete on public.community_relationships
for each row execute function public.community_relationship_cleanup();

create function public.community_card_cleanup() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if new.revoked_at is not null or new.version <> old.version then
 delete from public.community_reactions where activity_id = new.id;
 end if;
 return new;
end $$;
create trigger community_card_cleanup after update on public.shared_activities
for each row execute function public.community_card_cleanup();
create function public.community_source_cleanup() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if new.completed_at is null or new.details #>> '{workoutLifecycle,kind}' is distinct from 'session' then
 update public.shared_activities set revoked_at = coalesce(revoked_at,now()) where source_workout_id = new.id;
 end if;
 return new;
end $$;
create trigger community_source_cleanup after update on public.workouts
for each row execute function public.community_source_cleanup();

create function public.community_publish_activity(p_source_workout_id uuid,p_category text,p_shared_day text,p_duration_seconds integer,p_enrollment_generation integer,p_operation_id uuid)
returns setof public.shared_activities language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); gen integer; existing public.shared_activities; op public.community_publication_operations;
 source public.workouts; payload jsonb;
begin
 perform public.community_lock();
 if not public.community_active(caller) then raise exception 'community_unavailable'; end if;
 select generation into gen from public.community_profiles where user_id = caller;
 if gen <> p_enrollment_generation or p_operation_id is null then raise exception 'community_conflict'; end if;
 select * into source from public.workouts where id = p_source_workout_id and user_id = caller;
 if source.id is null or source.completed_at is null or source.details #>> '{workoutLifecycle,kind}' is distinct from 'session' then raise exception 'community_unavailable'; end if;
 if p_shared_day::date::text <> p_shared_day or p_shared_day::date not between (source.completed_at at time zone 'UTC')::date - 1 and (source.completed_at at time zone 'UTC')::date + 1
 or (p_duration_seconds is not null and p_duration_seconds <> greatest(0,floor(extract(epoch from(source.completed_at-source.started_at)))::integer)) then raise exception 'community_conflict'; end if;
 payload := jsonb_build_object('source',p_source_workout_id,'category',p_category,'day',p_shared_day,'duration',p_duration_seconds);
 select * into op from public.community_publication_operations where user_id = caller and operation_id = p_operation_id;
 if op.operation_id is not null then
  select * into existing from public.shared_activities where id = op.activity_id;
  if existing.id is null or op.enrollment_generation <> gen or op.payload <> payload or existing.revoked_at is not null or op.activity_version <> existing.version then raise exception 'community_conflict'; end if;
  return next existing; return;
 end if;
 select * into existing from public.shared_activities where user_id = caller and source_workout_id = p_source_workout_id;
 if existing.id is null then
  insert into public.shared_activities(user_id,source_workout_id,category,shared_day,duration_seconds,enrollment_generation)
  values(caller,p_source_workout_id,p_category,p_shared_day,p_duration_seconds,gen) returning * into existing;
 else
  update public.shared_activities set category = p_category, shared_day = p_shared_day, duration_seconds = p_duration_seconds,
  enrollment_generation = gen, revoked_at = null, version = version + 1, published_at = now() where id = existing.id returning * into existing;
 end if;
 insert into public.community_publication_operations(user_id,operation_id,enrollment_generation,activity_id,activity_version,payload)
 values(caller,p_operation_id,gen,existing.id,existing.version,payload);
 return next existing;
end $$;
create function public.community_update_activity(p_activity_id uuid,p_duration_seconds integer)
returns setof public.shared_activities language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); a public.shared_activities; source public.workouts;
begin
 perform public.community_lock();
 select * into a from public.shared_activities where id = p_activity_id and user_id = caller and revoked_at is null;
 if a.id is null or not public.community_active(caller) or a.enrollment_generation <> (select generation from public.community_profiles where user_id = caller) then raise exception 'community_unavailable'; end if;
 select * into source from public.workouts where id = a.source_workout_id and user_id = caller;
 if source.completed_at is null or source.details #>> '{workoutLifecycle,kind}' is distinct from 'session'
 or (p_duration_seconds is not null and p_duration_seconds <> greatest(0,floor(extract(epoch from(source.completed_at-source.started_at)))::integer)) then raise exception 'community_conflict'; end if;
 if a.duration_seconds is not distinct from p_duration_seconds then return next a; return; end if;
 return query update public.shared_activities set duration_seconds = p_duration_seconds, version = version + 1
 where id = p_activity_id returning *;
end $$;

create function public.community_can_view_card(p_activity_id uuid) returns boolean
language sql volatile security definer set search_path = '' as $$
 select exists(select 1 from public.shared_activities a join public.community_profiles p on p.user_id = a.user_id
 where a.id = p_activity_id and a.revoked_at is null and a.enrollment_generation = p.generation
 and public.community_active(auth.uid()) and public.community_active(a.user_id)
 and not public.community_blocked_between(auth.uid(),a.user_id)
 and (a.user_id = auth.uid() or exists(select 1 from public.community_relationships r where r.follower_user_id = auth.uid() and r.target_user_id = a.user_id and r.status = 'approved')))
$$;
create function public.community_get_activity(p_activity_id uuid) returns setof public.shared_activities
language plpgsql stable security definer set search_path = '' as $$
declare a public.shared_activities;
begin
 select * into a from public.shared_activities where id = p_activity_id;
 if a.id is null then return; end if;
 if a.user_id <> auth.uid() and not public.community_can_view_card(a.id) then return; end if;
 if a.user_id <> auth.uid() then a.source_workout_id := '00000000-0000-0000-0000-000000000000'; end if;
 if auth.uid() is null then return; end if;
 return next a;
end $$;
create function public.community_feed(p_limit integer,p_before_time timestamptz,p_before_id uuid)
returns setof public.shared_activities language plpgsql stable security definer set search_path = '' as $$
declare a public.shared_activities;
begin
 for a in select * from public.shared_activities s where public.community_can_view_card(s.id)
 and (p_before_time is null or (s.published_at,s.id) < (p_before_time,p_before_id))
 order by s.published_at desc,s.id desc limit greatest(1,least(coalesce(p_limit,20),50)) loop
 if a.user_id <> auth.uid() then a.source_workout_id := '00000000-0000-0000-0000-000000000000'; end if;
 return next a;
 end loop;
end $$;
create trigger community_lock_reaction before insert or update or delete on public.community_reactions
for each statement execute function public.community_lock_write();
create function public.community_guard_reaction() returns trigger language plpgsql volatile security definer set search_path = '' as $$
begin
 if auth.role() = 'authenticated' and (new.user_id <> auth.uid() or not public.community_can_view_card(new.activity_id) or exists(select 1 from public.shared_activities where id = new.activity_id and user_id = new.user_id)) then raise exception 'community_unavailable'; end if;
 if TG_OP = 'UPDATE' and (new.user_id <> old.user_id or new.activity_id <> old.activity_id or new.id <> old.id) then raise exception 'community_conflict'; end if;
 return new;
end $$;
create trigger community_guard_reaction before insert or update on public.community_reactions for each row execute function public.community_guard_reaction();
create policy community_reaction_read on public.community_reactions for select to authenticated
using(public.community_can_view_card(activity_id));
create policy community_reaction_write on public.community_reactions for all to authenticated
using(user_id = (select auth.uid()) and public.community_can_view_card(activity_id))
with check(user_id = (select auth.uid()) and public.community_can_view_card(activity_id));
-- Staff-owned moderation status cannot be supplied by a reporter.
drop policy community_reports_insert on public.community_reports;
create policy community_reports_insert on public.community_reports for insert to authenticated
with check(reporter_user_id = (select auth.uid()) and status = 'submitted' and public.community_active((select auth.uid())));
revoke update, delete on public.community_reports from authenticated;

create function public.community_delete_all_for_user() returns table(deleted_count bigint)
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); n bigint := 0; c bigint;
begin
 if caller is null then raise exception 'community_unavailable'; end if;
 perform public.community_withdraw_profile();
 delete from public.shared_activities where user_id = caller; get diagnostics c = row_count; n := n + c;
 delete from public.community_reactions where user_id = caller; get diagnostics c = row_count; n := n + c;
 delete from public.community_reports where reporter_user_id = caller; get diagnostics c = row_count; n := n + c;
 delete from public.community_invitations where inviter_user_id = caller; get diagnostics c = row_count; n := n + c;
 delete from public.community_relationships where follower_user_id = caller or target_user_id = caller; get diagnostics c = row_count; n := n + c;
 -- Stable sanctions/blocks intentionally survive social withdrawal. Actual Auth
 -- account deletion cascades auth.users FKs through the existing deletion worker.
 return query select n;
end $$;

-- No anonymous access; internal definer helpers cannot be invoked as arbitrary
-- user oracles. Policies invoke the minimum auth-relative predicate only.
do $$ declare r record;
begin
 for r in select p.oid::regprocedure as signature, p.proname from pg_catalog.pg_proc p
 join pg_catalog.pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and (p.proname like 'community_%' or p.proname = 'handle_community_block_inserted') loop
 execute format('revoke all on function %s from public, anon, authenticated',r.signature);
 if r.proname in ('community_save_profile','community_withdraw_profile','community_get_profile','community_profile_by_handle',
 'community_handle_available','community_resolve_invitation','community_create_invitation','community_is_blocked','community_request_follow',
 'community_publish_activity','community_update_activity','community_get_activity','community_feed','community_can_view_card','community_delete_all_for_user') then
 execute format('grant execute on function %s to authenticated',r.signature);
 end if;
 end loop;
end $$;
revoke all on public.community_relationships,public.community_blocks,public.community_reactions,public.community_reports from anon;
commit;
