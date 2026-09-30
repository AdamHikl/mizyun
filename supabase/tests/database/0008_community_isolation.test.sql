begin;
-- Synthetic fixture explicitly activates Community; production defaults stay closed.
update public.community_operations set enabled=true,enrollment=true,discovery=true,publish=true,engagement=true,cohort_required=false;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(16);
insert into auth.users(id,email) values
('c0000000-0000-4000-8000-000000000001','community-a@mizyun.test'),
('c0000000-0000-4000-8000-000000000002','community-b@mizyun.test'),
('c0000000-0000-4000-8000-000000000003','community-c@mizyun.test');
update public.profiles set birth_year = 1990 where id::text like 'c0000000-%';
set local role anon;
set local request.jwt.claim.role = 'anon';
select throws_ok($$select * from public.community_profiles$$,'42501',null,'Anonymous profile reads denied');
select throws_ok($$select * from public.community_save_profile('usera','User A','UA',null,false,true,'2026-09-30')$$,'42501',null,'Anonymous enrollment denied');
set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000001';
select lives_ok($$select * from public.community_save_profile('usera','User A','UA','Private social bio',false,true,'2026-09-30')$$,'Adult explicit enrollment accepted');
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000002';
select * from public.community_save_profile('userb','User B','UB',null,false,true,'2026-09-30');
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000003';
select * from public.community_save_profile('userc','User C','UC',null,false,true,'2026-09-30');
select is_empty($$select * from public.community_get_profile('c0000000-0000-4000-8000-000000000001')$$,'Stranger cannot lookup unsearchable identity');
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000001';
select * from public.community_save_profile('usera','User A','UA','Private social bio',true,true,'2026-09-30');
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000003';
select is((select count(*) from public.community_profile_by_handle('usera')),1::bigint,'Exact searchable handle lookup works');
select is((select bio from public.community_profile_by_handle('usera')),null,'Stranger lookup excludes bio');
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000002';
select lives_ok($$select * from public.community_request_follow('c0000000-0000-4000-8000-000000000001',null,'e1430000-0000-4000-8000-000000000101')$$,'Requester creates pending directional edge');
select throws_ok($$update public.community_relationships set status='approved' where follower_user_id=auth.uid()$$,'P0001','community_unavailable','Requester cannot self-approve');
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000001';
select lives_ok($$update public.community_relationships set status='approved' where target_user_id=auth.uid()$$,'Recipient approves pending edge');
reset role;set local request.jwt.claim.role='service_role';
set local request.jwt.claim.role = 'service_role';
insert into public.workouts(id,user_id,name,started_at,completed_at,details)
values('d0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','Never shared private name',now()-interval '1 hour',now(),'{"workoutLifecycle":{"kind":"session"}}');
set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000001';
select lives_ok($$select * from public.community_publish_activity('d0000000-0000-4000-8000-000000000001','strength',(now() at time zone 'UTC')::date::text,3600,1,'a0000000-0000-4000-8000-000000000001')$$,'Completed owned session publication accepted');
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000002';
select is((select count(*) from public.community_feed(20,null,null)),1::bigint,'Approved follower sees card via safe projection');
select is((select source_workout_id::text from public.community_feed(20,null,null)),'00000000-0000-0000-0000-000000000000','Follower cannot retrieve author source identifier');
select lives_ok($$insert into public.community_reactions(activity_id,user_id,reaction) select id,auth.uid(),'clap' from public.community_feed(20,null,null)$$,'Approved follower reacts');
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000001';
select lives_ok($$insert into public.community_blocks(blocker_user_id,blocked_user_id) values(auth.uid(),'c0000000-0000-4000-8000-000000000002')$$,'Author blocks follower');
select is_empty($$select * from public.community_relationships where target_user_id=auth.uid()$$,'Block removes directional graph');
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000002';
select is_empty($$select * from public.community_feed(20,null,null)$$,'Incoming block denies safe card transport');
select * from finish();
rollback;
