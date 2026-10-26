begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
insert into auth.users(id,email) values
 ('a2540000-0000-4000-8000-000000000001','refine-owner@mizyun.test'),
 ('a2540000-0000-4000-8000-000000000002','refine-other@mizyun.test'),
 ('a2540000-0000-4000-8000-000000000003','cost-third@mizyun.test'),
 ('a2540000-0000-4000-8000-000000000004','cost-fourth@mizyun.test');

select ok(not has_function_privilege('authenticated','public.ai_charge_refine(uuid,date,integer)','EXECUTE'),'Authenticated clients cannot charge refines');
select ok(not has_function_privilege('anon','public.ai_charge_refine(uuid,date,integer)','EXECUTE'),'Anonymous clients cannot charge refines');
select ok(has_function_privilege('service_role','public.ai_charge_refine(uuid,date,integer)','EXECUTE'),'Service role can charge refines');

select is((select allowed from public.ai_charge_refine('a2540000-0000-4000-8000-000000000001','2026-10-26',2)),true,'First refine is admitted');
select is((select refines_used from public.ai_charge_refine('a2540000-0000-4000-8000-000000000001','2026-10-26',2)),2,'Second refine is admitted and counted');
select is((select allowed from public.ai_charge_refine('a2540000-0000-4000-8000-000000000001','2026-10-26',2)),false,'Third refine over the daily cap is denied');
select ok((select retry_after from public.ai_charge_refine('a2540000-0000-4000-8000-000000000001','2026-10-26',2)) >= 1,'Denial carries a positive retry-after');
select is((select refines_used from public.ai_daily_draft_ledger where user_id='a2540000-0000-4000-8000-000000000001' and day='2026-10-26'),2,'Denials do not charge');
select is((select drafts_used + reserved_drafts from public.ai_daily_draft_ledger where user_id='a2540000-0000-4000-8000-000000000001' and day='2026-10-26'),0,'Refines leave the draft count untouched');
select is((select allowed from public.ai_charge_refine('a2540000-0000-4000-8000-000000000001','2026-10-27',2)),true,'A new UTC day starts a new count');
select is((select allowed from public.ai_charge_refine('a2540000-0000-4000-8000-000000000002','2026-10-26',2)),true,'Another user has an independent count');
select is((select allowed from public.ai_charge_refine('a2540000-0000-4000-8000-000000000002','2026-10-26',0)),false,'A zero budget denies');
select is((select refines_used from public.ai_daily_draft_ledger where user_id='a2540000-0000-4000-8000-000000000002' and day='2026-10-26'),1,'A zero budget does not charge');
select ok((select relrowsecurity from pg_class where oid='public.ai_daily_draft_ledger'::regclass),'Draft ledger keeps RLS');

-- Cost allowance
select ok(not has_function_privilege('authenticated','public.ai_reserve_cost(uuid,date,bigint,bigint,bigint)','EXECUTE'),'Authenticated clients cannot reserve cost');
select ok(not has_function_privilege('authenticated','public.ai_settle_cost(uuid,date,bigint,bigint)','EXECUTE'),'Authenticated clients cannot settle cost');
select ok(not has_function_privilege('anon','public.ai_settle_cost(uuid,date,bigint,bigint)','EXECUTE'),'Anonymous clients cannot settle cost');
select ok(has_function_privilege('service_role','public.ai_reserve_cost(uuid,date,bigint,bigint,bigint)','EXECUTE'),'Service role can reserve cost');
select ok(not has_table_privilege('authenticated','public.ai_daily_cost_ledger','SELECT'),'Clients cannot read the cost ledger directly');
select ok((select relrowsecurity from pg_class where oid='public.ai_daily_cost_ledger'::regclass),'Cost ledger enables RLS');

