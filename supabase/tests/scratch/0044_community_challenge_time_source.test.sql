-- Disposable synthetic proof only; all fixtures and controls roll back.
-- Literal DST cases exercise the real SQL artifact/DTO boundary. Historical
-- memberships model already-open challenges for the authenticated late-sync RPC.
begin;
do $$begin
 if current_database() !~ '^mizyun_.*(scratch|verify)' then
  raise exception 'Challenge proof requires a disposable Mizyun scratch/verify database';
 end if;
end $$;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(24);
set local request.jwt.claim.role='service_role';
update public.community_operations set enabled=true,enrollment=true,discovery=true,publish=true,engagement=true,cohort_required=false;
update public.community_feature_controls set enabled=true where feature in ('groups','challenges');
insert into auth.users(id,email) values ('c4400000-0000-4000-8000-000000000001','synthetic-challenge44@mizyun.test');
update public.profiles set birth_year=1990 where id='c4400000-0000-4000-8000-000000000001';
insert into public.community_profiles(user_id,handle,display_name,status,terms_version,terms_accepted_at,adult_declared_at)
values ('c4400000-0000-4000-8000-000000000001','challenge44','Synthetic challenge member','active','2026-09-30',now(),now());
insert into public.community_groups(id,user_id,created_by,operation_id,name,rules)
values ('a4400000-0000-4000-8000-000000000001','c4400000-0000-4000-8000-000000000001','c4400000-0000-4000-8000-000000000001','e4400000-0000-4000-8000-000000000001','Synthetic challenge group','Be kind');
insert into public.community_group_members(group_id,user_id,role,state,generation,joined_at)
select 'a4400000-0000-4000-8000-000000000001',user_id,'owner','member',generation,now()-interval '400 days'
from public.community_profiles where user_id='c4400000-0000-4000-8000-000000000001';
create temporary table challenge44_clock as
select tz,(now() at time zone tz)::date as today from
 (select zone as tz from unnest(array['Pacific/Kiritimati','Etc/GMT+12']) zone
  where (now() at time zone zone)::date<>(now() at time zone 'UTC')::date limit 1) chosen;
