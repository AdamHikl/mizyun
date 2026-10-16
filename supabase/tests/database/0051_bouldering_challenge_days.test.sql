begin;
create extension if not exists pgtap with schema extensions;set local search_path=public,extensions;select no_plan();
update public.community_operations set enabled=true,enrollment=true,discovery=true,publish=true,engagement=true,cohort_required=false;
update public.community_feature_controls set enabled=true where feature in('groups','challenges');
insert into auth.users(id,email) values('61510000-0000-4000-8000-000000000001','bchallenge-a@mizyun.test'),('61510000-0000-4000-8000-000000000002','bchallenge-b@mizyun.test');update public.profiles set birth_year=1990 where id::text like '61510000%';
create temporary table ids(label text primary key,id uuid);grant all on ids to authenticated;
set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='61510000-0000-4000-8000-000000000001';select * from public.community_save_profile('bchallenge_a','A','AA',null,true,true,'2026-09-30');
set local request.jwt.claim.sub='61510000-0000-4000-8000-000000000002';select * from public.community_save_profile('bchallenge_b','B','BB',null,true,true,'2026-09-30');
reset role;set local request.jwt.claim.role='service_role';
insert into public.community_groups(id,user_id,created_by,operation_id,name,rules) values('62510000-0000-4000-8000-000000000001','61510000-0000-4000-8000-000000000001','61510000-0000-4000-8000-000000000001','63510000-0000-4000-8000-000000000001','Climbers','Be kind');
insert into public.community_group_members(group_id,user_id,role,state,generation,joined_at) select '62510000-0000-4000-8000-000000000001',user_id,case when user_id::text like '%001' then 'owner' else 'member' end,'member',generation,now() from public.community_profiles where user_id in('61510000-0000-4000-8000-000000000001','61510000-0000-4000-8000-000000000002');
create temp table challenge_create(args jsonb);insert into challenge_create values(jsonb_build_object('id','64510000-0000-4000-8000-000000000001','groupId','62510000-0000-4000-8000-000000000001','title','Climb together','startDay',current_date,'endDay',current_date+6,'timezone','UTC','goalDays',3,'confirmed',true));grant select on challenge_create to authenticated;
set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='61510000-0000-4000-8000-000000000001';
select * from public.community_challenges_rpc('create',(select args from challenge_create));
select * from public.community_challenges_rpc('join','{"id":"64510000-0000-4000-8000-000000000001","confirmed":true}');
insert into ids select 'session',id from public.boulder_session_start('b2510000-0000-4000-8000-000000000001','UTC',null);
select lives_ok($$select * from public.boulder_ascent_create((select id from ids where label='session'),'c2510000-0000-4000-8000-000000000001','6B','flash',1,null,null,null)$$,'Boulder logged');

-- An active session is not a completed workout day.
select throws_ok($$select * from public.community_challenges_rpc('contribute',jsonb_build_object('id','64510000-0000-4000-8000-000000000001','day',current_date,'kind','workout','sourceWorkoutId',(select id from ids where label='session'),'confirmed',true))$$,'P0001','community_unavailable','An unfinished session cannot count');
select ok((select completed_at is not null from public.boulder_session_finish((select id from ids where label='session'),'d2510000-0000-4000-8000-000000000001',null)),'Session finished');
select is((select result->'challenge'->>'myProgress' from public.community_challenges_rpc('contribute',jsonb_build_object('id','64510000-0000-4000-8000-000000000001','day',current_date,'kind','workout','sourceWorkoutId',(select id from ids where label='session'),'confirmed',true))),'1','A completed bouldering session counts as a workout day');
select is((select result->'challenge'->>'myProgress' from public.community_challenges_rpc('contribute',jsonb_build_object('id','64510000-0000-4000-8000-000000000001','day',current_date,'kind','workout','sourceWorkoutId',(select id from ids where label='session'),'confirmed',true))),'1','Repeating the declaration cannot inflate progress');
reset role;
select ok((select public.community_challenge_artifact_valid(c) from public.community_challenge_contributions c where c.challenge_id='64510000-0000-4000-8000-000000000001' and c.user_id='61510000-0000-4000-8000-000000000001'),'The bouldering day is a valid artifact');
set local role authenticated;

-- Another user cannot claim the session.
set local request.jwt.claim.sub='61510000-0000-4000-8000-000000000002';
select * from public.community_challenges_rpc('join','{"id":"64510000-0000-4000-8000-000000000001","confirmed":true}');
select throws_ok($$select * from public.community_challenges_rpc('contribute',jsonb_build_object('id','64510000-0000-4000-8000-000000000001','day',current_date,'kind','workout','sourceWorkoutId',(select id from ids where label='session'),'confirmed',true))$$,'P0001','community_unavailable','Another user''s session is refused');

-- Direct inserts stay guarded: only a workout-kind day for an owned completed session.
reset role;
select throws_ok($$insert into public.community_challenge_contributions(user_id,challenge_id,day,kind,source_workout_id,source_updated_at) values('61510000-0000-4000-8000-000000000002','64510000-0000-4000-8000-000000000001',current_date,'workout',(select id from ids where label='session'),now())$$,'22023','boulder_invalid','A bouldering session cannot back another user''s day');
select throws_ok($$insert into public.community_routine_shares(user_id,source_workout_id) values('61510000-0000-4000-8000-000000000001',(select id from ids where label='session'))$$,'22023','boulder_invalid','Routine shares of a bouldering session stay blocked');
select throws_ok($$insert into public.shared_activities(user_id,activity_kind,source_workout_id,category,shared_day) values('61510000-0000-4000-8000-000000000001','workout',(select id from ids where label='session'),'other',current_date::text)$$,'22023','boulder_invalid','Workout cards of a bouldering session stay blocked');

-- Editing the session later invalidates the declared artifact like any workout.
set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='61510000-0000-4000-8000-000000000001';
select lives_ok($$select * from public.boulder_ascent_create((select id from ids where label='session'),'c2510000-0000-4000-8000-000000000002','6C','sent',3,null,null,null)$$,'A boulder added after finishing');
reset role;
select ok((select public.community_challenge_artifact_valid(c) from public.community_challenge_contributions c where c.challenge_id='64510000-0000-4000-8000-000000000001' and c.user_id='61510000-0000-4000-8000-000000000001'),'Adding a boulder keeps the completed-day artifact valid');
set local role authenticated;
select is((select count(*) from public.boulder_session_remove((select id from ids where label='session'))),0::bigint,'Session removed');
reset role;
select is((select count(*) from public.community_challenge_contributions where user_id='61510000-0000-4000-8000-000000000001'),0::bigint,'Removing the session removes its declared day');

select * from finish();
rollback;
