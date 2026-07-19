-- PERSIST-001: align the public.profiles and public.goals shapes
-- with the domain-side fields promoted since the original migration
-- (activity_level + sex_at_birth on profiles; pace + review_date
-- on goals), and add the partial-unique invariant the in-memory
-- GoalRepository enforces ("at most one active goal per user").
--
-- All new columns are nullable so the migration is forward-only:
-- existing rows back-fill to NULL without a rewrite. The check
-- constraints mirror the closed enums in @mizyun/core so the
-- domain and the SQL agree on what the values are.

-- 1) profiles: activity_level + sex_at_birth (PROF-001+).
alter table public.profiles
  add column if not exists activity_level text
    check (
      activity_level in (
        'sedentary',
        'lightly_active',
        'moderately_active',
        'very_active',
        'extra_active'
      )
    ),
  add column if not exists sex_at_birth text
    check (sex_at_birth in ('male', 'female'));

-- 2) goals: pace + optional review_date (GOAL-001), plus a partial
--    unique index that enforces "at most one active goal per
--    user". The in-memory repository already enforces this; the
--    SQL constraint guarantees the database stays coherent even
--    when a future background job inserts goals on the user's
--    behalf.
alter table public.goals
  add column if not exists pace text
    check (pace in ('steady', 'gradual', 'aggressive')),
  add column if not exists review_date date;

create unique index if not exists goals_one_active_per_user
  on public.goals (user_id)
  where status = 'active';

-- Backfill: nothing to write. Existing rows receive NULL for the
-- new columns, which the domain validator treats as "ask me later".
-- The partial unique index is forward-compatible because a user
-- with zero or one non-active goals does not violate it.
