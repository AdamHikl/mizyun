begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
insert into auth.users(id, email) values
  ('a2450000-0000-4000-8000-000000000001', 'cal-a@synthetic.invalid'),
  ('a2450000-0000-4000-8000-000000000002', 'cal-b@synthetic.invalid'),
  ('a2450000-0000-4000-8000-000000000003', 'cal-c@synthetic.invalid'),
  ('a2450000-0000-4000-8000-000000000004', 'cal-d@synthetic.invalid');
insert into public.goals(id, user_id, kind, status, pace, target, starts_on, target_date) values
  ('b2450000-0000-4000-8000-00000000000a', 'a2450000-0000-4000-8000-000000000001', 'cut', 'active', 'steady', '{"weightKg":75}', '2026-09-01', '2027-12-31'),
  ('b2450000-0000-4000-8000-00000000000b', 'a2450000-0000-4000-8000-000000000002', 'cut', 'active', 'steady', '{"weightKg":70}', '2026-09-01', '2027-12-31'),
  ('b2450000-0000-4000-8000-00000000000c', 'a2450000-0000-4000-8000-000000000003', 'cut', 'active', 'steady', '{"weightKg":70}', '2026-09-01', '2027-12-31'),
  ('b2450000-0000-4000-8000-00000000000d', 'a2450000-0000-4000-8000-000000000004', 'cut', 'active', 'steady', '{"weightKg":70}', '2026-09-01', '2027-12-31');

-- Clock-relative ISO weeks: never a caller-controlled acceptance clock.
create temporary table cal_weeks as
select date_trunc('week', current_date)::date as cur,
       date_trunc('week', current_date)::date - 7 as prev,
       date_trunc('week', current_date)::date - 14 as old;
grant select on cal_weeks to authenticated, anon;

-- A proposal row for owner/goal/week with the given calibration step.
create function pg_temp.cal_insert(p_id uuid, p_user uuid, p_goal uuid, p_week date, p_before int, p_delta int, p_pace text default 'steady')
returns void language sql as $$
  insert into public.calorie_adjustment_proposals(id, user_id, goal_id, week_start, goal_pace, review, current_target_kcal, proposed_target_kcal, delta_kcal, calibration_before_kcal, calibration_after_kcal)
  values (coalesce(p_id, gen_random_uuid()), p_user, p_goal, p_week, p_pace, '{}', 2000, 2000 + p_delta, p_delta, p_before, p_before + p_delta);
$$;
grant execute on function pg_temp.cal_insert(uuid, uuid, uuid, date, int, int, text) to authenticated;

-- Schema and privilege shape.
select ok((select relrowsecurity from pg_class where oid = 'public.calorie_adjustment_proposals'::regclass), 'Proposals have RLS');
select ok(exists(select 1 from pg_indexes where schemaname = 'public' and tablename = 'calorie_adjustment_proposals' and indexdef like '%(user_id)%'), 'Proposals have a user_id index');
select ok(not has_table_privilege('anon', 'public.calorie_adjustment_proposals', 'SELECT'), 'Anonymous cannot read proposals');
select ok(not has_table_privilege('authenticated', 'public.calorie_adjustment_proposals', 'UPDATE'), 'Owners cannot update proposals directly');
select ok(not has_table_privilege('authenticated', 'public.calorie_adjustment_proposals', 'DELETE'), 'Owners cannot delete proposals directly');
select ok(not has_function_privilege('anon', 'public.decide_calorie_adjustment(uuid,text)', 'EXECUTE'), 'Anonymous cannot decide');
select ok(has_function_privilege('authenticated', 'public.decide_calorie_adjustment(uuid,text)', 'EXECUTE'), 'Authenticated can call decide');
select is((select prosecdef from pg_proc where oid = 'public.decide_calorie_adjustment(uuid,text)'::regprocedure), true, 'Decide is SECURITY DEFINER');
select ok((select 'search_path=""' = any(proconfig) from pg_proc where oid = 'public.decide_calorie_adjustment(uuid,text)'::regprocedure), 'Decide pins an empty search_path');

-- Out-of-window row only a privileged writer can create (cadence guard target).
select pg_temp.cal_insert('c2450000-0000-4000-8000-0000000000d1', 'a2450000-0000-4000-8000-000000000004', 'b2450000-0000-4000-8000-00000000000d', (select old from cal_weeks), 0, -100);

-- Owner A.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a2450000-0000-4000-8000-000000000001', true);

select lives_ok($$select pg_temp.cal_insert('c2450000-0000-4000-8000-000000000001', 'a2450000-0000-4000-8000-000000000001', 'b2450000-0000-4000-8000-00000000000a', (select cur from cal_weeks), 0, -100)$$,
  'Owner inserts a pending proposal for this week');
select throws_ok($$select pg_temp.cal_insert(null, 'a2450000-0000-4000-8000-000000000001', 'b2450000-0000-4000-8000-00000000000a', (select cur from cal_weeks), 0, -100)$$,
  '23505', null, 'One live proposal per goal and week');
