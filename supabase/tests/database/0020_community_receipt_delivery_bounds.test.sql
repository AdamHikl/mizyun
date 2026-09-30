begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
update public.community_operations set enabled=true,enrollment=true,discovery=true,publish=true,engagement=true,delivery=true,cohort_required=false;
insert into auth.users(id,email) values
('c2000000-0000-4000-8000-000000000001','bounds-reader@mizyun.test'),
('c2000000-0000-4000-8000-000000000002','bounds-author@mizyun.test'),
('c2000000-0000-4000-8000-000000000003','bounds-stranger@mizyun.test');
update public.profiles set birth_year=1990 where id::text like 'c2000000-%';
set local request.jwt.claim.role='service_role';
insert into public.community_profiles(user_id,handle,display_name,is_searchable,status,terms_version,terms_accepted_at,adult_declared_at)
select id,'bounds_'||right(id::text,12),'Synthetic member',true,'active','2026-09-30',now(),now()
from auth.users where id::text like 'c2000000-%';
create temporary table bounds_state(receipt uuid,activity uuid,activity_receipt uuid,event uuid);
grant all on bounds_state to authenticated;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='c2000000-0000-4000-8000-000000000001';
insert into bounds_state(receipt) select id from public.community_issue_report_receipt('profile','c2000000-0000-4000-8000-000000000002');
reset role;
update public.community_report_receipts set expires_at=now()+interval '29 days' where id=(select receipt from bounds_state);
set local role authenticated;
select is((select id from public.community_issue_report_receipt('profile','c2000000-0000-4000-8000-000000000002')),(select receipt from bounds_state),'Identical evidence reuses the owned receipt ID');
select is((select count(*) from public.community_report_receipts_for_caller()),1::bigint,'Repeated explicit issuance retains one snapshot');
reset role;
select is((select expires_at from public.community_report_receipts where id=(select receipt from bounds_state)),now()+interval '29 days','Dedupe never extends an existing receipt expiry');
update public.community_profiles set display_name='Changed visible name' where user_id='c2000000-0000-4000-8000-000000000002';
set local role authenticated;
select isnt((select id from public.community_issue_report_receipt('profile','c2000000-0000-4000-8000-000000000002')),(select receipt from bounds_state),'Changed visible evidence gets a separate receipt');
reset role;
set local request.jwt.claim.role='service_role';
insert into public.community_relationships(follower_user_id,target_user_id,status)
values('c2000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000002','pending');
-- Synthetic alternate snapshots fill the actual daily insertion boundary.
insert into public.community_report_receipts(user_id,target_type,target_id,subject_user_id,evidence_snapshot)
select 'c2000000-0000-4000-8000-000000000001','profile','c2000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002',jsonb_build_object('synthetic',n)
from generate_series(1,118) n;
select is((select count(*) from public.community_report_receipts where user_id='c2000000-0000-4000-8000-000000000001'),120::bigint,'Daily owner issuance is bounded at120');
update public.community_profiles set display_name='New evidence at quota' where user_id='c2000000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claim.role='authenticated';
select throws_ok($$select * from public.community_issue_report_receipt('profile','c2000000-0000-4000-8000-000000000002')$$,'P0001','community_rate_limited','New explicit issuance fails at the owner bound');
select lives_ok($$select * from public.community_submit_report('profile','c2000000-0000-4000-8000-000000000002','harassment','Existing evidence remains usable',(select receipt from bounds_state))$$,'Existing receipt-backed report stays available at issuance limit');
select lives_ok($$insert into public.community_blocks(blocker_user_id,blocked_user_id) values(auth.uid(),'c2000000-0000-4000-8000-000000000002')$$,'Blocking remains available at issuance limit');
select is((select count(*) from public.community_relationships where follower_user_id=auth.uid()),0::bigint,'Block removes real pending edge while automatic receipt capture is bounded');
select lives_ok($$select public.community_withdraw_profile()$$,'Withdrawal remains available at issuance limit');
reset role;
-- All automatic mint paths use the same guard and cannot abort privacy cleanup.
select lives_ok($$insert into public.community_report_receipts(user_id,target_type,target_id,subject_user_id,evidence_snapshot) values('c2000000-0000-4000-8000-000000000001','profile','c2000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002','{"synthetic":"automatic over limit"}')$$,'Automatic capture skips new evidence without throwing');
select is((select count(*) from public.community_report_receipts where user_id='c2000000-0000-4000-8000-000000000001'),120::bigint,'Skipped automatic capture cannot grow evidence storage');
-- Distinct older receipts reach the active-owner cap independently of daily use.
insert into public.community_report_receipts(user_id,target_type,target_id,subject_user_id,evidence_snapshot,created_at)
select 'c2000000-0000-4000-8000-000000000003','profile','c2000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002',jsonb_build_object('syntheticOlder',n),now()-interval '1 day'
from generate_series(1,1001) n;
select is((select count(*) from public.community_report_receipts where user_id='c2000000-0000-4000-8000-000000000003'),1000::bigint,'Total active receipts are bounded independently of UTC-day count');
select ok(not has_function_privilege('authenticated','public.community_report_receipt_bounds()','EXECUTE'),'Caller cannot invoke internal receipt guard');
-- Fresh reaction events become unavailable at card expiry even before purge runs.
select * from public.community_withdrawal_batch('c2000000-0000-4000-8000-000000000001',1);
delete from public.community_blocks where blocker_user_id='c2000000-0000-4000-8000-000000000001';
set local role authenticated;
select * from public.community_save_profile('bounds_000000000001','Synthetic member','SM',null,true,true,'2026-09-30');
reset role;
set local request.jwt.claim.role='service_role';
insert into public.community_relationships(follower_user_id,target_user_id,status) values('c2000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000002','approved');
insert into public.workouts(id,user_id,name,started_at,completed_at,details) values('d2000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000002','Private fixture',now()-interval '1 hour',now(),'{"workoutLifecycle":{"kind":"session"}}');
insert into public.shared_activities(user_id,source_workout_id,category,shared_day,enrollment_generation)
values('c2000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000001','strength',(now() at time zone 'UTC')::date::text,1) returning id;
update bounds_state set activity=(select id from public.shared_activities where source_workout_id='d2000000-0000-4000-8000-000000000001');
-- Retire only service-seeded quota fillers for this independent visibility test.
delete from public.community_report_receipts where user_id='c2000000-0000-4000-8000-000000000001' and evidence_snapshot ? 'synthetic';
set local role authenticated;
set local request.jwt.claim.role='authenticated';
select lives_ok($$update bounds_state set activity_receipt=(select id from public.community_issue_report_receipt('activity',(select activity::text from bounds_state)))$$,'Visible activity evidence issues a real receipt without ambiguous id references');
select ok((select activity_receipt is not null from bounds_state),'Activity receipt is an actual issued opaque ID');
reset role;
set local request.jwt.claim.role='service_role';
select ok((select not evidence_snapshot ? 'sourceWorkoutId' and not evidence_snapshot ? 'source_workout_id' from public.community_report_receipts where id=(select activity_receipt from bounds_state)),'Activity evidence omits private workout linkage');
insert into auth.sessions(id,user_id) values('e2000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002');
insert into public.community_push_tokens(installation_id,user_id,token,session_id,generation)
values('f2000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002','ExpoPushToken[bounds_synthetic_token]','e2000000-0000-4000-8000-000000000002',1);
insert into public.community_reactions(activity_id,user_id,reaction) select activity,'c2000000-0000-4000-8000-000000000001','clap' from bounds_state;
update bounds_state set event=(select id from public.community_inbox_events where kind='reaction' and target_id=(select activity from bounds_state));
update public.community_inbox_events set created_at=now()-interval '1 hour' where id=(select event from bounds_state);
update public.community_notification_outbox set next_attempt_at=now()+interval '1 hour' where event_id=(select event from bounds_state);
select is((public.community_operations_metrics()->>'oldestQueueSeconds')::bigint,3600::bigint,'Queue age uses original event time even with future retry readiness');
select is((public.community_operations_metrics()->>'readyDelivery')::bigint,0::bigint,'Delayed jobs are counted separately from ready delivery');
update public.community_notification_outbox set next_attempt_at=now() where event_id=(select event from bounds_state);
select ok((select public.community_notification_visible(e) from public.community_inbox_events e where id=(select event from bounds_state)),'Fresh reaction remains visible');
update public.shared_activities set published_at=now()-interval '365 days' where id=(select activity from bounds_state);
select is((select count(*) from public.community_reactions where activity_id=(select activity from bounds_state)),1::bigint,'Expired-card fixture retains its physical reaction before purge');
select is((select public.community_notification_visible(e) from public.community_inbox_events e where id=(select event from bounds_state)),false,'Publication expiry immediately denies old reaction event');
create temporary table bounds_claim as select * from public.community_notification_claim();
select is((select public.community_notification_prepare(id,lease_id) from bounds_claim),null::jsonb,'Expired reaction cannot be prepared for external delivery');
select is((select status from public.community_notification_outbox where event_id=(select event from bounds_state)),'suppressed','Expired reaction retires its pending delivery');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='c2000000-0000-4000-8000-000000000002';
select is(jsonb_array_length(public.community_notifications('inbox')->'items'),0,'Expired reaction disappears from owner inbox before cleanup');
select is(public.community_notifications('resolve',jsonb_build_object('id',(select event from bounds_state))),null::jsonb,'Expired reaction tap grants no destination');
select ok(not has_function_privilege('authenticated','public.community_notification_visible(public.community_inbox_events)','EXECUTE'),'Caller cannot invoke worker visibility helper directly');
reset role;
select * from finish();
rollback;
