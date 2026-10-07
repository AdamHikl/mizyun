-- APPLE-003: actual service-role fences, private state and accepted-job recovery.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id, email) values
  ('d0360000-0000-4000-8000-000000000001', 'apple-cleanup-a@mizyun.test'),
  ('d0360000-0000-4000-8000-000000000002', 'apple-cleanup-b@mizyun.test'),
  ('d0360000-0000-4000-8000-000000000003', 'apple-cleanup-c@mizyun.test');
insert into public.account_deletion_jobs(id, user_id, challenge_hash, status, worker_id, lease_expires_at, expires_at) values
  ('a0360000-0000-4000-8000-000000000001', 'd0360000-0000-4000-8000-000000000001', 'accepted-a', 'in_progress', 'worker-a', now() + interval '5 minutes', now() - interval '1 hour'),
  ('a0360000-0000-4000-8000-000000000002', 'd0360000-0000-4000-8000-000000000002', 'expired-b', 'challenge_issued', null, null, now() - interval '1 second'),
  ('a0360000-0000-4000-8000-000000000003', 'd0360000-0000-4000-8000-000000000003', 'older-c', 'challenge_issued', null, null, now() + interval '5 minutes'),
  ('a0360000-0000-4000-8000-000000000004', 'd0360000-0000-4000-8000-000000000003', 'newer-c', 'challenge_issued', null, null, now() + interval '5 minutes');

select ok((select relrowsecurity from pg_class where oid = 'public.account_provider_revocations'::regclass), 'provider cleanup table has RLS');
select has_index('public', 'account_provider_revocations', 'account_provider_revocations_user_id', 'private cleanup state has a user index');

set local role service_role;
select is((select saved from public.account_save_provider_revocation(
  'a0360000-0000-4000-8000-000000000001', 'd0360000-0000-4000-8000-000000000001', 'apple', 'worker-a', 'pending', 'apple-a', 'com.mizyun.test', repeat('x', 22000))), true,
  'leased worker can durably save a bounded encrypted envelope');
select throws_ok($$select * from public.account_save_provider_revocation(
  'a0360000-0000-4000-8000-000000000001', 'd0360000-0000-4000-8000-000000000002', 'apple', 'worker-a', 'pending', 'apple-a', 'com.mizyun.test', 'cipher')$$,
  'PT409', null, 'another account cannot save against the owning job');
select throws_ok($$select * from public.account_save_provider_revocation(
  'a0360000-0000-4000-8000-000000000001', 'd0360000-0000-4000-8000-000000000001', 'apple', 'worker-b', 'pending', 'apple-a', 'com.mizyun.test', 'cipher')$$,
  'PT409', null, 'another worker cannot overwrite pending revocation');
select throws_ok($$select * from public.account_save_provider_revocation(
  'a0360000-0000-4000-8000-000000000001', 'd0360000-0000-4000-8000-000000000001', 'apple', 'worker-a', 'pending', 'apple-b', 'com.mizyun.test', 'cipher')$$,
  'PT409', null, 'the accepted Apple subject cannot be replaced');
select throws_ok($$select * from public.account_save_provider_revocation(
  'a0360000-0000-4000-8000-000000000001', 'd0360000-0000-4000-8000-000000000001', 'apple', 'worker-a', 'pending', 'apple-a', 'com.other.test', 'cipher')$$,
  'PT409', null, 'the accepted Apple audience cannot be replaced');
update public.account_deletion_jobs set lease_expires_at = now() - interval '1 second'
where id = 'a0360000-0000-4000-8000-000000000001';
select throws_ok($$select * from public.account_save_provider_revocation(
  'a0360000-0000-4000-8000-000000000001', 'd0360000-0000-4000-8000-000000000001', 'apple', 'worker-a', 'revoked', 'apple-a', 'com.mizyun.test', null)$$,
  'PT409', null, 'an expired lease cannot complete provider revocation');
update public.account_deletion_jobs set lease_expires_at = now() + interval '5 minutes'
where id = 'a0360000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claim.sub = 'd0360000-0000-4000-8000-000000000001';
select throws_ok($$select * from public.account_provider_revocations$$, '42501', null, 'owner cannot read encrypted provider state');
select throws_ok($$insert into public.account_provider_revocations(job_id,user_id,provider,status)
values ('a0360000-0000-4000-8000-000000000001','d0360000-0000-4000-8000-000000000001','apple','not_required')$$, '42501', null, 'owner cannot insert provider state');
select throws_ok($$update public.account_provider_revocations set status='revoked'$$, '42501', null, 'owner cannot mark revocation complete');
select throws_ok($$delete from public.account_provider_revocations$$, '42501', null, 'owner cannot erase recovery state');
select throws_ok($$select * from public.account_save_provider_revocation(
  'a0360000-0000-4000-8000-000000000001', 'd0360000-0000-4000-8000-000000000001', 'apple', 'worker-a', 'revoked', 'apple-a', 'com.mizyun.test', null)$$,
  '42501', null, 'owner cannot invoke the privileged cleanup RPC');
