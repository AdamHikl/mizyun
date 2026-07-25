-- AI-OPS-001: durable, replica-safe, plan-tier-aware limiter.
-- Replaces the single-process Map-based limiter used during AI-MOB-001.
-- One migration introduces four tables, one enum, one plan_tier column,
-- and the SECURITY DEFINER RPCs that the API calls. RLS keeps each
-- user to their own rows. The service_role is the only writer; the
-- per-request user client only reads.

set check_function_bodies = off;

-- =========================================================================
-- 1. profile.plan_tier
-- =========================================================================

alter table public.profiles
  add column if not exists plan_tier text not null default 'free'
  check (plan_tier in ('free', 'paid'));

-- =========================================================================
-- 2. ai_provider_call_status enum + four limiter tables
-- =========================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'ai_provider_call_status') then
    create type public.ai_provider_call_status as enum (
      'attempting',
      'succeeded',
      'failed',
      'replayed'
    );
  end if;
end $$;

create table if not exists public.ai_daily_token_ledger (
  user_id      uuid not null references auth.users(id) on delete cascade,
  day          date not null,
  tokens_used  integer not null default 0 check (tokens_used >= 0),
  updated_at   timestamptz not null default now(),
  primary key (user_id, day)
);
create index if not exists ai_daily_token_ledger_day_idx
  on public.ai_daily_token_ledger(day);

create table if not exists public.ai_request_windows (
  user_id       uuid not null references auth.users(id) on delete cascade,
  window_start  timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, window_start)
);
create index if not exists ai_request_windows_window_idx
  on public.ai_request_windows(window_start);

create table if not exists public.ai_in_flight (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  in_flight   integer not null default 0 check (in_flight >= 0),
  acquired_at timestamptz not null default now()
);

create table if not exists public.ai_provider_calls (
  provider_call_id uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  conversation_id  uuid not null,
  idempotency_key  text not null,
  result_status    public.ai_provider_call_status not null default 'attempting',
  message_id       uuid,
  tokens_used      integer not null default 0 check (tokens_used >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, conversation_id, idempotency_key),
  foreign key (conversation_id, user_id)
    references public.conversations(id, user_id) on delete cascade
);
create index if not exists ai_provider_calls_user_idx
  on public.ai_provider_calls(user_id, created_at desc);

-- =========================================================================
-- 3. Row Level Security
-- =========================================================================

alter table public.ai_daily_token_ledger enable row level security;
alter table public.ai_request_windows    enable row level security;
alter table public.ai_in_flight            enable row level security;
alter table public.ai_provider_calls       enable row level security;

drop policy if exists ai_daily_token_ledger_select on public.ai_daily_token_ledger;
create policy ai_daily_token_ledger_select on public.ai_daily_token_ledger
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists ai_request_windows_select on public.ai_request_windows;
create policy ai_request_windows_select on public.ai_request_windows
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists ai_in_flight_select on public.ai_in_flight;
create policy ai_in_flight_select on public.ai_in_flight
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists ai_provider_calls_select on public.ai_provider_calls;
create policy ai_provider_calls_select on public.ai_provider_calls
  for select to authenticated using (auth.uid() = user_id);

-- =========================================================================
-- 4. SECURITY DEFINER RPCs (service_role only)
-- =========================================================================

create or replace function public.ai_lock_key(p_kind text, p_user_id uuid, p_conversation_id uuid, p_idempotency_key text)
returns bigint
language sql immutable security definer set search_path = '' as $$
  -- 64-bit FNV-1a of (kind || ':' || userId || ':' || coalesce(convId,'') || ':' || coalesce(key,'')).
  -- Stable across replicas; collisions acceptable since the advisory
  -- lock namespace is private to Mizyun.
  select (
    ('x' || substr(md5(p_kind || ':' || p_user_id::text || ':' || coalesce(p_conversation_id::text,'') || ':' || coalesce(p_idempotency_key,''))), 1, 16)
  )::bit(64)::bigint;
$$;

create or replace function public.ai_reserve_tokens(
  p_user_id uuid, p_day date, p_budget integer, p_needed integer)
returns table(allowed boolean, tokens_used integer, retry_after integer)
language plpgsql security definer set search_path = '' as $$
declare
  cur integer;
begin
  insert into public.ai_daily_token_ledger(user_id, day, tokens_used)
  values (p_user_id, p_day, 0)
  on conflict (user_id, day) do nothing;
  select ledger.tokens_used into cur
    from public.ai_daily_token_ledger as ledger
    where ledger.user_id = p_user_id and ledger.day = p_day for update;
  if cur + p_needed > p_budget then
    return query select false, cur,
      greatest(1, ceil(extract(epoch from ((p_day + 1)::timestamp - now()))))::int;
  end if;
  return query select true, cur, 0;
