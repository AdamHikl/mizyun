begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values ('f2540000-0000-4000-8000-000000000001','history-a@mizyun.test'),('f2540000-0000-4000-8000-000000000002','history-b@mizyun.test'),('f2540000-0000-4000-8000-000000000003','history-c@mizyun.test');
create temporary table ids(label text,id uuid);
create temporary table chunk(value jsonb);
grant all on ids,chunk to authenticated;

-- Grants and RLS
select ok(not has_function_privilege('anon','public.history_import_write(uuid,integer,text,boolean,jsonb,jsonb)','EXECUTE'),'Anon cannot write imports');
select ok(not has_function_privilege('service_role','public.history_import_begin(uuid,text,text,text)','EXECUTE'),'Service role has no begin grant');
select ok(has_function_privilege('authenticated','public.history_import_delete(uuid)','EXECUTE'),'Authenticated can delete a batch through the RPC');
select ok(not has_function_privilege('authenticated','public.history_import_admit()','EXECUTE'),'Admission helper is private');
select ok(not has_table_privilege('authenticated','public.history_import_batches','INSERT'),'Batches cannot be inserted directly');
select ok(not has_table_privilege('authenticated','public.history_import_batches','UPDATE'),'Batches cannot be updated directly');
select ok((select relrowsecurity from pg_catalog.pg_class where oid='public.history_import_batches'::regclass),'Batches have RLS');
select ok(exists(select 1 from pg_catalog.pg_indexes where tablename='history_import_batches' and indexdef like '%(user_id%'),'Batches have a user_id index');
select is((select count(*) from pg_catalog.pg_proc where proname='run_list' and pronamespace='public'::regnamespace),1::bigint,'Run list has one overload');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='f2540000-0000-4000-8000-000000000001';

-- Direct table writes cannot claim import provenance
select throws_ok($$insert into public.workouts(user_id,name,started_at,completed_at,source,details) values(auth.uid(),'Bypass',now(),now(),'file_import','{}')$$,'42501','history_import_requires_rpc','Direct insert cannot claim file-import source');
with x as (insert into public.workouts(user_id,name,started_at,completed_at,details) values(auth.uid(),'Logged here','2026-09-01T08:00:00Z','2026-09-01T09:00:00Z','{"workoutLifecycle":{"kind":"session"}}') returning id) insert into ids select 'manual',id from x;

-- Begin, validation and replay
select throws_ok($$select * from public.history_import_begin('a2540000-0000-4000-8000-000000000001','fitbod',null,repeat('a',64))$$,'22023','history_import_invalid','Unknown format is rejected');
select throws_ok($$select * from public.history_import_begin('a2540000-0000-4000-8000-000000000001','hevy',null,'abc')$$,'22023','history_import_invalid','Malformed digest is rejected');
select is((select status from public.history_import_begin('a2540000-0000-4000-8000-000000000001','hevy','hevy.csv',repeat('a',64))),'importing','Begin creates an importing batch');
select is((select count(*) from public.history_import_begin('a2540000-0000-4000-8000-000000000001','hevy','hevy.csv',repeat('a',64))),1::bigint,'Same request replays');
select throws_ok($$select * from public.history_import_begin('a2540000-0000-4000-8000-000000000001','hevy','hevy.csv',repeat('b',64))$$,'PT409','history_import_conflict','Changed request with the same batch id conflicts');
select throws_ok($$update public.workouts set import_key='hevy:x' where id=(select id from ids where label='manual')$$,'22023','history_import_invalid','Provenance cannot be added later');

