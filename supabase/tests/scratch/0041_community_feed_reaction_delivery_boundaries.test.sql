-- Disposable local scratch only: COMMIT boundaries deliberately retain fixtures
-- between replay reads. The runner must drop the scratch on any SQL failure.
-- No provider calls; worker recovery below exercises the actual SQL lease RPCs.
begin;
do $$begin
 if current_database() !~ '^mizyun_.*(scratch|verify)' then
  raise exception 'This committed-fixture suite requires a disposable Mizyun scratch/verify database';
 end if;
end $$;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(39);
create temporary table boundary_operations as
 select enabled,enrollment,discovery,publish,engagement,delivery,cohort_required from public.community_operations;
update public.community_operations set enabled=true,enrollment=true,discovery=true,publish=true,engagement=true,delivery=true,cohort_required=false;
set local request.jwt.claim.role='service_role';
insert into auth.users(id,email)
select ('c4100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'community-boundary41-'||i||'@mizyun.test' from generate_series(1,6)i;
update public.profiles set birth_year=1990 where id::text like 'c4100000-%';
insert into public.community_profiles(user_id,handle,display_name,status,terms_version,terms_accepted_at,adult_declared_at)
select id,'boundary41_'||right(id::text,12),'Synthetic boundary member','active','2026-09-30',now(),now()
from auth.users where id::text like 'c4100000-%';
insert into auth.sessions(id,user_id)
select ('e4100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 ('c4100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid from unnest(array[1,4,5])i;
insert into public.community_push_tokens(installation_id,user_id,token,session_id,generation)
select ('f4100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 ('c4100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'ExpoPushToken[synthetic_boundary41_'||i||']',
 'e4100000-0000-4000-8000-'||lpad(i::text,12,'0'),1 from unnest(array[1,4,5])i;
insert into public.community_relationships(follower_user_id,target_user_id,status)
values('c4100000-0000-4000-8000-000000000002','c4100000-0000-4000-8000-000000000001','approved'),
 ('c4100000-0000-4000-8000-000000000002','c4100000-0000-4000-8000-000000000003','approved');
create temporary table boundary_time as select date_trunc('second',now()-interval '1 hour') as base;
insert into public.workouts(id,user_id,name,started_at,completed_at,details)
select ('d4100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'c4100000-0000-4000-8000-000000000001','Private synthetic source',now()-interval '1 hour',now(),
 '{"workoutLifecycle":{"kind":"session"}}'::jsonb from generate_series(1,5)i;
insert into public.shared_activities(id,user_id,source_workout_id,category,shared_day,published_at)
select ('a4100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'c4100000-0000-4000-8000-000000000001',('d4100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'strength',(now() at time zone 'UTC')::date::text,
 base+make_interval(secs=>case when i=4 then 0.123452 else 0.123449+i*0.000001 end)
from generate_series(1,4)i cross join boundary_time;
create temporary table boundary_page(id uuid,published_at timestamptz);
create temporary table boundary_reaction(reaction_id uuid,event_id uuid);
create temporary table boundary_claim(label text,id uuid,lease_id uuid);
grant all on boundary_time,boundary_page,boundary_reaction,boundary_claim to authenticated;

-- Real PostgreSQL microseconds and equal-time UUID ordering, never a Date fixture.
set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='c4100000-0000-4000-8000-000000000002';
insert into boundary_page select id,published_at from public.community_feed(2,null,null);
select is((select id::text from public.community_feed(1,null,null)),
 'a4100000-0000-4000-8000-000000000004','Feed starts at higher UUID when publication microseconds tie');
select is((select mod(extract(microseconds from published_at)::integer,1000000) from boundary_page where id='a4100000-0000-4000-8000-000000000004'),
 123452,'RPC publication boundary retains all six fractional digits');
select is((select id::text from public.community_feed(1,(select published_at from boundary_page where id='a4100000-0000-4000-8000-000000000004'),'a4100000-0000-4000-8000-000000000004')),
 'a4100000-0000-4000-8000-000000000003','Exact cursor traverses equal microseconds by descending UUID');
select is((select id::text from public.community_feed(1,(select published_at from boundary_page where id='a4100000-0000-4000-8000-000000000003'),'a4100000-0000-4000-8000-000000000003')),
 'a4100000-0000-4000-8000-000000000002','Exact cursor reaches the next lower microsecond within the same millisecond');
select is((select count(*) from public.community_feed(20,(select base+interval '0.123 seconds' from boundary_time),'a4100000-0000-4000-8000-000000000004')),
 0::bigint,'Millisecond-truncated boundary demonstrates the omitted-row failure');
select is((select id::text from public.community_author_activities('c4100000-0000-4000-8000-000000000001',1,(select published_at from boundary_page where id='a4100000-0000-4000-8000-000000000004'),'a4100000-0000-4000-8000-000000000004')),
 'a4100000-0000-4000-8000-000000000003','Author RPC preserves the same exact tuple boundary');
reset role;set local request.jwt.claim.role='service_role';
insert into public.shared_activities(id,user_id,source_workout_id,category,shared_day,published_at)
select 'a4100000-0000-4000-8000-000000000005','c4100000-0000-4000-8000-000000000001',
 'd4100000-0000-4000-8000-000000000005','strength',(now() at time zone 'UTC')::date::text,base+interval '0.123453 seconds' from boundary_time;
delete from public.shared_activities where id='a4100000-0000-4000-8000-000000000001';
set local role authenticated;set local request.jwt.claim.role='authenticated';
select is((select array_agg(id::text order by published_at desc,id desc) from public.community_feed(20,(select published_at from boundary_page where id='a4100000-0000-4000-8000-000000000003'),'a4100000-0000-4000-8000-000000000003')),
 array['a4100000-0000-4000-8000-000000000002'],'Insert above cursor and delete below cursor neither repeat prior cards nor skip surviving continuation');
select is((select id::text from public.community_feed(1,null,null)),
 'a4100000-0000-4000-8000-000000000005','Refresh includes the newly inserted card above the old cursor');

-- The same upsert used by the adapter is committed before replaying it.
insert into public.community_reactions(activity_id,user_id,reaction,updated_at)
values('a4100000-0000-4000-8000-000000000004',auth.uid(),'clap',clock_timestamp())
on conflict(activity_id,user_id) do update set reaction=excluded.reaction,updated_at=excluded.updated_at;
reset role;set local request.jwt.claim.role='service_role';
insert into boundary_reaction select r.id,e.id from public.community_reactions r
 join public.community_inbox_events e on e.source_id=r.id and e.kind='reaction'
 where r.activity_id='a4100000-0000-4000-8000-000000000004' and r.user_id='c4100000-0000-4000-8000-000000000002';
select is((select count(*) from boundary_reaction),1::bigint,'Initial reaction creates one identified logical inbox event');
commit;

begin;
set local search_path=public,extensions;
set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='c4100000-0000-4000-8000-000000000002';
insert into public.community_reactions(activity_id,user_id,reaction,updated_at)
values('a4100000-0000-4000-8000-000000000004',auth.uid(),'clap',clock_timestamp())
on conflict(activity_id,user_id) do update set reaction=excluded.reaction,updated_at=excluded.updated_at;
select is((select id from public.community_reactions where activity_id='a4100000-0000-4000-8000-000000000004' and user_id=auth.uid()),
 (select reaction_id from boundary_reaction),'Fresh authenticated replay preserves the committed reaction identity');
commit;

begin;
set local search_path=public,extensions;
set local request.jwt.claim.role='service_role';
select is((select count(*) from public.community_reactions where activity_id='a4100000-0000-4000-8000-000000000004'),1::bigint,'Fresh transaction reads exactly one active reaction after committed replay');
select is((select count(*) from public.community_inbox_events where source_id=(select reaction_id from boundary_reaction)),1::bigint,'Committed replay retains exactly one logical notification');
select is((select id from public.community_inbox_events where source_id=(select reaction_id from boundary_reaction)),
 (select event_id from boundary_reaction),'Replay keeps the original notification identity');
select is((select count(*) from public.community_notification_dedupe where user_id='c4100000-0000-4000-8000-000000000001' and dedupe_key='reaction:'||(select reaction_id::text from boundary_reaction)),
 1::bigint,'Committed replay retains one durable logical dedupe key');

-- Worker crash: claim survives, lease expires, a new worker claims the same job.
insert into boundary_claim select 'expired',id,lease_id from public.community_notification_claim(1);
select is((select count(*) from boundary_claim where label='expired'),1::bigint,'Original worker claims the committed reaction job');
select is((select count(*) from public.community_notification_claim(1)),0::bigint,'Restart cannot steal an unexpired worker lease');
update public.community_notification_outbox set lease_until=now()-interval '1 second' where id=(select id from boundary_claim where label='expired');
insert into boundary_claim select 'recovered',id,lease_id from public.community_notification_claim(1);
select is((select id from boundary_claim where label='recovered'),(select id from boundary_claim where label='expired'),'Expired-lease recovery reuses the original outbox job');
select isnt((select lease_id from boundary_claim where label='recovered'),(select lease_id from boundary_claim where label='expired'),'Recovered worker receives a new lease identity');
select is((select public.community_notification_prepare(id,lease_id) from boundary_claim where label='expired'),null::jsonb,'Crashed worker lease cannot dispatch after replacement');
select is((select public.community_notification_prepare(id,lease_id)->>'eventId' from boundary_claim where label='recovered'),
 (select event_id::text from boundary_reaction),'Recovered worker prepares the same opaque logical event');
select is((select count(*) from public.community_inbox_events where source_id=(select reaction_id from boundary_reaction)),1::bigint,'Worker lease recovery creates no second logical inbox event');
select public.community_notification_finish(id,lease_id,'retry') from boundary_claim where label='recovered';
update public.community_notification_outbox set next_attempt_at=now() where id=(select id from boundary_claim where label='recovered');
insert into boundary_claim select 'blocked',id,lease_id from public.community_notification_claim(1);

set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='c4100000-0000-4000-8000-000000000001';
insert into public.community_blocks(blocker_user_id,blocked_user_id) values(auth.uid(),'c4100000-0000-4000-8000-000000000002');
set local request.jwt.claim.sub='c4100000-0000-4000-8000-000000000002';
select is((select count(*) from public.community_feed(20,(select published_at from boundary_page where id='a4100000-0000-4000-8000-000000000004'),'a4100000-0000-4000-8000-000000000004')),
 0::bigint,'Old feed cursor cannot retain an audience after bilateral block');
select is((select count(*) from public.community_author_activities('c4100000-0000-4000-8000-000000000001',20,(select published_at from boundary_page where id='a4100000-0000-4000-8000-000000000004'),'a4100000-0000-4000-8000-000000000004')),
 0::bigint,'Old author cursor cannot retain an audience after bilateral block');
select is((select count(*) from public.community_get_activity('a4100000-0000-4000-8000-000000000004')),0::bigint,'Old detail identity cannot bypass bilateral block');
reset role;set local request.jwt.claim.role='service_role';
select is((select public.community_notification_prepare(id,lease_id) from boundary_claim where label='blocked'),null::jsonb,'Queued reaction is suppressed when a block intervenes after claim');
select is((select status from public.community_notification_outbox where id=(select id from boundary_claim where label='blocked')),'suppressed','Blocked delivery is terminally suppressed');

-- Separate live requests isolate missing-session/logout and Auth-deletion cases.
insert into public.community_relationships(follower_user_id,target_user_id,status)
values('c4100000-0000-4000-8000-000000000006','c4100000-0000-4000-8000-000000000004','pending');
insert into boundary_claim select 'logout',id,lease_id from public.community_notification_claim(1);
select ok((select public.community_notification_prepare(id,lease_id) is not null from boundary_claim where label='logout'),'Queued logout fixture is eligible before session revocation');
delete from auth.sessions where id='e4100000-0000-4000-8000-000000000004';
select is((select count(*) from public.community_push_tokens where user_id='c4100000-0000-4000-8000-000000000004'),1::bigint,'Logout fixture retains token to model failed device deregistration');
select is((select public.community_notification_prepare(id,lease_id) from boundary_claim where label='logout'),null::jsonb,'Missing Auth session suppresses queued delivery despite retained token');
select is((select status from public.community_notification_outbox where id=(select id from boundary_claim where label='logout')),'suppressed','Session-revoked job is terminally suppressed');
insert into public.community_relationships(follower_user_id,target_user_id,status)
values('c4100000-0000-4000-8000-000000000006','c4100000-0000-4000-8000-000000000005','pending');
insert into boundary_claim select 'deleted',id,lease_id from public.community_notification_claim(1);
select ok((select public.community_notification_prepare(id,lease_id) is not null from boundary_claim where label='deleted'),'Queued deletion fixture is eligible before account erasure');
delete from auth.users where id='c4100000-0000-4000-8000-000000000005';
select is((select public.community_notification_prepare(id,lease_id) from boundary_claim where label='deleted'),null::jsonb,'Old claimed identity cannot dispatch after recipient Auth deletion');
select is((select count(*) from public.community_notification_outbox where id=(select id from boundary_claim where label='deleted')),0::bigint,'Recipient Auth deletion removes queued outbox job');
select is((select count(*) from public.community_inbox_events where user_id='c4100000-0000-4000-8000-000000000005'),0::bigint,'Recipient Auth deletion removes logical inbox events');
select is((select count(*) from public.community_push_tokens where user_id='c4100000-0000-4000-8000-000000000005'),0::bigint,'Recipient Auth deletion removes device registry');

-- Independent author withdrawal, with the original publication tuple retained.
insert into public.workouts(id,user_id,name,started_at,completed_at,details)
values('d4100000-0000-4000-8000-000000000006','c4100000-0000-4000-8000-000000000003','Private withdrawal source',now()-interval '1 hour',now(),'{"workoutLifecycle":{"kind":"session"}}');
insert into public.shared_activities(id,user_id,source_workout_id,category,shared_day,published_at)
select 'a4100000-0000-4000-8000-000000000006','c4100000-0000-4000-8000-000000000003',
 'd4100000-0000-4000-8000-000000000006','strength',(now() at time zone 'UTC')::date::text,base+interval '0.100000 seconds' from boundary_time;
set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='c4100000-0000-4000-8000-000000000002';
select is((select count(*) from public.community_author_activities('c4100000-0000-4000-8000-000000000003',20,(select published_at from boundary_page where id='a4100000-0000-4000-8000-000000000004'),'a4100000-0000-4000-8000-000000000004')),
 1::bigint,'Independent withdrawn-author fixture is visible under the old tuple before withdrawal');
set local request.jwt.claim.sub='c4100000-0000-4000-8000-000000000003';
select public.community_withdraw_profile();
set local request.jwt.claim.sub='c4100000-0000-4000-8000-000000000002';
select is((select count(*) from public.community_author_activities('c4100000-0000-4000-8000-000000000003',20,(select published_at from boundary_page where id='a4100000-0000-4000-8000-000000000004'),'a4100000-0000-4000-8000-000000000004')),
 0::bigint,'Old author cursor cannot bypass author withdrawal');
select is((select count(*) from public.community_feed(20,(select published_at from boundary_page where id='a4100000-0000-4000-8000-000000000004'),'a4100000-0000-4000-8000-000000000004')),
 0::bigint,'Old feed cursor rechecks withdrawal after the earlier block');
select is((select count(*) from public.community_get_activity('a4100000-0000-4000-8000-000000000006')),0::bigint,'Old detail identity cannot bypass author withdrawal');

-- Always clean committed synthetic fixtures and restore every touched gate.
reset role;set local request.jwt.claim.role='service_role';
delete from auth.users where id::text like 'c4100000-%';
update public.community_operations set (enabled,enrollment,discovery,publish,engagement,delivery,cohort_required)=
 (select enabled,enrollment,discovery,publish,engagement,delivery,cohort_required from boundary_operations);
select * from finish();
commit;
