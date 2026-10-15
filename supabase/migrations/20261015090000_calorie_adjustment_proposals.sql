-- ENG-08: weekly calorie self-adjustment the user accepts or declines.
--
-- The API computes a deterministic weekly review on the user's own
-- authenticated request and stores at most one proposal per goal and ISO
-- week. A proposal changes nothing until the owner accepts it through
-- public.decide_calorie_adjustment, which moves the goal's calibration
-- offset under row locks with an optimistic-concurrency check.

-- Accepted calibration lives on the goal. Owners cannot write it directly
-- through the Data API; only the decision function changes it.
alter table public.goals
  add column calorie_calibration_kcal integer not null default 0
  check (calorie_calibration_kcal between -1000 and 1000);

-- Composite key so proposals can reference (goal, owner) together.
alter table public.goals
  add constraint goals_id_user_id_key unique (id, user_id);

create function public.goals_calibration_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Data API callers run as `authenticated`; the SECURITY DEFINER decision
  -- function runs as its owner and is the only owner-facing writer.
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' and new.calorie_calibration_kcal <> 0 then
      raise exception 'calorie_calibration_read_only' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE'
      and new.calorie_calibration_kcal is distinct from old.calorie_calibration_kcal then
      raise exception 'calorie_calibration_read_only' using errcode = '42501';
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.goals_calibration_guard() from public, anon, authenticated, service_role;
create trigger goals_calibration_guard before insert or update on public.goals
for each row execute function public.goals_calibration_guard();

create table public.calorie_adjustment_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null,
  week_start date not null check (extract(isodow from week_start) = 1),
  -- Pace the review was computed for; a later pace edit supersedes it.
  goal_pace text not null check (goal_pace in ('steady', 'gradual', 'aggressive')),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'superseded')),
  review jsonb not null check (jsonb_typeof(review) = 'object'),
  current_target_kcal integer check (current_target_kcal between 0 and 20000),
  proposed_target_kcal integer not null check (proposed_target_kcal between 0 and 20000),
  -- Calibration change: at most 250 kcal, except a raise out of negative
  -- calibration that the safety-floor clamp absorbed (ADR0064).
  delta_kcal integer not null check (
    delta_kcal <> 0
    and (
      delta_kcal between -250 and 250
      or (delta_kcal > 0 and calibration_before_kcal < 0
        and calibration_before_kcal + delta_kcal <= 250)
    )
  ),
  calibration_before_kcal integer not null check (calibration_before_kcal between -1000 and 1000),
  calibration_after_kcal integer not null check (calibration_after_kcal between -1000 and 1000),
  -- Visible weekly step is capped at 250 kcal.
  check (current_target_kcal is null or abs(proposed_target_kcal - current_target_kcal) <= 250),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint calorie_adjustment_proposals_goal_owner_fkey
    foreign key (goal_id, user_id) references public.goals(id, user_id) on delete cascade,
  constraint calorie_adjustment_proposals_calibration_step
    check (calibration_after_kcal = calibration_before_kcal + delta_kcal),
  constraint calorie_adjustment_proposals_decided_at
    check ((status = 'pending') = (decided_at is null))
);

create index calorie_adjustment_proposals_user_id_idx
  on public.calorie_adjustment_proposals(user_id);

-- At most one live (non-superseded) proposal per goal and ISO week. A
-- superseded proposal does not block a fresh one for the same week.
create unique index calorie_adjustment_proposals_goal_week_live_key
  on public.calorie_adjustment_proposals(goal_id, week_start)
  where status <> 'superseded';

create index calorie_adjustment_proposals_goal_accepted_idx
  on public.calorie_adjustment_proposals(goal_id, decided_at desc)
  where status = 'accepted';

alter table public.calorie_adjustment_proposals enable row level security;

revoke all on public.calorie_adjustment_proposals from anon, authenticated;
grant select, insert on public.calorie_adjustment_proposals to authenticated;
grant all on public.calorie_adjustment_proposals to service_role;

