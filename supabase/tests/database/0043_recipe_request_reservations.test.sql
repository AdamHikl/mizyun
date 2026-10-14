begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
insert into auth.users(id,email) values
 ('a2430000-0000-4000-8000-000000000001','recipe-owner@mizyun.test'),
 ('a2430000-0000-4000-8000-000000000002','recipe-other@mizyun.test');
insert into public.user_ai_consents(user_id,granted,confirmed_adult,consent_version,consented_at)
 values('a2430000-0000-4000-8000-000000000001',true,true,'test-v1',now()),
 ('a2430000-0000-4000-8000-000000000002',true,true,'test-v1',now());
create temporary table recipe_test_attempts(attempt_id uuid, budget_day date);
create function pg_temp.recipe_reserve(p_request uuid, p_fingerprint text default repeat('a',64), p_tokens integer default 800, p_token_budget integer default 5000, p_draft_budget integer default 10, p_per_minute integer default 20, p_max integer default 2)
returns table(outcome text,attempt_id uuid,budget_day date,lease_expires_at timestamptz,reason text,retry_after integer)
language sql as $$
 select * from public.ai_reserve_recipe_request('a2430000-0000-4000-8000-000000000001',p_request,'suggest',p_fingerprint,'test-v1',p_tokens,p_token_budget,p_draft_budget,p_per_minute,p_max,60000);
$$;
select ok((select available from public.ai_recipe_requests_available()),'Migration readiness is present');
select ok(not has_function_privilege('authenticated','public.ai_reserve_recipe_request(uuid,uuid,text,text,text,integer,integer,integer,integer,integer,integer)','EXECUTE'),'Authenticated admission bypass is forbidden');
select ok(not has_function_privilege('anon','public.ai_finalize_recipe_request(uuid,uuid,text,integer)','EXECUTE'),'Anonymous finalization is forbidden');
select ok(not has_function_privilege('authenticated','public.ai_recipe_requests_available()','EXECUTE'),'Readiness is service-only');
select ok(has_function_privilege('service_role','public.ai_reserve_recipe_request(uuid,uuid,text,text,text,integer,integer,integer,integer,integer,integer)','EXECUTE'),'Service role has narrow admission grant');
select ok(not has_table_privilege('authenticated','public.ai_recipe_requests','SELECT'),'Raw fingerprints and attempt IDs are unavailable to authenticated clients');
select ok((select relrowsecurity from pg_class where oid='public.ai_recipe_requests'::regclass),'Ledger enables RLS');
select ok(exists(select 1 from pg_index i where i.indrelid='public.ai_recipe_requests'::regclass and pg_get_indexdef(i.indexrelid) like '%(user_id)%'),'Ownership has a user_id index');
select is((select outcome from pg_temp.recipe_reserve('b2430000-0000-4000-8000-000000000001')),'reserved','First explicit request is admitted');
insert into recipe_test_attempts select attempt_id,budget_day from public.ai_recipe_requests where user_id='a2430000-0000-4000-8000-000000000001';
select is((select allowed from public.ai_acquire_in_flight('a2430000-0000-4000-8000-000000000001',1)),false,'Coach RPC cannot acquire a recipe-held shared slot');
select is((select in_flight from public.ai_in_flight where user_id='a2430000-0000-4000-8000-000000000001'),1,'Denied Coach RPC leaves the active recipe slot unchanged');
select is((select reason from pg_temp.recipe_reserve('b2430000-0000-4000-8000-000000000009',repeat('a',64),800,5000,10,20,1)),'inflight','Another recipe stays denied while the shared slot is held');
select is((select tokens_used from public.ai_daily_token_ledger where user_id='a2430000-0000-4000-8000-000000000001'),800,'Shared concurrency denial does not charge another recipe');

