begin;
-- Synthetic fixture explicitly activates Community; production defaults stay closed.
update public.community_operations set enabled=true,enrollment=true,discovery=true,publish=true,engagement=true,cohort_required=false;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values
('c1700000-0000-4000-8000-000000000001','notify-author@mizyun.test'),
('c1700000-0000-4000-8000-000000000002','notify-friend@mizyun.test'),
('c1700000-0000-4000-8000-000000000003','notify-stranger@mizyun.test');
update public.profiles set birth_year=1990 where id::text like 'c1700000-%';
set local request.jwt.claim.role='service_role';
insert into public.community_profiles(user_id,handle,display_name,status,terms_version,terms_accepted_at,adult_declared_at) values
('c1700000-0000-4000-8000-000000000001','notify_author','Author','active','2026-09-30',now(),now()),
('c1700000-0000-4000-8000-000000000002','notify_friend','Friend','active','2026-09-30',now(),now()),
('c1700000-0000-4000-8000-000000000003','notify_stranger','Stranger','active','2026-09-30',now(),now());
insert into auth.sessions(id,user_id) values('e1700000-0000-4000-8000-000000000001','c1700000-0000-4000-8000-000000000001');
set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='c1700000-0000-4000-8000-000000000001';set local request.jwt.claims='{"role":"authenticated","session_id":"e1700000-0000-4000-8000-000000000001"}';
select lives_ok($$select public.community_notifications('registerToken','{"installationId":"d1700000-0000-4000-8000-000000000001","token":"ExpoPushToken[synthetic_notify_1234]"}')$$,'Independent device registration requires no tier request');
select throws_ok($$select * from public.community_inbox_events$$,'42501',null,'Direct inbox select cannot bypass current visibility');
select throws_ok($$select public.community_notification_claim()$$,'42501',null,'Ordinary user cannot claim delivery');
select throws_ok($$select public.community_enqueue_notification(auth.uid(),null,'moderation',null,'forged')$$,'42501',null,'Ordinary user cannot forge inbox event');
reset role;set local request.jwt.claim.role='service_role';set local request.jwt.claim.role='service_role';
insert into public.community_relationships(id,follower_user_id,target_user_id,status) values('a1700000-0000-4000-8000-000000000001','c1700000-0000-4000-8000-000000000002','c1700000-0000-4000-8000-000000000001','pending');
select is((select count(*) from public.community_inbox_events),1::bigint,'Request transaction creates one logical owner event');
set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='c1700000-0000-4000-8000-000000000001';
select public.community_notifications('registerToken','{"installationId":"d1700000-0000-4000-8000-000000000001","token":"ExpoPushToken[synthetic_notify_1234]"}');
reset role;set local request.jwt.claim.role='service_role';
select is((select count(*) from public.community_notification_outbox),1::bigint,'Foreground idempotent registration preserves queued delivery');
set local role authenticated;set local request.jwt.claim.role='authenticated';
select public.community_notifications('registerToken','{"installationId":"d1700000-0000-4000-8000-000000000001","token":"ExpoPushToken[rotated_notify_12345]"}');
reset role;set local request.jwt.claim.role='service_role';
select is((select count(*) from public.community_notification_outbox),1::bigint,'Same-owner token rotation preserves authorized pending event');

