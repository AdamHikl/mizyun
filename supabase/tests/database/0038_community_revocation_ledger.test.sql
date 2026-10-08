-- Transactional capture/ACK boundaries. Positive replay is exercised separately
-- in the actual network-none mizyun_restore database, never by bypassing its gate.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
update public.community_operations set enabled=true,enrollment=true,discovery=true,publish=true,engagement=true,delivery=false,cohort_required=false;
insert into auth.users(id,email)
select ('c3800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'revocation-'||n||'@mizyun.test' from generate_series(1,5)n;
update public.profiles set birth_year=1990 where id::text like 'c3800000-%';
set local request.jwt.claim.role='service_role';
insert into public.community_profiles(user_id,handle,display_name,status,terms_version,terms_accepted_at,adult_declared_at)
select id,'revocation_'||right(id::text,12),'Synthetic member','active','2026-09-30',now(),now() from auth.users where id::text like 'c3800000-%';
select ok((select relrowsecurity from pg_class where oid='public.community_revocation_events'::regclass),'Capture has RLS');
select ok(not exists(select 1 from pg_constraint where conrelid='public.community_revocation_events'::regclass and contype='f'),'Capture survives Auth/content cascade without an FK');
select ok(not has_table_privilege('authenticated','public.community_revocation_events','SELECT'),'Members cannot inspect private revocation IDs');
select ok(not has_table_privilege('service_role','public.community_revocation_events','DELETE'),'Worker cannot delete unacknowledged events');
select ok(not has_function_privilege('authenticated','public.community_revocation_pending(integer)','EXECUTE'),'Member cannot enumerate pending revocations');
select ok(not has_function_privilege('anon','public.community_revocation_replay(jsonb)','EXECUTE'),'Anonymous caller cannot apply revocations');
select ok(has_function_privilege('service_role','public.community_revocation_ack(uuid[],text)','EXECUTE'),'Worker can acknowledge a durable receipt');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='c3800000-0000-4000-8000-000000000001';
select throws_ok($$select * from public.community_revocation_pending(1)$$,'42501',null,'Authenticated caller cannot read pending IDs');
select throws_ok($$select * from public.community_revocation_replay('[]')$$,'42501',null,'Authenticated caller cannot replay arbitrary erasures');
select * from public.community_withdraw_profile();
reset role;set local request.jwt.claim.role='service_role';
select is((select count(*) from public.community_revocation_events where user_id='c3800000-0000-4000-8000-000000000001' and kind='withdrawal' and generation=1),1::bigint,'Withdrawal captures its original enrollment generation');
update public.community_profiles set status='withdrawn',updated_at=now() where user_id='c3800000-0000-4000-8000-000000000001';
select is((select count(*) from public.community_revocation_events where user_id='c3800000-0000-4000-8000-000000000001' and kind='withdrawal'),1::bigint,'Repeated withdrawal creates no second generation event');

insert into public.community_relationships(id,follower_user_id,target_user_id,status)
values('e3800000-0000-4000-8000-000000000001','c3800000-0000-4000-8000-000000000002','c3800000-0000-4000-8000-000000000003','approved');
insert into public.community_blocks(id,blocker_user_id,blocked_user_id)
values('b3800000-0000-4000-8000-000000000001','c3800000-0000-4000-8000-000000000002','c3800000-0000-4000-8000-000000000003');
select is((select count(*) from public.community_revocation_events where kind='block' and target_id='b3800000-0000-4000-8000-000000000001' and user_id='c3800000-0000-4000-8000-000000000002' and related_user_id='c3800000-0000-4000-8000-000000000003'),1::bigint,'Block captures both principals and exact record');
select is((select count(*) from public.community_revocation_events where kind='relationship' and target_id='e3800000-0000-4000-8000-000000000001'),1::bigint,'Block cascade records removal of the approved edge');
insert into public.community_moderation_sanctions(id,user_id,kind,expires_at)
values('a3800000-0000-4000-8000-000000000001','c3800000-0000-4000-8000-000000000003','suspend',now()+interval '7 days');
select is((select count(*) from public.community_revocation_events where kind='sanction' and target_id='a3800000-0000-4000-8000-000000000001'),1::bigint,'Sanction is captured without copied case text');

insert into public.workouts(id,user_id,name,started_at,completed_at,details)
values('d3800000-0000-4000-8000-000000000001','c3800000-0000-4000-8000-000000000004','Private fixture',now(),now(),'{}');
insert into public.shared_activities(id,user_id,source_workout_id,shared_day,enrollment_generation)
values('f3800000-0000-4000-8000-000000000001','c3800000-0000-4000-8000-000000000004','d3800000-0000-4000-8000-000000000001','2026-10-08',1);
insert into public.community_reactions(id,activity_id,user_id,reaction) values('f3800000-0000-4000-8000-000000000002','f3800000-0000-4000-8000-000000000001','c3800000-0000-4000-8000-000000000002','clap');
update public.shared_activities set revoked_at=now() where id='f3800000-0000-4000-8000-000000000001';
select is((select count(*) from public.community_revocation_events where kind='activity' and target_id='f3800000-0000-4000-8000-000000000001' and generation=1),1::bigint,'Direct owner/source revocation captures exact activity and generation');
select is((select count(*) from public.community_revocation_events where kind='reaction' and target_id='f3800000-0000-4000-8000-000000000002'),1::bigint,'Revocation cascade captures exact removed reaction');
update public.workouts set details='{"private":"edited"}' where id='d3800000-0000-4000-8000-000000000001';
select is((select count(*) from public.community_revocation_events where kind='source_workout' and target_id='d3800000-0000-4000-8000-000000000001'),1::bigint,'Referenced private-source edit leaves a content-free source barrier');
delete from public.workouts where id='d3800000-0000-4000-8000-000000000001';
select is((select count(*) from public.community_revocation_events where kind='activity' and target_id='f3800000-0000-4000-8000-000000000001'),2::bigint,'Source FK cascade preserves a second exact deletion event');
select ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='community_revocation_events' and column_name in ('body','notes','snapshot','handle','email','token')),'External event shape contains no text, snapshot, identity label or token');

