-- WORKOUT-SET-001: Support set types (normal, warmup, drop, failure)
-- Mirroring workoutSetTypeSchema in @mizyun/contracts

alter table public.workout_sets
  add column if not exists set_type text not null default 'normal'
    check (set_type in ('normal', 'warmup', 'drop', 'failure'));
