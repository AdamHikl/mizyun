begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
update public.community_operations set enabled=true,enrollment=true,discovery=true,publish=true,engagement=true,cohort_required=false;
insert into auth.users(id,email) values
 ('c2500000-0000-4000-8000-000000000001','boulder-author@mizyun.test'),('c2500000-0000-4000-8000-000000000002','boulder-follower@mizyun.test'),
 ('c2500000-0000-4000-8000-000000000003','boulder-outsider@mizyun.test'),('c2500000-0000-4000-8000-000000000004','boulder-blocked@mizyun.test'),
 ('c2500000-0000-4000-8000-000000000005','boulder-withdrawn@mizyun.test'),('c2500000-0000-4000-8000-000000000006','boulder-other@mizyun.test'),
 ('c2500000-0000-4000-8000-000000000007','boulder-unenrolled@mizyun.test');
update public.profiles set birth_year=1990 where id::text like 'c2500000%';
insert into public.community_profiles(user_id,handle,display_name,avatar_symbol,status,generation,terms_version,terms_accepted_at,adult_declared_at)
select id,'bld250_'||right(id::text,12),'Synthetic climber','BC','active',1,'2026-09-30',now(),now() from auth.users where id::text like 'c2500000%' and id<>'c2500000-0000-4000-8000-000000000007';
insert into public.community_relationships(follower_user_id,target_user_id,status) values
 ('c2500000-0000-4000-8000-000000000002','c2500000-0000-4000-8000-000000000001','approved'),
 ('c2500000-0000-4000-8000-000000000004','c2500000-0000-4000-8000-000000000001','approved'),
 ('c2500000-0000-4000-8000-000000000005','c2500000-0000-4000-8000-000000000001','approved');
insert into public.media_assets(id,user_id,object_path,purpose,mime_type) values
 ('a2500000-0000-4000-8000-000000000001','c2500000-0000-4000-8000-000000000001','c2500000-0000-4000-8000-000000000001/wall.jpg','workout','image/jpeg');
insert into public.workouts(id,user_id,name,started_at,completed_at,details) values
 ('d2500000-0000-4000-8000-000000000009','c2500000-0000-4000-8000-000000000001','Strength',now()-interval '1 hour',now(),'{"workoutLifecycle":{"kind":"session"}}');
create temporary table ids(label text primary key,id uuid);
grant all on ids to authenticated;
create temporary table snaps(kind text primary key,value jsonb);
grant all on snaps to authenticated;

select ok(not has_function_privilege('authenticated','public.community_bouldering_details(uuid,uuid,boolean)','EXECUTE'),'Private bouldering projection helper is not callable');
select ok(not has_function_privilege('anon','public.community_publish_bouldering_activity(uuid,text,integer,uuid,integer,boolean,jsonb)','EXECUTE'),'Anonymous bouldering publish is denied');
select ok(not has_function_privilege('authenticated','public.community_publish_activity_before_bouldering(uuid,text,text,integer,integer,uuid,integer,boolean,jsonb)','EXECUTE'),'Raw strength publish is inaccessible');
select ok(not has_function_privilege('authenticated','public.community_export_page_before_bouldering(text,text,integer)','EXECUTE'),'Raw export reader is inaccessible');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='c2500000-0000-4000-8000-000000000001';
insert into ids select 'session',id from public.boulder_session_start('b2500000-0000-4000-8000-000000000001','Europe/Bratislava','Secret Gym');
insert into ids select 'flash',id from public.boulder_ascent_create((select id from ids where label='session'),'b2500000-0000-4000-8000-000000000002','6B','flash',1,'blue','private beta note','a2500000-0000-4000-8000-000000000001');
insert into ids select 'top',id from public.boulder_ascent_create((select id from ids where label='session'),'b2500000-0000-4000-8000-000000000003','7A','sent',3,'red',null,null);
insert into ids select 'sent',id from public.boulder_ascent_create((select id from ids where label='session'),'b2500000-0000-4000-8000-000000000004','6B','sent',null,null,null,null);
insert into ids select 'project',id from public.boulder_ascent_create((select id from ids where label='session'),'b2500000-0000-4000-8000-000000000005','7B','not_yet',4,'pink','crimpy project',null);
insert into snaps select 'day',to_jsonb(details->'boulderSession'->>'activityDate') from public.workouts where id=(select id from ids where label='session');
insert into snaps values('minimal',jsonb_build_object('activityDate',(select value->>0 from snaps where kind='day'),'topGrade','7A','sends',3,'flashes',1,'gradeBreakdown',null));
insert into snaps values('breakdown',jsonb_build_object('activityDate',(select value->>0 from snaps where kind='day'),'topGrade','7A','sends',3,'flashes',1,'gradeBreakdown','[{"grade":"7A","sends":1},{"grade":"6B","sends":2}]'::jsonb));

