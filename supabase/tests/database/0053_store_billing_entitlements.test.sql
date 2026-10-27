begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values
  ('f3320000-0000-4000-8000-000000000001','billing-a@mizyun.test'),
  ('f3320000-0000-4000-8000-000000000002','billing-b@mizyun.test'),
  ('f3320000-0000-4000-8000-000000000003','billing-c@mizyun.test');

-- Shape, RLS and grants.
select ok((select relrowsecurity from pg_class where oid='public.subscription_entitlements'::regclass),'RLS on subscription_entitlements');
select ok((select relrowsecurity from pg_class where oid='public.billing_webhook_events'::regclass),'RLS on billing_webhook_events');
select ok(exists(select 1 from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=i.indkey[0]
  where i.indrelid='public.subscription_entitlements'::regclass and i.indisprimary and a.attname='user_id'),'user_id is the indexed primary key');
select ok(has_table_privilege('authenticated','public.subscription_entitlements','SELECT'),'Owner can read entitlements');
select ok(not has_table_privilege('authenticated','public.subscription_entitlements','INSERT'),'No client insert');
select ok(not has_table_privilege('authenticated','public.subscription_entitlements','UPDATE'),'No client update');
select ok(not has_table_privilege('authenticated','public.subscription_entitlements','DELETE'),'No client delete');
select ok(not has_table_privilege('anon','public.subscription_entitlements','SELECT'),'Anon cannot read entitlements');
select ok(not has_table_privilege('authenticated','public.billing_webhook_events','SELECT'),'Clients cannot read the webhook ledger');
select ok(not has_table_privilege('anon','public.billing_webhook_events','INSERT'),'Anon cannot write the webhook ledger');
select ok(not has_function_privilege('authenticated','public.billing_apply_entitlement(uuid,text,text,text,text,text,boolean,boolean,boolean,timestamptz,timestamptz,text)','EXECUTE'),'Clients cannot apply entitlements');
select ok(not has_function_privilege('anon','public.billing_apply_entitlement(uuid,text,text,text,text,text,boolean,boolean,boolean,timestamptz,timestamptz,text)','EXECUTE'),'Anon cannot apply entitlements');
select ok(not has_function_privilege('authenticated','public.billing_recompute_plan_tier(uuid,boolean)','EXECUTE'),'Clients cannot recompute plan_tier');
select ok(not has_function_privilege('authenticated','public.billing_claim_webhook_event(text,text)','EXECUTE'),'Clients cannot claim webhook events');
select ok(has_function_privilege('service_role','public.billing_apply_entitlement(uuid,text,text,text,text,text,boolean,boolean,boolean,timestamptz,timestamptz,text)','EXECUTE'),'Service role applies entitlements');
select ok((select prosecdef from pg_proc where oid='public.billing_recompute_plan_tier(uuid,boolean)'::regprocedure),'Recompute is SECURITY DEFINER');
select is((select proconfig from pg_proc where oid='public.billing_apply_entitlement(uuid,text,text,text,text,text,boolean,boolean,boolean,timestamptz,timestamptz,text)'::regprocedure),array['search_path=""'],'Apply pins an empty search_path');

-- Service role: purchase sets paid.
set local role service_role;
set local request.jwt.claim.role='service_role';
select is((select applied::text||' '||plan_tier from public.billing_apply_entitlement('f3320000-0000-4000-8000-000000000001','pro','active','mizyun_pro_yearly','app_store','production',true,true,false,now()+interval '14 days','2026-10-26 12:00+00','evt-1')),'true paid','Active entitlement sets paid');
select is((select plan_tier from public.profiles where id='f3320000-0000-4000-8000-000000000001'),'paid','Profile is paid');
select is((select plan_tier from public.profiles where id='f3320000-0000-4000-8000-000000000002'),'free','Other user stays free');

-- An older snapshot never overwrites a newer one.
select is((select applied::text||' '||plan_tier from public.billing_apply_entitlement('f3320000-0000-4000-8000-000000000001','pro','expired',null,null,null,false,false,false,null,'2026-10-26 11:00+00','evt-old')),'false paid','Older snapshot is ignored');
select is((select last_event_id from public.subscription_entitlements where user_id='f3320000-0000-4000-8000-000000000001'),'evt-1','Row still reflects the newer snapshot');

