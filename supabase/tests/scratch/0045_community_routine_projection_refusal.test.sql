-- Disposable synthetic proof only; all fixtures and controls roll back.
-- Private catalog/custom IDs are deliberately omitted, not resolved across
-- accounts. Invalid public names/targets fail at the authenticated SQL boundary.
begin;
do $$begin
 if current_database() !~ '^mizyun_.*(scratch|verify)' then
  raise exception 'Routine proof requires a disposable Mizyun scratch/verify database';
 end if;
end $$;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(30);
set local request.jwt.claim.role='service_role';
update public.community_operations set enabled=true,enrollment=true,discovery=true,publish=true,engagement=true,cohort_required=false;
update public.community_feature_controls set enabled=true where feature='routines';
insert into auth.users(id,email)
select ('c4500000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'synthetic-routine45-'||i||'@mizyun.test' from generate_series(1,2)i;
update public.profiles set birth_year=1990 where id::text like 'c4500000-%';
insert into public.community_profiles(user_id,handle,display_name,status,terms_version,terms_accepted_at,adult_declared_at)
select id,'routine45_'||right(id::text,12),'Synthetic routine member','active','2026-09-30',now(),now() from auth.users where id::text like 'c4500000-%';
create temporary table routine45_base(details jsonb);
insert into routine45_base values ('{"workoutLifecycle":{"kind":"routine"},"injury":"PRIVATE_HEALTH45","notes":"PRIVATE_HEALTH45","coachPlan":{"health":"PRIVATE_HEALTH45","exercises":[{"name":"Synthetic custom squat","targetSets":3,"targetReps":"8-12","targetLoad":"100 lb","restSeconds":90,"catalogId":"NONEXISTENT_PRIVATE_REFERENCE45","exerciseId":"FOREIGN_PRIVATE_REFERENCE45","notes":"PRIVATE_HEALTH45"}]}}');
create temporary table routine45_cases(ordinal integer primary key,label text,details jsonb,title text,expected text);
insert into routine45_cases
select ordinal,label,jsonb_set(b.details,array['coachPlan','exercises','0',field],replacement), 'Shared synthetic targets',expected
from routine45_base b cross join (values
 (1,'Zero sets refused','targetSets','0'::jsonb,'community_invalid_input'),
 (2,'Over twenty sets refused','targetSets','21'::jsonb,'community_invalid_input'),
 (3,'Reversed repetition range refused','targetReps','"12-8"'::jsonb,'community_invalid_input'),
 (4,'Zero repetition range refused','targetReps','"0-8"'::jsonb,'community_invalid_input'),
 (5,'Over one hundred reps refused','targetReps','"8-101"'::jsonb,'community_invalid_input'),
 (6,'Free-text coaching target refused','targetReps','"8 reps until injured"'::jsonb,'community_invalid_input'),
 (7,'Load without explicit unit refused','targetLoad','"80"'::jsonb,'community_invalid_input'),
 (8,'Negative load refused','targetLoad','"-2 kg"'::jsonb,'community_invalid_input'),
 (9,'Unrecognized load unit refused','targetLoad','"100 ml"'::jsonb,'community_invalid_input'),
 (10,'Over one thousand kilogram target refused','targetLoad','"1001 kg"'::jsonb,'community_invalid_input'),
 (11,'Nonfinite load refused','targetLoad','"Infinity kg"'::jsonb,'community_invalid_input'),
 (12,'Negative rest refused','restSeconds','-1'::jsonb,'community_invalid_input'),
 (13,'Over thirty minutes rest refused','restSeconds','1801'::jsonb,'community_invalid_input'),
 (14,'Contact URL exercise reference refused','name','"https://example.com/private45"'::jsonb,'community_content_violation'),
 (15,'Handle contact exercise reference refused','name','"Ask @private45"'::jsonb,'community_content_violation'),
 (16,'Missing exercise display name refused','name','null'::jsonb,'community_content_violation')
) cases(ordinal,label,field,replacement,expected);
insert into routine45_cases
select 17,'Performed session cannot be projected as a routine',jsonb_set(details,'{workoutLifecycle,kind}','"session"'),'Shared synthetic targets','community_invalid_input' from routine45_base
union all select 18,'Empty exercise list refused',jsonb_set(details,'{coachPlan,exercises}','[]'),'Shared synthetic targets','community_invalid_input' from routine45_base
union all select 19,'Non-array exercise references refused',jsonb_set(details,'{coachPlan,exercises}','{}'),'Shared synthetic targets','community_invalid_input' from routine45_base
union all select 20,'Unsafe public title refused',details,'Starvation challenge','community_content_violation' from routine45_base
union all select 21,'Contact public title refused',details,'Plan https://example.com/private45','community_content_violation' from routine45_base;
insert into public.workouts(id,user_id,name,started_at,notes,details)
select ('d4500000-0000-4000-8000-'||lpad(ordinal::text,12,'0'))::uuid,'c4500000-0000-4000-8000-000000000001','PRIVATE_HEALTH45',now(),'PRIVATE_HEALTH45',details from routine45_cases;
insert into public.workouts(id,user_id,name,started_at,notes,details)
select 'd4500000-0000-4000-8000-000000000099','c4500000-0000-4000-8000-000000000001','PRIVATE_HEALTH45',now(),'PRIVATE_HEALTH45',details from routine45_base;
grant select on routine45_cases to authenticated;
create temporary table routine45_state(key text primary key,value jsonb);
grant all on routine45_state to authenticated;

set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='c4500000-0000-4000-8000-000000000001';
select throws_ok(format('select public.community_routines(''preview'',%L::jsonb)',
 jsonb_build_object('sourceWorkoutId','d4500000-0000-4000-8000-'||lpad(ordinal::text,12,'0'),'title',title)::text),
 'P0001',expected,label) from routine45_cases order by ordinal;
insert into routine45_state values ('preview',public.community_routines('preview','{"sourceWorkoutId":"d4500000-0000-4000-8000-000000000099","title":"Shared synthetic targets"}'));
select is((select value->'snapshot'->'exercises'->0 from routine45_state where key='preview'),
 '{"name":"Synthetic custom squat","sets":3,"repsMin":8,"repsMax":12,"loadKg":45.359,"restSeconds":90}'::jsonb,
 'Safe custom-name control projects exact targets and converts pounds deterministically');
select ok((select value::text not like '%PRIVATE_HEALTH45%' and value::text not like '%PRIVATE_REFERENCE45%' from routine45_state where key='preview'),
 'Unknown private catalog and custom references are omitted together with all hidden health fields');
select is((select count(*) from public.community_routine_export('routineShares',null,500)),0::bigint,'Refused previews and safe preview create no publication');
select is((select count(*) from public.community_routine_export('routineImports',null,500)),0::bigint,'Refused previews cannot create an import receipt');

-- Exact preview must remain the publication boundary even if a raw caller tries
-- to insert unresolved/private reference fields after seeing a valid preview.
select throws_ok($$select public.community_routines('publish',jsonb_build_object('sourceWorkoutId','d4500000-0000-4000-8000-000000000099','operationId','e4500000-0000-4000-8000-000000000001','sourceUpdatedAt',(select value->>'sourceUpdatedAt' from routine45_state where key='preview'),'confirmed',true,'snapshot',jsonb_set((select value->'snapshot' from routine45_state where key='preview'),'{exercises,0,catalogId}','"FOREIGN_PRIVATE_REFERENCE45"')))$$,
 'P0001','community_conflict','A forged public exercise reference cannot widen the safe projection');
select is((select count(*) from public.community_routine_export('routineShares',null,500)),0::bigint,'Refused forged publication leaves no share or reserved operation effect');
insert into routine45_state values ('share',public.community_routines('publish',jsonb_build_object('sourceWorkoutId','d4500000-0000-4000-8000-000000000099','operationId','e4500000-0000-4000-8000-000000000001','sourceUpdatedAt',(select value->>'sourceUpdatedAt' from routine45_state where key='preview'),'confirmed',true,'snapshot',(select value->'snapshot' from routine45_state where key='preview'))));
select is((select value->'snapshot' from routine45_state where key='share'),(select value->'snapshot' from routine45_state where key='preview'),'The same operation remains usable only with the exact safe preview');
set local request.jwt.claim.sub='c4500000-0000-4000-8000-000000000002';
select throws_ok($$select public.community_routines('preview','{"sourceWorkoutId":"d4500000-0000-4000-8000-000000000099","title":"Guess"}')$$,
 'P0001','community_unavailable','Another authenticated principal cannot resolve the guessed private source');
select is((select count(*) from public.community_routine_export('routineShares',null,500)),0::bigint,'Another principal receives no author publication through owner export');
select * from finish();
rollback;
