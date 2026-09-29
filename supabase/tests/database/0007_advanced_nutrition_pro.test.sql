begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(11);

insert into auth.users (id, email) values
  ('a7000000-0000-4000-8000-000000000001', 'nutr-pro@test.invalid'),
  ('a7000000-0000-4000-8000-000000000002', 'nutr-other@test.invalid');

set local role authenticated;
set local request.jwt.claim.sub = 'a7000000-0000-4000-8000-000000000001';
set local request.jwt.claim.role = 'authenticated';

select lives_ok(
  $$insert into public.food_entries (user_id, consumed_at, name, fibre_g)
    values ('a7000000-0000-4000-8000-000000000001', now(), 'Basic', null)$$,
  'free user may create a basic entry'
);
select throws_ok(
  $$insert into public.food_entries (user_id, consumed_at, name, fibre_g)
    values ('a7000000-0000-4000-8000-000000000001', now(), 'Advanced', 5)$$,
  '42501', 'advanced nutrition requires Pro',
  'free user cannot bypass the API with a direct advanced insert'
);
select throws_ok(
  $$insert into public.food_entries (user_id, consumed_at, name, fibre_g)
    values ('a7000000-0000-4000-8000-000000000002', now(), 'Other owner', 5)$$,
  '42501', 'food entry owner mismatch',
  'advanced guard rejects a different owner'
);

reset role;
set local request.jwt.claim.role = 'service_role';
insert into public.beta_pro_requests (user_id, email, status)
values ('a7000000-0000-4000-8000-000000000001', 'nutr-pro@test.invalid', 'pending');
update public.beta_pro_requests set status = 'approved'
where user_id = 'a7000000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
select lives_ok(
  $$insert into public.food_entries (user_id, consumed_at, name, fibre_g, sodium_mg)
    values ('a7000000-0000-4000-8000-000000000001', now(), 'Pro', 5, 20)$$,
  'approved Pro can write advanced values'
);

reset role;
set local request.jwt.claim.role = 'service_role';
update public.beta_pro_requests set status = 'rejected'
where user_id = 'a7000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
select throws_ok(
  $$update public.food_entries set cholesterol_mg = 10 where name = 'Pro'$$,
  '42501', 'advanced nutrition requires Pro',
  'downgraded user cannot fill a new advanced field'
);
select lives_ok(
  $$update public.food_entries set fibre_g = 4 where name = 'Pro'$$,
  'downgraded user can correct an existing advanced value'
);
select lives_ok(
  $$update public.food_entries set sodium_mg = null where name = 'Pro'$$,
  'downgraded user can clear an existing advanced value'
);
select lives_ok(
  $$update public.food_entries set name = 'Pro edited' where name = 'Pro'$$,
  'old client basic patch preserves existing advanced values after downgrade'
);
select results_eq(
  $$select fibre_g from public.food_entries where name = 'Pro edited'$$,
  $$values (4::numeric)$$,
  'basic patch retained corrected advanced value'
);

reset role;
set local request.jwt.claim.role = 'service_role';
update public.profiles set plan_tier = 'paid'
where id = 'a7000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
select lives_ok(
  $$insert into public.food_entries (user_id, consumed_at, name, cholesterol_mg)
    values ('a7000000-0000-4000-8000-000000000001', now(), 'Paid only', 10)$$,
  'server-owned paid tier grants Pro without an approved beta request'
);

set local request.jwt.claim.sub = 'a7000000-0000-4000-8000-000000000002';
select results_eq(
  $$select count(*) from public.food_entries where user_id = 'a7000000-0000-4000-8000-000000000001'$$,
  $$values (0::bigint)$$,
  'other user cannot read Pro nutrient records'
);

select * from finish();
rollback;