select throws_ok($$select * from public.community_publish_bouldering_activity((select id from ids where label='session'),(select value->>0 from snaps where kind='day'),1,'e2500000-0000-4000-8000-000000000001',0,false,(select value from snaps where kind='minimal'))$$,'P0001','community_unavailable','An unfinished session cannot be shared');
select lives_ok($$select * from public.boulder_session_finish((select id from ids where label='session'),'b2500000-0000-4000-8000-000000000006','private session notes')$$,'Owner finishes the session');
select throws_ok($$select * from public.community_publish_bouldering_activity((select id from ids where label='session'),(select value->>0 from snaps where kind='day'),1,'e2500000-0000-4000-8000-000000000001',0,false,(select value||'{"gymName":"Secret Gym"}' from snaps where kind='minimal'))$$,'P0001','community_conflict','An added gym key is rejected');
select throws_ok($$select * from public.community_publish_bouldering_activity((select id from ids where label='session'),(select value->>0 from snaps where kind='day'),1,'e2500000-0000-4000-8000-000000000001',0,false,(select value||'{"sends":4}' from snaps where kind='minimal'))$$,'P0001','community_conflict','A tampered send count is rejected');
select throws_ok($$select * from public.community_publish_bouldering_activity((select id from ids where label='session'),(select value->>0 from snaps where kind='day'),1,'e2500000-0000-4000-8000-000000000001',0,false,(select (value-'gradeBreakdown')||'{"attempts":9}' from snaps where kind='minimal'))$$,'P0001','community_conflict','A replaced allowlist key is rejected');
select throws_ok($$select * from public.community_publish_bouldering_activity((select id from ids where label='session'),(select value->>0 from snaps where kind='day'),1,'e2500000-0000-4000-8000-000000000001',0,false,(select jsonb_set(value,'{gradeBreakdown,0,sends}','2') from snaps where kind='breakdown'))$$,'P0001','community_conflict','A tampered grade breakdown is rejected');
select throws_ok($$select * from public.community_publish_bouldering_activity((select id from ids where label='session'),((select value->>0 from snaps where kind='day')::date-1)::text,1,'e2500000-0000-4000-8000-000000000001',0,false,(select value from snaps where kind='minimal'))$$,'P0001','community_conflict','The shared day must be the session local day');
insert into ids select 'card',id from public.community_publish_bouldering_activity((select id from ids where label='session'),(select value->>0 from snaps where kind='day'),1,'e2500000-0000-4000-8000-000000000001',0,false,(select value from snaps where kind='minimal'));
select is((select bouldering_details from public.shared_activities where id=(select id from ids where label='card')),(select value from snaps where kind='minimal'),'Previewed snapshot is stored exactly');
select ok((select activity_kind='bouldering' and category='other' and duration_seconds is null and workout_details is null and meal_details is null from public.shared_activities where id=(select id from ids where label='card')),'Card is a bouldering kind without strength or meal fields');
select is((select version from public.community_publish_bouldering_activity((select id from ids where label='session'),(select value->>0 from snaps where kind='day'),1,'e2500000-0000-4000-8000-000000000001',0,false,(select value from snaps where kind='minimal'))),1,'Lost-response replay returns the same version');
select is((select count(*) from public.shared_activities),1::bigint,'Replay leaves one card');
select throws_ok($$select * from public.community_publish_bouldering_activity((select id from ids where label='session'),(select value->>0 from snaps where kind='day'),1,'e2500000-0000-4000-8000-000000000001',0,false,(select value from snaps where kind='breakdown'))$$,'P0001','community_conflict','Same operation with a changed payload conflicts');
select throws_ok($$select * from public.community_publish_activity((select id from ids where label='session'),'other',(select value->>0 from snaps where kind='day'),null,1,'e2500000-0000-4000-8000-000000000002',1,false,null)$$,'22023','boulder_invalid','Strength card path cannot publish or overwrite a bouldering session');
select throws_ok($$select * from public.community_update_activity((select id from ids where label='card'),null,1)$$,'P0001','community_conflict','Generic duration edit cannot mutate a bouldering card');
select is((select item->>'activity_kind' from public.community_export_page('activities')),'bouldering','Own export names the kind');
select is((select item->'bouldering_details' from public.community_export_page('activities')),(select value from snaps where kind='minimal'),'Own export contains the published projection');
select is((select (item->>'source_workout_id')::uuid from public.community_export_page('activities')),(select id from ids where label='session'),'Own export keeps the private source link');

