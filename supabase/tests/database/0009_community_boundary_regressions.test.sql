begin;
-- Synthetic fixture explicitly activates Community; production defaults stay closed.
update public.community_operations set enabled=true,enrollment=true,discovery=true,publish=true,engagement=true,cohort_required=false;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- These helpers accept either an ACL/RLS exception or an RLS-filtered zero-row
-- operation. Syntax errors and missing tables/functions still abort the test.
-- They run as the caller, never SECURITY DEFINER.
create function pg_temp.community_write_denied(statement text)
returns boolean language plpgsql as $$
declare affected bigint;
begin
  execute statement;
  get diagnostics affected = row_count;
  return affected = 0;
exception
  when insufficient_privilege or check_violation or foreign_key_violation
    or raise_exception or invalid_parameter_value then return true;
end;
$$;

create function pg_temp.community_visible_count(statement text)
returns bigint language plpgsql as $$
declare result bigint;
begin
  execute 'select count(*) from (' || statement || ') as permitted_rows' into result;
  return result;
exception when insufficient_privilege then return 0;
end;
$$;

-- Trusted fixtures represent valid enrollment receipts. Authenticated raw writes
-- remain denied by table ACL and cannot use this fixture construction.
create function pg_temp.community_fixture_receipt() returns trigger language plpgsql as $$
begin new.terms_version := '2026-09-30'; new.terms_accepted_at := now(); new.adult_declared_at := now(); return new; end $$;
create trigger community_fixture_receipt before insert on public.community_profiles
for each row execute function pg_temp.community_fixture_receipt();

-- A missing hardening RPC is an explicit failed acceptance result on baseline,
-- rather than an undefined-function error that prevents later regressions.
create function pg_temp.community_resolved_invitation(invite_token text)
returns jsonb language plpgsql as $$
declare result jsonb;
begin
  execute 'select jsonb_build_object(''invitation'', invitation, ''inviter'', inviter) from public.community_resolve_invitation($1)'
    into result using invite_token;
  return result;
exception when undefined_function then return null;
end;
$$;

create function pg_temp.community_incoming_block(other_user uuid)
returns boolean language plpgsql as $$
declare result boolean;
begin
  execute 'select is_unavailable from public.community_is_unavailable($1)' into result using other_user;
  return coalesce(result, false);
exception when undefined_function then return false;
end;
$$;

do $$
begin
  execute format('grant usage on schema %s to authenticated', pg_catalog.pg_my_temp_schema()::regnamespace);
end;
$$;
grant execute on function pg_temp.community_write_denied(text),
  pg_temp.community_visible_count(text), pg_temp.community_resolved_invitation(text),
  pg_temp.community_incoming_block(uuid) to authenticated;

-- Trusted fixture construction is distinct from the authenticated attack
-- statements below. Auth creates the existing private profiles automatically.
insert into auth.users (id, email) values
  ('c9000000-0000-4000-8000-000000000001', 'community-boundary-a@mizyun.test'),
  ('c9000000-0000-4000-8000-000000000002', 'community-boundary-b@mizyun.test'),
  ('c9000000-0000-4000-8000-000000000003', 'community-boundary-unenrolled@mizyun.test'),
  ('c9000000-0000-4000-8000-000000000004', 'community-boundary-suspended@mizyun.test'),
  ('c9000000-0000-4000-8000-000000000005', 'community-boundary-underage@mizyun.test');
update public.profiles set birth_year = extract(year from now())::integer - 30
where id in ('c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000004');
update public.profiles set birth_year = extract(year from now())::integer - 17
where id = 'c9000000-0000-4000-8000-000000000005';

insert into public.community_profiles (user_id, handle, display_name, is_searchable, status) values
  ('c9000000-0000-4000-8000-000000000001', 'boundary_author', 'Boundary Author', true, 'active'),
  ('c9000000-0000-4000-8000-000000000002', 'boundary_follower', 'Boundary Follower', false, 'active'),
  ('c9000000-0000-4000-8000-000000000004', 'boundary_suspended', 'Boundary Suspended', false, 'suspended');