create policy calorie_adjustment_proposals_owner_select
  on public.calorie_adjustment_proposals for select to authenticated
  using (user_id = (select auth.uid()));

-- Owners insert only pending proposals for their own active goal. No
-- update/delete policy: decisions go through the function below and
-- account deletion cascades from auth.users.
create policy calorie_adjustment_proposals_owner_insert
  on public.calorie_adjustment_proposals for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and decided_at is null
    -- Only this or last week's review (timezone slack included).
    and week_start between current_date - 13 and current_date + 1
    and exists (
      select 1 from public.goals g
      where g.id = goal_id
        and g.user_id = (select auth.uid())
        and g.status = 'active'
    )
  );

-- Decide a pending proposal owned by the caller.
--
-- SECURITY DEFINER because owners have no UPDATE privilege on proposals and
-- cannot change goals.calorie_calibration_kcal directly. Every statement is
-- explicitly scoped to auth.uid(); search_path is empty.
--
-- Outcomes (returned row's status):
--   accepted   - the goal's calibration moved to calibration_after_kcal.
--   declined   - nothing else changed.
--   superseded - 'accept' found the proposal no longer applicable: goal
--                inactive, calibration no longer equal to
--                calibration_before_kcal, pace changed since the review,
--                week_start outside the current/previous ISO week, or
--                another proposal for the goal accepted within 14 days
--                (cadence guard against direct Data API inserts).
--                Committed, so retries see a decided proposal.
-- Errors: calorie_adjustment_not_found (P0002) for missing/foreign ids or
-- no session, calorie_adjustment_already_decided (55000) when not pending,
-- calorie_adjustment_invalid (22023) for an unknown decision.
create function public.decide_calorie_adjustment(p_proposal_id uuid, p_decision text)
returns setof public.calorie_adjustment_proposals
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := auth.uid();
  p public.calorie_adjustment_proposals;
  g public.goals;
begin
  if u is null or p_proposal_id is null then
    raise exception 'calorie_adjustment_not_found' using errcode = 'P0002';
  end if;
  if p_decision is null or p_decision not in ('accept', 'decline') then
    raise exception 'calorie_adjustment_invalid' using errcode = '22023';
  end if;

  select * into p from public.calorie_adjustment_proposals
  where id = p_proposal_id and user_id = u
  for update;
  if not found then
    raise exception 'calorie_adjustment_not_found' using errcode = 'P0002';
  end if;
  if p.status <> 'pending' then
    raise exception 'calorie_adjustment_already_decided' using errcode = '55000';
  end if;

  if p_decision = 'decline' then
    update public.calorie_adjustment_proposals
    set status = 'declined', decided_at = now()
    where id = p.id and user_id = u
    returning * into p;
    return next p;
    return;
  end if;

  select * into g from public.goals
  where id = p.goal_id and user_id = u
  for update;
  if not found
    or g.status <> 'active'
    or g.calorie_calibration_kcal <> p.calibration_before_kcal
    or g.pace is distinct from p.goal_pace
    -- Current or previous ISO week; the upper bound allows a client a
    -- day ahead of the database clock across a Monday boundary.
    or p.week_start < (date_trunc('week', current_date)::date - 7)
    or p.week_start > date_trunc('week', current_date + 1)::date
    or exists (
      select 1 from public.calorie_adjustment_proposals other
      where other.goal_id = p.goal_id
        and other.user_id = u
        and other.id <> p.id
        and other.status = 'accepted'
        and other.decided_at > now() - interval '14 days'
    ) then
    update public.calorie_adjustment_proposals
    set status = 'superseded', decided_at = now()
    where id = p.id and user_id = u
    returning * into p;
    return next p;
    return;
  end if;

  update public.goals
  set calorie_calibration_kcal = p.calibration_after_kcal
  where id = g.id and user_id = u;

  update public.calorie_adjustment_proposals
  set status = 'accepted', decided_at = now()
  where id = p.id and user_id = u
  returning * into p;
  return next p;
end; $$;

revoke all on function public.decide_calorie_adjustment(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.decide_calorie_adjustment(uuid, text) to authenticated;
