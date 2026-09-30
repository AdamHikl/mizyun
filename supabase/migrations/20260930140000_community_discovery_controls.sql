-- #144: durable combined actor budget; no query, bearer token or source address persisted.
create table public.community_discovery_attempts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
create index community_discovery_attempts_user_id_idx on public.community_discovery_attempts(user_id,created_at);
alter table public.community_discovery_attempts enable row level security;
revoke all on public.community_discovery_attempts from public, anon, authenticated;
grant all on public.community_discovery_attempts to service_role;

create function public.community_discovery_attempt() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare caller uuid := auth.uid(); day_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
begin
 perform public.community_lock();
 if not public.community_active(caller) then raise exception 'community_unavailable'; end if;
 delete from public.community_discovery_attempts where created_at < least(day_start, now() - interval '1 minute');
 if (select count(*) from public.community_discovery_attempts where user_id = caller and created_at > now() - interval '1 minute') >= 30
 or (select count(*) from public.community_discovery_attempts where user_id = caller and created_at >= day_start) >= 120
 then raise exception 'community_rate_limited'; end if;
 insert into public.community_discovery_attempts(user_id) values(caller);
end $$;
revoke all on function public.community_discovery_attempt() from public, anon, authenticated;

-- Search preference applies even when the viewer already has a relationship.
-- Known-edge profile views remain separately available through community_get_profile.
create or replace function public.community_profile_by_handle(p_handle text) returns setof public.community_profiles
language plpgsql volatile security definer set search_path = '' as $$
declare result public.community_profiles; caller uuid := auth.uid();
begin
 perform public.community_discovery_attempt();
 select * into result from public.community_profiles where handle = lower(btrim(p_handle)) and is_searchable;
 if result.user_id is null or result.user_id = caller or not public.community_active(result.user_id)
 or public.community_blocked_between(caller,result.user_id) then return; end if;
 result.bio := null; result.generation := 1; result.terms_version := null;
 result.terms_accepted_at := null; result.adult_declared_at := null;
 return next result;
end $$;

-- Database isolation is the environment boundary: tokens are random 128-bit
-- bearers issued only into this backend's Auth/database resource. Resolution
-- cannot reach the other environment and checks current enrollment generation.
create or replace function public.community_resolve_invitation(p_token text) returns table(invitation jsonb, inviter jsonb)
language plpgsql volatile security definer set search_path = '' as $$
declare i public.community_invitations; p public.community_profiles;
begin
 perform public.community_discovery_attempt();
 select * into i from public.community_invitations where token = p_token and revoked_at is null and expires_at > now();
 if i.id is null or not public.community_active(i.inviter_user_id) or public.community_blocked_between(auth.uid(),i.inviter_user_id) then return; end if;
 select * into p from public.community_profiles where user_id = i.inviter_user_id;
 if p.generation <> i.enrollment_generation then return; end if;
 return query select jsonb_build_object('id',i.id,'token',i.token,'inviter_user_id',i.inviter_user_id,
 'expires_at',i.expires_at,'revoked_at',i.revoked_at,'created_at',i.created_at), jsonb_build_object('user_id',p.user_id,'handle',p.handle,'display_name',p.display_name,
 'avatar_symbol',p.avatar_symbol,'bio',null,'is_searchable',p.is_searchable,'status','active','generation',1,'created_at',p.created_at,'updated_at',p.updated_at);
end $$;
revoke all on function public.community_profile_by_handle(text),public.community_resolve_invitation(text) from public, anon;
grant execute on function public.community_profile_by_handle(text),public.community_resolve_invitation(text) to authenticated;

-- Daily issuance authority survives social cleanup/withdrawal; account erasure
-- cascades it. Only UTC-day aggregate counts are kept, without bearer secrets.
create table public.community_invitation_usage (
 user_id uuid not null references auth.users(id) on delete cascade,
 utc_day date not null,
 issued_count integer not null check(issued_count between 0 and 20),
 primary key(user_id,utc_day)
);
alter table public.community_invitation_usage enable row level security;
revoke all on public.community_invitation_usage from public, anon, authenticated;
grant all on public.community_invitation_usage to service_role;
insert into public.community_invitation_usage(user_id,utc_day,issued_count)
select inviter_user_id,(created_at at time zone 'UTC')::date,least(count(*),20)::integer
from public.community_invitations
where created_at >= (date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')
group by inviter_user_id,(created_at at time zone 'UTC')::date;

-- Issuance uses the same fixed UTC-day convention as every daily pilot budget.
create or replace function public.community_create_invitation(p_token text,p_expires_in_days integer)
returns setof public.community_invitations language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); gen integer; issued integer; day_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'; current_utc_day date := (now() at time zone 'UTC')::date;
begin
 perform public.community_lock();
 if not public.community_active(caller) then raise exception 'community_unavailable'; end if;
 if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' or p_expires_in_days is null or p_expires_in_days not between 1 and 7 then raise exception 'community_conflict'; end if;
 delete from public.community_invitation_usage u where u.utc_day < current_utc_day;
 select greatest(coalesce((select u.issued_count from public.community_invitation_usage u where u.user_id = caller and u.utc_day = current_utc_day),0),
 (select count(*)::integer from public.community_invitations where inviter_user_id = caller and created_at >= day_start)) into issued;
 if issued >= 20
 or (select count(*) from public.community_invitations where inviter_user_id = caller and revoked_at is null and expires_at > now()) >= 20 then raise exception 'community_rate_limited'; end if;
 insert into public.community_invitation_usage(user_id,utc_day,issued_count) values(caller,current_utc_day,issued+1)
 on conflict(user_id,utc_day) do update set issued_count = excluded.issued_count;
 select generation into gen from public.community_profiles where user_id = caller;
 return query insert into public.community_invitations(token,inviter_user_id,expires_at,enrollment_generation)
 values(p_token,caller,now() + make_interval(days => p_expires_in_days),gen) returning *;
end $$;
