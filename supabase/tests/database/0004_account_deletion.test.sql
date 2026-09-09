-- 0004_account_deletion.test.sql
-- pgTAP tests for durable account deletion jobs and tombstones (REL-AUD-001 / REL-AUD-002 / Q4)

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(8);

-- 1. Verify table exists
select has_table('public', 'account_deletion_jobs', 'account_deletion_jobs table exists');

-- 2. Verify worker lease columns exist (Q4 worker leases)
select has_column('public', 'account_deletion_jobs', 'worker_id', 'worker_id column exists');
select has_column('public', 'account_deletion_jobs', 'lease_expires_at', 'lease_expires_at column exists');

-- 3. Setup synthetic test users in auth.users
insert into auth.users (id, email)
values
  ('d0000000-0000-4000-8000-000000000001', 'del-a@mizyun.test'),
  ('d0000000-0000-4000-8000-000000000002', 'del-b@mizyun.test');

-- 4. Service role can insert a deletion job with lease fields
insert into public.account_deletion_jobs (
  id,
  user_id,
  challenge_hash,
  status,
  stage,
  worker_id,
  lease_expires_at,
  expires_at
) values (
  '00000000-0000-4000-8000-000000000001'::uuid,
  'd0000000-0000-4000-8000-000000000001'::uuid,
  'hash_a_123',
  'challenge_issued',
  'none',
  null,
  null,
  now() + interval '5 minutes'
);

select is(
  (select count(*)::int from public.account_deletion_jobs where challenge_hash = 'hash_a_123'),
  1,
  'service_role can insert account_deletion_jobs'
);

-- 5. Switch to authenticated user A
set local role authenticated;
set local request.jwt.claim.sub = 'd0000000-0000-4000-8000-000000000001';
set local request.jwt.claim.role = 'authenticated';
set local search_path = public, extensions;

-- Authenticated user cannot insert or tamper with deletion jobs
select throws_ok(
  $$insert into public.account_deletion_jobs (user_id, challenge_hash, status, expires_at)
    values ('d0000000-0000-4000-8000-000000000001'::uuid, 'tamper', 'completed', now())$$,
  '42501',
  null,
  'authenticated user cannot directly insert into account_deletion_jobs'
);

-- 6. User can select own job
select is(
  (select count(*)::int from public.account_deletion_jobs where user_id = 'd0000000-0000-4000-8000-000000000001'::uuid),
  1,
  'user can select own deletion job'
);

-- 7. Switch to authenticated user B (cannot see User A's job)
set local request.jwt.claim.sub = 'd0000000-0000-4000-8000-000000000002';
select is(
  (select count(*)::int from public.account_deletion_jobs where user_id = 'd0000000-0000-4000-8000-000000000001'::uuid),
  0,
  'user B cannot select user A deletion job'
);

-- 8. Reset role and test tombstone survival: deleting user from auth.users does NOT delete account_deletion_jobs record
reset role;
delete from auth.users where id = 'd0000000-0000-4000-8000-000000000001';

select is(
  (select count(*)::int from public.account_deletion_jobs where id = '00000000-0000-4000-8000-000000000001'::uuid),
  1,
  'account_deletion_jobs record survives auth.users deletion as durable tombstone'
);

select * from finish();
rollback;
