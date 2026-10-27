-- REL-02 / REL-04: workout sets gain an optional client operation identity so
-- a replayed POST (lost response, app restart, offline queue) returns the row
-- it already saved instead of inserting a duplicate. Older clients omit the
-- identity and keep keyless append behaviour (NULLs never collide).
-- Existing authenticated grants, owner RLS, (workout_id, sequence) uniqueness
-- and the user_id index remain in force.
alter table public.workout_sets
  add column if not exists client_operation_id uuid null;

create unique index if not exists workout_sets_user_client_op_idx
  on public.workout_sets(user_id, client_operation_id)
  where client_operation_id is not null;
