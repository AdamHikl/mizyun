-- REL-02 / REL-04: exercise the real workout-set identity and owner boundary.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id, email) values
  ('d0560000-0000-4000-8000-000000000001', 'set-retry-a@mizyun.test'),
  ('d0560000-0000-4000-8000-000000000002', 'set-retry-b@mizyun.test');

insert into public.exercises(id, user_id, name) values
  ('e0560000-0000-4000-8000-000000000001', 'd0560000-0000-4000-8000-000000000001', 'A squat'),
  ('e0560000-0000-4000-8000-000000000002', 'd0560000-0000-4000-8000-000000000002', 'B squat');

insert into public.workouts(id, user_id, name, started_at) values
  ('b0560000-0000-4000-8000-000000000001', 'd0560000-0000-4000-8000-000000000001', 'A session', '2026-10-27T08:00:00Z'),
  ('b0560000-0000-4000-8000-000000000002', 'd0560000-0000-4000-8000-000000000002', 'B session', '2026-10-27T08:00:00Z');

select ok((select relrowsecurity from pg_class where oid = 'public.workout_sets'::regclass), 'workout set RLS remains enabled');
select has_index('public', 'workout_sets', 'workout_sets_user_id_idx', 'existing user_id index remains');
select has_index('public', 'workout_sets', 'workout_sets_user_client_op_idx', 'owner and operation index exists');
select ok(exists(select 1 from pg_constraint where conname = 'workout_sets_workout_id_sequence_key' and conrelid = 'public.workout_sets'::regclass),
  'per-workout sequence uniqueness keeps its default constraint name');

set local role authenticated;
set local request.jwt.claim.sub = 'd0560000-0000-4000-8000-000000000001';
select lives_ok($$insert into public.workout_sets(user_id, workout_id, exercise_id, sequence, repetitions, load_kg, client_operation_id, completed_at)
  values ('d0560000-0000-4000-8000-000000000001', 'b0560000-0000-4000-8000-000000000001', 'e0560000-0000-4000-8000-000000000001', 1, 5, 60, 'a0560000-0000-4000-8000-000000000001', '2026-10-27T08:10:00Z')$$,
  'authenticated owner can insert a keyed set');
select throws_ok($$insert into public.workout_sets(user_id, workout_id, exercise_id, sequence, repetitions, load_kg, client_operation_id, completed_at)
  values ('d0560000-0000-4000-8000-000000000001', 'b0560000-0000-4000-8000-000000000001', 'e0560000-0000-4000-8000-000000000001', 2, 5, 60, 'a0560000-0000-4000-8000-000000000001', '2026-10-27T08:10:00Z')$$,
  '23505', null, 'a retry at a different sequence cannot add a second row for the same operation');
select is((select count(*) from public.workout_sets where client_operation_id = 'a0560000-0000-4000-8000-000000000001'), 1::bigint,
  'one authoritative row remains after the duplicate attempt');
select lives_ok($$insert into public.workout_sets(user_id, workout_id, exercise_id, sequence, repetitions, load_kg) values
  ('d0560000-0000-4000-8000-000000000001', 'b0560000-0000-4000-8000-000000000001', 'e0560000-0000-4000-8000-000000000001', 3, 5, 60),
  ('d0560000-0000-4000-8000-000000000001', 'b0560000-0000-4000-8000-000000000001', 'e0560000-0000-4000-8000-000000000001', 4, 5, 60)$$,
  'older keyless clients retain append compatibility');
select throws_ok($$insert into public.workout_sets(user_id, workout_id, exercise_id, sequence, repetitions, client_operation_id)
  values ('d0560000-0000-4000-8000-000000000001', 'b0560000-0000-4000-8000-000000000001', 'e0560000-0000-4000-8000-000000000001', 1, 5, 'a0560000-0000-4000-8000-000000000009')$$,
  '23505', null, 'a new keyed set still cannot take an occupied sequence');
select lives_ok($$insert into public.workout_sets(user_id, workout_id, exercise_id, sequence, load_kg, repetitions, client_operation_id)
  values ('d0560000-0000-4000-8000-000000000001', 'b0560000-0000-4000-8000-000000000001', 'e0560000-0000-4000-8000-000000000001', 5, 82.125, 5, 'a0560000-0000-4000-8000-000000000003')$$,
  'keyed three-decimal load survives the real numeric column');
select is((select load_kg from public.workout_sets where client_operation_id = 'a0560000-0000-4000-8000-000000000003'), 82.125::numeric,
  'numeric(8,3) storage preserves the canonical API load exactly');

set local request.jwt.claim.sub = 'd0560000-0000-4000-8000-000000000002';
select is((select count(*) from public.workout_sets), 0::bigint, 'account B cannot read account A keyed or keyless sets');
select lives_ok($$insert into public.workout_sets(user_id, workout_id, exercise_id, sequence, repetitions, client_operation_id)
  values ('d0560000-0000-4000-8000-000000000002', 'b0560000-0000-4000-8000-000000000002', 'e0560000-0000-4000-8000-000000000002', 1, 5, 'a0560000-0000-4000-8000-000000000001')$$,
  'same UUID can be used independently by another owner');
select throws_ok($$insert into public.workout_sets(user_id, workout_id, exercise_id, sequence, repetitions, client_operation_id)
  values ('d0560000-0000-4000-8000-000000000001', 'b0560000-0000-4000-8000-000000000001', 'e0560000-0000-4000-8000-000000000001', 9, 5, 'a0560000-0000-4000-8000-000000000002')$$,
  '42501', null, 'account B cannot insert under account A identity');
select is((select count(*) from public.workout_sets), 1::bigint, 'B sees only its own operation result');

reset role;
select is((select count(*) from public.workout_sets where client_operation_id = 'a0560000-0000-4000-8000-000000000001'), 2::bigint,
  'the same UUID creates exactly one row per owner');
select * from finish();
rollback;
