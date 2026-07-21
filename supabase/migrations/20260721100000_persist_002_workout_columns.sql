-- PERSIST-002 follow-up: the persisted workout adapter stores the same
-- provider-neutral source and extensible details fields as the domain model.
-- The original user-data migration predates those fields, so a clean local or
-- hosted database could not run the adapter even though its unit tests passed.

alter table public.workouts
  add column if not exists source text not null default 'manual'
    check (source in ('manual')),
  add column if not exists details jsonb not null default '{}'::jsonb;