select throws_ok($$select pg_temp.cal_insert(null, 'a2450000-0000-4000-8000-000000000001', 'b2450000-0000-4000-8000-00000000000a', (select old from cal_weeks) - 7, 0, -100)$$,
  '42501', null, 'Cannot insert a proposal for a week outside the review window');
select throws_ok($$select pg_temp.cal_insert(null, 'a2450000-0000-4000-8000-000000000001', 'b2450000-0000-4000-8000-00000000000b', (select prev from cal_weeks), 0, -100)$$,
  '42501', null, 'Cannot insert against another user''s goal');
select throws_ok($$select pg_temp.cal_insert(null, 'a2450000-0000-4000-8000-000000000002', 'b2450000-0000-4000-8000-00000000000b', (select prev from cal_weeks), 0, -100)$$,
  '42501', null, 'Cannot insert a proposal owned by another user');
select throws_ok($$insert into public.calorie_adjustment_proposals(user_id, goal_id, week_start, goal_pace, status, decided_at, review, current_target_kcal, proposed_target_kcal, delta_kcal, calibration_before_kcal, calibration_after_kcal)
  values ('a2450000-0000-4000-8000-000000000001', 'b2450000-0000-4000-8000-00000000000a', (select prev from cal_weeks), 'steady', 'accepted', now(), '{}', 2000, 1900, -100, 0, -100)$$,
  '42501', null, 'Cannot insert an already accepted proposal');
select throws_ok($$select pg_temp.cal_insert(null, 'a2450000-0000-4000-8000-000000000001', 'b2450000-0000-4000-8000-00000000000a', (select prev from cal_weeks), 0, -500)$$,
  '23514', null, 'Visible step is capped at 250 kcal');
select throws_ok($$insert into public.calorie_adjustment_proposals(user_id, goal_id, week_start, goal_pace, review, current_target_kcal, proposed_target_kcal, delta_kcal, calibration_before_kcal, calibration_after_kcal)
  values ('a2450000-0000-4000-8000-000000000001', 'b2450000-0000-4000-8000-00000000000a', (select prev from cal_weeks), 'steady', '{}', 1200, 1300, 2000, -1000, 1000)$$,
  '23514', null, 'A floor-clamp raise cannot swing calibration past +250');
select throws_ok($$insert into public.calorie_adjustment_proposals(user_id, goal_id, week_start, goal_pace, review, current_target_kcal, proposed_target_kcal, delta_kcal, calibration_before_kcal, calibration_after_kcal)
  values ('a2450000-0000-4000-8000-000000000001', 'b2450000-0000-4000-8000-00000000000a', (select prev from cal_weeks), 'steady', '{}', 2000, 2100, 300, 0, 300)$$,
  '23514', null, 'Calibration steps above 250 need absorbed negative calibration');
select throws_ok($$update public.goals set calorie_calibration_kcal = 500 where id = 'b2450000-0000-4000-8000-00000000000a'$$,
  '42501', null, 'Owner cannot write calibration directly');
select lives_ok($$update public.goals set target_date = '2028-01-31' where id = 'b2450000-0000-4000-8000-00000000000a'$$,
  'Owner goal edits that leave calibration alone still work');

-- Owner B cannot see or decide A's proposal.
select set_config('request.jwt.claim.sub', 'a2450000-0000-4000-8000-000000000002', true);
select is((select count(*)::int from public.calorie_adjustment_proposals), 0, 'User B sees none of A''s proposals');
select throws_ok($$select * from public.decide_calorie_adjustment('c2450000-0000-4000-8000-000000000001', 'accept')$$,
  'P0002', 'calorie_adjustment_not_found', 'User B cannot decide A''s proposal');

-- Owner A accepts; calibration moves; second decision conflicts.
select set_config('request.jwt.claim.sub', 'a2450000-0000-4000-8000-000000000001', true);
select throws_ok($$select * from public.decide_calorie_adjustment('c2450000-0000-4000-8000-000000000001', 'maybe')$$,
  '22023', 'calorie_adjustment_invalid', 'Unknown decision rejected');
select is((select status from public.decide_calorie_adjustment('c2450000-0000-4000-8000-000000000001', 'accept')), 'accepted', 'Accept returns accepted');
select is((select calorie_calibration_kcal from public.goals where id = 'b2450000-0000-4000-8000-00000000000a'), -100, 'Accept moves goal calibration');
select ok((select decided_at is not null from public.calorie_adjustment_proposals where id = 'c2450000-0000-4000-8000-000000000001'), 'Accept records decided_at');
select throws_ok($$select * from public.decide_calorie_adjustment('c2450000-0000-4000-8000-000000000001', 'accept')$$,
  '55000', 'calorie_adjustment_already_decided', 'Cannot decide twice (accept retry)');
select throws_ok($$select * from public.decide_calorie_adjustment('c2450000-0000-4000-8000-000000000001', 'decline')$$,
  '55000', 'calorie_adjustment_already_decided', 'Cannot decline after accepting');

