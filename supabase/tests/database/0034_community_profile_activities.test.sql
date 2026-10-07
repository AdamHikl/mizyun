begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
set local request.jwt.claim.role='service_role';
update public.community_operations set enabled=true,enrollment=true,discovery=true,publish=true,engagement=true,cohort_required=false;
insert into auth.users(id,email) values
 ('34000000-0000-4000-8000-000000000001','timeline-owner@mizyun.test'),
 ('34000000-0000-4000-8000-000000000002','timeline-friend@mizyun.test'),
 ('34000000-0000-4000-8000-000000000003','timeline-outsider@mizyun.test');
update public.profiles set birth_year=1990 where id::text like '34000000%';
set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='34000000-0000-4000-8000-000000000001';
select * from public.community_save_profile('timeline_owner','Owner','OW',null,true,true,'2026-09-30');
set local request.jwt.claim.sub='34000000-0000-4000-8000-000000000002';
select * from public.community_save_profile('timeline_friend','Friend','FR',null,true,true,'2026-09-30');
set local request.jwt.claim.sub='34000000-0000-4000-8000-000000000003';
select * from public.community_save_profile('timeline_outsider','Outsider','OU',null,true,true,'2026-09-30');
reset role;set local request.jwt.claim.role='service_role';
insert into public.workouts(id,user_id,name,started_at,completed_at,details)
select ('34100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'34000000-0000-4000-8000-000000000001','Private workout',now()-interval '1 hour',now(),'{"workoutLifecycle":{"kind":"session"}}' from generate_series(1,53)i;
insert into public.shared_activities(id,user_id,source_workout_id,category,shared_day,published_at)
select ('34200000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'34000000-0000-4000-8000-000000000001',('34100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'strength',(now() at time zone 'UTC')::date::text,now()-interval '1 hour' from generate_series(1,53)i;
insert into public.community_relationships(follower_user_id,target_user_id,status) values('34000000-0000-4000-8000-000000000002','34000000-0000-4000-8000-000000000001','pending');
set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='34000000-0000-4000-8000-000000000003';
select is((select count(*) from public.community_author_activities('34000000-0000-4000-8000-000000000001',20,null,null)),0::bigint,'Unrelated member cannot enumerate a guessed author timeline');
select ok(not has_function_privilege('anon','public.community_author_activities(uuid,integer,timestamptz,uuid)','execute'),'Anonymous cannot call author timeline');
set local request.jwt.claim.sub='34000000-0000-4000-8000-000000000002';
select is((select count(*) from public.community_author_activities('34000000-0000-4000-8000-000000000001',20,null,null)),0::bigint,'Pending request confers no author access');
reset role;set local request.jwt.claim.role='service_role';
update public.community_relationships set status='approved' where follower_user_id='34000000-0000-4000-8000-000000000002';
set local role authenticated;set local request.jwt.claim.role='authenticated';
select is((select count(*) from public.community_author_activities('34000000-0000-4000-8000-000000000001',999,null,null)),51::bigint,'Internal approved author list is bounded to 51 including lookahead');
select is((select id::text from public.community_author_activities('34000000-0000-4000-8000-000000000001',1,null,null)),'34200000-0000-4000-8000-000000000053','Equal publication times use descending UUID tie-breaker');
select is((select count(*) from public.community_author_activities('34000000-0000-4000-8000-000000000001',50,now()-interval '1 hour','34200000-0000-4000-8000-000000000004')),3::bigint,'Older author page uses complete stable tuple');
select ok((select bool_and(source_workout_id='00000000-0000-0000-0000-000000000000') from public.community_author_activities('34000000-0000-4000-8000-000000000001',20,null,null)),'Peer timeline strips private source identity at RPC boundary');
set local request.jwt.claim.sub='34000000-0000-4000-8000-000000000001';
select ok((select bool_and(source_workout_id='00000000-0000-0000-0000-000000000000') from public.community_author_activities('34000000-0000-4000-8000-000000000001',20,null,null)),'Owner timeline uses common projection, independent from private management context');
reset role;set local request.jwt.claim.role='service_role';
update public.shared_activities set revoked_at=now() where id='34200000-0000-4000-8000-000000000001';
update public.shared_activities set published_at=now()-interval '366 days' where id='34200000-0000-4000-8000-000000000002';
update public.shared_activities set enrollment_generation=2 where id='34200000-0000-4000-8000-000000000003';
set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='34000000-0000-4000-8000-000000000002';
select is((select count(*) from public.community_author_activities('34000000-0000-4000-8000-000000000001',50,now()-interval '1 hour','34200000-0000-4000-8000-000000000004')),0::bigint,'Revoked, expired and former-generation publications are excluded');
reset role;set local request.jwt.claim.role='service_role';
update public.community_operations set enabled=false;
set local role authenticated;set local request.jwt.claim.role='authenticated';
select is((select count(*) from public.community_author_activities('34000000-0000-4000-8000-000000000001',20,null,null)),0::bigint,'Global admission freeze fails closed for direct RPC');
reset role;set local request.jwt.claim.role='service_role';
update public.community_operations set enabled=true;
insert into public.community_blocks(blocker_user_id,blocked_user_id) values('34000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000002');
set local role authenticated;set local request.jwt.claim.role='authenticated';
select is((select count(*) from public.community_author_activities('34000000-0000-4000-8000-000000000001',20,null,null)),0::bigint,'Bilateral block immediately retires direct RPC audience');
reset role;
select * from finish();
rollback;
