-- 0006_token_reservations_and_leases.test.sql
-- pgTAP tests for AI token reservations, commit/release settlement, and in-flight lease recovery (REL-AUD-006)

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(29);

-- Setup synthetic test users in auth.users
insert into auth.users (id, email)
values
  ('f0000000-0000-4000-8000-000000000001', 'token-lease-admin@mizyun.test'),
  ('f0000000-0000-4000-8000-000000000002', 'token-lease-client@mizyun.test');

-- =========================================================================
-- 1. ai_reserve_tokens: single-row return and fallthrough prevention
-- =========================================================================

-- Initial reservation within budget
select results_eq(
  $$select allowed, tokens_used, retry_after from public.ai_reserve_tokens(
      'f0000000-0000-4000-8000-000000000001'::uuid,
      current_date,
      1000,
      800
    )$$,
  $$values (true, 0, 0)$$,
  'ai_reserve_tokens permits initial reservation within budget'
);

select is(
  (select reserved_tokens from public.ai_daily_token_ledger
    where user_id = 'f0000000-0000-4000-8000-000000000001'::uuid and day = current_date),
  800,
  'ai_reserve_tokens increments reserved_tokens to 800'
);

-- Second reservation exceeding budget (800 reserved + 300 requested > 1000 budget)
-- Verify that ai_reserve_tokens returns exactly ONE row (no fallthrough bug)
select is(
  (select count(*)::int from public.ai_reserve_tokens(
      'f0000000-0000-4000-8000-000000000001'::uuid,
      current_date,
      1000,
      300
    )),
  1,
  'ai_reserve_tokens returns exactly 1 row when budget is exceeded'
);

select results_eq(
  $$select allowed, tokens_used from public.ai_reserve_tokens(
      'f0000000-0000-4000-8000-000000000001'::uuid,
      current_date,
      1000,
      300
    )$$,
  $$values (false, 0)$$,
  'ai_reserve_tokens rejects request when budget is exceeded'
);

-- Verify that reserved_tokens was NOT incremented on rejected request
select is(
  (select reserved_tokens from public.ai_daily_token_ledger
    where user_id = 'f0000000-0000-4000-8000-000000000001'::uuid and day = current_date),
  800,
  'ai_reserve_tokens does not increment reserved_tokens when budget check fails'
);

-- =========================================================================
-- 2. ai_commit_tokens: updates tokens_used and settles reserved_tokens
-- =========================================================================

-- Commit with explicit p_tokens_reserved (used 500 out of 800 reserved)
select lives_ok(
  $$select public.ai_commit_tokens(
      'f0000000-0000-4000-8000-000000000001'::uuid,
      current_date,
      500,
      800
    )$$,
  'ai_commit_tokens executes cleanly with explicit reserved tokens parameter'
);

select results_eq(
  $$select tokens_used, reserved_tokens from public.ai_daily_token_ledger
    where user_id = 'f0000000-0000-4000-8000-000000000001'::uuid and day = current_date$$,
  $$values (500, 0)$$,
  'ai_commit_tokens updates tokens_used to 500 and clears reserved_tokens to 0'
);

-- Reserve 200 tokens, then commit with default p_tokens_reserved (3 arguments)
select public.ai_reserve_tokens('f0000000-0000-4000-8000-000000000001'::uuid, current_date, 1000, 200);

select lives_ok(
  $$select public.ai_commit_tokens(
      'f0000000-0000-4000-8000-000000000001'::uuid,
      current_date,
      150
    )$$,
  'ai_commit_tokens executes cleanly with default p_tokens_reserved'
);

select results_eq(
  $$select tokens_used, reserved_tokens from public.ai_daily_token_ledger
    where user_id = 'f0000000-0000-4000-8000-000000000001'::uuid and day = current_date$$,
  $$values (650, 50)$$,
  'ai_commit_tokens with default p_tokens_reserved decrements reserved_tokens by tokens_used'
);

-- =========================================================================
-- 3. ai_release_token_reservation: clears reserved without affecting used
-- =========================================================================

select lives_ok(
  $$select public.ai_release_token_reservation(
      'f0000000-0000-4000-8000-000000000001'::uuid,
      current_date,
      50
    )$$,
  'ai_release_token_reservation executes cleanly'
);

select results_eq(
  $$select tokens_used, reserved_tokens from public.ai_daily_token_ledger
    where user_id = 'f0000000-0000-4000-8000-000000000001'::uuid and day = current_date$$,
  $$values (650, 0)$$,
  'ai_release_token_reservation clears reserved_tokens while leaving tokens_used unchanged'
);

-- Excess release stays floored at 0
select lives_ok(
  $$select public.ai_release_token_reservation(
      'f0000000-0000-4000-8000-000000000001'::uuid,
      current_date,
      100
    )$$,
  'ai_release_token_reservation excess release executes cleanly'
);

select is(
  (select reserved_tokens from public.ai_daily_token_ledger
    where user_id = 'f0000000-0000-4000-8000-000000000001'::uuid and day = current_date),
  0,
  'ai_release_token_reservation never drops reserved_tokens below 0'
);