-- Exercises
insert into ids select 'bench',exercise_id from public.history_import_exercises('a2540000-0000-4000-8000-000000000001','[{"key":"Bench Press (Barbell)","kind":"catalog","catalogId":"barbell-bench-press","name":"Barbell Bench Press","trackingMode":"load_reps"}]');
insert into ids select 'plank',exercise_id from public.history_import_exercises('a2540000-0000-4000-8000-000000000001','[{"key":"Wall Angels","kind":"custom","name":"Wall Angels","trackingMode":"duration"}]');
select is((select metadata->>'catalogId' from public.exercises where id=(select id from ids where label='bench')),'barbell-bench-press','Catalog target creates a catalog record');
select is((select metadata->>'custom' from public.exercises where id=(select id from ids where label='plank')),'true','Custom target creates a custom record');
select is((select exercise_id from public.history_import_exercises('a2540000-0000-4000-8000-000000000001','[{"key":"x","kind":"catalog","catalogId":"barbell-bench-press","name":"Barbell Bench Press","trackingMode":"load_reps"}]')),(select id from ids where label='bench'),'Catalog target reuses the saved record');
select is((select exercise_id from public.history_import_exercises('a2540000-0000-4000-8000-000000000001','[{"key":"x","kind":"custom","name":"wall angels","trackingMode":"duration"}]')),(select id from ids where label='plank'),'Custom target reuses a same-name record');
select is((select cardinality(created_exercise_ids) from public.history_import_batches where id='a2540000-0000-4000-8000-000000000001'),2,'Batch remembers the exercises it created');
select throws_ok($$select * from public.history_import_exercises('a2540000-0000-4000-8000-000000000001','[{"key":"x","kind":"custom","catalogId":"y","name":"Z","trackingMode":"duration"}]')$$,'22023','history_import_invalid','Custom target cannot carry a catalog id');

-- Write chunks
insert into chunk select jsonb_build_array(
 jsonb_build_object('key','hevy:2026-10-20T07:30:00.000Z','name','Push Day','startedAt','2026-10-20T07:30:00Z','completedAt','2026-10-20T08:25:00Z','notes',null,'sets',jsonb_build_array(
  jsonb_build_object('exerciseId',(select id from ids where label='bench'),'setType','warmup','repetitions',10,'loadKg',40,'durationSeconds',null,'distanceMeters',null,'perceivedExertion',null),
  jsonb_build_object('exerciseId',(select id from ids where label='bench'),'setType','normal','repetitions',5,'loadKg',82.5,'durationSeconds',null,'distanceMeters',null,'perceivedExertion',8),
  jsonb_build_object('exerciseId',(select id from ids where label='plank'),'setType','normal','repetitions',null,'loadKg',null,'durationSeconds',60,'distanceMeters',null,'perceivedExertion',null))),
 jsonb_build_object('key','hevy:2026-09-01T08:30:00.000Z','name','Overlaps','startedAt','2026-09-01T08:30:00Z','completedAt','2026-09-01T09:30:00Z','notes','x','sets',jsonb_build_array(
  jsonb_build_object('exerciseId',(select id from ids where label='bench'),'setType','normal','repetitions',5,'loadKg',80,'durationSeconds',null,'distanceMeters',null,'perceivedExertion',null))));