insert into public.community_media_assets(id,user_id,generation,operation_id,digest,alt_text,state)
values('a3800000-0000-4000-8000-000000000002','c3800000-0000-4000-8000-000000000004',1,'a3800000-0000-4000-8000-000000000003',repeat('a',64),'Synthetic still','pending');
update public.community_media_assets set state='revoked' where id='a3800000-0000-4000-8000-000000000002';
select is((select count(*) from public.community_revocation_events where kind='media' and target_id='a3800000-0000-4000-8000-000000000002'),1::bigint,'Media revocation is captured independently of physical cleanup');
select is((select count(*) from public.community_media_cleanup_jobs where id='a3800000-0000-4000-8000-000000000002'),1::bigint,'Existing physical cleanup ticket remains intact');

insert into public.community_messaging_preferences(user_id,generation,enabled) values('c3800000-0000-4000-8000-000000000004',1,true);
update public.community_messaging_preferences set enabled=false where user_id='c3800000-0000-4000-8000-000000000004';
select is((select count(*) from public.community_revocation_events where kind='messaging_optout' and user_id='c3800000-0000-4000-8000-000000000004' and generation=1),1::bigint,'Messaging opt-out captures its enrollment');
insert into public.community_broader_discovery_preferences(user_id,generation,enabled) values('c3800000-0000-4000-8000-000000000004',1,true);
update public.community_broader_discovery_preferences set enabled=false where user_id='c3800000-0000-4000-8000-000000000004';
update public.community_profiles set is_searchable=true where user_id='c3800000-0000-4000-8000-000000000004';
update public.community_profiles set is_searchable=false where user_id='c3800000-0000-4000-8000-000000000004';
select is((select count(*) from public.community_revocation_events where kind='discovery_optout' and user_id='c3800000-0000-4000-8000-000000000004' and generation=1),2::bigint,'Both discovery preferences and handle search narrowing are captured');
insert into public.community_groups(id,user_id,created_by,operation_id,name,rules) values('b3800000-0000-4000-8000-000000000010','c3800000-0000-4000-8000-000000000004','c3800000-0000-4000-8000-000000000004','b3800000-0000-4000-8000-000000000011','Synthetic group','Synthetic rules');
insert into public.community_group_members(group_id,user_id,state,generation,joined_at) values('b3800000-0000-4000-8000-000000000010','c3800000-0000-4000-8000-000000000002','member',1,now());
insert into public.community_challenges(id,user_id,group_id,title,start_day,end_day,timezone,goal_days) values('b3800000-0000-4000-8000-000000000012','c3800000-0000-4000-8000-000000000004','b3800000-0000-4000-8000-000000000010','Synthetic challenge','2026-10-08','2026-10-09','UTC',1);
insert into public.community_challenge_members(user_id,challenge_id,generation) values('c3800000-0000-4000-8000-000000000002','b3800000-0000-4000-8000-000000000012',1);
insert into public.community_challenge_contributions(user_id,challenge_id,day,kind) values('c3800000-0000-4000-8000-000000000002','b3800000-0000-4000-8000-000000000012','2026-10-08','rest');
delete from public.community_challenge_contributions where user_id='c3800000-0000-4000-8000-000000000002';
delete from public.community_challenge_members where user_id='c3800000-0000-4000-8000-000000000002';
select is((select count(*) from public.community_revocation_events where kind='challenge_contribution' and target_id='b3800000-0000-4000-8000-000000000012'),1::bigint,'Contribution removal leaves a challenge/member cutoff barrier');
select is((select count(*) from public.community_revocation_events where kind='challenge_membership' and target_id='b3800000-0000-4000-8000-000000000012' and generation=1),1::bigint,'Challenge departure captures exact enrollment');
update public.community_group_members set state='removed' where group_id='b3800000-0000-4000-8000-000000000010' and user_id='c3800000-0000-4000-8000-000000000002';
select is((select count(*) from public.community_revocation_events where kind='group_membership' and target_id='b3800000-0000-4000-8000-000000000010' and generation=1),1::bigint,'Group access narrowing captures exact group/member enrollment');

