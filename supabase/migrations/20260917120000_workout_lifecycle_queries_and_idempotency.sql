-- WORKOUT-LIFECYCLE-002
--
-- 1. Add client_operation_id to workouts with a unique partial index to prevent
--    duplicate session snapshots on network retries or app restarts.
-- 2. Add an expression index on (user_id, (details->'workoutLifecycle'->>'kind'), started_at desc)
--    so server-side routine discovery does not scan or drop behind high session volume.

alter table public.workouts
  add column if not exists client_operation_id uuid null;

create unique index if not exists workouts_user_client_op_idx
  on public.workouts(user_id, client_operation_id)
  where client_operation_id is not null;

create index if not exists workouts_user_lifecycle_kind_idx
  on public.workouts(user_id, (details->'workoutLifecycle'->>'kind'), started_at desc);