reset role;
select throws_ok($$insert into public.shared_activities(user_id,source_workout_id) values('c2500000-0000-4000-8000-000000000006',(select id from ids where label='session'))$$,'22023','boulder_invalid','A workout-kind card still cannot reference a bouldering session');
select throws_ok($$insert into public.shared_activities(user_id,activity_kind,source_workout_id,category,shared_day,bouldering_details) values('c2500000-0000-4000-8000-000000000001','bouldering','d2500000-0000-4000-8000-000000000009','other','2026-10-16','{}')$$,'22023','boulder_invalid','A bouldering-kind card cannot reference a strength workout');
select throws_ok($$insert into public.community_routine_shares(user_id,source_workout_id) values('c2500000-0000-4000-8000-000000000001',(select id from ids where label='session'))$$,'22023','boulder_invalid','Routine share of a bouldering session is still blocked');
select throws_ok($$insert into public.community_challenge_contributions(user_id,source_workout_id) values('c2500000-0000-4000-8000-000000000001',(select id from ids where label='session'))$$,'22023','boulder_invalid','Challenge contribution of a bouldering session is still blocked');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='c2500000-0000-4000-8000-000000000002';
select is((select count(*) from public.shared_activities),0::bigint,'Follower cannot read raw card rows');
select is((select count(*) from public.workouts),0::bigint,'Follower cannot read the source session');
select is((select count(*) from public.boulder_ascents),0::bigint,'Follower cannot read the source boulders');
select is((select bouldering_details from public.community_feed(20,null,null)),(select value from snaps where kind='minimal'),'Follower feed shows only the allowlisted snapshot');
select is((select activity_kind from public.community_feed(20,null,null)),'bouldering','Follower feed carries the kind');
select is((select source_workout_id from public.community_feed(20,null,null)),'00000000-0000-0000-0000-000000000000'::uuid,'Follower feed masks the source session');
select is((select source_workout_id from public.community_get_activity((select id from ids where label='card'))),'00000000-0000-0000-0000-000000000000'::uuid,'Card RPC masks the source session');
select is((select source_workout_id from public.community_author_activities('c2500000-0000-4000-8000-000000000001',20,null,null)),'00000000-0000-0000-0000-000000000000'::uuid,'Profile timeline masks the source session');
select ok((select bouldering_details::text not like '%Secret Gym%' and bouldering_details::text not like '%note%' and bouldering_details::text not like '%blue%' from public.community_get_activity((select id from ids where label='card'))),'Recipient card has no gym, notes or colours');
select lives_ok($$insert into public.community_reactions(activity_id,user_id,reaction) values((select id from ids where label='card'),auth.uid(),'clap')$$,'Bouldering card uses common reactions');
insert into ids select 'receipt',id from public.community_issue_report_receipt('activity',(select id::text from ids where label='card'));
select lives_ok($$select * from public.community_submit_report('activity',(select id::text from ids where label='card'),'spam',null,(select id from ids where label='receipt'))$$,'Bouldering card uses common report boundary');
select throws_ok($$select * from public.community_publish_bouldering_activity((select id from ids where label='session'),(select value->>0 from snaps where kind='day'),1,'e2500000-0000-4000-8000-000000000003',0,false,(select value from snaps where kind='minimal'))$$,'P0001','community_unavailable','A follower cannot publish the author''s session');