grant select on challenge44_clock to authenticated;
select is((select count(*) from challenge44_clock),1::bigint,'One real challenge timezone differs from UTC today at any test hour');
insert into public.community_challenges(id,user_id,group_id,title,start_day,end_day,timezone,goal_days,created_at)
select 'b4400000-0000-4000-8000-000000000001','c4400000-0000-4000-8000-000000000001','a4400000-0000-4000-8000-000000000001','Synthetic late-sync goal',today-10,today+1,tz,4,now()-interval '10 days' from challenge44_clock;
insert into public.community_challenge_members(user_id,challenge_id,generation,joined_at)
select user_id,'b4400000-0000-4000-8000-000000000001',generation,now()-interval '10 days'
from public.community_profiles where user_id='c4400000-0000-4000-8000-000000000001';
insert into public.workouts(id,user_id,name,started_at,completed_at,updated_at,details)
select ('d4400000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'c4400000-0000-4000-8000-000000000001','Private synthetic workout',
 ((today-7)::timestamp+interval '11 hours') at time zone tz,
 ((today-7)::timestamp+interval '12 hours') at time zone tz,now()-interval '2 hours','{"workoutLifecycle":{"kind":"session"}}'::jsonb
from challenge44_clock cross join generate_series(1,2) i;
insert into public.workouts(id,user_id,name,started_at,completed_at,updated_at,details)
values ('d4400000-0000-4000-8000-000000000003','c4400000-0000-4000-8000-000000000001','Private current workout',now()-interval '1 hour',now(),now()-interval '2 hours','{"workoutLifecycle":{"kind":"session"}}');

set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='c4400000-0000-4000-8000-000000000001';
select is((select result->'challenge'->>'myProgress' from public.community_challenges_rpc('contribute',jsonb_build_object('id','b4400000-0000-4000-8000-000000000001','day',(select today-7 from challenge44_clock),'kind','workout','sourceWorkoutId','d4400000-0000-4000-8000-000000000001','confirmed',true))),'1','Exactly seven local days late is accepted by the real authenticated RPC');
select is((select result->'challenge'->>'myProgress' from public.community_challenges_rpc('contribute',jsonb_build_object('id','b4400000-0000-4000-8000-000000000001','day',(select today-7 from challenge44_clock),'kind','workout','sourceWorkoutId','d4400000-0000-4000-8000-000000000001','confirmed',true))),'1','Late-sync replay cannot inflate progress');
select is((select result->'challenge'->>'myProgress' from public.community_challenges_rpc('contribute',jsonb_build_object('id','b4400000-0000-4000-8000-000000000001','day',(select today-7 from challenge44_clock),'kind','workout','sourceWorkoutId','d4400000-0000-4000-8000-000000000002','confirmed',true))),'1','A second completed workout on the same day replaces rather than adds credit');
select throws_ok($$select * from public.community_challenges_rpc('contribute',jsonb_build_object('id','b4400000-0000-4000-8000-000000000001','day',(select today-8 from challenge44_clock),'kind','rest','confirmed',true))$$,'P0001','community_invalid_input','Eight local days late is outside the sync window');
select throws_ok($$select * from public.community_challenges_rpc('contribute',jsonb_build_object('id','b4400000-0000-4000-8000-000000000001','day',(select today+1 from challenge44_clock),'kind','rest','confirmed',true))$$,'P0001','community_invalid_input','Tomorrow in the challenge timezone cannot be declared');
select is((select result->'challenge'->>'myProgress' from public.community_challenges_rpc('contribute',jsonb_build_object('id','b4400000-0000-4000-8000-000000000001','day',(select today-7 from challenge44_clock),'kind','rest','confirmed',true))),'1','Equal rest replacement cannot add a second day');
select throws_ok($$select * from public.community_challenges_rpc('contribute',jsonb_build_object('id','b4400000-0000-4000-8000-000000000001','day',(now() at time zone 'UTC')::date,'kind','workout','sourceWorkoutId','d4400000-0000-4000-8000-000000000003','confirmed',true))$$,'P0001',null,'UTC date cannot relabel a source completed on a different challenge-local day');
select is((select result->'challenge'->>'myProgress' from public.community_challenges_rpc('contribute',jsonb_build_object('id','b4400000-0000-4000-8000-000000000001','day',(select today from challenge44_clock),'kind','workout','sourceWorkoutId','d4400000-0000-4000-8000-000000000003','confirmed',true))),'2','The challenge-local source date is accepted independent of the SQL session date');

reset role;set local request.jwt.claim.role='service_role';
update public.workouts set notes='Synthetic edit while still completed' where id='d4400000-0000-4000-8000-000000000003';
select ok((select completed_at is not null from public.workouts where id='d4400000-0000-4000-8000-000000000003'),'Version-edit fixture remains completed');
select isnt((select w.updated_at from public.workouts w where w.id='d4400000-0000-4000-8000-000000000003'),(select source_updated_at from public.community_challenge_contributions where source_workout_id='d4400000-0000-4000-8000-000000000003'),'Real source update advances the pinned source version');
set local role authenticated;set local request.jwt.claim.role='authenticated';
select is((select result->'challenge'->>'myProgress' from public.community_challenges_rpc('get','{"id":"b4400000-0000-4000-8000-000000000001"}')),'1','A still-completed source edit invalidates its old declaration without losing the rest day');
select is((select result->'challenge'->'days'->1->>'valid' from public.community_challenges_rpc('get','{"id":"b4400000-0000-4000-8000-000000000001"}')),'false','The old source declaration is explicitly marked invalid');
select is((select result->'challenge'->>'myProgress' from public.community_challenges_rpc('contribute',jsonb_build_object('id','b4400000-0000-4000-8000-000000000001','day',(select today from challenge44_clock),'kind','workout','sourceWorkoutId','d4400000-0000-4000-8000-000000000003','confirmed',true))),'2','Deliberate redeclaration binds the new completed version once');

reset role;set local request.jwt.claim.role='service_role';
update public.community_challenge_members set joined_at=now()+interval '1 second' where challenge_id='b4400000-0000-4000-8000-000000000001';
set local role authenticated;set local request.jwt.claim.role='authenticated';
select throws_ok($$select * from public.community_challenges_rpc('contribute',jsonb_build_object('id','b4400000-0000-4000-8000-000000000001','day',(select today from challenge44_clock),'kind','workout','sourceWorkoutId','d4400000-0000-4000-8000-000000000003','confirmed',true))$$,'P0001','community_unavailable','A completed workout from before opt-in is refused even on the same local day');
select throws_ok($$select * from public.community_challenges_rpc('contribute',jsonb_build_object('id','b4400000-0000-4000-8000-000000000001','day',(select today-1 from challenge44_clock),'kind','rest','confirmed',true))$$,'P0001','community_invalid_input','A recent join cannot backfill a prior local day inside the seven-day window');
reset role;set local request.jwt.claim.role='service_role';
update public.community_challenges set end_day=(select today-1 from challenge44_clock) where id='b4400000-0000-4000-8000-000000000001';
set local role authenticated;set local request.jwt.claim.role='authenticated';
select throws_ok($$select * from public.community_challenges_rpc('contribute',jsonb_build_object('id','b4400000-0000-4000-8000-000000000001','day',(select today-1 from challenge44_clock),'kind','rest','confirmed',true))$$,'P0001','community_unavailable','An ended challenge rejects later sync instead of adding progress');

-- Fixed DST timestamps are separate from the dynamic admission clock above.
reset role;set local request.jwt.claim.role='service_role';
insert into public.community_challenges(id,user_id,group_id,title,start_day,end_day,timezone,goal_days,created_at)
values ('b4400000-0000-4000-8000-000000000002','c4400000-0000-4000-8000-000000000001','a4400000-0000-4000-8000-000000000001','Synthetic DST goal','2026-10-24','2026-10-26','Europe/Bratislava',2,'2026-10-24T00:00:00Z');
insert into public.community_challenge_members(user_id,challenge_id,generation,joined_at)
select user_id,'b4400000-0000-4000-8000-000000000002',generation,'2026-10-24T00:00:00Z'
from public.community_profiles where user_id='c4400000-0000-4000-8000-000000000001';
insert into public.workouts(id,user_id,name,started_at,completed_at,details)
select ('d4400000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'c4400000-0000-4000-8000-000000000001','Private DST source',stamp-interval '10 minutes',stamp,'{"workoutLifecycle":{"kind":"session"}}'::jsonb
from (values (4,'2026-10-25T00:30:00Z'::timestamptz),(5,'2026-10-25T01:30:00Z'::timestamptz),(6,'2026-03-29T00:30:00Z'::timestamptz),(7,'2026-03-29T01:30:00Z'::timestamptz),(8,'2026-03-28T23:30:00Z'::timestamptz)) cases(i,stamp);
insert into public.community_challenge_contributions(user_id,challenge_id,day,kind,source_workout_id,source_updated_at)
select user_id,'b4400000-0000-4000-8000-000000000002','2026-10-25','workout',id,updated_at from public.workouts where id='d4400000-0000-4000-8000-000000000004';
select ok((select public.community_challenge_artifact_valid(a) from public.community_challenge_contributions a where challenge_id='b4400000-0000-4000-8000-000000000002'),'First occurrence of the repeated autumn hour belongs to October25');
update public.community_challenge_contributions set source_workout_id='d4400000-0000-4000-8000-000000000005',source_updated_at=(select updated_at from public.workouts where id='d4400000-0000-4000-8000-000000000005') where challenge_id='b4400000-0000-4000-8000-000000000002';
select ok((select public.community_challenge_artifact_valid(a) from public.community_challenge_contributions a where challenge_id='b4400000-0000-4000-8000-000000000002'),'Second occurrence of the repeated autumn hour belongs to the same local day');
select is(public.community_challenge_dto('b4400000-0000-4000-8000-000000000002')->>'myProgress','1','Repeated autumn hour still contributes one day through the real DTO');
update public.community_challenges set start_day='2026-03-28',end_day='2026-03-30' where id='b4400000-0000-4000-8000-000000000002';
update public.community_challenge_contributions set day='2026-03-29',source_workout_id='d4400000-0000-4000-8000-000000000006',source_updated_at=(select updated_at from public.workouts where id='d4400000-0000-4000-8000-000000000006') where challenge_id='b4400000-0000-4000-8000-000000000002';
select ok((select public.community_challenge_artifact_valid(a) from public.community_challenge_contributions a where challenge_id='b4400000-0000-4000-8000-000000000002'),'Before spring clock jump belongs to March29');
update public.community_challenge_contributions set source_workout_id='d4400000-0000-4000-8000-000000000007',source_updated_at=(select updated_at from public.workouts where id='d4400000-0000-4000-8000-000000000007') where challenge_id='b4400000-0000-4000-8000-000000000002';
select ok((select public.community_challenge_artifact_valid(a) from public.community_challenge_contributions a where challenge_id='b4400000-0000-4000-8000-000000000002'),'After spring clock jump belongs to the same local day');
update public.community_challenge_contributions set source_workout_id='d4400000-0000-4000-8000-000000000008',source_updated_at=(select updated_at from public.workouts where id='d4400000-0000-4000-8000-000000000008') where challenge_id='b4400000-0000-4000-8000-000000000002';
select ok((select public.community_challenge_artifact_valid(a) from public.community_challenge_contributions a where challenge_id='b4400000-0000-4000-8000-000000000002'),'UTC March28 at23:30 is correctly March29 in Bratislava');
update public.community_challenge_contributions set day='2026-03-28' where challenge_id='b4400000-0000-4000-8000-000000000002';
select ok(not (select public.community_challenge_artifact_valid(a) from public.community_challenge_contributions a where challenge_id='b4400000-0000-4000-8000-000000000002'),'Using the UTC day instead of the actual local day fails provenance');
select * from finish();
rollback;
