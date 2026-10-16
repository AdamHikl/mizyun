begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values ('f2480000-0000-4000-8000-000000000001','boulder-a@mizyun.test'),('f2480000-0000-4000-8000-000000000002','boulder-b@mizyun.test');
insert into public.media_assets(id,user_id,object_path,purpose,mime_type) values
 ('a2480000-0000-4000-8000-000000000001','f2480000-0000-4000-8000-000000000001','f2480000-0000-4000-8000-000000000001/boulder-a.jpg','workout','image/jpeg'),
 ('a2480000-0000-4000-8000-000000000002','f2480000-0000-4000-8000-000000000002','f2480000-0000-4000-8000-000000000002/boulder-b.jpg','workout','image/jpeg'),
 ('a2480000-0000-4000-8000-000000000003','f2480000-0000-4000-8000-000000000001','f2480000-0000-4000-8000-000000000001/progress-a.jpg','progress','image/jpeg');
create temporary table ids(label text primary key,id uuid);
grant all on ids to authenticated;

-- Grants and RLS
select ok((select relrowsecurity from pg_class where oid='public.boulder_ascents'::regclass),'RLS on boulder_ascents');
select ok((select relrowsecurity from pg_class where oid='public.boulder_operation_receipts'::regclass),'RLS on boulder_operation_receipts');
select ok(not has_table_privilege('authenticated','public.boulder_ascents','INSERT'),'No direct ascent insert');
select ok(not has_table_privilege('authenticated','public.boulder_ascents','UPDATE'),'No direct ascent update');
select ok(not has_table_privilege('authenticated','public.boulder_ascents','DELETE'),'No direct ascent delete');
select ok(not has_table_privilege('authenticated','public.boulder_operation_receipts','INSERT'),'No direct receipt insert');
select ok(not has_table_privilege('anon','public.boulder_ascents','SELECT'),'Anon cannot read ascents');
select ok(not has_function_privilege('anon','public.boulder_session_start(uuid,text,text)','EXECUTE'),'Anon cannot start');
select ok(not has_function_privilege('service_role','public.boulder_ascent_create(uuid,uuid,text,text,integer,text,text,uuid,uuid)','EXECUTE'),'Service role has no create grant');
select ok(has_function_privilege('authenticated','public.boulder_ascent_create(uuid,uuid,text,text,integer,text,text,uuid,uuid)','EXECUTE'),'Authenticated can create through the RPC');
select ok(not has_function_privilege('authenticated','public.boulder_admit()','EXECUTE'),'Admission helper is private');
select is(public.boulder_grade_rank('6A+'),6::smallint,'Font 6A+ ranks 6');
select is(public.boulder_grade_rank('8C+'),22::smallint,'Font 8C+ ranks 22');
select ok(public.boulder_grade_rank('6a+') is null,'Lowercase is not canonical in storage');
select ok(exists(select 1 from pg_indexes where tablename='boulder_ascents' and indexdef like '%(user_id, logged_at DESC)%'),'Owner index on ascents');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='f2480000-0000-4000-8000-000000000001';

-- Session lifecycle
select throws_ok($$select * from public.boulder_session_start('b2480000-0000-4000-8000-0000000000a1','Not/AZone',null)$$,'22023','boulder_invalid','Unknown timezone is rejected');
select throws_ok($$select * from public.boulder_session_start('b2480000-0000-4000-8000-0000000000a1','Europe/Bratislava',repeat('g',61))$$,'22023','boulder_invalid','Overlong gym name is rejected');
insert into ids select 'session_a',id from public.boulder_session_start('b2480000-0000-4000-8000-0000000000a1','Europe/Bratislava','  Boulder Bar  ');
select is((select details->'boulderSession'->>'gymName' from public.workouts where id=(select id from ids where label='session_a')),'Boulder Bar','Gym name is trimmed');
select ok((select completed_at is null and details->>'activityType'='bouldering' and details->'boulderSession'->>'activityDate'=to_char((now() at time zone 'Europe/Bratislava')::date,'YYYY-MM-DD') from public.workouts where id=(select id from ids where label='session_a')),'Active session with local activity date');
select is((select id from public.boulder_session_start('b2480000-0000-4000-8000-0000000000a1','Europe/Bratislava','Boulder Bar')),(select id from ids where label='session_a'),'Start replay returns the same session');
select throws_ok($$select * from public.boulder_session_start('b2480000-0000-4000-8000-0000000000a1','UTC',null)$$,'PT409','boulder_conflict','Changed start payload conflicts');
select throws_ok($$select * from public.boulder_session_start('b2480000-0000-4000-8000-0000000000a2','UTC',null)$$,'PT409','boulder_session_active','Second active session is refused');