set local request.jwt.claim.sub = 'd0360000-0000-4000-8000-000000000002';
select throws_ok($$select * from public.account_provider_revocations$$, '42501', null, 'second user cannot read provider state');
set local role anon;
select throws_ok($$select * from public.account_provider_revocations$$, '42501', null, 'anonymous access cannot read provider state');
select throws_ok($$select * from public.account_save_provider_revocation(
  'a0360000-0000-4000-8000-000000000001', 'd0360000-0000-4000-8000-000000000001', 'apple', 'worker-a', 'revoked', 'apple-a', 'com.mizyun.test', null)$$,
  '42501', null, 'anonymous access cannot invoke the cleanup RPC');

set local role service_role;
select is((select saved from public.account_save_provider_revocation(
  'a0360000-0000-4000-8000-000000000001', 'd0360000-0000-4000-8000-000000000001', 'apple', 'worker-a', 'revoked', 'apple-a', 'com.mizyun.test', null)), true,
  'the owning worker can complete revocation');
select is((select encrypted_token from public.account_provider_revocations where job_id='a0360000-0000-4000-8000-000000000001'), null::text,
  'successful revocation removes the encrypted token');
select throws_ok($$select * from public.account_save_provider_revocation(
  'a0360000-0000-4000-8000-000000000001', 'd0360000-0000-4000-8000-000000000001', 'apple', 'worker-a', 'pending', 'apple-a', 'com.mizyun.test', 'cipher')$$,
  'PT409', null, 'a completed provider marker cannot return to pending');
select throws_ok($$insert into public.account_deletion_jobs(user_id,challenge_hash,status,expires_at)
values('d0360000-0000-4000-8000-000000000001','replacement','challenge_issued',now()+interval '5 minutes')$$,
  'PT409', null, 'an accepted job cannot be stranded by another challenge');
select throws_ok($$update public.account_deletion_jobs set status='in_progress',worker_id='worker-b',lease_expires_at=now()+interval '5 minutes'
where id='a0360000-0000-4000-8000-000000000002'$$,
  'PT410', null, 'challenge expiry is checked at database acceptance time');
select lives_ok($$update public.account_deletion_jobs set status='in_progress',worker_id='worker-c',lease_expires_at=now()+interval '5 minutes'
where id='a0360000-0000-4000-8000-000000000003'$$,
  'an older valid receipt can be accepted despite a newer unaccepted challenge');
select throws_ok($$update public.account_deletion_jobs set status='in_progress',worker_id='worker-c2',lease_expires_at=now()+interval '5 minutes'
where id='a0360000-0000-4000-8000-000000000004'$$,
  'PT409', null, 'a competing challenge cannot become a second accepted operation');
update public.account_deletion_jobs set status='failed',lease_expires_at=null where id='a0360000-0000-4000-8000-000000000001';
select lives_ok($$update public.account_deletion_jobs set status='in_progress',worker_id='worker-a2',lease_expires_at=now()+interval '5 minutes'
where id='a0360000-0000-4000-8000-000000000001'$$,
  'accepted failure resumes after the original challenge TTL');
select is((select saved from public.account_save_provider_revocation(
  'a0360000-0000-4000-8000-000000000003', 'd0360000-0000-4000-8000-000000000003', 'apple', 'worker-c', 'not_required', null, null, null)), true,
  'a trusted non-Apple identity can persist its recovery marker');
select throws_ok($$select * from public.account_save_provider_revocation(
  'a0360000-0000-4000-8000-000000000003', 'd0360000-0000-4000-8000-000000000003', 'apple', 'worker-c', 'pending', 'apple-c', 'com.mizyun.test', 'cipher')$$,
  'PT409', null, 'a terminal not-required marker cannot acquire a token');
reset role;
delete from auth.users where id='d0360000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.account_provider_revocations where job_id='a0360000-0000-4000-8000-000000000001'), 1,
  'provider completion survives Auth deletion for restart recovery');

select * from finish();
rollback;