set local request.jwt.claim.sub='c2500000-0000-4000-8000-000000000003';
select is((select count(*) from public.community_get_activity((select id from ids where label='card'))),0::bigint,'Non-follower cannot read the card');
select is((select count(*) from public.community_feed(20,null,null)),0::bigint,'Non-follower feed omits the card');
set local request.jwt.claim.sub='c2500000-0000-4000-8000-000000000007';
select is((select count(*) from public.community_get_activity((select id from ids where label='card'))),0::bigint,'Unenrolled user cannot read the card');
set local request.jwt.claim.sub='c2500000-0000-4000-8000-000000000006';
select throws_ok($$select * from public.community_publish_bouldering_activity((select id from ids where label='session'),(select value->>0 from snaps where kind='day'),1,'e2500000-0000-4000-8000-000000000004',0,false,(select value from snaps where kind='minimal'))$$,'P0001','community_unavailable','Another user''s session cannot be published');
set local request.jwt.claim.sub='c2500000-0000-4000-8000-000000000005';
select is((select count(*) from public.community_feed(20,null,null)),1::bigint,'Approved follower sees the card before withdrawal');
select lives_ok($$select public.community_withdraw_profile()$$,'Follower withdraws from Community');
select is((select count(*) from public.community_feed(20,null,null)),0::bigint,'Withdrawn follower feed omits the card');
select is((select count(*) from public.community_get_activity((select id from ids where label='card'))),0::bigint,'Withdrawn follower cannot read the card');

reset role;
insert into public.community_blocks(blocker_user_id,blocked_user_id) values('c2500000-0000-4000-8000-000000000001','c2500000-0000-4000-8000-000000000004');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='c2500000-0000-4000-8000-000000000004';
select is((select count(*) from public.community_feed(20,null,null)),0::bigint,'Blocked user feed omits the card');
select is((select count(*) from public.community_get_activity((select id from ids where label='card'))),0::bigint,'Blocked user cannot read the card');

set local request.jwt.claim.sub='c2500000-0000-4000-8000-000000000001';
select is((select version from public.community_publish_bouldering_activity((select id from ids where label='session'),(select value->>0 from snaps where kind='day'),1,'e2500000-0000-4000-8000-000000000005',1,false,(select value from snaps where kind='breakdown'))),2,'Explicit breakdown confirmation replaces the card');
select is((select bouldering_details from public.shared_activities where id=(select id from ids where label='card')),(select value from snaps where kind='breakdown'),'Breakdown is stored hardest first');
reset role;
select ok(exists(select 1 from public.community_revocation_events where user_id='c2500000-0000-4000-8000-000000000001' and kind='activity' and target_id=(select id from ids where label='card')),'Live projection replacement records a data-free reduction event');
select ok((select (public.community_social_snapshot('activity',(select id::text from ids where label='card')))->'boulderingDetails'=(select value from snaps where kind='breakdown')),'Report snapshot carries the bouldering allowlist');
select ok((select public.community_social_snapshot('activity',(select id::text from ids where label='card'))::text not like '%Secret Gym%'),'Report snapshot has no gym name');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='c2500000-0000-4000-8000-000000000001';