select throws_ok($$select * from public.history_import_write('a2540000-0000-4000-8000-000000000001',1,'Europe/Bratislava',true,(select value from chunk),'[]')$$,'PT409','history_import_conflict','Chunks must arrive in order');
select throws_ok($$select * from public.history_import_write('a2540000-0000-4000-8000-000000000001',0,'Europe/Bratislava',true,jsonb_build_array((select value->0 from chunk) || '{"key":"strong:x"}'::jsonb),'[]')$$,'22023','history_import_invalid','Key must use the batch format');
select throws_ok($$select * from public.history_import_write('a2540000-0000-4000-8000-000000000001',0,'Europe/Bratislava',true,jsonb_build_array(jsonb_set((select value->0 from chunk),'{sets,0,loadKg}','-1')),'[]')$$,'22023','history_import_invalid','Negative load is rejected');
select throws_ok($$select * from public.history_import_write('a2540000-0000-4000-8000-000000000001',0,'Europe/Bratislava',true,jsonb_build_array(jsonb_set((select value->0 from chunk),'{sets,0,repetitions}','10.001')),'[]')$$,'22023','history_import_invalid','Over-precise reps are rejected');
select throws_ok($$select * from public.history_import_write('a2540000-0000-4000-8000-000000000001',0,'Europe/Bratislava',true,jsonb_build_array((select value->0 from chunk) || jsonb_build_object('completedAt',to_char(now()+interval '1 day','YYYY-MM-DD"T"HH24:MI:SS"Z"'))),'[]')$$,'22023','history_import_invalid','Future workouts are rejected');
select throws_ok($$select * from public.history_import_write('a2540000-0000-4000-8000-000000000001',0,'Europe/Bratislava',true,'[]',jsonb_build_array(jsonb_build_object('externalId','1','name','Run','startedAt','2026-10-01T06:00:00Z','durationSeconds',1800,'distanceMeters',5000,'environment','outdoor')))$$,'22023','history_import_invalid','Runs only come from Strava batches');
select throws_ok($$select * from public.history_import_write('a2540000-0000-4000-8000-000000000001',0,'Europe/Bratislava',true,jsonb_build_array((select value->0 from chunk) - 'sets'),'[]')$$,'22023','history_import_invalid','A workout without sets is rejected');
select throws_ok($$select * from public.history_import_write('a2540000-0000-4000-8000-000000000001',0,'Europe/Bratislava',true,jsonb_build_array((select value->0 from chunk) - 'name'),'[]')$$,'22023','history_import_invalid','A workout without a name is rejected');
select throws_ok($$select * from public.history_import_write('a2540000-0000-4000-8000-000000000001',0,'Europe/Bratislava',true,jsonb_build_array((select value->0 from chunk) || '{"startedAt":"-infinity"}'::jsonb),'[]')$$,'22023','history_import_invalid','Special timestamps are rejected');
select throws_ok($$select * from public.history_import_write('a2540000-0000-4000-8000-000000000001',0,'Europe/Bratislava',true,jsonb_build_array((select value->0 from chunk) || '{"startedAt":"1900-01-01T00:00:00Z"}'::jsonb),'[]')$$,'22023','history_import_invalid','Implausible spans are rejected');
select throws_ok($$select * from public.history_import_write('a2540000-0000-4000-8000-000000000001',0,'Europe/Bratislava',true,jsonb_build_array(jsonb_set((select value->0 from chunk),'{sets,0}',(select value->0->'sets'->0 from chunk) - 'setType')),'[]')$$,'22023','history_import_invalid','A set without a type is rejected');
select throws_ok($$select * from public.history_import_exercises('a2540000-0000-4000-8000-000000000001','[{"key":"x","kind":"custom","name":"Z"}]')$$,'22023','history_import_invalid','An exercise spec without a tracking mode is rejected');
select is((select row(workouts,sets,runs,duplicates,overlapping)::text from public.history_import_write('a2540000-0000-4000-8000-000000000001',0,'Europe/Bratislava',true,(select value from chunk),'[]')),'(1,3,0,0,1)','Chunk writes one workout and skips the overlap');
select is((select row(workouts,sets,runs,duplicates,overlapping)::text from public.history_import_write('a2540000-0000-4000-8000-000000000001',0,'Europe/Bratislava',true,(select value from chunk),'[]')),'(0,0,0,0,0)','Replayed chunk is a no-op');
insert into ids select 'push',id from public.workouts where import_key='hevy:2026-10-20T07:30:00.000Z';
select is((select source from public.workouts where id=(select id from ids where label='push')),'file_import','Imported workout keeps file-import provenance');
select is((select details->>'entryMode' from public.workouts where id=(select id from ids where label='push')),'history_import','Imported workout is marked in details');
select is((select string_agg(set_type||':'||sequence,',' order by sequence) from public.workout_sets where workout_id=(select id from ids where label='push')),'warmup:1,normal:2,normal:3','Sets keep types and order');
select is((select load_kg from public.workout_sets where workout_id=(select id from ids where label='push') and sequence=2),82.5::numeric,'Load is stored in kilograms');
select is((select duration_seconds from public.workout_sets where workout_id=(select id from ids where label='push') and sequence=3),60,'Timed set keeps its duration');
select lives_ok($$update public.workouts set name='Renamed',source='file_import' where id=(select id from ids where label='push')$$,'Imported workout name stays editable');
select throws_ok($$update public.workouts set source='manual' where id=(select id from ids where label='push')$$,'22023','history_import_invalid','Provenance cannot be dropped');
select is((select status from public.history_import_finish('a2540000-0000-4000-8000-000000000001',1)),'complete','Finish closes the batch');
select is((select row(workout_count,set_count,run_count,duplicate_count,overlap_count)::text from public.history_import_batches where id='a2540000-0000-4000-8000-000000000001'),'(1,3,0,0,1)','Batch counts come from stored rows');
select throws_ok($$select * from public.history_import_write('a2540000-0000-4000-8000-000000000001',1,'Europe/Bratislava',true,'[]','[]')$$,'PT409','history_import_conflict','A complete batch takes no more chunks');
select is((select row(workouts,sets,runs,duplicates,overlapping)::text from public.history_import_write('a2540000-0000-4000-8000-000000000001',0,'Europe/Bratislava',true,(select value from chunk),'[]')),'(0,0,0,0,0)','A late replay of a finished batch is a no-op');
select is((select count(*) from public.history_import_exercises('a2540000-0000-4000-8000-000000000001','[{"key":"x","kind":"custom","name":"Wall Angels","trackingMode":"duration"}]')),1::bigint,'A late replay can still resolve exercises');

