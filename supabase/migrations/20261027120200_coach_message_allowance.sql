-- AI-02 (ADR-0087): meter Coach chat in messages per UTC day.
--
-- The Coach token budget let a free user send about one real message a day:
-- one turn with the app guide is 9,000 to 14,000 tokens and the free budget
-- was 10,000. Coach now counts messages (free 5, paid 50 a day). A hidden
-- Coach token ceiling stays, sized to real turns, and the ADR-0081 cost
-- allowance stays the spend guard.
--
-- Coach tokens move to their own columns. `tokens_used` and `reserved_tokens`
-- remain the recipe budget (ai_reserve_recipe_request), which Coach turns
-- would otherwise use up after one message.
--
-- A message and its tokens are reserved together at admission and settled
-- once on the admission day: counted when the reply was stored, returned
-- when the call failed. A reservation lost to a crash holds one message
-- until the UTC day ends.

alter table public.ai_daily_token_ledger
  add column if not exists messages_used integer not null default 0
  check (messages_used >= 0),
  add column if not exists reserved_messages integer not null default 0
  check (reserved_messages >= 0),
  add column if not exists coach_tokens_used bigint not null default 0
  check (coach_tokens_used >= 0),
  add column if not exists coach_reserved_tokens bigint not null default 0
  check (coach_reserved_tokens >= 0);

create or replace function public.ai_reserve_coach_message(
  p_user_id uuid,
  p_day date,
  p_message_limit integer,
  p_token_budget bigint,
  p_tokens_needed integer
)
returns table(
  allowed boolean,
  reason text,
  messages_used integer,
  retry_after integer
)
language plpgsql security definer set search_path = '' as $$
declare
  cur record;
  until_midnight integer :=
    greatest(1, ceil(extract(epoch from ((p_day + 1)::timestamp - timezone('utc', now())))))::int;
begin
  if p_message_limit is null or p_message_limit <= 0
     or p_token_budget is null or p_token_budget <= 0
     or p_tokens_needed is null or p_tokens_needed < 0 then
    return query select false, 'messages'::text, 0, 60;
    return;
  end if;

  insert into public.ai_daily_token_ledger(user_id, day, tokens_used, reserved_tokens)
  values (p_user_id, p_day, 0, 0)
  on conflict (user_id, day) do nothing;

  select ledger.messages_used as used,
         ledger.reserved_messages as reserved,
         ledger.coach_tokens_used as tokens,
         ledger.coach_reserved_tokens as reserved_tokens
    into cur
    from public.ai_daily_token_ledger as ledger
   where ledger.user_id = p_user_id and ledger.day = p_day
   for update;

  if cur.used + cur.reserved + 1 > p_message_limit then
    return query select false, 'messages'::text, cur.used + cur.reserved, until_midnight;
    return;
  end if;
  if cur.tokens + cur.reserved_tokens + p_tokens_needed > p_token_budget then
    return query select false, 'tokens'::text, cur.used + cur.reserved, until_midnight;
    return;
  end if;

  update public.ai_daily_token_ledger as ledger
     set reserved_messages = ledger.reserved_messages + 1,
         coach_reserved_tokens = ledger.coach_reserved_tokens + p_tokens_needed,
         updated_at = now()
   where ledger.user_id = p_user_id and ledger.day = p_day;

  -- Messages taken before this one, counted or in flight.
  return query select true, null::text, cur.used + cur.reserved, 0;
end;
$$;

create or replace function public.ai_settle_coach_message(
  p_user_id uuid,
  p_day date,
  p_counted boolean,
  p_tokens_reserved integer,
  p_tokens_used integer
)
returns void
language sql security definer set search_path = '' as $$
  update public.ai_daily_token_ledger as ledger
     set messages_used = ledger.messages_used
           + case when p_counted and ledger.reserved_messages > 0 then 1 else 0 end,
         reserved_messages = greatest(0, ledger.reserved_messages - 1),
         coach_tokens_used = ledger.coach_tokens_used + greatest(0, coalesce(p_tokens_used, 0)),
         coach_reserved_tokens = greatest(0, ledger.coach_reserved_tokens - greatest(0, coalesce(p_tokens_reserved, 0))),
         updated_at = now()
   where ledger.user_id = p_user_id and ledger.day = p_day;
$$;

revoke execute on function public.ai_reserve_coach_message(uuid, date, integer, bigint, integer) from public, anon, authenticated;
grant execute on function public.ai_reserve_coach_message(uuid, date, integer, bigint, integer) to service_role;
revoke execute on function public.ai_settle_coach_message(uuid, date, boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.ai_settle_coach_message(uuid, date, boolean, integer, integer) to service_role;
