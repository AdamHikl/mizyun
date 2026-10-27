-- PRIV-01: explicit, versioned consent to store and use health data
-- (GDPR Art. 9(2)(a)). One current row per user plus an append-only history
-- so a grant or withdrawal can be demonstrated (Art. 7(1)). Both are owner
-- scoped by RLS and removed with the account (auth.users cascade).

set check_function_bodies = off;

create table if not exists public.user_health_data_consents (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  granted         boolean not null,
  consent_version text not null check (char_length(consent_version) between 1 and 32),
  consented_at    timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint user_health_data_consents_state check (
    (granted and consented_at is not null and revoked_at is null)
    or (not granted and consented_at is null and revoked_at is not null)
  )
);

create index if not exists user_health_data_consents_user_idx
  on public.user_health_data_consents(user_id);

alter table public.user_health_data_consents enable row level security;

drop policy if exists user_health_data_consents_select on public.user_health_data_consents;
create policy user_health_data_consents_select on public.user_health_data_consents
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists user_health_data_consents_insert on public.user_health_data_consents;
create policy user_health_data_consents_insert on public.user_health_data_consents
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists user_health_data_consents_update on public.user_health_data_consents;
create policy user_health_data_consents_update on public.user_health_data_consents
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

revoke all on table public.user_health_data_consents from anon, authenticated;
grant select, insert, update on table public.user_health_data_consents to authenticated;
grant all privileges on table public.user_health_data_consents to service_role;

create table if not exists public.user_health_data_consent_events (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  granted         boolean not null,
  consent_version text not null,
  recorded_at     timestamptz not null default now()
);

create index if not exists user_health_data_consent_events_user_idx
  on public.user_health_data_consent_events(user_id, recorded_at);

alter table public.user_health_data_consent_events enable row level security;

drop policy if exists user_health_data_consent_events_select on public.user_health_data_consent_events;
create policy user_health_data_consent_events_select on public.user_health_data_consent_events
  for select to authenticated using (auth.uid() = user_id);

-- Clients only read their history; rows come from the trigger below.
revoke all on table public.user_health_data_consent_events from anon, authenticated;
grant select on table public.user_health_data_consent_events to authenticated;
grant all privileges on table public.user_health_data_consent_events to service_role;

-- The database, not the caller, sets the consent times, so a client writing
-- the row directly through PostgREST cannot backdate or forge them. A repeat
-- grant of the same version keeps the original consent time.
create or replace function public.stamp_health_data_consent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  if new.granted then
    new.revoked_at := null;
    new.consented_at := case
      when tg_op = 'UPDATE' and old.granted and old.consent_version = new.consent_version
        then old.consented_at
      else now()
    end;
  else
    new.consented_at := null;
    new.revoked_at := case
      when tg_op = 'UPDATE' and not old.granted then old.revoked_at
      else now()
    end;
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_health_data_consent() from public, anon, authenticated;

drop trigger if exists user_health_data_consents_stamp on public.user_health_data_consents;
create trigger user_health_data_consents_stamp
  before insert or update on public.user_health_data_consents
  for each row execute function public.stamp_health_data_consent();

create or replace function public.record_health_data_consent_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or new.granted is distinct from old.granted
     or new.consent_version is distinct from old.consent_version then
    insert into public.user_health_data_consent_events(user_id, granted, consent_version, recorded_at)
    values (new.user_id, new.granted, new.consent_version, now());
  end if;
  return new;
end;
$$;

revoke all on function public.record_health_data_consent_event() from public, anon, authenticated;

drop trigger if exists user_health_data_consents_history on public.user_health_data_consents;
create trigger user_health_data_consents_history
  after insert or update on public.user_health_data_consents
  for each row execute function public.record_health_data_consent_event();