-- =========================================================================
-- 4. ai_acquire_in_flight: 2-minute lease recovery
-- =========================================================================

-- First acquire succeeds
select results_eq(
  $$select allowed from public.ai_acquire_in_flight('f0000000-0000-4000-8000-000000000001'::uuid, 1)$$,
  $$values (true)$$,
  'ai_acquire_in_flight permits initial request within concurrency limit'
);

-- Record timestamp
create temp table _lease_ts as
select acquired_at from public.ai_in_flight where user_id = 'f0000000-0000-4000-8000-000000000001'::uuid;

-- Second concurrent acquire within active lease is rejected
select results_eq(
  $$select allowed from public.ai_acquire_in_flight('f0000000-0000-4000-8000-000000000001'::uuid, 1)$$,
  $$values (false)$$,
  'ai_acquire_in_flight rejects concurrent request exceeding concurrency limit'
);

select is(
  (select in_flight from public.ai_in_flight
    where user_id = 'f0000000-0000-4000-8000-000000000001'::uuid),
  1,
  'in_flight count is NOT incremented when acquisition is rejected'
);

select is(
  (select acquired_at from public.ai_in_flight
    where user_id = 'f0000000-0000-4000-8000-000000000001'::uuid),
  (select acquired_at from _lease_ts),
  'acquired_at is NOT refreshed on rejection (prevents lease starvation)'
);

-- Simulate lease expiration by backdating acquired_at > 2 minutes
update public.ai_in_flight
   set acquired_at = now() - interval '130 seconds'
 where user_id = 'f0000000-0000-4000-8000-000000000001'::uuid;

-- Acquire after lease expiry resets in_flight to 1 and permits request
select results_eq(
  $$select allowed from public.ai_acquire_in_flight('f0000000-0000-4000-8000-000000000001'::uuid, 1)$$,
  $$values (true)$$,
  'ai_acquire_in_flight resets expired lease to 1 and permits request'
);

select is(
  (select in_flight from public.ai_in_flight
    where user_id = 'f0000000-0000-4000-8000-000000000001'::uuid),
  1,
  'in_flight count in ai_in_flight is reset to 1 after lease expiration'
);

-- =========================================================================
-- 5. Permissions: anon and authenticated receive 42501
-- =========================================================================

-- Switch to authenticated role
set local role authenticated;
set local request.jwt.claim.sub = 'f0000000-0000-4000-8000-000000000002';
set local request.jwt.claim.role = 'authenticated';
set local search_path = public, extensions;

select throws_ok(
  $$select * from public.ai_reserve_tokens('f0000000-0000-4000-8000-000000000002'::uuid, current_date, 1000, 100)$$,
  '42501',
  null,
  'authenticated role cannot execute ai_reserve_tokens'
);

select throws_ok(
  $$select public.ai_commit_tokens('f0000000-0000-4000-8000-000000000002'::uuid, current_date, 100, 100)$$,
  '42501',
  null,
  'authenticated role cannot execute ai_commit_tokens (4 args)'
);

select throws_ok(
  $$select public.ai_commit_tokens('f0000000-0000-4000-8000-000000000002'::uuid, current_date, 100)$$,
  '42501',
  null,
  'authenticated role cannot execute ai_commit_tokens (3 args)'
);

select throws_ok(
  $$select public.ai_release_token_reservation('f0000000-0000-4000-8000-000000000002'::uuid, current_date, 100)$$,
  '42501',
  null,
  'authenticated role cannot execute ai_release_token_reservation'
);

select throws_ok(
  $$select * from public.ai_acquire_in_flight('f0000000-0000-4000-8000-000000000002'::uuid, 1)$$,
  '42501',
  null,
  'authenticated role cannot execute ai_acquire_in_flight'
);

-- Switch to anon role
set local role anon;
set local search_path = public, extensions;

select throws_ok(
  $$select * from public.ai_reserve_tokens('f0000000-0000-4000-8000-000000000002'::uuid, current_date, 1000, 100)$$,
  '42501',
  null,
  'anon role cannot execute ai_reserve_tokens'
);

select throws_ok(
  $$select public.ai_commit_tokens('f0000000-0000-4000-8000-000000000002'::uuid, current_date, 100, 100)$$,
  '42501',
  null,
  'anon role cannot execute ai_commit_tokens (4 args)'
);

select throws_ok(
  $$select public.ai_commit_tokens('f0000000-0000-4000-8000-000000000002'::uuid, current_date, 100)$$,
  '42501',
  null,
  'anon role cannot execute ai_commit_tokens (3 args)'
);

select throws_ok(
  $$select public.ai_release_token_reservation('f0000000-0000-4000-8000-000000000002'::uuid, current_date, 100)$$,
  '42501',
  null,
  'anon role cannot execute ai_release_token_reservation'
);

select throws_ok(
  $$select * from public.ai_acquire_in_flight('f0000000-0000-4000-8000-000000000002'::uuid, 1)$$,
  '42501',
  null,
  'anon role cannot execute ai_acquire_in_flight'
);

select * from finish();
rollback;
