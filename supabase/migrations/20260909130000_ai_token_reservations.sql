-- Round-3: make daily AI budget admission an atomic reservation.
-- Existing callers keep the same RPC signature; reserved tokens are settled
-- conservatively when the provider reports actual usage.

alter table public.ai_daily_token_ledger
  add column if not exists reserved_tokens integer not null default 0
  check (reserved_tokens >= 0);

create or replace function public.ai_reserve_tokens(
  p_user_id uuid, p_day date, p_budget integer, p_needed integer)
returns table(allowed boolean, tokens_used integer, retry_after integer)
language plpgsql security definer set search_path = '' as $$
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
  end if;
  update public.ai_daily_token_ledger
     set reserved_tokens = reserved_tokens + p_needed,
         updated_at = now()
   where user_id = p_user_id and day = p_day;
  return query select true, cur, 0;
end; $$;

create or replace function public.ai_commit_tokens(
  p_user_id uuid, p_day date, p_tokens integer)
returns void language sql security definer set search_path = '' as $$
  update public.ai_daily_token_ledger
     set tokens_used = tokens_used + greatest(0, p_tokens),
         reserved_tokens = greatest(0, reserved_tokens - greatest(0, p_tokens)),
         updated_at = now()
   where user_id = p_user_id and day = p_day;
$$;

