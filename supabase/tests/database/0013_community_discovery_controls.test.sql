begin;
-- Synthetic fixture explicitly activates Community; production defaults stay closed.
update public.community_operations set enabled=true,enrollment=true,discovery=true,publish=true,engagement=true,cohort_required=false;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
insert into auth.users(id,email) values
('c1300000-0000-4000-8000-000000000001','discovery-a@mizyun.test'),
('c1300000-0000-4000-8000-000000000002','discovery-b@mizyun.test');
update public.profiles set birth_year = extract(year from now() at time zone 'UTC')::integer - 30 where id::text like 'c1300000-%';
set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub = 'c1300000-0000-4000-8000-000000000001';
select * from public.community_save_profile('discovery_a','Participant A','PA','Private bio',false,true,'2026-09-30');
select * from public.community_create_invitation('ABCDEFGHIJKLMNOPQRSTUV',7);
set local request.jwt.claim.sub = 'c1300000-0000-4000-8000-000000000002';
select * from public.community_save_profile('discovery_b','Participant B','PB',null,false,true,'2026-09-30');
select is((select count(*) from public.community_profile_by_handle('discovery_a')),0::bigint,'Opt-out lookup is empty');
select is((select count(*) from public.community_resolve_invitation('ABCDEFGHIJKLMNOPQRSTUV')),1::bigint,'Known valid invitation resolves with discovery off');
select ok((select inviter->'bio' = 'null'::jsonb from public.community_resolve_invitation('ABCDEFGHIJKLMNOPQRSTUV')),'Invitation never includes bio');
-- Set up an approved relationship without consuming request budgets in this boundary test.
reset role;set local request.jwt.claim.role='service_role';
insert into public.community_relationships(follower_user_id,target_user_id,status) values
('c1300000-0000-4000-8000-000000000002','c1300000-0000-4000-8000-000000000001','approved');
set local role authenticated;set local request.jwt.claim.role='authenticated';
select is((select count(*) from public.community_profile_by_handle('discovery_a')),0::bigint,'Approved relationship cannot bypass discovery preference');
select ok((select inviter->'bio' = 'null'::jsonb from public.community_resolve_invitation('ABCDEFGHIJKLMNOPQRSTUV')),'Approved invitation viewer still gets no bio');
set local request.jwt.claim.sub = 'c1300000-0000-4000-8000-000000000001';
select * from public.community_save_profile('discovery_a','Participant A','PA','Private bio',true);
set local request.jwt.claim.sub = 'c1300000-0000-4000-8000-000000000002';
select is((select count(*) from public.community_profile_by_handle(' DISCOVERY_A ')),1::bigint,'Normalized exact match resolves');
select is((select count(*) from public.community_profile_by_handle('discovery')),0::bigint,'Prefix cannot discover');
select ok((select bio is null from public.community_profile_by_handle('discovery_a')),'Exact lookup returns minimal identity');
select is((select count(*) from public.community_resolve_invitation('ZZZZZZZZZZZZZZZZZZZZZZ')),0::bigint,'Unknown environment/database bearer returns unavailable');
reset role;set local request.jwt.claim.role='service_role';
-- Fill the shared rolling minute budget, including previous failed probes.
insert into public.community_discovery_attempts(user_id)
select 'c1300000-0000-4000-8000-000000000002'::uuid from generate_series(1,30 - (select count(*)::integer from public.community_discovery_attempts where user_id='c1300000-0000-4000-8000-000000000002'));
set local role authenticated;set local request.jwt.claim.role='authenticated';
select throws_ok($$select * from public.community_profile_by_handle('discovery_a')$$,'P0001','community_rate_limited','Minute actor quota denies exact lookup');
select throws_ok($$select * from public.community_resolve_invitation('ABCDEFGHIJKLMNOPQRSTUV')$$,'P0001','community_rate_limited','Same quota denies invitation resolve');
select throws_ok($$select * from public.community_discovery_attempts$$,'42501',null,'Caller cannot inspect ledger');
select throws_ok($$delete from public.community_discovery_attempts$$,'42501',null,'Caller cannot reset ledger');
reset role;set local request.jwt.claim.role='service_role';
update public.community_discovery_attempts set created_at=greatest(now()-interval '2 minutes',date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') where user_id='c1300000-0000-4000-8000-000000000002';
insert into public.community_discovery_attempts(user_id,created_at) select 'c1300000-0000-4000-8000-000000000002'::uuid,greatest(now()-interval '2 minutes',date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') from generate_series(1,90);
set local role authenticated;set local request.jwt.claim.role='authenticated';
select throws_ok($$select * from public.community_profile_by_handle('discovery_a')$$,'P0001','community_rate_limited','UTC daily budget remains exhausted');
reset role;set local request.jwt.claim.role='service_role';
update public.community_discovery_attempts set created_at = (date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') - interval '2 minutes';
set local role authenticated;set local request.jwt.claim.role='authenticated';
select lives_ok($$select * from public.community_profile_by_handle('discovery_a')$$,'Previous UTC-day attempts do not consume current daily budget');
reset role;set local request.jwt.claim.role='service_role';
delete from public.community_discovery_attempts;
update public.community_invitations set expires_at=now() where token='ABCDEFGHIJKLMNOPQRSTUV';
set local role authenticated;set local request.jwt.claim.role='authenticated';
select is((select count(*) from public.community_resolve_invitation('ABCDEFGHIJKLMNOPQRSTUV')),0::bigint,'Expiry at exact deadline denies bearer');
reset role;set local request.jwt.claim.role='service_role';
update public.community_invitations set expires_at=now()+interval '7 days' where token='ABCDEFGHIJKLMNOPQRSTUV';
update public.community_profiles set generation=generation+1 where user_id='c1300000-0000-4000-8000-000000000001';
set local role authenticated;set local request.jwt.claim.role='authenticated';
select is((select count(*) from public.community_resolve_invitation('ABCDEFGHIJKLMNOPQRSTUV')),0::bigint,'Prior enrollment generation denies bearer');
reset role;set local request.jwt.claim.role='service_role';
update public.community_profiles set generation=generation-1 where user_id='c1300000-0000-4000-8000-000000000001';
insert into public.community_blocks(blocker_user_id,blocked_user_id) values('c1300000-0000-4000-8000-000000000001','c1300000-0000-4000-8000-000000000002');
set local role authenticated;set local request.jwt.claim.role='authenticated';
select is((select count(*) from public.community_resolve_invitation('ABCDEFGHIJKLMNOPQRSTUV')),0::bigint,'Bilateral block denies bearer');
reset role;set local request.jwt.claim.role='service_role';
delete from public.community_blocks where blocker_user_id='c1300000-0000-4000-8000-000000000001';
update public.community_invitations set revoked_at=now() where token='ABCDEFGHIJKLMNOPQRSTUV';
set local role authenticated;set local request.jwt.claim.role='authenticated';
select is((select count(*) from public.community_resolve_invitation('ABCDEFGHIJKLMNOPQRSTUV')),0::bigint,'Revocation denies bearer');
set local role anon;
select throws_ok($$select * from public.community_resolve_invitation('ABCDEFGHIJKLMNOPQRSTUV')$$,'42501',null,'Anonymous identity probe denied');
reset role;set local request.jwt.claim.role='service_role';
-- Twenty revoked invitations from yesterday do not consume today's issuance budget.
insert into public.community_invitations(token,inviter_user_id,expires_at,revoked_at,created_at,enrollment_generation)
select lpad(n::text,22,'x'),'c1300000-0000-4000-8000-000000000002'::uuid,now()+interval '1 day',now(),
(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') - interval '1 hour',1 from generate_series(1,20) n;
set local role authenticated;set local request.jwt.claim.role='authenticated';
select lives_ok($$select * from public.community_create_invitation('UTCdaynewinvitation123',7)$$,'Previous UTC-day issuance does not consume today budget');
reset role;set local request.jwt.claim.role='service_role';
delete from public.community_invitations where inviter_user_id='c1300000-0000-4000-8000-000000000002' and revoked_at is not null;
set local role authenticated;set local request.jwt.claim.role='authenticated';
-- Fill today quota and then revoke, removing the live-limit condition.
select i.id from generate_series(1,19) n cross join lateral public.community_create_invitation(lpad(n::text,22,'y'),7) i;
reset role;set local request.jwt.claim.role='service_role';
update public.community_invitations set revoked_at=now() where inviter_user_id='c1300000-0000-4000-8000-000000000002';
set local role authenticated;set local request.jwt.claim.role='authenticated';
select throws_ok($$select * from public.community_create_invitation('UTCdaynextinvitation12',7)$$,'P0001','community_rate_limited','Revoked same-day invitations still consume issuance budget');
select * from public.community_delete_all_for_user();
reset role;set local request.jwt.claim.role='service_role';
select * from public.community_withdrawal_batch('c1300000-0000-4000-8000-000000000002',1);
set local role authenticated;set local request.jwt.claim.role='authenticated';
select * from public.community_save_profile('discovery_b','Participant B','PB',null,false,true,'2026-09-30');
select throws_ok($$select * from public.community_create_invitation('UTCdaynextinvitation12',7)$$,'P0001','community_rate_limited','Social cleanup and reenrollment cannot reset UTC daily issuance');
select throws_ok($$delete from public.community_invitation_usage$$,'42501',null,'Caller cannot reset issuance counter');
select * from finish();
rollback;