-- Cadence: a directly inserted, otherwise-valid proposal cannot be accepted
-- within 14 days of the previous acceptance.
select lives_ok($$select pg_temp.cal_insert('c2450000-0000-4000-8000-000000000002', 'a2450000-0000-4000-8000-000000000001', 'b2450000-0000-4000-8000-00000000000a', (select prev from cal_weeks), -100, -100)$$,
  'Direct insert for last week succeeds');
select is((select status from public.decide_calorie_adjustment('c2450000-0000-4000-8000-000000000002', 'accept')), 'superseded', 'Accept inside the 14-day cooldown supersedes');
select is((select calorie_calibration_kcal from public.goals where id = 'b2450000-0000-4000-8000-00000000000a'), -100, 'Cooldown leaves calibration unchanged');

-- A superseded proposal does not block the week; decline keeps calibration.
select lives_ok($$select pg_temp.cal_insert('c2450000-0000-4000-8000-000000000003', 'a2450000-0000-4000-8000-000000000001', 'b2450000-0000-4000-8000-00000000000a', (select prev from cal_weeks), -100, -100)$$,
  'Fresh proposal allowed for a week whose proposal was superseded');
select throws_ok($$select pg_temp.cal_insert(null, 'a2450000-0000-4000-8000-000000000001', 'b2450000-0000-4000-8000-00000000000a', (select prev from cal_weeks), -100, -100)$$,
  '23505', null, 'Still only one live proposal for that week');
select is((select status from public.decide_calorie_adjustment('c2450000-0000-4000-8000-000000000003', 'decline')), 'declined', 'Decline returns declined');
select is((select calorie_calibration_kcal from public.goals where id = 'b2450000-0000-4000-8000-00000000000a'), -100, 'Decline leaves calibration unchanged');

-- Owner C: stale calibration, pace change, inactive goal.
select set_config('request.jwt.claim.sub', 'a2450000-0000-4000-8000-000000000003', true);
select lives_ok($$select pg_temp.cal_insert('c2450000-0000-4000-8000-0000000000c1', 'a2450000-0000-4000-8000-000000000003', 'b2450000-0000-4000-8000-00000000000c', (select cur from cal_weeks), 50, -100)$$,
  'Stale-calibration proposal inserted');
select is((select status from public.decide_calorie_adjustment('c2450000-0000-4000-8000-0000000000c1', 'accept')), 'superseded', 'Stale calibration supersedes instead of applying');
select is((select calorie_calibration_kcal from public.goals where id = 'b2450000-0000-4000-8000-00000000000c'), 0, 'Stale accept leaves calibration unchanged');
select lives_ok($$select pg_temp.cal_insert('c2450000-0000-4000-8000-0000000000c2', 'a2450000-0000-4000-8000-000000000003', 'b2450000-0000-4000-8000-00000000000c', (select cur from cal_weeks), 0, -100)$$,
  'Fresh same-week proposal after superseded one');
select lives_ok($$update public.goals set pace = 'gradual' where id = 'b2450000-0000-4000-8000-00000000000c'$$, 'Owner changes pace');
select is((select status from public.decide_calorie_adjustment('c2450000-0000-4000-8000-0000000000c2', 'accept')), 'superseded', 'Pace change since the review supersedes');
select is((select calorie_calibration_kcal from public.goals where id = 'b2450000-0000-4000-8000-00000000000c'), 0, 'Pace-stale accept leaves calibration unchanged');
select lives_ok($$select pg_temp.cal_insert('c2450000-0000-4000-8000-0000000000c3', 'a2450000-0000-4000-8000-000000000003', 'b2450000-0000-4000-8000-00000000000c', (select cur from cal_weeks), 0, -100, 'gradual')$$,
  'Proposal for soon-archived goal inserted');
select lives_ok($$update public.goals set status = 'archived' where id = 'b2450000-0000-4000-8000-00000000000c'$$, 'Owner archives goal');
select is((select status from public.decide_calorie_adjustment('c2450000-0000-4000-8000-0000000000c3', 'accept')), 'superseded', 'Accept on inactive goal supersedes');
select throws_ok($$select pg_temp.cal_insert(null, 'a2450000-0000-4000-8000-000000000003', 'b2450000-0000-4000-8000-00000000000c', (select prev from cal_weeks), 0, -100, 'gradual')$$,
  '42501', null, 'Cannot insert a proposal for an inactive goal');

-- Owner D: a proposal older than last week cannot be accepted.
select set_config('request.jwt.claim.sub', 'a2450000-0000-4000-8000-000000000004', true);
select is((select status from public.decide_calorie_adjustment('c2450000-0000-4000-8000-0000000000d1', 'accept')), 'superseded', 'Accept outside the current/previous ISO week supersedes');
select is((select calorie_calibration_kcal from public.goals where id = 'b2450000-0000-4000-8000-00000000000d'), 0, 'Out-of-window accept leaves calibration unchanged');

-- Anonymous callers.
reset role;
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$select * from public.decide_calorie_adjustment('c2450000-0000-4000-8000-000000000001', 'accept')$$,
  '42501', null, 'Anonymous decide denied');

reset role;
select * from finish();
rollback;