-- Source changes revoke.
select lives_ok($$select * from public.boulder_ascent_update((select id from ids where label='sent'),'b2500000-0000-4000-8000-000000000007',1,'6B','sent',null,null,'edited note',null)$$,'Owner edits a boulder note');
select ok((select revoked_at is null from public.shared_activities where id=(select id from ids where label='card')),'A note edit never reaches the card and does not revoke it');
select lives_ok($$select * from public.boulder_ascent_update((select id from ids where label='sent'),'b2500000-0000-4000-8000-000000000017',2,'6B+','sent',null,null,'edited note',null)$$,'Owner edits a boulder grade');
select ok((select revoked_at is not null from public.shared_activities where id=(select id from ids where label='card')),'Editing a shared grade revokes the card');
select lives_ok($$select * from public.boulder_ascent_update((select id from ids where label='sent'),'b2500000-0000-4000-8000-000000000027',3,'6B','sent',null,null,'edited note',null)$$,'Owner restores the grade');
select throws_ok($$select * from public.community_publish_bouldering_activity((select id from ids where label='session'),(select value->>0 from snaps where kind='day'),1,'e2500000-0000-4000-8000-000000000005',1,false,(select value from snaps where kind='breakdown'))$$,'P0001','community_conflict','Lost-response retry cannot resurrect a revoked card');
select is((select version from public.community_publish_bouldering_activity((select id from ids where label='session'),(select value->>0 from snaps where kind='day'),1,'e2500000-0000-4000-8000-000000000006',2,true,(select value from snaps where kind='minimal'))),3,'Fresh confirmation republishes a revoked card');
select lives_ok($$select * from public.boulder_ascent_create((select id from ids where label='session'),'b2500000-0000-4000-8000-000000000008','5','sent',null,null,null,null)$$,'Owner adds a boulder to the finished session');
select ok((select revoked_at is not null from public.shared_activities where id=(select id from ids where label='card')),'Adding a boulder revokes the card');
select throws_ok($$select * from public.community_publish_bouldering_activity((select id from ids where label='session'),(select value->>0 from snaps where kind='day'),1,'e2500000-0000-4000-8000-000000000007',3,true,(select value from snaps where kind='minimal'))$$,'P0001','community_conflict','A stale preview cannot republish after a source change');
select is((select version from public.community_publish_bouldering_activity((select id from ids where label='session'),(select value->>0 from snaps where kind='day'),1,'e2500000-0000-4000-8000-000000000008',3,true,(select value||'{"sends":4}' from snaps where kind='minimal'))),4,'Fresh projection republishes');
select lives_ok($$select * from public.boulder_ascent_remove((select id from ids where label='project'))$$,'Owner removes a boulder');
select ok((select revoked_at is not null from public.shared_activities where id=(select id from ids where label='card')),'Removing a boulder revokes the card');
select lives_ok($$select public.community_revoke_bouldering_activities((select id from ids where label='session'))$$,'Explicit revoke is idempotent');
select is((select version from public.community_publish_bouldering_activity((select id from ids where label='session'),(select value->>0 from snaps where kind='day'),1,'e2500000-0000-4000-8000-000000000009',4,true,(select value||'{"sends":4}' from snaps where kind='minimal'))),5,'Republish before session delete');
select lives_ok($$select * from public.boulder_session_remove((select id from ids where label='session'))$$,'Owner deletes the session');
select is((select count(*) from public.shared_activities where id=(select id from ids where label='card')),0::bigint,'Deleting the session removes the card');
reset role;
select ok(exists(select 1 from public.community_revocation_events where user_id='c2500000-0000-4000-8000-000000000001' and kind='source_workout' and target_id=(select id from ids where label='session')),'Session delete records a source tombstone');

-- Account erasure removes the card with the session.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='c2500000-0000-4000-8000-000000000001';
insert into ids select 'session2',id from public.boulder_session_start('b2500000-0000-4000-8000-000000000011','UTC',null);
select lives_ok($$select * from public.boulder_ascent_create((select id from ids where label='session2'),'b2500000-0000-4000-8000-000000000012','6A','flash',1,null,null,null)$$,'Second session boulder');
select lives_ok($$select * from public.boulder_session_finish((select id from ids where label='session2'),'b2500000-0000-4000-8000-000000000013',null)$$,'Second session finishes');
insert into ids select 'card2',id from public.community_publish_bouldering_activity((select id from ids where label='session2'),(select details->'boulderSession'->>'activityDate' from public.workouts where id=(select id from ids where label='session2')),1,'e2500000-0000-4000-8000-000000000011',0,false,
 jsonb_build_object('activityDate',(select details->'boulderSession'->>'activityDate' from public.workouts where id=(select id from ids where label='session2')),'topGrade','6A','sends',1,'flashes',1,'gradeBreakdown',null));
select ok((select id from ids where label='card2') is not null,'Second session is shared');
reset role;
delete from auth.users where id='c2500000-0000-4000-8000-000000000001';
select is((select count(*) from public.shared_activities where user_id='c2500000-0000-4000-8000-000000000001'),0::bigint,'Erasure removes bouldering cards');
select is((select count(*) from public.boulder_ascents where user_id='c2500000-0000-4000-8000-000000000001'),0::bigint,'Erasure removes boulders');
select * from finish();
rollback;