select is((select tokens_used from public.ai_daily_token_ledger where user_id='a2430000-0000-4000-8000-000000000001'),800,'Full estimate is charged upfront in existing shared token ledger');
select is((select drafts_used from public.ai_daily_draft_ledger where user_id='a2430000-0000-4000-8000-000000000001'),1,'Every attempt consumes the existing daily draft quota upfront');
select is((select outcome from pg_temp.recipe_reserve('b2430000-0000-4000-8000-000000000001')),'busy','Lost admission response cannot create a second attempt');
select is((select outcome from pg_temp.recipe_reserve('b2430000-0000-4000-8000-000000000001',repeat('b',64))),'conflict','Changed inputs cannot reuse admitted identity');
select is((select count(*) from public.ai_recipe_requests where user_id='a2430000-0000-4000-8000-000000000001'),1::bigint,'Duplicate identities leave one durable record');
select is((select request_count from public.ai_request_windows where user_id='a2430000-0000-4000-8000-000000000001'),1,'Duplicate does not spend a second shared minute slot');
select is((select publish_allowed from public.ai_finalize_recipe_request('a2430000-0000-4000-8000-000000000002',(select attempt_id from recipe_test_attempts),'succeeded',0)),false,'Cross-owner settlement cannot refund another user');
select is((select tokens_used from public.ai_daily_token_ledger where user_id='a2430000-0000-4000-8000-000000000001'),800,'Cross-owner settlement preserves charge');
select is((select publish_allowed from public.ai_finalize_recipe_request('a2430000-0000-4000-8000-000000000001',(select attempt_id from recipe_test_attempts),'succeeded',200)),true,'Successful trustworthy usage can settle and publish');
select is((select tokens_used from public.ai_daily_token_ledger where user_id='a2430000-0000-4000-8000-000000000001'),200,'Success refunds only unused estimate');
select is((select publish_allowed from public.ai_finalize_recipe_request('a2430000-0000-4000-8000-000000000001',(select attempt_id from recipe_test_attempts),'succeeded',0)),false,'Repeated settlement is inert and cannot republish');
select is((select outcome from pg_temp.recipe_reserve('b2430000-0000-4000-8000-000000000001')),'outcome_unavailable','Completed output loss requires a new explicit identity');
select is((select outcome from pg_temp.recipe_reserve('b2430000-0000-4000-8000-000000000002',repeat('a',64),800,999)),'denied','Existing token usage gates recipe admission');
select is((select count(*) from public.ai_recipe_requests where user_id='a2430000-0000-4000-8000-000000000001'),1::bigint,'Denied budget never creates a provider attempt');
select is((select outcome from pg_temp.recipe_reserve('b2430000-0000-4000-8000-000000000002')),'reserved','New explicit attempt admitted under remaining cap');
select is((select publish_allowed from public.ai_finalize_recipe_request('a2430000-0000-4000-8000-000000000001',(select attempt_id from public.ai_recipe_requests where request_id='b2430000-0000-4000-8000-000000000002'),'failed',0)),false,'Ambiguous terminal failure cannot publish');
select is((select tokens_used from public.ai_daily_token_ledger where user_id='a2430000-0000-4000-8000-000000000001'),1000,'Failure retains complete conservative charge');
select is((select outcome from pg_temp.recipe_reserve('b2430000-0000-4000-8000-000000000002')),'outcome_unavailable','Failed identity cannot silently retry');
-- A persisted reservation whose lease ended before restart remains terminal.
select is((select outcome from pg_temp.recipe_reserve('b2430000-0000-4000-8000-000000000003')),'reserved','Third explicit attempt admitted');
update public.ai_recipe_requests set lease_expires_at=clock_timestamp()-interval '1 second' where request_id='b2430000-0000-4000-8000-000000000003';
select is((select outcome from pg_temp.recipe_reserve('b2430000-0000-4000-8000-000000000003')),'outcome_unavailable','Restart with expired lease cannot repeat provider');
select is((select tokens_used from public.ai_daily_token_ledger where user_id='a2430000-0000-4000-8000-000000000001'),1800,'Expiry retains estimate');
select is((select publish_allowed from public.ai_finalize_recipe_request('a2430000-0000-4000-8000-000000000001',(select attempt_id from public.ai_recipe_requests where request_id='b2430000-0000-4000-8000-000000000003'),'succeeded',0)),false,'Late provider response after expiry cannot publish/refund');
-- Settlement follows the frozen admission day even when response is another day.
select is((select outcome from pg_temp.recipe_reserve('b2430000-0000-4000-8000-000000000004')),'reserved','Fourth explicit attempt admitted');
insert into public.ai_daily_token_ledger(user_id,day,tokens_used,reserved_tokens) values('a2430000-0000-4000-8000-000000000001',(now() at time zone 'UTC')::date-1,800,0);
update public.ai_recipe_requests set budget_day=(now() at time zone 'UTC')::date-1 where request_id='b2430000-0000-4000-8000-000000000004';
select is((select publish_allowed from public.ai_finalize_recipe_request('a2430000-0000-4000-8000-000000000001',(select attempt_id from public.ai_recipe_requests where request_id='b2430000-0000-4000-8000-000000000004'),'succeeded',100)),true,'Live result settles frozen day');
select is((select tokens_used from public.ai_daily_token_ledger where user_id='a2430000-0000-4000-8000-000000000001' and day=(now() at time zone 'UTC')::date-1),100,'Midnight settlement updates original ledger');
-- Shared reservation counters from existing Coach/food RPCs are included.
select * from public.ai_reserve_tokens('a2430000-0000-4000-8000-000000000001',(now() at time zone 'UTC')::date,5000,2000);
select is((select reason from pg_temp.recipe_reserve('b2430000-0000-4000-8000-000000000005',repeat('a',64),800,5000)),'tokens','Existing pending Coach tokens also block recipe');
select is((select reason from pg_temp.recipe_reserve('b2430000-0000-4000-8000-000000000005',repeat('a',64),800,10000,4)),'drafts','Existing shared draft quota blocks recipe');
select is((select reason from pg_temp.recipe_reserve('b2430000-0000-4000-8000-000000000005',repeat('a',64),800,10000,10,1)),'minute','Existing shared request window blocks recipe');
update public.ai_in_flight set in_flight=2,acquired_at=clock_timestamp() where user_id='a2430000-0000-4000-8000-000000000001';
select is((select reason from pg_temp.recipe_reserve('b2430000-0000-4000-8000-000000000005',repeat('a',64),800,10000)),'inflight','Existing shared concurrency slot blocks recipe');
update public.ai_in_flight set in_flight=0 where user_id='a2430000-0000-4000-8000-000000000001';
select is((select outcome from pg_temp.recipe_reserve('b2430000-0000-4000-8000-000000000005',repeat('a',64),800,10000)),'reserved','Admission resumes with capacity');
update public.user_ai_consents set granted=false,revoked_at=clock_timestamp() where user_id='a2430000-0000-4000-8000-000000000001';
select is((select publish_allowed from public.ai_finalize_recipe_request('a2430000-0000-4000-8000-000000000001',(select attempt_id from public.ai_recipe_requests where request_id='b2430000-0000-4000-8000-000000000005'),'succeeded',100)),false,'Consent revocation blocks an in-flight result');
select is((select reason from pg_temp.recipe_reserve('b2430000-0000-4000-8000-000000000006',repeat('a',64),800,10000)),'consent','Fresh consent revocation blocks new provider attempts');
update public.user_ai_consents set granted=true,revoked_at=null where user_id='a2430000-0000-4000-8000-000000000001';
select is((select outcome from pg_temp.recipe_reserve('b2430000-0000-4000-8000-000000000006',repeat('a',64),800,10000)),'reserved','Explicit new identity admitted after current consent');
insert into public.account_deletion_jobs(user_id,challenge_hash,status,stage,expires_at) values('a2430000-0000-4000-8000-000000000001','synthetic','in_progress','storage',clock_timestamp()+interval '1 hour');
select is((select publish_allowed from public.ai_finalize_recipe_request('a2430000-0000-4000-8000-000000000001',(select attempt_id from public.ai_recipe_requests where request_id='b2430000-0000-4000-8000-000000000006'),'succeeded',100)),false,'Accepted deletion blocks an in-flight result');
select is((select reason from pg_temp.recipe_reserve('b2430000-0000-4000-8000-000000000007',repeat('a',64),800,10000)),'deletion','Accepted deletion blocks new recipe admission');
select ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='ai_recipe_requests' and column_name in ('prompt','image','recipe','result','photo_path','health_context','conversation_id')),'No provider content or fabricated conversation exists in operational ledger');
delete from auth.users where id='a2430000-0000-4000-8000-000000000001';
select is((select count(*) from public.ai_recipe_requests where user_id='a2430000-0000-4000-8000-000000000001'),0::bigint,'Auth erasure cascades recipe ledger');
select * from finish();
rollback;
