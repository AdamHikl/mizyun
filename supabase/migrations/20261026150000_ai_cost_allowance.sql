-- #336 (ADR-0081): AI cost allowance and a daily cap on draft changes.
--
-- 1. ai_daily_cost_ledger keeps each user's estimated AI cost per UTC day in
--    micro-USD. The API reserves an estimate before a provider call and
--    settles the estimated actual cost after it. A call is admitted while
--    the day and the calendar month are under the tier's allowance, so one
--    call may overshoot each by its own cost.
-- 2. Meal draft changes ("refine") stay outside the daily draft count, but
--    were limited only per minute (about 4,300 calls a day on the paid
--    tier). Each refine is now counted at admission and never refunded,
--    like meal illustration attempts, because the API releases its
--    in-flight slot on success too.

-- ============================================================================
-- 1. Cost ledger
-- ============================================================================

create table if not exists public.ai_daily_cost_ledger (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  used_micros bigint not null default 0 check (used_micros >= 0),
  reserved_micros bigint not null default 0 check (reserved_micros >= 0),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, day)
);

-- Service-role only: RLS on, no client policies or grants.
alter table public.ai_daily_cost_ledger enable row level security;
revoke all on table public.ai_daily_cost_ledger from public, anon, authenticated;

create or replace function public.ai_reserve_cost(
  p_user_id uuid,
  p_day date,
  p_daily_budget bigint,
  p_monthly_budget bigint,
  p_needed bigint
)
returns table(allowed boolean, scope text, retry_after integer)
language plpgsql security definer set search_path = '' as $$
declare
  today bigint;
  month_total bigint;
  month_start date := date_trunc('month', p_day)::date;
begin
  if p_daily_budget is null or p_daily_budget <= 0
     or p_monthly_budget is null or p_monthly_budget <= 0
     or p_needed is null or p_needed < 0 then
    return query select false, 'day'::text, 60;
    return;
  end if;

  insert into public.ai_daily_cost_ledger(user_id, day)
  values (p_user_id, p_day)
  on conflict (user_id, day) do nothing;

  -- Lock today's row: concurrent reservations for one user serialize here.
  select ledger.used_micros + ledger.reserved_micros
    into today
    from public.ai_daily_cost_ledger as ledger
   where ledger.user_id = p_user_id and ledger.day = p_day
   for update;

  if today >= p_daily_budget then
    return query select false, 'day'::text,
      greatest(1, ceil(extract(epoch from ((p_day + 1)::timestamp - now()))))::int;
    return;
  end if;

  -- Earlier days count what they settled; a reservation left by a crashed
  -- request expires with its day.
  select coalesce(sum(ledger.used_micros), 0) + today
    into month_total
    from public.ai_daily_cost_ledger as ledger
   where ledger.user_id = p_user_id
     and ledger.day >= month_start
     and ledger.day < p_day;

  if month_total >= p_monthly_budget then
    return query select false, 'month'::text,
      greatest(1, ceil(extract(epoch from (
        (month_start + interval '1 month')::timestamp - now()))))::int;
    return;
  end if;

  update public.ai_daily_cost_ledger as ledger
     set reserved_micros = ledger.reserved_micros + p_needed,
         updated_at = now()
   where ledger.user_id = p_user_id and ledger.day = p_day;

  return query select true, null::text, 0;
end;
$$;

-- Settle a reservation made on p_day: add the estimated actual cost and
-- release the reserved amount. Release without a cost passes p_actual = 0.
create or replace function public.ai_settle_cost(
  p_user_id uuid,
  p_day date,
  p_reserved bigint,
  p_actual bigint
)
returns void language sql security definer set search_path = '' as $$
  update public.ai_daily_cost_ledger as ledger
     set used_micros = ledger.used_micros + greatest(0, coalesce(p_actual, 0)),
         reserved_micros = greatest(0, ledger.reserved_micros - greatest(0, coalesce(p_reserved, 0))),
         updated_at = now()
   where ledger.user_id = p_user_id and ledger.day = p_day;
$$;

revoke execute on function public.ai_reserve_cost(uuid, date, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.ai_reserve_cost(uuid, date, bigint, bigint, bigint) to service_role;
revoke execute on function public.ai_settle_cost(uuid, date, bigint, bigint) from public, anon, authenticated;
grant execute on function public.ai_settle_cost(uuid, date, bigint, bigint) to service_role;

-- ============================================================================
-- 2. Daily cap on draft changes
-- ============================================================================

alter table public.ai_daily_draft_ledger
  add column if not exists refines_used integer not null default 0
  check (refines_used >= 0);

create or replace function public.ai_charge_refine(
  p_user_id uuid,
  p_day date,
  p_budget integer
)
returns table(allowed boolean, refines_used integer, retry_after integer)
language plpgsql security definer set search_path = '' as $$
declare
  cur integer;
begin
  if p_budget is null or p_budget <= 0 then
    return query select false, 0, 60;
    return;
  end if;

  insert into public.ai_daily_draft_ledger(user_id, day)
  values (p_user_id, p_day)
  on conflict (user_id, day) do nothing;

  select ledger.refines_used
    into cur
    from public.ai_daily_draft_ledger as ledger
   where ledger.user_id = p_user_id and ledger.day = p_day
   for update;

  if cur + 1 > p_budget then
    return query select false, cur,
      greatest(1, ceil(extract(epoch from ((p_day + 1)::timestamp - now()))))::int;
    return;
  end if;

  update public.ai_daily_draft_ledger as ledger
     set refines_used = ledger.refines_used + 1,
         updated_at = now()
   where ledger.user_id = p_user_id and ledger.day = p_day;

  return query select true, cur + 1, 0;
end;
$$;

revoke execute on function public.ai_charge_refine(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.ai_charge_refine(uuid, date, integer) to service_role;