-- Expiry and refund clear paid.
select is((select applied::text||' '||plan_tier from public.billing_apply_entitlement('f3320000-0000-4000-8000-000000000001','pro','expired','mizyun_pro_yearly','app_store','production',false,false,false,now()-interval '1 minute','2026-10-26 13:00+00','evt-2')),'true free','Expired entitlement clears paid');
-- An "active" row whose period already ended does not grant paid.
select is((select plan_tier from public.billing_apply_entitlement('f3320000-0000-4000-8000-000000000001','pro','active','mizyun_pro_yearly','app_store','production',false,true,false,now()-interval '1 second','2026-10-26 14:00+00',null)),'free','Lapsed active row stays free');
select is((select last_event_id from public.subscription_entitlements where user_id='f3320000-0000-4000-8000-000000000001'),'evt-2','A sync without an event keeps the last event id');
select throws_ok($$select * from public.billing_apply_entitlement('f3320000-0000-4000-8000-000000000001','pro','expired',null,null,null,true,false,false,null,'2026-10-26 15:00+00',null)$$,'23514',null,'Expired rows cannot claim a trial');
select throws_ok($$select * from public.billing_apply_entitlement('f3320000-0000-4000-8000-000000000001','pro','paid',null,null,null,false,false,false,null,'2026-10-26 15:00+00',null)$$,'23514',null,'Unknown status rejected');

-- Unknown accounts are not created.
select is((select applied::text||' '||coalesce(plan_tier,'none') from public.billing_apply_entitlement('f3320000-0000-4000-8000-0000000000ff','pro','active',null,null,null,false,true,false,now()+interval '1 day','2026-10-26 12:00+00',null)),'false none','Unknown user is skipped');
select is((select count(*) from public.subscription_entitlements where user_id='f3320000-0000-4000-8000-0000000000ff'),0::bigint,'No row for unknown user');

-- Beta Pro and subscription combine.
select is((select plan_tier from public.billing_apply_entitlement('f3320000-0000-4000-8000-000000000002','pro','active','mizyun_pro_monthly','play_store','production',false,true,false,now()+interval '30 days','2026-10-26 12:00+00','evt-b')),'paid','B subscribes');
reset role;
insert into public.beta_pro_requests(user_id,email,status) values
  ('f3320000-0000-4000-8000-000000000002','billing-b@mizyun.test','pending'),
  ('f3320000-0000-4000-8000-000000000003','billing-c@mizyun.test','pending');
update public.beta_pro_requests set status='approved' where user_id='f3320000-0000-4000-8000-000000000002';
update public.beta_pro_requests set status='rejected' where user_id='f3320000-0000-4000-8000-000000000002';
select is((select plan_tier from public.profiles where id='f3320000-0000-4000-8000-000000000002'),'paid','Rejecting Beta Pro keeps an active subscription paid');
update public.beta_pro_requests set status='approved' where user_id='f3320000-0000-4000-8000-000000000003';
set local role service_role;
set local request.jwt.claim.role='service_role';
select is((select plan_tier from public.billing_apply_entitlement('f3320000-0000-4000-8000-000000000003','pro','expired',null,null,null,false,false,false,null,'2026-10-26 12:00+00','evt-c')),'paid','Subscription expiry keeps an approved Beta Pro pass paid');

