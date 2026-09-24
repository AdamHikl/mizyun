-- REL-AUD-006: Fix AI token reservations, commit/release settlement, and in-flight lease recovery.
-- 1. ai_reserve_tokens: add missing return; on budget check failure to prevent fallthrough.
-- 2. ai_commit_tokens: accept optional p_tokens_reserved; decrement reserved and increment used.
-- 3. ai_release_token_reservation: release unused token reservation back to daily pool.
-- 4. ai_acquire_in_flight: reset in_flight lease to 1 after 2-minute expiration.
-- 5. Tighten permissions: revoke execute from public, anon, authenticated; grant to service_role.

set check_function_bodies = off;

-- =========================================================================
-- 1. ai_reserve_tokens (fix fallthrough bug)
-- =========================================================================

create or replace function public.ai_reserve_tokens(
  p_user_id uuid,
  p_day date,
  p_budget integer,
  p_needed integer
)
returns table(allowed boolean, tokens_used integer, retry_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur integer;
  reserved integer;
begin
  if p_needed <= 0 or p_budget <= 0 then
    return query select false, 0, 60;
    return;
  end if;
  insert into public.ai_daily_token_ledger(user_id, day, tokens_used, reserved_tokens)
  values (p_user_id, p_day, 0, 0)
  on conflict (user_id, day) do nothing;
  select ledger.tokens_used, ledger.reserved_tokens
    into cur, reserved
    from public.ai_daily_token_ledger as ledger
   where ledger.user_id = p_user_id and ledger.day = p_day
   for update;
  if cur + reserved + p_needed > p_budget then
    return query select false, cur,
      greatest(1, ceil(extract(epoch from ((p_day + 1)::timestamp - now()))))::int;
    return;
  end if;
  update public.ai_daily_token_ledger
     set reserved_tokens = reserved_tokens + p_needed,
         updated_at = now()
   where user_id = p_user_id and day = p_day;
  return query select true, cur, 0;
end;
$$;

-- =========================================================================
-- 2. ai_commit_tokens (settle used and reserved tokens)
-- =========================================================================

drop function if exists public.ai_commit_tokens(uuid, date, integer);

create or replace function public.ai_commit_tokens(
  p_user_id uuid,
  p_day date,
  p_tokens_used integer,
  p_tokens_reserved integer default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ai_daily_token_ledger
     set tokens_used = tokens_used + greatest(0, p_tokens_used),
         reserved_tokens = greatest(0, reserved_tokens - greatest(0, coalesce(p_tokens_reserved, greatest(0, p_tokens_used)))),
         updated_at = now()
   where user_id = p_user_id and day = p_day;
$$;

-- =========================================================================
-- 3. ai_release_token_reservation (clear reservation on failure/cancel)
-- =========================================================================

create or replace function public.ai_release_token_reservation(
  p_user_id uuid,
  p_day date,
  p_tokens integer
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ai_daily_token_ledger
     set reserved_tokens = greatest(0, reserved_tokens - greatest(0, p_tokens)),
         updated_at = now()
   where user_id = p_user_id and day = p_day;
$$;

-- =========================================================================
-- 4. ai_acquire_in_flight (2-minute lease recovery)
-- =========================================================================

create or replace function public.ai_acquire_in_flight(
  p_user_id uuid,
  p_max integer
)
returns table(allowed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record;
begin
  select in_flight, acquired_at into rec
  from public.ai_in_flight
  where user_id = p_user_id
  for update;

  if not found then
    insert into public.ai_in_flight(user_id, in_flight, acquired_at)
    values (p_user_id, 1, now());
    return query select true;
    return;
  end if;

  -- Expired lease: reset to 1
  if rec.acquired_at < now() - interval '2 minutes' then
    update public.ai_in_flight
    set in_flight = 1, acquired_at = now()
    where user_id = p_user_id;
    return query select true;
    return;
  end if;

  -- Active lease with available capacity: increment
  if rec.in_flight < p_max then
    update public.ai_in_flight
    set in_flight = rec.in_flight + 1, acquired_at = now()
    where user_id = p_user_id;
    return query select true;
    return;
  end if;

  -- Over capacity: do NOT increment, do NOT update acquired_at (prevents starvation)
  return query select false;
  return;
end;
$$;

-- =========================================================================
-- 5. Revocations and Grants
-- =========================================================================

revoke execute on function public.ai_reserve_tokens(uuid, date, integer, integer) from public;
revoke execute on function public.ai_reserve_tokens(uuid, date, integer, integer) from anon;
revoke execute on function public.ai_reserve_tokens(uuid, date, integer, integer) from authenticated;

revoke execute on function public.ai_commit_tokens(uuid, date, integer, integer) from public;
revoke execute on function public.ai_commit_tokens(uuid, date, integer, integer) from anon;
revoke execute on function public.ai_commit_tokens(uuid, date, integer, integer) from authenticated;

revoke execute on function public.ai_release_token_reservation(uuid, date, integer) from public;
revoke execute on function public.ai_release_token_reservation(uuid, date, integer) from anon;
revoke execute on function public.ai_release_token_reservation(uuid, date, integer) from authenticated;

revoke execute on function public.ai_acquire_in_flight(uuid, integer) from public;
revoke execute on function public.ai_acquire_in_flight(uuid, integer) from anon;
revoke execute on function public.ai_acquire_in_flight(uuid, integer) from authenticated;

grant execute on function
  public.ai_reserve_tokens(uuid, date, integer, integer),
  public.ai_commit_tokens(uuid, date, integer, integer),
  public.ai_release_token_reservation(uuid, date, integer),
  public.ai_acquire_in_flight(uuid, integer)
to service_role;