select is((select allowed from public.ai_reserve_cost('a2540000-0000-4000-8000-000000000001','2026-10-26',100,1000,40)),true,'First call under the daily allowance is admitted');
select is((select reserved_micros from public.ai_daily_cost_ledger where user_id='a2540000-0000-4000-8000-000000000001' and day='2026-10-26'),40::bigint,'Admission reserves the estimate');
select is((select allowed from public.ai_reserve_cost('a2540000-0000-4000-8000-000000000001','2026-10-26',100,1000,40)),true,'A second call is admitted while under the allowance');
select lives_ok($$select public.ai_settle_cost('a2540000-0000-4000-8000-000000000001','2026-10-26',40,70)$$,'Settling records the actual cost');
select is((select used_micros::int || '/' || reserved_micros::int from public.ai_daily_cost_ledger where user_id='a2540000-0000-4000-8000-000000000001' and day='2026-10-26'),'70/40','Settle adds the actual cost and releases the reservation');
select lives_ok($$select public.ai_settle_cost('a2540000-0000-4000-8000-000000000001','2026-10-26',40,0)$$,'Releasing a failed call charges nothing');
select is((select used_micros::int || '/' || reserved_micros::int from public.ai_daily_cost_ledger where user_id='a2540000-0000-4000-8000-000000000001' and day='2026-10-26'),'70/0','Release leaves the used amount unchanged');
select is((select allowed from public.ai_reserve_cost('a2540000-0000-4000-8000-000000000001','2026-10-26',100,1000,40)),true,'A call at 70 of 100 is admitted');
select lives_ok($$select public.ai_settle_cost('a2540000-0000-4000-8000-000000000001','2026-10-26',40,45)$$,'One call may overshoot the day');
select is((select scope from public.ai_reserve_cost('a2540000-0000-4000-8000-000000000001','2026-10-26',100,1000,40)),'day','A spent day is denied with day scope');
select ok((select retry_after from public.ai_reserve_cost('a2540000-0000-4000-8000-000000000001','2026-10-26',100,1000,40)) >= 1,'Day denial carries retry-after');

-- Month: earlier days of the same calendar month count; another month does not.
insert into public.ai_daily_cost_ledger(user_id,day,used_micros,reserved_micros) values
 ('a2540000-0000-4000-8000-000000000002','2026-10-01',600,0),
 ('a2540000-0000-4000-8000-000000000002','2026-10-02',400,500),
 ('a2540000-0000-4000-8000-000000000002','2026-09-30',5000,0);
select is((select scope from public.ai_reserve_cost('a2540000-0000-4000-8000-000000000002','2026-10-20',100,1000,10)),'month','A spent month is denied with month scope even on a fresh day');
select is((select reserved_micros from public.ai_daily_cost_ledger where user_id='a2540000-0000-4000-8000-000000000002' and day='2026-10-20'),0::bigint,'A denial reserves nothing');
select is((select allowed from public.ai_reserve_cost('a2540000-0000-4000-8000-000000000002','2026-11-01',100,1000,10)),true,'A new month renews the allowance');
update public.ai_daily_cost_ledger set used_micros = 300 where user_id='a2540000-0000-4000-8000-000000000002' and day='2026-10-01';
select is((select allowed from public.ai_reserve_cost('a2540000-0000-4000-8000-000000000002','2026-10-20',100,1000,10)),true,'Stale reservations of earlier days do not count against the month');
select is((select allowed from public.ai_reserve_cost('a2540000-0000-4000-8000-000000000002','2026-10-21',0,1000,10)),false,'A zero allowance denies');

-- Today's open reservation counts toward the month, and retry-after is bounded.
insert into public.ai_daily_cost_ledger(user_id,day,used_micros) values
 ('a2540000-0000-4000-8000-000000000003',date_trunc('month', now())::date,900);
select is((select allowed from public.ai_reserve_cost('a2540000-0000-4000-8000-000000000003',timezone('utc', now())::date + case when extract(day from now()) = 1 then 1 else 0 end,1000,1000,200)),true,'A call under the month is admitted and reserved');
select is((select scope from public.ai_reserve_cost('a2540000-0000-4000-8000-000000000003',timezone('utc', now())::date + case when extract(day from now()) = 1 then 1 else 0 end,1000,1000,200)),'month','Today''s reservation counts toward the month');
select ok((select retry_after between 1 and 31*86400 from public.ai_reserve_cost('a2540000-0000-4000-8000-000000000003',timezone('utc', now())::date + case when extract(day from now()) = 1 then 1 else 0 end,1000,1000,200)),'Month retry-after reaches at most the next month');
select is((select allowed from public.ai_reserve_cost('a2540000-0000-4000-8000-000000000004',timezone('utc', now())::date,100,100000,0)),true,'A fresh day for another user is open');
select lives_ok($$select public.ai_settle_cost('a2540000-0000-4000-8000-000000000004',timezone('utc', now())::date,0,150)$$,'Spend the current day');
select ok((select retry_after between 1 and 86400 from public.ai_reserve_cost('a2540000-0000-4000-8000-000000000004',timezone('utc', now())::date,100,100000,0)),'Day retry-after reaches at most the next midnight');
delete from auth.users where id='a2540000-0000-4000-8000-000000000002';
select is((select count(*) from public.ai_daily_cost_ledger where user_id='a2540000-0000-4000-8000-000000000002'),0::bigint,'Auth erasure cascades the cost ledger');

select * from finish();
rollback;
