-- Decorative private illustrations. This feature is disabled until provider acceptance.
-- Counts are charged at admission, including failed/unknown attempts; never refunded.
alter table public.food_entries add constraint food_entries_illustration_owner_key unique(id,user_id);
create table public.meal_illustrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_entry_id uuid not null,
  foreign key(source_entry_id,user_id) references public.food_entries(id,user_id) on delete cascade,
  dish_key text not null check (dish_key ~ '^[a-f0-9]{64}$'),
  state text not null default 'generating' check (state in ('generating','ready','failed','unknown')),
  created_at timestamptz not null default now(),
  lease_until timestamptz not null default now() + interval '2 minutes',
  image_base64 text,
  unique(user_id, dish_key),
  check ((state = 'ready') = (image_base64 is not null)),
  check (image_base64 is null or (length(image_base64) <= 349528 and octet_length(decode(image_base64, 'base64')) <= 262144))
);
create index meal_illustrations_user_idx on public.meal_illustrations(user_id, created_at);
create index meal_illustrations_source_idx on public.meal_illustrations(source_entry_id);
create index meal_illustrations_active_idx on public.meal_illustrations(lease_until) where state = 'generating';
alter table public.meal_illustrations enable row level security;
create policy meal_illustrations_select on public.meal_illustrations for select to authenticated using(user_id = auth.uid());
grant select on public.meal_illustrations to authenticated;
revoke insert, update, delete on public.meal_illustrations from authenticated, anon;
grant all on public.meal_illustrations to service_role;

-- Aggregate-only counters intentionally survive account deletion; contain no user keys.
create table public.meal_illustration_environment_usage (
  day date primary key,
  attempts integer not null default 0 check(attempts >= 0)
);
alter table public.meal_illustration_environment_usage enable row level security;
revoke all on public.meal_illustration_environment_usage from authenticated, anon;
grant all on public.meal_illustration_environment_usage to service_role;


-- Owner counters survive meal/cache deletion and are erased only with the account.
create table public.meal_illustration_user_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  attempts integer not null default 0 check(attempts >= 0),
  primary key(user_id,day)
);
alter table public.meal_illustration_user_usage enable row level security;
create policy meal_illustration_usage_select on public.meal_illustration_user_usage for select to authenticated using(user_id=auth.uid());
grant select on public.meal_illustration_user_usage to authenticated;
revoke insert,update,delete on public.meal_illustration_user_usage from authenticated,anon;
grant all on public.meal_illustration_user_usage to service_role;

create function public.meal_illustration_source_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.name is distinct from old.name or new.photo_asset_id is distinct from old.photo_asset_id then
    delete from public.meal_illustrations where source_entry_id=old.id;
  end if;
  return new;
end $$;
create trigger meal_illustration_source_changed after update of name,photo_asset_id on public.food_entries
for each row execute function public.meal_illustration_source_changed();
revoke all on function public.meal_illustration_source_changed() from public,anon,authenticated;

create function public.meal_illustration_authorized(p_user_id uuid, p_consent_version text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare c public.user_ai_consents%rowtype; byear integer;
begin
  select * into c from public.user_ai_consents where user_id = p_user_id for share;
  select birth_year into byear from public.profiles where id = p_user_id for share;
  return coalesce(c.granted and c.confirmed_adult and c.revoked_at is null and c.consent_version = p_consent_version
    and byear <= extract(year from timezone('UTC',now()))::integer - 18
    and not exists(select 1 from public.account_deletion_jobs where user_id = p_user_id and status in ('in_progress','completed','failed')), false);
end $$;

create function public.meal_illustration_claim(p_user_id uuid, p_key text, p_consent_version text, p_source_entry_id uuid)
returns table(id uuid,user_id uuid,source_entry_id uuid,dish_key text,state text,created_at timestamptz,lease_until timestamptz,image_base64 text,claimed boolean)
language plpgsql security definer set search_path = '' as $$
declare r public.meal_illustrations%rowtype; d date := timezone('UTC',now())::date; m date := date_trunc('month',timezone('UTC',now()))::date;
begin
  if p_key !~ '^[a-f0-9]{64}$' then return; end if;
  perform pg_advisory_xact_lock(7391540821);
  if not public.meal_illustration_authorized(p_user_id,p_consent_version) then return; end if;
  perform 1 from public.food_entries f where f.id=p_source_entry_id and f.user_id=p_user_id and f.photo_asset_id is null for share;
  if not found then return; end if;
  update public.meal_illustrations mi set state = 'unknown' where mi.state = 'generating' and mi.lease_until <= now();
  select * into r from public.meal_illustrations mi where mi.user_id = p_user_id and mi.dish_key = p_key;
  if found then
    return query select r.id,r.user_id,r.source_entry_id,r.dish_key,r.state,r.created_at,r.lease_until,r.image_base64,false;
    return;
  end if;
  if (select coalesce(sum(u.attempts),0) from public.meal_illustration_user_usage u where u.user_id=p_user_id and u.day=d) >= 5
    or (select coalesce(sum(u.attempts),0) from public.meal_illustration_user_usage u where u.user_id=p_user_id and u.day>=m) >= 30
    or (select coalesce(sum(u.attempts),0) from public.meal_illustration_environment_usage u where u.day = d) >= 50
    or (select coalesce(sum(u.attempts),0) from public.meal_illustration_environment_usage u where u.day >= m) >= 500
    or (select count(*) from public.meal_illustrations mi where mi.state = 'generating') >= 2
    or exists(select 1 from public.meal_illustrations mi where mi.user_id = p_user_id and mi.state = 'generating') then return; end if;
  insert into public.meal_illustration_environment_usage(day,attempts) values(d,1)
    on conflict(day) do update set attempts = public.meal_illustration_environment_usage.attempts + 1;
  insert into public.meal_illustration_user_usage(user_id,day,attempts) values(p_user_id,d,1)
    on conflict on constraint meal_illustration_user_usage_pkey do update set attempts=public.meal_illustration_user_usage.attempts+1;
  insert into public.meal_illustrations(user_id,dish_key,source_entry_id) values(p_user_id,p_key,p_source_entry_id) returning * into r;
  return query select r.id,r.user_id,r.source_entry_id,r.dish_key,r.state,r.created_at,r.lease_until,r.image_base64,true;
end $$;

create function public.meal_illustration_complete(p_user_id uuid,p_id uuid,p_base64 text,p_consent_version text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.meal_illustration_authorized(p_user_id,p_consent_version) then
    update public.meal_illustrations set state = 'failed' where id = p_id and user_id = p_user_id and state = 'generating';
    return;
  end if;
  if length(p_base64) > 349528 or octet_length(decode(p_base64,'base64')) > 262144 then raise exception 'Invalid illustration size'; end if;
  update public.meal_illustrations set image_base64 = p_base64, state = 'ready'
    where id = p_id and user_id = p_user_id and state = 'generating' and lease_until > now();
end $$;

create function public.meal_illustration_fail(p_user_id uuid,p_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.meal_illustrations set state = 'failed' where id = p_id and user_id = p_user_id and state = 'generating';
$$;
revoke all on function public.meal_illustration_authorized(uuid,text), public.meal_illustration_claim(uuid,text,text,uuid), public.meal_illustration_complete(uuid,uuid,text,text), public.meal_illustration_fail(uuid,uuid) from public, anon, authenticated;
grant execute on function public.meal_illustration_authorized(uuid,text), public.meal_illustration_claim(uuid,text,text,uuid), public.meal_illustration_complete(uuid,uuid,text,text), public.meal_illustration_fail(uuid,uuid) to service_role;