select public.community_enqueue_notification('c1700000-0000-4000-8000-000000000001','c1700000-0000-4000-8000-000000000002','request','a1700000-0000-4000-8000-000000000001','request:a1700000-0000-4000-8000-000000000001');
select is((select count(*) from public.community_inbox_events),1::bigint,'Lost response/replayed trigger keeps one logical event');
create temporary table notify_claims as select * from public.community_notification_claim();
grant select on notify_claims to authenticated;
select is((select count(*) from public.community_notification_claim()),0::bigint,'Concurrent second claim cannot steal unexpired lease');
select is((select public.community_notification_prepare(id,lease_id) from notify_claims),null::jsonb,'Database delivery defaults closed even for active worker');
update public.community_operations set delivery=true;
update public.community_notification_outbox set next_attempt_at=now();
truncate notify_claims;insert into notify_claims select * from public.community_notification_claim();
select ok((select public.community_notification_prepare(id,lease_id) ? 'token' from notify_claims),'Enabled eligible session prepares a generic opaque notification');
select public.community_notification_finish(id,lease_id,'retry') from notify_claims;
select is((select status from public.community_notification_outbox),'pending','Lost push response is retried with same logical event');
set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='c1700000-0000-4000-8000-000000000003';
select is(jsonb_array_length(public.community_notifications('inbox')->'items'),0,'Stranger cannot read known recipient inbox');
select is(public.community_notifications('resolve',jsonb_build_object('id',(select id from notify_claims))),null::jsonb,'Claim/outbox IDs grant no capability');
set local request.jwt.claim.sub='c1700000-0000-4000-8000-000000000001';
select is(jsonb_array_length(public.community_notifications('inbox')->'items'),1,'Owner reads current request');
select public.community_notifications('savePreferences','{"requests":false,"reactions":true,"moderation":true,"muted":false,"timezone":"UTC","quietHours":null}');
reset role;set local request.jwt.claim.role='service_role';update public.community_notification_outbox set next_attempt_at=now(),lease_until=null;
truncate notify_claims;insert into notify_claims select * from public.community_notification_claim();
select is((select public.community_notification_prepare(id,lease_id) from notify_claims),null::jsonb,'Category opt out suppresses queued delivery');
select is((select status from public.community_notification_outbox),'suppressed','Opt out permanently retires pending job');
update public.community_relationships set status='approved' where id='a1700000-0000-4000-8000-000000000001';
insert into public.workouts(id,user_id,name,started_at,completed_at,details) values('d1700000-0000-4000-8000-000000000002','c1700000-0000-4000-8000-000000000001','Private source',now()-interval '1 hour',now(),'{"workoutLifecycle":{"kind":"session"}}');
set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='c1700000-0000-4000-8000-000000000001';
select * from public.community_publish_activity('d1700000-0000-4000-8000-000000000002','strength',(now() at time zone 'UTC')::date::text,null,1,'d1700000-0000-4000-8000-000000000003',0,false);
reset role;set local request.jwt.claim.role='service_role';set local request.jwt.claim.role='service_role';
insert into public.community_reactions(id,activity_id,user_id,reaction) select 'a1700000-0000-4000-8000-000000000002',id,'c1700000-0000-4000-8000-000000000002','clap' from public.shared_activities where user_id='c1700000-0000-4000-8000-000000000001';
create temporary table first_reaction as select id from public.community_inbox_events where kind='reaction';
select ok((select public.community_notification_visible(e) from public.community_inbox_events e where id=(select id from first_reaction)),'Fresh reaction visible');
update public.shared_activities set version=version+1 where user_id='c1700000-0000-4000-8000-000000000001';
insert into public.community_reactions(activity_id,user_id,reaction) select id,'c1700000-0000-4000-8000-000000000002','clap' from public.shared_activities where user_id='c1700000-0000-4000-8000-000000000001';
select is((select public.community_notification_visible(e) from public.community_inbox_events e where id=(select id from first_reaction)),false,'Refreshing then reacting cannot revive old version event');
select is((select count(*) from public.community_inbox_events where kind='reaction'),2::bigint,'Fresh immutable reaction gets its own logical event');
update public.community_notification_outbox set next_attempt_at=now(),lease_until=null where event_id=(select id from first_reaction);
truncate notify_claims;insert into notify_claims select * from public.community_notification_claim();
select public.community_notification_prepare(id,lease_id) from notify_claims;
select is((select status from public.community_notification_outbox where event_id=(select id from first_reaction)),'suppressed','Old version queued push stays suppressed');
-- Exact provider acknowledgement cannot invalidate a subsequently rotated token.
create temporary table receipt_job as select o.id,o.lease_id from public.community_notification_outbox o join public.community_inbox_events e on e.id=o.event_id where e.kind='reaction' and e.id<>(select id from first_reaction);
select public.community_notification_finish(id,lease_id,'accepted','synthetic-receipt') from receipt_job;
update public.community_notification_outbox set receipt_due_at=now()-interval '1 second' where id=(select id from receipt_job);
select is((select count(*) from public.community_notification_receipts()),1::bigint,'Accepted push ticket is separately eligible for receipt polling');
select public.community_notification_receipt_finish((select id from receipt_job),'wrong-receipt','invalid');
select is((select receipt_status from public.community_notification_outbox where id=(select id from receipt_job)),null::text,'Wrong receipt cannot acknowledge or revoke a registration');
set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='c1700000-0000-4000-8000-000000000001';
select public.community_notifications('registerToken','{"installationId":"d1700000-0000-4000-8000-000000000001","token":"ExpoPushToken[fresh_token_after_send]"}');
reset role;set local request.jwt.claim.role='service_role';
select public.community_notification_receipt_finish((select id from receipt_job),'synthetic-receipt','invalid');
select is((select count(*) from public.community_push_tokens),1::bigint,'Old receipt cannot delete newly rotated token');
-- Simulate synchronous late invalid response on an in-flight lease after rotation.
update public.community_notification_outbox set status='pending',lease_until=now()+interval '30 seconds' where id=(select id from receipt_job);
select public.community_notification_finish(id,lease_id,'invalid') from receipt_job;
select is((select count(*) from public.community_push_tokens),1::bigint,'Old synchronous invalid response cannot delete newly rotated token');
-- Global freeze must preserve reductions and deny new growth directly in SQL.
update public.community_operations set enabled=false;
select throws_ok($$insert into public.community_reactions(activity_id,user_id,reaction) select id,'c1700000-0000-4000-8000-000000000003','clap' from public.shared_activities$$,'P0001','community_unavailable','Freeze stops new engagement through direct DB');
select lives_ok($$delete from public.community_reactions where user_id='c1700000-0000-4000-8000-000000000002'$$,'Freeze permits unreact safety reduction');
set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='c1700000-0000-4000-8000-000000000001';
select throws_ok($$select * from public.community_handle_available('not_claimed')$$,'P0001','community_unavailable','Direct discovery cannot bypass global freeze');
select lives_ok($$select public.community_withdraw_profile()$$,'Freeze preserves withdrawal');
reset role;set local request.jwt.claim.role='service_role';
select is((select count(*) from public.beta_pro_requests where user_id='c1700000-0000-4000-8000-000000000001'),0::bigint,'Community token did not submit Beta Pro request');

delete from public.community_inbox_events where dedupe_key='request:a1700000-0000-4000-8000-000000000001';
select public.community_enqueue_notification('c1700000-0000-4000-8000-000000000001','c1700000-0000-4000-8000-000000000002','request','a1700000-0000-4000-8000-000000000001','request:a1700000-0000-4000-8000-000000000001');
select is((select count(*) from public.community_inbox_events where dedupe_key='request:a1700000-0000-4000-8000-000000000001'),0::bigint,'Inbox deletion cannot recreate retained logical dedupe key');
select * from finish();rollback;