insert into public.workouts (id, user_id, name, started_at, completed_at) values
  ('d9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001', 'Private author source', now() - interval '1 hour', now()),
  ('d9000000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000002', 'Private follower source', now() - interval '1 hour', now()),
  ('d9000000-0000-4000-8000-000000000003', 'c9000000-0000-4000-8000-000000000001', 'Incomplete source', now(), null);

update public.workouts set details = '{"workoutLifecycle":{"kind":"session"}}'::jsonb
where id in ('d9000000-0000-4000-8000-000000000001','d9000000-0000-4000-8000-000000000002','d9000000-0000-4000-8000-000000000003');

insert into public.community_invitations (id, token, inviter_user_id, expires_at) values
  ('e9000000-0000-4000-8000-000000000001', 'boundary-known-invite-token-000001', 'c9000000-0000-4000-8000-000000000001', now() + interval '1 day'),
  ('e9000000-0000-4000-8000-000000000002', 'boundary-private-invite-token-00002', 'c9000000-0000-4000-8000-000000000002', now() + interval '1 day');

-- An authenticated account with no community enrollment must not browse the
-- directory or enroll directly without adult eligibility/accepted current terms.
set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000003';
select is(pg_temp.community_visible_count($$select * from public.community_profiles where user_id <> 'c9000000-0000-4000-8000-000000000003'$$), 0::bigint,
  'Unenrolled authenticated account cannot read social directory');
select ok(pg_temp.community_write_denied($$insert into public.community_profiles (user_id, handle, display_name) values ('c9000000-0000-4000-8000-000000000003', 'boundary_no_age', 'No Age')$$),
  'Unknown-age account cannot create community enrollment directly');
set local request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000005';
select ok(pg_temp.community_write_denied($$insert into public.community_profiles (user_id, handle, display_name) values ('c9000000-0000-4000-8000-000000000005', 'boundary_underage', 'Underage')$$),
  'Known-underage account cannot create community enrollment directly');
set local request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000004';
select ok(pg_temp.community_write_denied($$update public.community_profiles set status = 'active' where user_id = 'c9000000-0000-4000-8000-000000000004'$$),
  'Suspended participant cannot clear their own suspension');
select ok(pg_temp.community_write_denied($$delete from public.community_profiles where user_id = 'c9000000-0000-4000-8000-000000000004'$$),
  'Suspended participant cannot erase stable sanction identity by deleting social profile');

-- Reset state after an expected failing baseline assertion, so each regression
-- remains independently meaningful even when the unfixed migration allows it.
reset role;set local request.jwt.claim.role='service_role';
set local request.jwt.claim.role = 'service_role';
delete from public.community_profiles where user_id in ('c9000000-0000-4000-8000-000000000003', 'c9000000-0000-4000-8000-000000000005');
insert into public.community_profiles (user_id, handle, display_name, is_searchable, status)
values ('c9000000-0000-4000-8000-000000000004', 'boundary_suspended', 'Boundary Suspended', false, 'suspended')
on conflict (user_id) do update set status = 'suspended';
insert into public.community_relationships (id, follower_user_id, target_user_id, status)
values ('a9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000001', 'pending');

set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000001';
select is(pg_temp.community_resolved_invitation('boundary-private-invite-token-00002')->'inviter'->>'user_id',
  'c9000000-0000-4000-8000-000000000002',
  'Known-token RPC resolves deliberately invited non-searchable participant');
select is(pg_temp.community_resolved_invitation('boundary-private-invite-token-00002')->'inviter'->'bio', 'null'::jsonb,
  'Non-searchable invitation resolution excludes private social bio');
set local request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000002';
select ok(pg_temp.community_write_denied($$update public.community_relationships set status = 'approved' where id = 'a9000000-0000-4000-8000-000000000001'$$),
  'Requester cannot directly approve their outgoing request');
select ok(pg_temp.community_write_denied($$update public.community_relationships set follower_user_id = 'c9000000-0000-4000-8000-000000000003', target_user_id = 'c9000000-0000-4000-8000-000000000002', status = 'approved' where id = 'a9000000-0000-4000-8000-000000000001'$$),
  'Participant cannot rewrite edge endpoints to forge another account following them');