end; $$;

create or replace function public.ai_commit_tokens(
  p_user_id uuid, p_day date, p_tokens integer)
returns void language sql security definer set search_path = '' as $$
  update public.ai_daily_token_ledger
    set tokens_used = tokens_used + p_tokens, updated_at = now()
    where user_id = p_user_id and day = p_day;
$$;

create or replace function public.ai_register_request(
  p_user_id uuid, p_now timestamptz, p_per_minute integer)
returns table(allowed boolean, retry_after integer)
language plpgsql security definer set search_path = '' as $$
declare
  ws timestamp := date_trunc('minute', p_now);
  cur integer;
begin
  insert into public.ai_request_windows(user_id, window_start, request_count)
  values (p_user_id, ws, 0)
  on conflict (user_id, window_start) do nothing;
  select request_count into cur
    from public.ai_request_windows
    where user_id = p_user_id and window_start = ws for update;
  if cur >= p_per_minute then
    return query select false,
      greatest(1, ceil(extract(epoch from (ws + interval '1 minute' - p_now))))::int;
  end if;
  update public.ai_request_windows
    set request_count = request_count + 1
    where user_id = p_user_id and window_start = ws;
  return query select true, 0;
end; $$;

create or replace function public.ai_acquire_in_flight(p_user_id uuid, p_max integer)
returns table(allowed boolean)
language plpgsql security definer set search_path = '' as $$
declare cur integer;
begin
  insert into public.ai_in_flight(user_id, in_flight, acquired_at)
  values (p_user_id, 1, now())
  on conflict (user_id) do update set in_flight = public.ai_in_flight.in_flight + 1,
                                  acquired_at = now()
  returning in_flight into cur;
  return query select cur <= p_max;
end; $$;

create or replace function public.ai_release_in_flight(p_user_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.ai_in_flight
    set in_flight = greatest(0, in_flight - 1)
    where user_id = p_user_id;
$$;

create or replace function public.ai_reserve_provider_call(
  p_user_id uuid, p_conversation_id uuid, p_idempotency_key text)
returns table(outcome text, call_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  found_row public.ai_provider_calls%rowtype;
  inserted_id uuid;
begin
  select * into found_row from public.ai_provider_calls
    where user_id = p_user_id
      and conversation_id = p_conversation_id
      and idempotency_key = p_idempotency_key
    for update;
  if found then
    if found_row.result_status = 'failed' then
      return query select 'conflict', null::uuid;
    else
      return query select 'replayed', found_row.provider_call_id as call_id;
    end if;
    return;
  end if;
  insert into public.ai_provider_calls(user_id, conversation_id, idempotency_key, result_status, tokens_used)
  values (p_user_id, p_conversation_id, p_idempotency_key, 'attempting', 0)
  returning provider_call_id into inserted_id;
  return query select 'reserved', inserted_id as call_id;
  return;
exception when unique_violation then
  select * into found_row from public.ai_provider_calls
    where user_id = p_user_id
      and conversation_id = p_conversation_id
      and idempotency_key = p_idempotency_key;
  return query select 'replayed', found_row.provider_call_id as call_id;
  return;
end; $$;

create or replace function public.ai_complete_provider_call(
  p_provider_call_id uuid, p_status public.ai_provider_call_status,
  p_message_id uuid, p_tokens integer)
returns void language sql security definer set search_path = '' as $$
  update public.ai_provider_calls
    set result_status = p_status,
        message_id = coalesce(p_message_id, message_id),
        tokens_used = case when p_status = 'succeeded'
                           then greatest(tokens_used, p_tokens)
                           else tokens_used end,
        updated_at = now()
    where provider_call_id = p_provider_call_id;
$$;

-- =========================================================================
-- 5. Grants
-- =========================================================================

grant select on public.ai_daily_token_ledger to authenticated;
grant select on public.ai_request_windows    to authenticated;
grant select on public.ai_in_flight            to authenticated;
grant select on public.ai_provider_calls       to authenticated;

grant execute on function
  public.ai_lock_key(text, uuid, uuid, text),
  public.ai_reserve_tokens(uuid, date, integer, integer),
  public.ai_commit_tokens(uuid, date, integer),
  public.ai_register_request(uuid, timestamptz, integer),
  public.ai_acquire_in_flight(uuid, integer),
  public.ai_release_in_flight(uuid),
  public.ai_reserve_provider_call(uuid, uuid, text),
  public.ai_complete_provider_call(uuid, public.ai_provider_call_status, uuid, integer)
to service_role;
