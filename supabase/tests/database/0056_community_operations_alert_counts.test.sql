begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email)
select ('c5600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'alert-counts-'||n||'@mizyun.test' from generate_series(1,3) n;
set local request.jwt.claim.role='service_role';
-- Deltas from a baseline keep the test independent of other fixtures in the same database.
create temporary table alert_baseline as select public.community_operations_alert_counts(3900) c;
insert into public.community_reports(reporter_user_id,target_type,target_id,reason,status,priority,created_at) values
('c5600000-0000-4000-8000-000000000001','profile','c5600000-0000-4000-8000-000000000002','harassment','submitted','urgent',now()-interval '10 minutes'),
('c5600000-0000-4000-8000-000000000001','profile','c5600000-0000-4000-8000-000000000003','harassment','submitted','urgent',now()-interval '5 hours'),
('c5600000-0000-4000-8000-000000000002','profile','c5600000-0000-4000-8000-000000000003','spam','submitted','normal',now()-interval '23 hours'),
('c5600000-0000-4000-8000-000000000003','profile','c5600000-0000-4000-8000-000000000001','spam','submitted','normal',now()-interval '25 hours'),
('c5600000-0000-4000-8000-000000000003','profile','c5600000-0000-4000-8000-000000000002','harassment','under_review','urgent',now()-interval '8 days'),
('c5600000-0000-4000-8000-000000000002','profile','c5600000-0000-4000-8000-000000000001','spam','resolved','normal',now()-interval '30 days');
insert into public.community_withdrawal_jobs(user_id,generation,requested_at) values
('c5600000-0000-4000-8000-000000000001',91,now()-interval '25 hours'),
('c5600000-0000-4000-8000-000000000002',91,now()-interval '1 hour');
insert into public.community_withdrawal_jobs(user_id,generation,requested_at,completed_at) values
('c5600000-0000-4000-8000-000000000003',91,now()-interval '40 days',now()-interval '39 days');
create temporary table alert_now as select public.community_operations_alert_counts(3900) c;
create function pg_temp.delta(k text) returns bigint language sql as $$select (select (c->>k)::bigint from alert_now)-(select (c->>k)::bigint from alert_baseline)$$;
select is(pg_temp.delta('openReports'),5::bigint,'Open counts submitted and under-review cases only');
select is(pg_temp.delta('unclaimedReports'),4::bigint,'Unclaimed counts submitted cases only');
select is(pg_temp.delta('urgentUnclaimed'),2::bigint,'Claimed urgent cases leave the urgent-unclaimed alert');
select is(pg_temp.delta('overdueFirstResponse'),2::bigint,'Urgent after four hours and normal after 24 hours are overdue');
select is(pg_temp.delta('staleOpenReports'),1::bigint,'Open cases older than seven days need weekly review');
select is(pg_temp.delta('newReports'),1::bigint,'Only reports inside the window count as new');
select ok((select (c->>'oldestUnclaimedSeconds')::bigint from alert_now)>=25*3600,'Oldest unclaimed age is measured from server receipt');
select is(pg_temp.delta('pendingWithdrawals'),2::bigint,'Completed withdrawal generations are not pending');
select ok((select (c->>'oldestWithdrawalSeconds')::bigint from alert_now)>=25*3600,'Oldest pending withdrawal age is reported');
select ok((select c from alert_now)::text !~ 'c5600000','Counts never expose user or report identifiers');
set local role service_role;
select lives_ok($$select public.community_operations_alert_counts(3900)$$,'The service role may read operator counts');
reset role;
select throws_ok($$select public.community_operations_alert_counts(10)$$,'P0001','community_conflict','A window below one minute is rejected');
select throws_ok($$select public.community_operations_alert_counts(null)$$,'P0001','community_conflict','A null window is rejected');
set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='c5600000-0000-4000-8000-000000000001';
select throws_ok($$select public.community_operations_alert_counts(3900)$$,'42501',null,'Ordinary users cannot read operator counts');
reset role;set local role anon;
select throws_ok($$select public.community_operations_alert_counts(3900)$$,'42501',null,'Anonymous callers cannot read operator counts');
reset role;
select * from finish();
rollback;
