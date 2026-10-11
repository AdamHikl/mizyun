-- Committed fixtures are permitted only in the verifier's disposable database.
-- This is SQL worker-lease recovery, not a deployed API/Storage deletion drill.
begin;
do $$begin
 if current_database() !~ '^mizyun_.*(scratch|verify)' then
  raise exception 'Committed lifecycle fixtures require a disposable Mizyun scratch/verify database';
 end if;
end $$;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create temporary table restart151_controls as select * from public.community_operations;
update public.community_operations set enabled=true,enrollment=true,discovery=true,publish=true,engagement=true,cohort_required=false;
set local request.jwt.claim.role='service_role';
insert into auth.users(id,email)
select ('c1510000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'synthetic-restart151-'||i||'@mizyun.test' from generate_series(1,61)i;
update public.profiles set birth_year=1990 where id::text like 'c1510000-%';
insert into public.community_profiles(user_id,handle,display_name,status,terms_version,terms_accepted_at,adult_declared_at)
select id,'restart151_'||right(id::text,12),'Synthetic restart member','active','2026-09-30',now(),now()
from auth.users where id::text like 'c1510000-%';
-- Service fixtures exceed the live thirty-edge cap to stress historical cleanup.
-- They never alter the ordinary member cap or create a public testing cohort.
insert into public.community_relationships(follower_user_id,target_user_id,status)
select id,'c1510000-0000-4000-8000-000000000001','approved' from auth.users
where id::text like 'c1510000-%' and id<>'c1510000-0000-4000-8000-000000000001';
insert into public.community_relationships(follower_user_id,target_user_id,status)
select 'c1510000-0000-4000-8000-000000000001',id,'approved' from auth.users
where id::text like 'c1510000-%' and id<>'c1510000-0000-4000-8000-000000000001';
insert into public.workouts(id,user_id,name,started_at,completed_at,details)
select ('d1510000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'c1510000-0000-4000-8000-000000000001','Private synthetic restart source',now()-interval '1 hour',now(),
 '{"workoutLifecycle":{"kind":"session"}}'::jsonb from generate_series(1,50)i;
insert into public.shared_activities(id,user_id,source_workout_id,category,shared_day)
select ('a1510000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'c1510000-0000-4000-8000-000000000001',('d1510000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'strength',(now() at time zone 'UTC')::date::text from generate_series(1,50)i;
insert into public.community_invitations(inviter_user_id,token)
select 'c1510000-0000-4000-8000-000000000001','private-restart151-token-'||i from generate_series(1,50)i;
insert into public.community_inbox_events(user_id,actor_user_id,kind,target_id,generation,dedupe_key)
select follower_user_id,target_user_id,'approval',id,1,'restart151:'||id::text
from public.community_relationships where target_user_id='c1510000-0000-4000-8000-000000000001';
select is((select count(*) from public.community_relationships where follower_user_id='c1510000-0000-4000-8000-000000000001' or target_user_id='c1510000-0000-4000-8000-000000000001'),120::bigint,'Synthetic high-degree graph starts with sixty incoming and sixty outgoing edges');
select is((select count(*) from public.community_inbox_events where actor_user_id='c1510000-0000-4000-8000-000000000001'),60::bigint,'Incoming delivery references are present before cleanup');
set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='c1510000-0000-4000-8000-000000000002';
select ok(public.community_can_view_card('a1510000-0000-4000-8000-000000000001'),'Approved recipient can read the initial card');
reset role;set local request.jwt.claim.role='service_role';
insert into public.account_deletion_jobs(id,user_id,challenge_hash,status,stage,expires_at,worker_id,lease_expires_at)
values('e1510000-0000-4000-8000-000000000001','c1510000-0000-4000-8000-000000000001',
 'synthetic-restart151-challenge','in_progress','auth',now()+interval '1 hour','restart151-old',now()+interval '5 minutes');
select is((select complete from public.community_account_cleanup_batch('c1510000-0000-4000-8000-000000000001','e1510000-0000-4000-8000-000000000001','restart151-old',10)),false,'First bounded batch deliberately leaves resumable work');
select is((select count(*) from public.community_invitations where inviter_user_id='c1510000-0000-4000-8000-000000000001'),40::bigint,'First batch commits exactly ten invitation removals');
create temporary table restart151_remaining_card as select id from public.shared_activities where user_id='c1510000-0000-4000-8000-000000000001' limit 1;
grant select on restart151_remaining_card to authenticated;
select is((select count(*) from restart151_remaining_card),1::bigint,'A physical remaining card exercises the visibility barrier independently of deletion');
commit;

begin;
set local search_path=public,extensions;
set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='c1510000-0000-4000-8000-000000000002';
select ok(not public.community_can_view_card((select id from restart151_remaining_card)),'Fresh recipient transaction cannot read an undeleted card after committed erasure barrier');
select is(jsonb_array_length(public.community_notifications('inbox','{}')->'items'),0,'Recipient has no visible delivery event from the withdrawing actor');
reset role;set local request.jwt.claim.role='service_role';
update public.account_deletion_jobs set lease_expires_at=now()-interval '1 second' where id='e1510000-0000-4000-8000-000000000001';
select throws_ok($$select * from public.community_account_cleanup_batch('c1510000-0000-4000-8000-000000000001','e1510000-0000-4000-8000-000000000001','restart151-old',10)$$,'P0001','community_access_denied','Expired worker lease cannot continue committed cleanup');
select is((select count(*) from public.community_invitations where inviter_user_id='c1510000-0000-4000-8000-000000000001'),40::bigint,'Rejected old worker performs no additional removal');
update public.account_deletion_jobs set worker_id='restart151-new',lease_expires_at=now()+interval '5 minutes' where id='e1510000-0000-4000-8000-000000000001';
commit;

begin;
set local search_path=public,extensions;
set local request.jwt.claim.role='service_role';
select throws_ok($$select * from public.community_account_cleanup_batch('c1510000-0000-4000-8000-000000000001','e1510000-0000-4000-8000-000000000001','restart151-old',10)$$,'P0001','community_access_denied','Former worker identity is denied after a new lease is committed');
create temporary table restart151_batches(ordinal integer,complete boolean);
do $$declare i integer;done boolean;begin
 for i in 1..10 loop
  select complete into done from public.community_account_cleanup_batch('c1510000-0000-4000-8000-000000000001','e1510000-0000-4000-8000-000000000001','restart151-new',10);
  insert into restart151_batches values(i,done);
  exit when done;
 end loop;
end $$;
select ok((select complete from restart151_batches order by ordinal desc limit 1),'New worker finishes the persisted high-degree job within its bounded batch budget');
select is((select count(*) from public.community_relationships where follower_user_id='c1510000-0000-4000-8000-000000000001' or target_user_id='c1510000-0000-4000-8000-000000000001'),0::bigint,'Incoming and outgoing graph references are exhausted');
select is((select count(*) from public.shared_activities where user_id='c1510000-0000-4000-8000-000000000001'),0::bigint,'No owned share remains');
select is((select count(*) from public.community_invitations where inviter_user_id='c1510000-0000-4000-8000-000000000001'),0::bigint,'Resumed worker exhausts every retained invitation');
select is((select count(*) from public.community_inbox_events where user_id='c1510000-0000-4000-8000-000000000001' or actor_user_id='c1510000-0000-4000-8000-000000000001'),0::bigint,'No incoming or outgoing inbox reference remains');
select is((select count(*) from public.workouts where user_id='c1510000-0000-4000-8000-000000000001'),50::bigint,'Social cleanup leaves private source removal to the existing Auth stage');
select is((select deleted_count from public.community_account_cleanup_batch('c1510000-0000-4000-8000-000000000001','e1510000-0000-4000-8000-000000000001','restart151-new',10)),0,'Completed social cleanup replay is idempotent');
-- Restore all scratch controls; fixture rows disappear when the runner drops it.
update public.community_operations c set enabled=b.enabled,enrollment=b.enrollment,discovery=b.discovery,publish=b.publish,engagement=b.engagement,delivery=b.delivery,cohort_required=b.cohort_required from restart151_controls b where c.singleton=b.singleton;
select * from finish();
commit;
