create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  status text not null default 'active' check (status in ('draft', 'active', 'completed', 'archived')),
  target jsonb not null default '{}'::jsonb,
  starts_on date,
  target_date date,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index goals_user_id_idx on public.goals(user_id);
create trigger goals_set_updated_at before update on public.goals
for each row execute function public.set_updated_at();

create table public.body_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  measured_at timestamptz not null,
  weight_kg numeric(6, 3),
  measurements jsonb not null default '{}'::jsonb,
  source text not null default 'manual',
  created_at timestamptz not null default timezone('utc', now())
);

create index body_measurements_user_time_idx
on public.body_measurements(user_id, measured_at desc);

create table public.food_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consumed_at timestamptz not null,
  name text not null,
  calories_kcal numeric(8, 2),
  calories_low_kcal numeric(8, 2),
  calories_high_kcal numeric(8, 2),
  protein_g numeric(8, 2),
  carbohydrate_g numeric(8, 2),
  fat_g numeric(8, 2),
  source text not null default 'manual',
  confidence numeric(4, 3) check (confidence between 0 and 1),
  confirmed_by_user boolean not null default false,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index food_entries_user_time_idx
on public.food_entries(user_id, consumed_at desc);
create trigger food_entries_set_updated_at before update on public.food_entries
for each row execute function public.set_updated_at();

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  instructions text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id)
);

create index exercises_user_id_idx on public.exercises(user_id);
create trigger exercises_set_updated_at before update on public.exercises
for each row execute function public.set_updated_at();

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  started_at timestamptz not null,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id)
);

create index workouts_user_time_idx on public.workouts(user_id, started_at desc);
create trigger workouts_set_updated_at before update on public.workouts
for each row execute function public.set_updated_at();

create table public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_id uuid not null,
  exercise_id uuid not null,
  sequence integer not null check (sequence > 0),
  repetitions numeric(7, 2),
  load_kg numeric(8, 3),
  duration_seconds integer,
  distance_meters numeric(10, 2),
  perceived_exertion numeric(3, 1) check (perceived_exertion between 0 and 10),
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (workout_id, sequence),
  foreign key (workout_id, user_id)
    references public.workouts(id, user_id) on delete cascade,
  foreign key (exercise_id, user_id)
    references public.exercises(id, user_id)
);

create index workout_sets_user_id_idx on public.workout_sets(user_id);

alter table public.goals enable row level security;
alter table public.body_measurements enable row level security;
alter table public.food_entries enable row level security;
alter table public.exercises enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_sets enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'goals', 'body_measurements', 'food_entries', 'exercises', 'workouts', 'workout_sets'
  ] loop
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      table_name || '_own_all',
      table_name
    );
  end loop;
end;
$$;