insert into public.account_deletion_jobs(id,user_id,challenge_hash,status,stage,expires_at)
values('a3800000-0000-4000-8000-000000000004','c3800000-0000-4000-8000-000000000005','synthetic-challenge','challenge_issued','none',now()+interval '5 minutes');
select is((select count(*) from public.community_revocation_events where kind='account_erasure' and user_id='c3800000-0000-4000-8000-000000000005'),0::bigint,'Issuing an unconfirmed challenge is not an accepted account erasure');
update public.account_deletion_jobs set status='in_progress' where id='a3800000-0000-4000-8000-000000000004';
select is((select count(*) from public.community_revocation_events where kind='account_erasure' and target_id='a3800000-0000-4000-8000-000000000004'),1::bigint,'Accepting deletion captures barrier before destructive worker stages');
delete from auth.users where id='c3800000-0000-4000-8000-000000000005';
select is((select count(*) from public.community_revocation_events where kind='account_erasure' and user_id='c3800000-0000-4000-8000-000000000005'),2::bigint,'Direct Auth erasure adds a barrier and cannot cascade away accepted erasure');

set local role service_role;
select throws_ok($$select * from public.community_revocation_pending(501)$$,'P0001','community_invalid_action','Pending export size is bounded');
select throws_ok($$select public.community_revocation_ack('{}',repeat('a',64))$$,'P0001','community_invalid_action','Empty ACK cannot establish delivery');
select throws_ok($$select public.community_revocation_ack(array['00000000-0000-0000-0000-000000000000'::uuid],repeat('a',64))$$,'P0001','community_conflict','Unknown event ACK fails closed');
select throws_ok($$select public.community_revocation_ack(array[(select event_id from public.community_revocation_pending(1))],'not-a-digest')$$,'P0001','community_invalid_action','ACK requires a ciphertext checkpoint digest');
reset role;set local request.jwt.claim.role='service_role';
create temporary table revocation_receipt as select event_id from public.community_revocation_events where user_id::text like 'c3800000-%' order by created_at,event_id limit 1;
select is(public.community_revocation_ack(array[(select event_id from revocation_receipt)],repeat('a',64)),1,'Durable receipt acknowledges exactly its exported event');
select is(public.community_revocation_ack(array[(select event_id from revocation_receipt)],repeat('a',64)),0,'Lost ACK response retries the same receipt idempotently');
select throws_ok($$select public.community_revocation_ack(array[(select event_id from revocation_receipt)],repeat('b',64))$$,'P0001','community_conflict','Conflicting checkpoint cannot rewrite acknowledged proof');
select is((select count(*) from public.community_revocation_pending(500) p join revocation_receipt r using(event_id)),0::bigint,'ACKed event is omitted from subsequent export scans');
select ok((select count(*)>0 from public.community_revocation_events where user_id::text like 'c3800000-%' and acknowledged_at is null),'Other captured events remain pending until their own durable receipt');
select throws_ok($$select public.community_revocation_replay('[]')$$,'P0001','community_restore_quarantine_required','Even privileged replay cannot run in the live/default database');
set local mizyun.restore_environment='dev';
set local mizyun.restore_run_id='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
set local mizyun.revocation_replaying='on';
delete from auth.users where id='c3800000-0000-4000-8000-000000000004';
select is((select count(*) from public.community_revocation_events where kind='account_erasure' and user_id='c3800000-0000-4000-8000-000000000004'),1::bigint,'Setting replay GUCs cannot suppress capture on the primary database');
select * from finish();
rollback;
