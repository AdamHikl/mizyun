begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(10);

-- Setup synthetic test users in auth.users
insert into auth.users (id, email)
values
  ('a0000000-0000-4000-8000-000000000001', 'tier-free@mizyun.test'),
  ('a0000000-0000-4000-8000-000000000002', 'tier-paid@mizyun.test'),
  ('a0000000-0000-4000-8000-000000000003', 'tier-new@mizyun.test');

-- Delete default profile for tier-new to test fresh profile creation
delete from public.profiles where id = 'a0000000-0000-4000-8000-000000000003';

-- Configure user 2 as paid via service_role/trusted setup
update public.profiles set plan_tier = 'paid'
  where id = 'a0000000-0000-4000-8000-000000000002';

-- 1. Switch to authenticated user 3 (new user)
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000003';
set local request.jwt.claim.role = 'authenticated';
set local search_path = public, extensions;

-- Test 1: Authenticated user cannot insert own profile with plan_tier = 'paid'
select throws_ok(
  $$insert into public.profiles (id, plan_tier)
    values ('a0000000-0000-4000-8000-000000000003', 'paid')$$,
  '42501',
  NULL,
  'authenticated user cannot insert profile with plan_tier = paid'
);

-- Test 2: Authenticated user can insert own profile without plan_tier (defaults to free)
select lives_ok(
  $$insert into public.profiles (id, display_name)
    values ('a0000000-0000-4000-8000-000000000003', 'New User')$$,
  'authenticated user can insert own profile with defaults'
);

select results_eq(
  $$select plan_tier from public.profiles where id = 'a0000000-0000-4000-8000-000000000003'$$,
  array['free'],
  'newly inserted profile receives free tier'
);

-- Test 3: Authenticated user cannot delete own profile
select throws_ok(
  $$delete from public.profiles where id = 'a0000000-0000-4000-8000-000000000003'$$,
  '42501',
  NULL,
  'authenticated user cannot delete profile'
);

-- Test 4: Authenticated user cannot update plan_tier to paid
select throws_ok(
  $$update public.profiles set plan_tier = 'paid'
    where id = 'a0000000-0000-4000-8000-000000000003'$$,
  '42501',
  NULL,
  'authenticated user cannot update plan_tier to paid'
);

-- Test 5: Authenticated user can update ordinary profile fields
select lives_ok(
  $$update public.profiles set display_name = 'Updated Name'
    where id = 'a0000000-0000-4000-8000-000000000003'$$,
  'authenticated user can update ordinary profile fields'
);

-- 2. Switch to authenticated user 2 (paid user)
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000002';
set local request.jwt.claim.role = 'authenticated';
set local search_path = public, extensions;

-- Test 6: Paid user retains paid tier on profile update
select lives_ok(
  $$update public.profiles set display_name = 'Paid User Edited'
    where id = 'a0000000-0000-4000-8000-000000000002'$$,
  'paid user can update ordinary fields without losing tier'
);

select results_eq(
  $$select plan_tier from public.profiles where id = 'a0000000-0000-4000-8000-000000000002'$$,
  array['paid'],
  'paid user preserves paid tier after ordinary edit'
);

-- 3. Switch to service_role
reset role;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local search_path = public, extensions;

-- Test 7: service_role can update plan_tier to paid
select lives_ok(
  $$update public.profiles set plan_tier = 'paid'
    where id = 'a0000000-0000-4000-8000-000000000001'$$,
  'service_role can upgrade user to paid tier'
);

select results_eq(
  $$select plan_tier from public.profiles where id = 'a0000000-0000-4000-8000-000000000001'$$,
  array['paid'],
  'user 1 successfully updated to paid tier by service_role'
);

select * from finish();
rollback;