-- Raw invite listing must not disclose bearer secrets, even to enrolled users.
select is(pg_temp.community_visible_count($$select token from public.community_invitations where inviter_user_id <> 'c9000000-0000-4000-8000-000000000002'$$), 0::bigint,
  'Enrolled stranger cannot enumerate other participants bearer invitation secrets');
select ok(pg_temp.community_write_denied($$insert into public.shared_activities (user_id, source_workout_id, category, shared_day) values ('c9000000-0000-4000-8000-000000000002', 'd9000000-0000-4000-8000-000000000001', 'other', '2026-09-30')$$),
  'Author cannot publish a source workout owned by another user');
set local request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000001';
select ok(pg_temp.community_write_denied($$insert into public.shared_activities (user_id, source_workout_id, category, shared_day) values ('c9000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000003', 'other', '2026-09-30')$$),
  'Author cannot publish an incomplete source workout directly');

reset role;set local request.jwt.claim.role='service_role';
set local request.jwt.claim.role = 'service_role';
-- Remove baseline artifacts and restore the original pending edge before block.
delete from public.shared_activities where source_workout_id in ('d9000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000003');
delete from public.community_relationships where id = 'a9000000-0000-4000-8000-000000000001';
insert into public.community_blocks (blocker_user_id, blocked_user_id)
values ('c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000002');

set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000002';
select is(pg_temp.community_visible_count($$select * from public.community_profiles where user_id = 'c9000000-0000-4000-8000-000000000001'$$), 0::bigint,
  'Incoming block hides blocker profile from blocked principal');
select ok(pg_temp.community_write_denied($$insert into public.community_relationships (follower_user_id, target_user_id, status) values ('c9000000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000001', 'pending')$$),
  'Incoming block prevents blocked principal from creating a new request');
select ok(pg_temp.community_incoming_block('c9000000-0000-4000-8000-000000000001'),
  'Caller-relative block RPC detects incoming block despite owner-only raw block RLS');
select is(pg_temp.community_resolved_invitation('boundary-known-invite-token-000001'), null::jsonb,
  'Known invitation token cannot bypass an incoming block');

-- Setup a fresh authorized card/edge as a trusted fixture, then exercise direct
-- source mutation as its owner. Source eligibility must be a DB invariant, not
-- only an API route side effect.
reset role;set local request.jwt.claim.role='service_role';
set local request.jwt.claim.role = 'service_role';
delete from public.community_blocks where blocker_user_id = 'c9000000-0000-4000-8000-000000000001';
delete from public.community_relationships where follower_user_id = 'c9000000-0000-4000-8000-000000000002' and target_user_id = 'c9000000-0000-4000-8000-000000000001';
insert into public.community_relationships (id, follower_user_id, target_user_id, status)
values ('a9000000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000001', 'approved');
insert into public.shared_activities (id, user_id, source_workout_id, category, shared_day)
values ('f9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000001', 'strength', '2026-09-30');
insert into public.community_reactions (activity_id, user_id, reaction)
values ('f9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000002', 'clap');

set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000002';
select is(pg_temp.community_visible_count($$select source_workout_id from public.shared_activities where id = 'f9000000-0000-4000-8000-000000000001'$$), 0::bigint,
  'Approved follower cannot read author-only private source identifier through raw database transport');
set local request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000001';
select lives_ok($$update public.workouts set completed_at = null where id = 'd9000000-0000-4000-8000-000000000001'$$,
  'Source owner can correct completed workout to incomplete through direct database');
set local request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000002';
select is(pg_temp.community_visible_count($$select * from public.shared_activities where id = 'f9000000-0000-4000-8000-000000000001'$$), 0::bigint,
  'Source uncompletion atomically denies follower access');
reset role;set local request.jwt.claim.role='service_role';
set local request.jwt.claim.role = 'service_role';
select is((select count(*) from public.community_reactions where activity_id = 'f9000000-0000-4000-8000-000000000001'), 0::bigint,
  'Source uncompletion atomically invalidates all prior reactions');

