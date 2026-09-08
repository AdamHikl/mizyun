-- 0005_ai_consent.test.sql
-- pgTAP tests for user AI consent persistence and RLS (REL-AUD-005 / Q8-B)

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(8);

-- 1. Verify table exists
select has_table('public', 'user_ai_consents', 'user_ai_consents table exists');

-- 2. Setup synthetic test users in auth.users
insert into auth.users (id, email)
values
  ('c0000000-0000-4000-8000-000000000001', 'consent-a@mizyun.test'),
  ('c0000000-0000-4000-8000-000000000002', 'consent-b@mizyun.test');

-- 3. Switch to authenticated user A
set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000001';
set local request.jwt.claim.role = 'authenticated';
set local search_path = public, extensions;

-- User A can insert own consent
insert into public.user_ai_consents (
  user_id,
  granted,
  confirmed_adult,
  consent_version,
  consented_at
) values (
  'c0000000-0000-4000-8000-000000000001'::uuid,
  true,
  true,
  '2026-09-08',
  now()
);

select is(
  (select count(*)::int from public.user_ai_consents where user_id = 'c0000000-0000-4000-8000-000000000001'::uuid),
  1,
  'authenticated user can insert own AI consent'
);

-- User A cannot insert consent for user B
select throws_ok(
  $$insert into public.user_ai_consents (user_id, granted, confirmed_adult, consent_version)
    values ('c0000000-0000-4000-8000-000000000002'::uuid, true, true, '2026-09-08')$$,
  '42501',
  null,
  'authenticated user cannot insert AI consent for another user'
);

-- User A can update own consent (e.g. revoke)
update public.user_ai_consents
  set granted = false, revoked_at = now()
  where user_id = 'c0000000-0000-4000-8000-000000000001'::uuid;

select is(
  (select granted from public.user_ai_consents where user_id = 'c0000000-0000-4000-8000-000000000001'::uuid),
  false,
  'authenticated user can update (revoke) own AI consent'
);

-- 4. Switch to authenticated user B
set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000002';
set local request.jwt.claim.role = 'authenticated';
set local search_path = public, extensions;

-- User B cannot see User A's consent
select is(
  (select count(*)::int from public.user_ai_consents where user_id = 'c0000000-0000-4000-8000-000000000001'::uuid),
  0,
  'authenticated user cannot view another user AI consent'
);

-- User B cannot update User A's consent
update public.user_ai_consents
  set granted = true
  where user_id = 'c0000000-0000-4000-8000-000000000001'::uuid;

select is(
  (select count(*)::int from public.user_ai_consents where user_id = 'c0000000-0000-4000-8000-000000000001'::uuid and granted = true),
  0,
  'authenticated user cannot update another user AI consent'
);

-- 5. Switch to anon role
set local role anon;
set local search_path = public, extensions;

select throws_ok(
  $$select * from public.user_ai_consents$$,
  '42501',
  null,
  'anonymous user is denied SELECT on user_ai_consents'
);

-- 6. Switch back to superuser to test cascade deletion with auth.users
reset role;
set local search_path = public, extensions;

delete from auth.users where id = 'c0000000-0000-4000-8000-000000000001'::uuid;

select is(
  (select count(*)::int from public.user_ai_consents where user_id = 'c0000000-0000-4000-8000-000000000001'::uuid),
  0,
  'user_ai_consents row is deleted when auth.users is deleted (cascade)'
);

select * from finish();
rollback;