-- Direct writes are blocked
select throws_ok($$insert into public.workouts(user_id,name,started_at,details,client_operation_id) values('f2480000-0000-4000-8000-000000000001','x',now(),'{"activityType":"bouldering"}','b2480000-0000-4000-8000-0000000000ff')$$,'42501','boulder_requires_rpc','Direct bouldering insert is blocked');
select throws_ok($$update public.workouts set name='Strength' where id=(select id from ids where label='session_a')$$,'42501','boulder_requires_rpc','Direct session update is blocked');
select throws_ok($$update public.workouts set details='{}' where id=(select id from ids where label='session_a')$$,'42501','boulder_requires_rpc','Discriminator cannot be removed directly');
select throws_ok($$delete from public.workouts where id=(select id from ids where label='session_a')$$,'42501','boulder_requires_rpc','Direct session delete is blocked');

-- Ascents
select throws_ok($$select * from public.boulder_ascent_create((select id from ids where label='session_a'),'c2480000-0000-4000-8000-0000000000b1','9A','sent',null,null,null,null)$$,'22023','boulder_invalid','Grade outside Font list is rejected');
select throws_ok($$select * from public.boulder_ascent_create((select id from ids where label='session_a'),'c2480000-0000-4000-8000-0000000000b1','6A','flash',2,null,null,null)$$,'22023','boulder_invalid','Flash must be one attempt');
select throws_ok($$select * from public.boulder_ascent_create((select id from ids where label='session_a'),'c2480000-0000-4000-8000-0000000000b1','6A','sent',1,null,null,null)$$,'22023','boulder_invalid','Sent needs at least two attempts');
select throws_ok($$select * from public.boulder_ascent_create((select id from ids where label='session_a'),'c2480000-0000-4000-8000-0000000000b1','6A','not_yet',100,null,null,null)$$,'22023','boulder_invalid','Attempts are capped');
select throws_ok($$select * from public.boulder_ascent_create((select id from ids where label='session_a'),'c2480000-0000-4000-8000-0000000000b1','6A','sent',null,'teal',null,null)$$,'22023','boulder_invalid','Unknown hold colour is rejected');
select throws_ok($$select * from public.boulder_ascent_create((select id from ids where label='session_a'),'c2480000-0000-4000-8000-0000000000b1','6A','sent',null,null,repeat('n',281),null)$$,'22023','boulder_invalid','Overlong note is rejected');
select throws_ok($$select * from public.boulder_ascent_create((select id from ids where label='session_a'),'c2480000-0000-4000-8000-0000000000b1','6A','sent',null,null,null,'a2480000-0000-4000-8000-000000000002')$$,'22023','boulder_invalid','Another user''s photo is rejected');
select throws_ok($$select * from public.boulder_ascent_create((select id from ids where label='session_a'),'c2480000-0000-4000-8000-0000000000b1','6A','sent',null,null,null,'a2480000-0000-4000-8000-000000000003')$$,'22023','boulder_invalid','Non-workout photo purpose is rejected');
insert into ids select 'flash',id from public.boulder_ascent_create((select id from ids where label='session_a'),'c2480000-0000-4000-8000-0000000000b1','6B','flash',1,'blue',null,'a2480000-0000-4000-8000-000000000001');
insert into ids select 'project',id from public.boulder_ascent_create((select id from ids where label='session_a'),'c2480000-0000-4000-8000-0000000000b2','7A','not_yet',null,null,'Heel hook',null);
select is((select grade_rank from public.boulder_ascents where id=(select id from ids where label='flash')),7::smallint,'Server derives rank');
select is((select array_agg(sequence order by sequence) from public.boulder_ascents where workout_id=(select id from ids where label='session_a')),array[1,2],'Sequences are assigned in order');
select is((select id from public.boulder_ascent_create((select id from ids where label='session_a'),'c2480000-0000-4000-8000-0000000000b1','6B','flash',1,'blue',null,'a2480000-0000-4000-8000-000000000001')),(select id from ids where label='flash'),'Lost-response create replay returns the same row');
select is((select count(*) from public.boulder_ascents where user_id='f2480000-0000-4000-8000-000000000001'),2::bigint,'Replay creates no duplicate');
select throws_ok($$select * from public.boulder_ascent_create((select id from ids where label='session_a'),'c2480000-0000-4000-8000-0000000000b1','6C','flash',1,null,null,null)$$,'PT409','boulder_conflict','Changed create payload conflicts');

-- Edits
select is((select revision from public.boulder_ascent_update((select id from ids where label='project'),'d2480000-0000-4000-8000-0000000000c1',1,'7A','sent',5,null,'Heel hook',null)),2,'Edit bumps revision');
select is((select revision from public.boulder_ascent_update((select id from ids where label='project'),'d2480000-0000-4000-8000-0000000000c1',1,'7A','sent',5,null,'Heel hook',null)),2,'Edit replay returns the accepted row');
select throws_ok($$select * from public.boulder_ascent_update((select id from ids where label='project'),'d2480000-0000-4000-8000-0000000000c2',1,'7A','sent',6,null,null,null)$$,'PT409','boulder_conflict','Stale revision conflicts');