-- A paid tier granted directly by an operator survives a sync that finds no
-- purchase, and ends only after a subscription that granted paid ends.
reset role;
insert into auth.users(id,email) values ('f3320000-0000-4000-8000-000000000004','billing-d@mizyun.test');
update public.profiles set plan_tier='paid' where id='f3320000-0000-4000-8000-000000000004';
set local role service_role;
set local request.jwt.claim.role='service_role';
select is((select applied::text||' '||plan_tier from public.billing_apply_entitlement('f3320000-0000-4000-8000-000000000004','pro','expired',null,null,null,false,false,false,null,'2026-10-26 12:00+00',null)),'true paid','Sync without a purchase keeps a manual paid grant');
select is((select plan_tier from public.billing_apply_entitlement('f3320000-0000-4000-8000-000000000004','pro','expired',null,null,null,false,false,false,null,'2026-10-26 12:01+00',null)),'paid','Repeated empty syncs keep it');
select is((select plan_tier from public.billing_apply_entitlement('f3320000-0000-4000-8000-000000000004','pro','active','mizyun_pro_monthly','app_store','production',false,true,false,now()+interval '30 days','2026-10-26 12:02+00','evt-d1')),'paid','Subscribing keeps paid');
select is((select plan_tier from public.billing_apply_entitlement('f3320000-0000-4000-8000-000000000004','pro','expired','mizyun_pro_monthly','app_store','production',false,false,false,now()-interval '1 minute','2026-10-26 12:03+00','evt-d2')),'free','Expiry of that subscription clears paid');
select is((select plan_tier from public.billing_apply_entitlement('f3320000-0000-4000-8000-000000000002','pro','expired',null,null,null,false,false,false,null,'2026-10-26 11:59+00',null)),'paid','A stale snapshot still leaves an active subscription paid');

-- Webhook ledger replay.
select is((select already_processed from public.billing_claim_webhook_event('evt-ledger','INITIAL_PURCHASE')),false,'New event is claimed');
select is((select already_processed from public.billing_claim_webhook_event('evt-ledger','INITIAL_PURCHASE')),false,'Unfinished event can be retried');
select lives_ok($$select public.billing_complete_webhook_event('evt-ledger')$$,'Event completed');
select is((select already_processed from public.billing_claim_webhook_event('evt-ledger','INITIAL_PURCHASE')),true,'Completed event is a replay');
select is((select count(*) from public.billing_webhook_events where event_id='evt-ledger'),1::bigint,'One ledger row');
reset role;
insert into public.billing_webhook_events(event_id,event_type,received_at,processed_at) values ('evt-ancient','RENEWAL',now()-interval '91 days',now()-interval '91 days');
set local role service_role;
set local request.jwt.claim.role='service_role';
select is((select already_processed from public.billing_claim_webhook_event('evt-prune','TEST')),false,'Claim prunes');
reset role;
select is((select count(*) from public.billing_webhook_events where event_id='evt-ancient'),0::bigint,'Ledger rows older than 90 days are pruned');

-- Owner isolation under RLS and no client escalation.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='f3320000-0000-4000-8000-000000000001';
select is((select count(*) from public.subscription_entitlements),1::bigint,'A reads only their own row');
select is((select user_id::text from public.subscription_entitlements),'f3320000-0000-4000-8000-000000000001','The row is A''s');
select throws_ok($$insert into public.subscription_entitlements(user_id,entitlement_id,status,observed_at) values ('f3320000-0000-4000-8000-000000000001','pro','active',now())$$,'42501',null,'A cannot insert an entitlement');
select throws_ok($$update public.subscription_entitlements set status='active', expires_at=now()+interval '1 year'$$,'42501',null,'A cannot update an entitlement');
select throws_ok($$select * from public.billing_apply_entitlement('f3320000-0000-4000-8000-000000000001','pro','active',null,null,null,false,true,false,now()+interval '1 year',now(),null)$$,'42501',null,'A cannot call apply');
select throws_ok($$select public.billing_recompute_plan_tier('f3320000-0000-4000-8000-000000000001',true)$$,'42501',null,'A cannot call recompute');
select throws_ok($$update public.profiles set plan_tier='paid' where id='f3320000-0000-4000-8000-000000000001'$$,'42501',null,'A cannot set plan_tier directly');
select throws_ok($$select count(*) from public.billing_webhook_events$$,'42501',null,'A cannot read the webhook ledger');
set local request.jwt.claim.sub='f3320000-0000-4000-8000-000000000002';
select is((select count(*) from public.subscription_entitlements),1::bigint,'B reads only their own row');
select is((select store from public.subscription_entitlements),'play_store','B sees B''s store');
select is((select count(*) from public.subscription_entitlements where user_id='f3320000-0000-4000-8000-000000000001'),0::bigint,'B cannot read A''s row');
reset role;

-- Account erasure removes the row.
delete from auth.users where id='f3320000-0000-4000-8000-000000000001';
select is((select count(*) from public.subscription_entitlements where user_id='f3320000-0000-4000-8000-000000000001'),0::bigint,'Account erasure cascades');

select * from finish();
rollback;
