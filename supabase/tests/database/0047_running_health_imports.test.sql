begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values ('f2470000-0000-4000-8000-000000000001','import-a@mizyun.test'),('f2470000-0000-4000-8000-000000000002','import-b@mizyun.test'),('f2470000-0000-4000-8000-000000000003','import-c@mizyun.test');
create temporary table summary(value jsonb);
insert into summary values ('{"version":1,"activityDate":"2026-10-02","recordingTimezone":"Europe/Bratislava","timePrecision":"instant","startedAt":"2026-10-01T22:30:00Z","durationSeconds":1800,"durationBasis":"active","distanceMeters":5012.37,"environment":"outdoor","perceivedExertion":null,"origin":{"kind":"health_import","provider":"apple_health","sourceAppId":"com.apple.health.watch","sourceAppName":"Apple Watch","externalId":"HK-0001"},"timestampEnvelope":"observed","revision":1}');
create temporary table manual(value jsonb);
insert into manual values ('{"version":1,"activityDate":"2026-10-01","recordingTimezone":"UTC","timePrecision":"day","startedAt":null,"durationSeconds":1500,"durationBasis":"elapsed","distanceMeters":null,"environment":"treadmill","perceivedExertion":null,"origin":{"kind":"manual"},"timestampEnvelope":"date_anchor","revision":1}');
create temporary table run_ids(label text,id uuid);
grant select on summary,manual to authenticated;grant all on run_ids to authenticated;
select ok(not has_function_privilege('anon','public.run_import(uuid,text,jsonb)','EXECUTE'),'Anon has no import grant');
select ok(not has_function_privilege('service_role','public.run_import(uuid,text,jsonb)','EXECUTE'),'Service role has no import grant');
select ok(has_function_privilege('authenticated','public.run_import(uuid,text,jsonb)','EXECUTE'),'Authenticated can import through the RPC');
select ok(not has_function_privilege('anon','public.run_list(text,text,text,integer,boolean,boolean)','EXECUTE'),'Anon has no list grant');
select ok(has_function_privilege('authenticated','public.run_list(text,text,text,integer,boolean,boolean)','EXECUTE'),'Authenticated keeps list grant');
select is((select count(*) from pg_catalog.pg_proc where proname='run_list' and pronamespace='public'::regnamespace),1::bigint,'Old list overload is replaced, not left ambiguous');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='f2470000-0000-4000-8000-000000000001';