-- Second user isolation
set local request.jwt.claim.sub='f2480000-0000-4000-8000-000000000002';
select is((select count(*) from public.boulder_ascents),0::bigint,'Other user reads no ascents');
select is((select count(*) from public.boulder_operation_receipts),0::bigint,'Other user reads no receipts');
select is((select count(*) from public.workouts where details->>'activityType'='bouldering'),0::bigint,'Other user reads no sessions');
select throws_ok($$select * from public.boulder_ascent_create((select id from ids where label='session_a'),'c2480000-0000-4000-8000-0000000000e1','6A','sent',null,null,null,null)$$,'P0002','boulder_not_found','Other user cannot add to the session');
select throws_ok($$select * from public.boulder_ascent_update((select id from ids where label='flash'),'d2480000-0000-4000-8000-0000000000e2',1,'6A','sent',null,null,null,null)$$,'P0002','boulder_not_found','Other user cannot edit');
select throws_ok($$select * from public.boulder_session_finish((select id from ids where label='session_a'),'d2480000-0000-4000-8000-0000000000e3',null)$$,'P0002','boulder_not_found','Other user cannot finish');
select is((select count(*) from public.boulder_ascent_remove((select id from ids where label='flash'))),0::bigint,'Other user removes nothing');
select is((select count(*) from public.boulder_session_remove((select id from ids where label='session_a'))),0::bigint,'Other user session remove is a no-op');
-- An independent active session for user B is allowed.
insert into ids select 'session_b',id from public.boulder_session_start('b2480000-0000-4000-8000-0000000000b9','UTC',null);
select ok((select id from ids where label='session_b') is not null,'Second user can start their own session');

-- Strength-only paths are blocked for bouldering sessions
set local request.jwt.claim.sub='f2480000-0000-4000-8000-000000000001';
insert into public.exercises(id,user_id,name) values ('e2480000-0000-4000-8000-000000000001','f2480000-0000-4000-8000-000000000001','Pull-up');
select throws_ok($$insert into public.workout_sets(user_id,workout_id,exercise_id,sequence,repetitions) values('f2480000-0000-4000-8000-000000000001',(select id from ids where label='session_a'),'e2480000-0000-4000-8000-000000000001',1,5)$$,'22023','boulder_invalid','Strength sets cannot attach to a bouldering session');

-- A strength row cannot be turned into a bouldering session directly
with w as (insert into public.workouts(user_id,name,started_at,details) values('f2480000-0000-4000-8000-000000000001','Push',now(),'{"workoutLifecycle":{"kind":"session"}}') returning id) insert into ids select 'strength',id from w;
select throws_ok($$update public.workouts set details='{"activityType":"bouldering","workoutLifecycle":{"kind":"session"},"boulderSession":{"version":1,"gradeScale":"font","recordingTimezone":"UTC","activityDate":"2026-10-16","gymName":null}}' where id=(select id from ids where label='strength')$$,'42501','boulder_requires_rpc','Strength row cannot become a bouldering session');
select throws_ok($$update public.workouts set details=details||'{"boulderSession":{}}' where id=(select id from ids where label='strength')$$,'42501','boulder_requires_rpc','A boulderSession key alone is tagged');
-- Community surfaces refuse bouldering sources through the child guard
reset role;
select throws_ok($$insert into public.shared_activities(user_id,source_workout_id) values('f2480000-0000-4000-8000-000000000001',(select id from ids where label='session_a'))$$,'22023','boulder_invalid','Workout card cannot reference a bouldering session');
select throws_ok($$insert into public.community_routine_shares(user_id,source_workout_id) values('f2480000-0000-4000-8000-000000000001',(select id from ids where label='session_a'))$$,'22023','boulder_invalid','Routine share cannot reference a bouldering session');
select throws_ok($$insert into public.community_challenge_contributions(user_id,source_workout_id) values('f2480000-0000-4000-8000-000000000001',(select id from ids where label='session_a'))$$,'22023','boulder_invalid','Challenge day cannot reference a bouldering session');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='f2480000-0000-4000-8000-000000000001';
select ok(not has_table_privilege('authenticated','public.boulder_operation_receipts','UPDATE'),'No direct receipt update');
select ok(not has_table_privilege('authenticated','public.boulder_operation_receipts','DELETE'),'No direct receipt delete');
select throws_ok($$select * from public.boulder_ascent_update((select id from ids where label='project'),'d2480000-0000-4000-8000-0000000000c9',2,'7A','sent',5,null,'Heel hook','a2480000-0000-4000-8000-000000000002')$$,'22023','boulder_invalid','Edit cannot link another user''s photo');
select throws_ok($$select * from public.boulder_ascent_update((select id from ids where label='project'),'d2480000-0000-4000-8000-0000000000ca',2,'7A','sent',5,null,'Heel hook','a2480000-0000-4000-8000-000000000003')$$,'22023','boulder_invalid','Edit cannot link a non-workout photo');

