-- APPLE-003 follow-up: deletion without an Apple authorization code records a
-- terminal, subject-free "skipped" outcome under the same worker fence.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id, email) values
  ('d0520000-0000-4000-8000-000000000001', 'apple-skip-a@mizyun.test'),
  ('d0520000-0000-4000-8000-000000000002', 'apple-skip-b@mizyun.test');
insert into public.account_deletion_jobs(id, user_id, challenge_hash, status, worker_id, lease_expires_at, expires_at) values
  ('a0520000-0000-4000-8000-000000000001', 'd0520000-0000-4000-8000-000000000001', 'accepted-a', 'in_progress', 'worker-a', now() + interval '5 minutes', now() - interval '1 hour'),
  ('a0520000-0000-4000-8000-000000000002', 'd0520000-0000-4000-8000-000000000002', 'accepted-b', 'in_progress', 'worker-b', now() + interval '5 minutes', now() - interval '1 hour');

set local role service_role;
select throws_ok($$select * from public.account_save_provider_revocation(
  'a0520000-0000-4000-8000-000000000001', 'd0520000-0000-4000-8000-000000000001', 'apple', 'worker-other', 'skipped_no_authorization_code', null, null, null)$$,
  'PT409', null, 'a non-owning worker cannot record a skipped revocation');
select throws_ok($$select * from public.account_save_provider_revocation(
  'a0520000-0000-4000-8000-000000000001', 'd0520000-0000-4000-8000-000000000001', 'apple', 'worker-a', 'skipped_no_authorization_code', 'apple-a', 'com.mizyun.test', null)$$,
  '23514', null, 'a skipped revocation cannot retain the Apple subject or client');
select is((select saved from public.account_save_provider_revocation(
  'a0520000-0000-4000-8000-000000000001', 'd0520000-0000-4000-8000-000000000001', 'apple', 'worker-a', 'skipped_no_authorization_code', null, null, null)), true,
  'the owning worker records deletion without an authorization code');
select is((select status from public.account_provider_revocations where job_id='a0520000-0000-4000-8000-000000000001'),
  'skipped_no_authorization_code', 'the truthful skipped outcome is stored');
select throws_ok($$select * from public.account_save_provider_revocation(
  'a0520000-0000-4000-8000-000000000001', 'd0520000-0000-4000-8000-000000000001', 'apple', 'worker-a', 'skipped_no_authorization_code', null, null, null)$$,
  'PT409', null, 'a skipped outcome is terminal');
select throws_ok($$select * from public.account_save_provider_revocation(
  'a0520000-0000-4000-8000-000000000001', 'd0520000-0000-4000-8000-000000000001', 'apple', 'worker-a', 'not_required', null, null, null)$$,
  'PT409', null, 'a skipped outcome cannot be relabelled as not required');
select throws_ok($$select * from public.account_save_provider_revocation(
  'a0520000-0000-4000-8000-000000000002', 'd0520000-0000-4000-8000-000000000002', 'apple', 'worker-b', 'unknown_status', null, null, null)$$,
  '23514', null, 'unknown statuses are still rejected');
select is((select saved from public.account_save_provider_revocation(
  'a0520000-0000-4000-8000-000000000002', 'd0520000-0000-4000-8000-000000000002', 'apple', 'worker-b', 'pending', 'apple-b', 'com.mizyun.test', 'cipher')), true,
  'the existing pending path is unchanged');
reset role;

select * from finish();
rollback;