-- Validation
select throws_ok($$select * from public.run_import('b2470000-0000-4000-8000-0000000000a1','Run',(select value || '{"origin":{"kind":"health_import","provider":"garmin","sourceAppId":"x","sourceAppName":null,"externalId":"y"}}'::jsonb from summary))$$,'22023','run_invalid','Unknown provider is rejected');
select throws_ok($$select * from public.run_import('b2470000-0000-4000-8000-0000000000a1','Run',(select jsonb_set(value,'{origin,extra}','1') from summary))$$,'22023','run_invalid','Extra origin key is rejected');
select throws_ok($$select * from public.run_import('b2470000-0000-4000-8000-0000000000a1','Run',(select value #- '{origin,sourceAppName}' from summary))$$,'22023','run_invalid','Missing origin key is rejected');
select throws_ok($$select * from public.run_import('b2470000-0000-4000-8000-0000000000a1','Run',(select jsonb_set(value,'{origin,externalId}','""') from summary))$$,'22023','run_invalid','Empty external ID is rejected');
select throws_ok($$select * from public.run_import('b2470000-0000-4000-8000-0000000000a1','Run',(select jsonb_set(value,'{origin,externalId}',to_jsonb(repeat('x',256))) from summary))$$,'22023','run_invalid','Overlong external ID is rejected');
select throws_ok($$select * from public.run_import('b2470000-0000-4000-8000-0000000000a1','Run',(select jsonb_set(value,'{origin,sourceAppId}','" padded"') from summary))$$,'22023','run_invalid','Untrimmed source app ID is rejected');
select throws_ok($$select * from public.run_import('b2470000-0000-4000-8000-0000000000a1','Run',(select jsonb_set(value,'{origin,sourceAppName}',to_jsonb(repeat('x',201))) from summary))$$,'22023','run_invalid','Overlong source app name is rejected');
select throws_ok($$select * from public.run_import('b2470000-0000-4000-8000-0000000000a1','Run',(select jsonb_set(value,'{origin,sourceAppId}','7') from summary))$$,'22023','run_invalid','Non-string source app ID is rejected');
select throws_ok($$select * from public.run_import('b2470000-0000-4000-8000-0000000000a1','Run',(select value || '{"durationBasis":"moving"}'::jsonb from summary))$$,'22023','run_invalid','Unknown duration basis is rejected');
select throws_ok($$select * from public.run_import('b2470000-0000-4000-8000-0000000000a1','Run',(select value || '{"timePrecision":"day","startedAt":null,"timestampEnvelope":"date_anchor"}'::jsonb from summary))$$,'22023','run_invalid','Imported run needs an observed start');
select throws_ok($$select * from public.run_import('b2470000-0000-4000-8000-0000000000a1','Run',(select value || '{"activityDate":"2026-10-01"}'::jsonb from summary))$$,'22023','run_invalid','Activity date must be the local start date');
select throws_ok($$select * from public.run_import('b2470000-0000-4000-8000-0000000000a1','Run',(select value || jsonb_build_object('startedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'activityDate',to_char(now() at time zone 'Europe/Bratislava','YYYY-MM-DD')) from summary))$$,'22023','run_invalid','Run ending in the future is rejected');
select throws_ok($$select * from public.run_import('b2470000-0000-4000-8000-0000000000a1','Run',(select value from manual))$$,'22023','run_invalid','Import cannot store a manual origin');
select throws_ok($$select * from public.run_import('b2470000-0000-4000-8000-0000000000a1','Run',(select value || '{"perceivedExertion":5}'::jsonb from summary))$$,'22023','run_invalid','Import does not invent perceived effort');
select throws_ok($$select * from public.run_create('b2470000-0000-4000-8000-0000000000a2','Run',null,(select value from summary))$$,'22023','run_invalid','Manual create cannot claim an import origin');
select throws_ok($$select * from public.run_create('b2470000-0000-4000-8000-0000000000a2','Run',null,(select value || '{"durationBasis":"active"}'::jsonb from manual))$$,'22023','run_invalid','Manual run keeps elapsed duration');
select throws_ok($$insert into public.workouts(user_id,name,started_at,completed_at,source,details) values(auth.uid(),'Bypass',now(),now(),'health_import','{}')$$,'22023','run_invalid','Non-run workouts cannot claim Health provenance');
select is((select count(*) from public.workouts where user_id=auth.uid()),0::bigint,'Rejected imports store nothing');

-- Create, replay and dedupe
insert into run_ids select 'a',id from public.run_import('b2470000-0000-4000-8000-000000000001','Morning run',(select value from summary));
select is((select source from public.workouts where id=(select id from run_ids where label='a')),'health_import','Imported run keeps Health provenance');
select is((select client_operation_id from public.workouts where id=(select id from run_ids where label='a')),'b2470000-0000-4000-8000-000000000001'::uuid,'Creating operation owns the row');
select is((select started_at from public.workouts where id=(select id from run_ids where label='a')),'2026-10-01T22:30:00Z'::timestamptz,'Envelope uses the observed start');
select is((select completed_at from public.workouts where id=(select id from run_ids where label='a')),'2026-10-01T23:00:00Z'::timestamptz,'Envelope uses the provider duration');
select is((select id from public.run_import('b2470000-0000-4000-8000-000000000001','Morning run',(select value from summary))),(select id from run_ids where label='a'),'Lost-response replay returns the same run');
select throws_ok($$select * from public.run_import('b2470000-0000-4000-8000-000000000001','Other name',(select value from summary))$$,'PT409','run_conflict','Changed replay payload conflicts');
select is((select id from public.run_import('b2470000-0000-4000-8000-000000000002','Another name',(select value || '{"durationSeconds":1700}'::jsonb from summary))),(select id from run_ids where label='a'),'Same provider workout returns the existing run');
select is((select client_operation_id from public.run_import('b2470000-0000-4000-8000-000000000002','Another name',(select value || '{"durationSeconds":1700}'::jsonb from summary))),'b2470000-0000-4000-8000-000000000001'::uuid,'Dedupe replay reports another creating operation');
select is((select details->'runSummary'->>'durationSeconds' from public.workouts where id=(select id from run_ids where label='a')),'1800','Dedupe does not overwrite stored provider facts');
select is((select count(*) from public.workouts where user_id=auth.uid()),1::bigint,'Dedupe stores one row');
select throws_ok($$select * from public.run_create('b2470000-0000-4000-8000-000000000002','Run',null,(select value from manual))$$,'PT409','run_conflict','Import operation cannot be reused for a manual create');
select throws_ok($$select * from public.run_cancel('b2470000-0000-4000-8000-000000000001')$$,'PT409','run_conflict','Import operations are removed by deleting the run');
insert into run_ids select 'b',id from public.run_import('b2470000-0000-4000-8000-000000000003','Run',(select jsonb_set(value,'{origin,provider}','"health_connect"') from summary));
insert into run_ids select 'c',id from public.run_import('b2470000-0000-4000-8000-000000000004','Run',(select jsonb_set(value,'{origin,externalId}','"HK-0002"') from summary));
select is((select count(distinct id) from run_ids),3::bigint,'Different provider or external ID creates distinct runs');
insert into run_ids select 'm',id from public.run_create('b2470000-0000-4000-8000-000000000005','Run',null,(select value from manual));

-- Concurrency-safe unique copy, even if a writer bypasses the advisory lock.
reset role;
select throws_ok($$insert into public.workouts(id,user_id,client_operation_id,name,source,started_at,completed_at,details) select gen_random_uuid(),'f2470000-0000-4000-8000-000000000001',gen_random_uuid(),'Dup','health_import','2026-10-01T22:30:00Z','2026-10-01T23:00:00Z',jsonb_build_object('activityType','running','workoutLifecycle','{"kind":"session"}'::jsonb,'runSummary',value) from summary$$,'23505',null,'Unique index rejects a second stored copy');
select throws_ok($$update public.workouts set source='manual' where id=(select id from run_ids where label='a')$$,'22023','run_invalid','Stored provenance cannot change');
set local role authenticated;

-- Listing
select is((select count(*) from public.run_list(null,null,null,50)),1::bigint,'Default list excludes imported runs');
select is((select id from public.run_list(null,null,null,50)),(select id from run_ids where label='m'),'Default list returns the manual run');
select is((select count(*) from public.run_list(null,null,null,50,true)),4::bigint,'Opt-in list includes imported runs');
select is((select count(*) from public.run_list('2026-10-02','2026-10-02',null,50,true)),3::bigint,'Imports filter by local activity date');
select is((select count(*) from public.run_get((select id from run_ids where label='a'))),1::bigint,'Owner reads an imported run');

-- Read-only provider facts
select lives_ok($$select * from public.run_update((select id from run_ids where label='a'),'b2470000-0000-4000-8000-000000000010',1,'Renamed','Felt good',(select value || '{"revision":2,"environment":"treadmill","perceivedExertion":6.5}'::jsonb from summary))$$,'Name, notes, environment and effort are editable');
select is((select name||'|'||notes||'|'||(details->'runSummary'->>'environment') from public.run_get((select id from run_ids where label='a'))),'Renamed|Felt good|treadmill','Editable fields are saved');
select throws_ok($$select * from public.run_update((select id from run_ids where label='a'),'b2470000-0000-4000-8000-000000000011',2,'Run',null,(select value || '{"revision":3,"durationSeconds":1700}'::jsonb from summary))$$,'22023','run_invalid','Duration is read-only');
select throws_ok($$select * from public.run_update((select id from run_ids where label='a'),'b2470000-0000-4000-8000-000000000011',2,'Run',null,(select value || '{"revision":3,"distanceMeters":null}'::jsonb from summary))$$,'22023','run_invalid','Distance is read-only');
select throws_ok($$select * from public.run_update((select id from run_ids where label='a'),'b2470000-0000-4000-8000-000000000011',2,'Run',null,(select value || '{"revision":3,"durationBasis":"elapsed"}'::jsonb from summary))$$,'22023','run_invalid','Duration basis is read-only');
select throws_ok($$select * from public.run_update((select id from run_ids where label='a'),'b2470000-0000-4000-8000-000000000011',2,'Run',null,(select value || '{"revision":3,"startedAt":"2026-10-01T22:00:00Z"}'::jsonb from summary))$$,'22023','run_invalid','Start is read-only');
select throws_ok($$select * from public.run_update((select id from run_ids where label='a'),'b2470000-0000-4000-8000-000000000011',2,'Run',null,(select value || '{"revision":3,"recordingTimezone":"Europe/Vienna"}'::jsonb from summary))$$,'22023','run_invalid','Recording timezone is read-only');
select throws_ok($$select * from public.run_update((select id from run_ids where label='a'),'b2470000-0000-4000-8000-000000000011',2,'Run',null,(select jsonb_set(value,'{origin,externalId}','"HK-0009"') || '{"revision":3}'::jsonb from summary))$$,'22023','run_invalid','Origin is read-only');
select throws_ok($$select * from public.run_update((select id from run_ids where label='a'),'b2470000-0000-4000-8000-000000000011',2,'Run',null,(select value || '{"revision":3}'::jsonb from manual))$$,'22023','run_invalid','Imported run cannot become manual');
select throws_ok($$select * from public.run_update((select id from run_ids where label='m'),'b2470000-0000-4000-8000-000000000012',1,'Run',null,(select jsonb_set(value,'{revision}','2') from summary))$$,'22023','run_invalid','Manual run cannot become imported');
select throws_ok($$update public.workouts set name='Bypass' where id=(select id from run_ids where label='a')$$,'42501','run_requires_rpc','Direct owned update cannot bypass the RPC');

-- Owner isolation
set local request.jwt.claim.sub='f2470000-0000-4000-8000-000000000002';
select is((select count(*) from public.run_get((select id from run_ids where label='a'))),0::bigint,'Other account cannot read an imported run');
select is((select count(*) from public.run_list(null,null,null,50,true)),0::bigint,'Other account lists no imports');
select throws_ok($$select * from public.run_update((select id from run_ids where label='a'),'b2470000-0000-4000-8000-000000000020',2,'Run',null,(select value || '{"revision":3}'::jsonb from summary))$$,'P0002','run_not_found','Other account cannot edit an imported run');
select isnt((select id from public.run_import('b2470000-0000-4000-8000-000000000021','Run',(select value from summary))),(select id from run_ids where label='a'),'Same provider workout in another account does not collide');
select is((select count(*) from public.run_import('b2470000-0000-4000-8000-000000000001','Morning run',(select value from summary))),1::bigint,'Operation IDs are scoped per account');
select is((select count(*) from public.workouts),1::bigint,'Other account sees only its own copy');
set local request.jwt.claim.sub='f2470000-0000-4000-8000-000000000001';
select is((select count(*) from public.workouts where user_id=auth.uid()),4::bigint,'Owner rows are unaffected by another account');

-- Delete then explicit re-import
select lives_ok($$select * from public.run_remove((select id from run_ids where label='a'))$$,'Imported run can be deleted');
select throws_ok($$select * from public.run_import('b2470000-0000-4000-8000-000000000001','Morning run',(select value from summary))$$,'P0003','run_removed','Late replay cannot resurrect a deleted import');
select throws_ok($$select * from public.run_import('b2470000-0000-4000-8000-000000000002','Another name',(select value || '{"durationSeconds":1700}'::jsonb from summary))$$,'P0003','run_removed','Late dedupe replay cannot resurrect a deleted import');
insert into run_ids select 'a2',id from public.run_import('b2470000-0000-4000-8000-000000000030','Run',(select value from summary));
select isnt((select id from run_ids where label='a2'),(select id from run_ids where label='a'),'A new explicit import creates a fresh copy after deletion');
select is((select client_operation_id from public.workouts where id=(select id from run_ids where label='a2')),'b2470000-0000-4000-8000-000000000030'::uuid,'Re-import is created by its own operation');

-- Account deletion admission still blocks imports
reset role;
insert into public.account_deletion_jobs(user_id,status,challenge_hash,expires_at) values('f2470000-0000-4000-8000-000000000003','in_progress','run-import-synthetic',now()+interval '1 hour');
set local role authenticated;
set local request.jwt.claim.sub='f2470000-0000-4000-8000-000000000003';
select throws_ok($$select * from public.run_import('b2470000-0000-4000-8000-000000000040','Run',(select value from summary))$$,'22023','run_invalid','Account deletion blocks imports');
reset role;
delete from auth.users where id='f2470000-0000-4000-8000-000000000001';
select is((select count(*) from public.workouts where user_id='f2470000-0000-4000-8000-000000000001'),0::bigint,'Account erasure cascades imported runs');
select is((select count(*) from public.run_operation_receipts where user_id='f2470000-0000-4000-8000-000000000001'),0::bigint,'Account erasure cascades import receipts');
select * from finish();
rollback;