-- Removal and resurrection
select is((select count(*) from public.boulder_ascent_remove((select id from ids where label='flash'))),1::bigint,'Owner removes an ascent');
select is((select count(*) from public.boulder_ascent_remove((select id from ids where label='flash'))),0::bigint,'Remove replay is a no-op');
select throws_ok($$select * from public.boulder_ascent_create((select id from ids where label='session_a'),'c2480000-0000-4000-8000-0000000000b1','6B','flash',1,'blue',null,'a2480000-0000-4000-8000-000000000001')$$,'P0003','boulder_removed','Delayed create replay cannot resurrect');
select is((select revision from public.boulder_ascent_update((select id from ids where label='project'),'d2480000-0000-4000-8000-0000000000c1',1,'7A','sent',5,null,'Heel hook',null)),2,'Edit replay is unaffected by another deletion');

-- Finish
select ok((select completed_at is not null from public.boulder_session_finish((select id from ids where label='session_a'),'d2480000-0000-4000-8000-0000000000f1','Good session')),'Finish completes the session');
select ok((select completed_at is not null from public.boulder_session_finish((select id from ids where label='session_a'),'d2480000-0000-4000-8000-0000000000f1','Good session')),'Finish replay succeeds');
select throws_ok($$select * from public.boulder_session_finish((select id from ids where label='session_a'),'d2480000-0000-4000-8000-0000000000f2',null)$$,'PT409','boulder_conflict','Second finish conflicts');
insert into ids select 'ascent_after',id from public.boulder_ascent_create((select id from ids where label='session_a'),'c2480000-0000-4000-8000-0000000000b3','5+','sent',2,null,null,null);
select ok((select id from ids where label='ascent_after') is not null,'A forgotten boulder can be added after finishing');
insert into ids select 'session_a2',id from public.boulder_session_start('b2480000-0000-4000-8000-0000000000a3','Europe/Bratislava',null);
select ok((select id from ids where label='session_a2') is not null,'A new session can start after finishing');

-- Session removal cascades and tombstones
select is((select count(*) from public.boulder_session_remove((select id from ids where label='session_a'))),0::bigint,'Session removal returns no rows');
select is((select count(*) from public.boulder_ascents where workout_id=(select id from ids where label='session_a')),0::bigint,'Session removal cascades ascents');
select throws_ok($$select * from public.boulder_ascent_create((select id from ids where label='session_a'),'c2480000-0000-4000-8000-0000000000b2','7A','not_yet',null,null,'Heel hook',null)$$,'P0003','boulder_removed','Ascent replay after session removal is removed');
select throws_ok($$select * from public.boulder_session_start('b2480000-0000-4000-8000-0000000000a1','Europe/Bratislava','Boulder Bar')$$,'P0003','boulder_removed','Session start replay cannot resurrect a removed session');
select throws_ok($$select * from public.boulder_ascent_create((select id from ids where label='session_a'),'c2480000-0000-4000-8000-0000000000b8','6A','sent',null,null,null,null)$$,'P0003','boulder_removed','New boulder on a removed session reports removed');
select throws_ok($$select * from public.boulder_session_finish((select id from ids where label='session_a'),'d2480000-0000-4000-8000-0000000000f8',null)$$,'P0003','boulder_removed','Finishing a removed session reports removed');

-- Account deletion admission
reset role;
insert into public.account_deletion_jobs(user_id,challenge_hash,status,expires_at) values('f2480000-0000-4000-8000-000000000002',repeat('a',64),'in_progress',now()+interval '1 hour');
set local role authenticated;
set local request.jwt.claim.sub='f2480000-0000-4000-8000-000000000002';
select throws_ok($$select * from public.boulder_session_start('b2480000-0000-4000-8000-0000000000e9','UTC',null)$$,'22023','boulder_invalid','Deletion in progress blocks writes');

-- Erasure cascades
reset role;
delete from auth.users where id='f2480000-0000-4000-8000-000000000001';
select is((select count(*) from public.boulder_ascents where user_id='f2480000-0000-4000-8000-000000000001'),0::bigint,'Erasure removes ascents');
select is((select count(*) from public.boulder_operation_receipts where user_id='f2480000-0000-4000-8000-000000000001'),0::bigint,'Erasure removes receipts');
select is((select count(*) from public.workouts where user_id='f2480000-0000-4000-8000-000000000001'),0::bigint,'Erasure removes sessions');

select * from finish();
rollback;
