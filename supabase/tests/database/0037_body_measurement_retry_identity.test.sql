-- Q2 / REL-AUD-007: exercise the real database identity and owner boundary.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id, email) values
  ('d0370000-0000-4000-8000-000000000001', 'measurement-retry-a@mizyun.test'),
  ('d0370000-0000-4000-8000-000000000002', 'measurement-retry-b@mizyun.test');

select ok((select relrowsecurity from pg_class where oid = 'public.body_measurements'::regclass), 'body measurement RLS remains enabled');
select has_index('public', 'body_measurements', 'body_measurements_user_time_idx', 'existing owner/time index remains');
select has_index('public', 'body_measurements', 'body_measurements_user_client_op_idx', 'owner and operation index exists');

set local role authenticated;
set local request.jwt.claim.sub = 'd0370000-0000-4000-8000-000000000001';
select lives_ok($$insert into public.body_measurements(user_id, client_operation_id, measured_at, weight_kg)
  values ('d0370000-0000-4000-8000-000000000001', 'a0370000-0000-4000-8000-000000000001', '2026-10-08T10:00:00Z', 72)$$,
  'authenticated owner can insert a keyed measurement');
select throws_ok($$insert into public.body_measurements(user_id, client_operation_id, measured_at, weight_kg)
  values ('d0370000-0000-4000-8000-000000000001', 'a0370000-0000-4000-8000-000000000001', '2026-10-08T10:00:00Z', 72)$$,
  '23505', null, 'identical retry cannot add a second row');
select throws_ok($$insert into public.body_measurements(user_id, client_operation_id, measured_at, weight_kg)
  values ('d0370000-0000-4000-8000-000000000001', 'a0370000-0000-4000-8000-000000000001', '2026-10-08T10:00:00Z', 73)$$,
  '23505', null, 'changed payload cannot evade owner/operation uniqueness');
select is((select count(*) from public.body_measurements where client_operation_id = 'a0370000-0000-4000-8000-000000000001'), 1::bigint,
  'one authoritative row remains after duplicate attempts');
select lives_ok($$insert into public.body_measurements(user_id, measured_at, weight_kg) values
  ('d0370000-0000-4000-8000-000000000001', '2026-10-08T10:00:00Z', 72),
  ('d0370000-0000-4000-8000-000000000001', '2026-10-08T10:00:00Z', 72)$$,
  'older keyless clients retain append compatibility');
select lives_ok($$insert into public.body_measurements(user_id, client_operation_id, measured_at, weight_kg)
  values ('d0370000-0000-4000-8000-000000000001', 'a0370000-0000-4000-8000-000000000003', '2026-10-08T10:00:00Z', 72.123)$$,
  'accepted keyed three-decimal precision survives the real numeric column');
select is((select weight_kg from public.body_measurements where client_operation_id = 'a0370000-0000-4000-8000-000000000003'), 72.123::numeric,
  'real numeric(6,3) storage preserves the canonical API weight exactly');

set local request.jwt.claim.sub = 'd0370000-0000-4000-8000-000000000002';
select is((select count(*) from public.body_measurements), 0::bigint, 'account B cannot read account A keyed or keyless records');
select lives_ok($$insert into public.body_measurements(user_id, client_operation_id, measured_at, weight_kg)
  values ('d0370000-0000-4000-8000-000000000002', 'a0370000-0000-4000-8000-000000000001', '2026-10-08T10:00:00Z', 72)$$,
  'same UUID can be used independently by another owner');
select throws_ok($$insert into public.body_measurements(user_id, client_operation_id, measured_at, weight_kg)
  values ('d0370000-0000-4000-8000-000000000001', 'a0370000-0000-4000-8000-000000000002', '2026-10-08T10:00:00Z', 72)$$,
  '42501', null, 'account B cannot insert under account A identity');
select is((select count(*) from public.body_measurements), 1::bigint, 'B sees only its own operation result');

reset role;
select is((select count(*) from public.body_measurements where client_operation_id = 'a0370000-0000-4000-8000-000000000001'), 2::bigint,
  'the same UUID creates exactly one row per owner');
select * from finish();
rollback;