-- A second batch with the same records is deduplicated
select is((select count(*) from public.history_import_begin('a2540000-0000-4000-8000-000000000002','hevy',null,repeat('c',64))),1::bigint,'Second batch begins');
select is((select row(workouts,sets,runs,duplicates,overlapping)::text from public.history_import_write('a2540000-0000-4000-8000-000000000002',0,'Europe/Bratislava',false,(select value from chunk),'[]')),'(1,1,0,1,0)','Existing import key is a duplicate; overlap kept when asked');

-- Strava runs
select is((select count(*) from public.history_import_begin('a2540000-0000-4000-8000-000000000003','strava','activities.csv',repeat('d',64))),1::bigint,'Strava batch begins');
select throws_ok($$select * from public.history_import_write('a2540000-0000-4000-8000-000000000003',0,'Europe/Bratislava',true,'[]',jsonb_build_array(jsonb_build_object('externalId','1001','name','Run','startedAt','2026-10-01T06:00:00Z','durationSeconds',0,'distanceMeters',5000,'environment','outdoor')))$$,'22023','run_invalid','Run validation still applies');
select is((select row(workouts,sets,runs,duplicates,overlapping)::text from public.history_import_write('a2540000-0000-4000-8000-000000000003',0,'Europe/Bratislava',true,'[]',jsonb_build_array(
 jsonb_build_object('externalId','1001','name','Morning Run','startedAt','2026-10-01T22:30:00.400Z','durationSeconds',1800,'distanceMeters',5012.37,'environment','outdoor'),
 jsonb_build_object('externalId','1001','name','Again','startedAt','2026-10-01T22:30:00Z','durationSeconds',1800,'distanceMeters',5012.37,'environment','outdoor')))),'(0,0,1,1,0)','Strava run imported once per Activity ID');