-- Deleting an actual source must remove or revoke its artifact even without API.
update public.workouts set completed_at = now() where id = 'd9000000-0000-4000-8000-000000000001';
update public.shared_activities set revoked_at = null where id = 'f9000000-0000-4000-8000-000000000001';
set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000001';
select lives_ok($$delete from public.workouts where id = 'd9000000-0000-4000-8000-000000000001'$$,
  'Source owner can delete private workout directly');
set local request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000002';
select is(pg_temp.community_visible_count($$select * from public.shared_activities where id = 'f9000000-0000-4000-8000-000000000001'$$), 0::bigint,
  'Source deletion denies follower access without relying on API cleanup');

-- Trusted lifecycle transition models the application accepting withdrawal.
-- Cleanup must be atomic, keep stable safety restrictions and prevent resurrection.
reset role;set local request.jwt.claim.role='service_role';
set local request.jwt.claim.role = 'service_role';
update public.profiles set birth_year = extract(year from now())::integer - 30
where id = 'c9000000-0000-4000-8000-000000000003';
insert into public.community_profiles (user_id, handle, display_name, is_searchable, status)
values ('c9000000-0000-4000-8000-000000000003', 'boundary_third', 'Boundary Third', false, 'active');
insert into public.shared_activities (id, user_id, source_workout_id, category, shared_day)
values ('f9000000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000002', 'd9000000-0000-4000-8000-000000000002', 'other', '2026-09-30');
insert into public.community_blocks (blocker_user_id, blocked_user_id)
values ('c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000002');
insert into public.community_relationships (follower_user_id, target_user_id, status)
values ('c9000000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000003', 'pending');
update public.community_profiles set status = 'withdrawn'
where user_id = 'c9000000-0000-4000-8000-000000000002';
select is((select count(*) from public.shared_activities where user_id = 'c9000000-0000-4000-8000-000000000002' and revoked_at is null), 0::bigint,
  'Accepted withdrawal durably revokes old-generation cards');
select is((select count(*) from public.community_relationships where follower_user_id = 'c9000000-0000-4000-8000-000000000002' or target_user_id = 'c9000000-0000-4000-8000-000000000002'), 0::bigint,
  'Accepted withdrawal severs incoming/outgoing relationships atomically');
select is((select count(*) from public.community_invitations where inviter_user_id = 'c9000000-0000-4000-8000-000000000002' and revoked_at is null), 0::bigint,
  'Accepted withdrawal durably revokes old invitation tokens');
select is((select count(*) from public.community_blocks where blocker_user_id = 'c9000000-0000-4000-8000-000000000001' and blocked_user_id = 'c9000000-0000-4000-8000-000000000002'), 1::bigint,
  'Withdrawal preserves another participants stable block');

set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000002';
select ok(pg_temp.community_write_denied($$update public.community_profiles set status = 'active' where user_id = 'c9000000-0000-4000-8000-000000000002'$$),
  'Participant cannot reactivate withdrawn generation directly');
select ok(pg_temp.community_write_denied($$update public.community_profiles set generation = 99 where user_id = 'c9000000-0000-4000-8000-000000000002'$$),
  'Participant cannot forge enrollment generation directly');

reset role;set local request.jwt.claim.role='service_role';
set local request.jwt.claim.role = 'service_role';
select * from public.community_withdrawal_batch('c9000000-0000-4000-8000-000000000002',1);
update public.community_profiles set status = 'active', generation = 2
where user_id = 'c9000000-0000-4000-8000-000000000002';
select is((select count(*) from public.shared_activities where user_id = 'c9000000-0000-4000-8000-000000000002' and revoked_at is null), 0::bigint,
  'Trusted re-enrollment does not resurrect previous-generation publications');
select is((select count(*) from public.community_blocks where blocker_user_id = 'c9000000-0000-4000-8000-000000000001' and blocked_user_id = 'c9000000-0000-4000-8000-000000000002'), 1::bigint,
  'Trusted re-enrollment keeps stable-account block');

select * from finish();
rollback;
