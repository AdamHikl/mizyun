-- AI-OPS-002 — Tighten AI RPC EXECUTE grants to service_role only.
--
-- `20260724120000_ai_ops_001_limits.sql` granted EXECUTE on the
-- eight `ai_*` RPCs to `service_role`, but PostgreSQL ships with
-- EXECUTE granted to PUBLIC for new functions. Without an
-- explicit `revoke ... from public`, anon / authenticated
-- callers retain the ability to invoke the limiter RPCs and
-- read/write the durable ledger. This migration closes that
-- gap so the only path that can read or write the limiter
-- state is the service-role key.
--
-- ADR-0017 §"Zero Data Retention + training/feedback off"
-- requires this surface to be locked down before any hosted
-- deployment.

set check_function_bodies = off;

-- ai_lock_key takes no SQL state; revoke first so the migration is
-- idempotent if an operator has already pulled it back manually.
revoke execute on function public.ai_lock_key(text, uuid, uuid, text) from public;
revoke execute on function public.ai_lock_key(text, uuid, uuid, text) from anon;
revoke execute on function public.ai_lock_key(text, uuid, uuid, text) from authenticated;

revoke execute on function public.ai_reserve_tokens(uuid, date, integer, integer) from public;
revoke execute on function public.ai_reserve_tokens(uuid, date, integer, integer) from anon;
revoke execute on function public.ai_reserve_tokens(uuid, date, integer, integer) from authenticated;

revoke execute on function public.ai_commit_tokens(uuid, date, integer) from public;
revoke execute on function public.ai_commit_tokens(uuid, date, integer) from anon;
revoke execute on function public.ai_commit_tokens(uuid, date, integer) from authenticated;

revoke execute on function public.ai_register_request(uuid, timestamptz, integer) from public;
revoke execute on function public.ai_register_request(uuid, timestamptz, integer) from anon;
revoke execute on function public.ai_register_request(uuid, timestamptz, integer) from authenticated;

revoke execute on function public.ai_acquire_in_flight(uuid, integer) from public;
revoke execute on function public.ai_acquire_in_flight(uuid, integer) from anon;
revoke execute on function public.ai_acquire_in_flight(uuid, integer) from authenticated;

revoke execute on function public.ai_release_in_flight(uuid) from public;
revoke execute on function public.ai_release_in_flight(uuid) from anon;
revoke execute on function public.ai_release_in_flight(uuid) from authenticated;

revoke execute on function public.ai_reserve_provider_call(uuid, uuid, text) from public;
revoke execute on function public.ai_reserve_provider_call(uuid, uuid, text) from anon;
revoke execute on function public.ai_reserve_provider_call(uuid, uuid, text) from authenticated;

revoke execute on function public.ai_complete_provider_call(uuid, public.ai_provider_call_status, uuid, integer) from public;
revoke execute on function public.ai_complete_provider_call(uuid, public.ai_provider_call_status, uuid, integer) from anon;
revoke execute on function public.ai_complete_provider_call(uuid, public.ai_provider_call_status, uuid, integer) from authenticated;

-- Defence in depth: the table-level grants already limit SELECT
-- on the four limiter tables to authenticated, but anon should
-- not even have the grant option to attempt the call. Revoke
-- any future default that might re-grant PUBLIC.
revoke select on public.ai_daily_token_ledger from public;
revoke select on public.ai_request_windows from public;
revoke select on public.ai_in_flight from public;
revoke select on public.ai_provider_calls from public;