insert into ids select 'run',id from public.workouts where import_key='strava:1001';
select is((select details->'runSummary'->>'activityDate' from public.workouts where id=(select id from ids where label='run')),'2026-10-02','Activity date uses the local start date');
select is((select details->'runSummary'->'origin' from public.workouts where id=(select id from ids where label='run')),'{"kind":"file_import","format":"strava","externalId":"1001"}'::jsonb,'Run keeps file-import origin');
select is((select started_at from public.workouts where id=(select id from ids where label='run')),'2026-10-01T22:30:00Z'::timestamptz,'Start is stored to the second');
select is((select count(*) from public.run_list(null,null,null,50,true)),0::bigint,'Health-import list excludes file imports');
select is((select count(*) from public.run_list(null,null,null,50,true,true)),1::bigint,'File-import list includes them');
select throws_ok($$select * from public.run_update((select id from ids where label='run'),'b2540000-0000-4000-8000-000000000001',1,'Run',null,(select jsonb_set(details->'runSummary' || '{"revision":2}'::jsonb,'{durationSeconds}','1700') from public.workouts where id=(select id from ids where label='run')))$$,'22023','run_invalid','Imported run metrics are read-only');
select is((select details->'runSummary'->>'environment' from public.run_update((select id from ids where label='run'),'b2540000-0000-4000-8000-000000000002',1,'Easy run','felt good',(select details->'runSummary' || '{"revision":2,"environment":"treadmill","perceivedExertion":4}'::jsonb from public.workouts where id=(select id from ids where label='run')))),'treadmill','Imported run environment stays editable');
select is((select source from public.workouts where id=(select id from ids where label='run')),'file_import','Run edit keeps provenance');
select throws_ok($$select * from public.run_create('b2540000-0000-4000-8000-000000000003','Run',null,(select details->'runSummary' || '{"revision":1}'::jsonb from public.workouts where id=(select id from ids where label='run')))$$,'22023','run_invalid','Manual create cannot claim a file-import origin');
-- A morning Strava run on the same local day as a date-only manual run (stored at local noon).
with m as (select public.run_create('b2540000-0000-4000-8000-000000000010','Logged run',null,'{"version":1,"activityDate":"2026-10-05","recordingTimezone":"Europe/Bratislava","timePrecision":"day","startedAt":null,"durationSeconds":1800,"durationBasis":"elapsed","distanceMeters":null,"environment":"unspecified","perceivedExertion":null,"origin":{"kind":"manual"},"timestampEnvelope":"date_anchor","revision":1}'::jsonb)) select count(*) from m;
select is((select row(workouts,sets,runs,duplicates,overlapping)::text from public.history_import_write('a2540000-0000-4000-8000-000000000003',1,'Europe/Bratislava',true,'[]',jsonb_build_array(jsonb_build_object('externalId','1009','name','Early','startedAt','2026-10-05T05:00:00Z','durationSeconds',1800,'distanceMeters',5000,'environment','outdoor')))),'(0,0,0,0,1)','Morning run on the day of a date-only run is an overlap');
select is((select overlapping from public.history_import_check('strava',jsonb_build_array(jsonb_build_object('key','strava:1009','kind','run','startedAt','2026-10-05T05:00:00Z','completedAt','2026-10-05T05:30:00Z','activityDate','2026-10-05')))),1,'Preview flags the same-day date-only run');
select is((select row(existing,overlapping)::text from public.history_import_check('strava',jsonb_build_array(
 jsonb_build_object('key','strava:1001','kind','run','startedAt','2026-10-01T22:30:00Z','completedAt','2026-10-01T23:00:00Z','activityDate','2026-10-02'),
 jsonb_build_object('key','strava:1002','kind','run','startedAt','2026-10-01T22:40:00Z','completedAt','2026-10-01T23:10:00Z','activityDate','2026-10-02'),
 jsonb_build_object('key','strava:1003','kind','run','startedAt','2026-10-03T22:40:00Z','completedAt','2026-10-03T23:10:00Z','activityDate','2026-10-04')))),'(1,1)','Preview counts existing and overlapping records');

-- Owner isolation
set local request.jwt.claim.sub='f2540000-0000-4000-8000-000000000002';
select is((select count(*) from public.history_import_batches),0::bigint,'Other account sees no batches');
select throws_ok($$select * from public.history_import_delete('a2540000-0000-4000-8000-000000000001')$$,'P0002','history_import_not_found','Other account cannot delete a batch');
select throws_ok($$select * from public.history_import_write('a2540000-0000-4000-8000-000000000002',1,'Europe/Bratislava',true,'[]','[]')$$,'P0002','history_import_not_found','Other account cannot write into a batch');
select throws_ok($$select * from public.history_import_begin('a2540000-0000-4000-8000-000000000001','hevy','hevy.csv',repeat('a',64))$$,'PT409','history_import_conflict','Batch ids cannot be claimed by another account');
select is((select row(existing,overlapping)::text from public.history_import_check('hevy',jsonb_build_array(jsonb_build_object('key','hevy:2026-10-20T07:30:00.000Z','kind','workout','startedAt','2026-10-20T07:30:00Z','completedAt','2026-10-20T08:25:00Z')))),'(0,0)','Preview does not see another account');
select is((select count(*) from public.history_import_begin('a2540000-0000-4000-8000-000000000004','hevy',null,repeat('a',64))),1::bigint,'Second account begins its own batch');
select throws_ok($$select * from public.history_import_write('a2540000-0000-4000-8000-000000000004',0,'Europe/Bratislava',true,(select value from chunk),'[]')$$,'23503',null,'Sets cannot reference another account''s exercise');
select is((select row(workouts,sets,runs,duplicates,overlapping)::text from public.history_import_write('a2540000-0000-4000-8000-000000000004',0,'Europe/Bratislava',true,'[]','[]')),'(0,0,0,0,0)','Same import keys are free in another account');

-- Undo a batch
set local request.jwt.claim.sub='f2540000-0000-4000-8000-000000000001';
select is((select row(workouts,runs,exercises,remaining)::text from public.history_import_delete('a2540000-0000-4000-8000-000000000002')),'(1,0,0,0)','A batch that created no exercises removes only its workouts');
select is((select row(workouts,runs,exercises,remaining)::text from public.history_import_delete('a2540000-0000-4000-8000-000000000001')),'(1,0,2,0)','Deleting the first batch removes its workouts and unused exercises');
select is((select count(*) from public.workouts where import_batch_id in ('a2540000-0000-4000-8000-000000000001','a2540000-0000-4000-8000-000000000002')),0::bigint,'Batch workouts are gone');
select is((select count(*) from public.workout_sets where workout_id=(select id from ids where label='push')),0::bigint,'Batch sets cascade');
select is((select count(*) from public.workouts where id=(select id from ids where label='manual')),1::bigint,'Manual workouts are untouched');
select is((select count(*) from public.history_import_batches),1::bigint,'Only the Strava batch remains');
select throws_ok($$select * from public.history_import_delete('a2540000-0000-4000-8000-000000000001')$$,'P0002','history_import_not_found','A deleted batch cannot be deleted again');
select is((select count(*) from public.history_import_begin('a2540000-0000-4000-8000-000000000006','generic',null,repeat('e',64))),1::bigint,'Large batch begins');
insert into ids select 'angels',exercise_id from public.history_import_exercises('a2540000-0000-4000-8000-000000000006','[{"key":"x","kind":"custom","name":"Wall Slides","trackingMode":"load_reps"}]');
select is((select workouts from public.history_import_write('a2540000-0000-4000-8000-000000000006',0,'UTC',false,(select jsonb_agg(jsonb_build_object('key','generic:'||g,'name','W','startedAt',to_char((timestamptz '2025-01-01T00:00:00Z'+g*interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'completedAt',to_char((timestamptz '2025-01-01T01:00:00Z'+g*interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'notes',null,'sets',jsonb_build_array(jsonb_build_object('exerciseId',(select id from ids where label='angels'),'setType','normal','repetitions',5,'loadKg',null,'durationSeconds',null,'distanceMeters',null,'perceivedExertion',null)))) from generate_series(1,150) g),'[]')),150,'Large chunk writes 150 workouts');
select is((select row(workouts,remaining,exercises)::text from public.history_import_delete('a2540000-0000-4000-8000-000000000006')),'(100,50,0)','Undo removes at most 100 records per call');
select is((select count(*) from public.history_import_batches where id='a2540000-0000-4000-8000-000000000006'),1::bigint,'Batch stays until the last slice');
select is((select row(workouts,remaining,exercises)::text from public.history_import_delete('a2540000-0000-4000-8000-000000000006')),'(50,0,1)','The last slice removes the rest, the created exercise and the batch');
select is((select count(*) from public.history_import_batches where id='a2540000-0000-4000-8000-000000000006'),0::bigint,'Batch is gone after the last slice');

-- Account deletion admission and erasure
reset role;
insert into public.account_deletion_jobs(user_id,status,challenge_hash,expires_at) values('f2540000-0000-4000-8000-000000000003','in_progress','history-import-synthetic',now()+interval '1 hour');
set local role authenticated;
set local request.jwt.claim.sub='f2540000-0000-4000-8000-000000000003';
select throws_ok($$select * from public.history_import_begin('a2540000-0000-4000-8000-000000000005','hevy',null,repeat('a',64))$$,'22023','history_import_invalid','Account deletion blocks imports');
reset role;
delete from auth.users where id='f2540000-0000-4000-8000-000000000001';
select is((select count(*) from public.history_import_batches where user_id='f2540000-0000-4000-8000-000000000001'),0::bigint,'Account erasure removes batches');
select is((select count(*) from public.workouts where user_id='f2540000-0000-4000-8000-000000000001'),0::bigint,'Account erasure removes imported records');
select * from finish();
rollback;
