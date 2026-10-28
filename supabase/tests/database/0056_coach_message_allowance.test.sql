begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
insert into auth.users(id,email) values
 ('a2560000-0000-4000-8000-000000000001','coach-msg-owner@mizyun.test'),
 ('a2560000-0000-4000-8000-000000000002','coach-msg-other@mizyun.test');

select ok(not has_function_privilege('authenticated','public.ai_reserve_coach_message(uuid,date,integer,bigint,integer)','EXECUTE'),'Authenticated clients cannot reserve Coach messages');
select ok(not has_function_privilege('anon','public.ai_reserve_coach_message(uuid,date,integer,bigint,integer)','EXECUTE'),'Anonymous clients cannot reserve Coach messages');
select ok(not has_function_privilege('authenticated','public.ai_settle_coach_message(uuid,date,boolean,integer,integer)','EXECUTE'),'Authenticated clients cannot settle Coach messages');
select ok(has_function_privilege('service_role','public.ai_reserve_coach_message(uuid,date,integer,bigint,integer)','EXECUTE'),'Service role can reserve Coach messages');
select ok(has_function_privilege('service_role','public.ai_settle_coach_message(uuid,date,boolean,integer,integer)','EXECUTE'),'Service role can settle Coach messages');

select is((select messages_used from public.ai_reserve_coach_message('a2560000-0000-4000-8000-000000000001','2026-10-27',2,100000,1200)),0,'First message is admitted with none taken before');
select is((select reserved_messages || '/' || coach_reserved_tokens from public.ai_daily_token_ledger where user_id='a2560000-0000-4000-8000-000000000001' and day='2026-10-27'),'1/1200','Admission reserves one message and its tokens');
select lives_ok($$select public.ai_settle_coach_message('a2560000-0000-4000-8000-000000000001','2026-10-27',true,1200,9000)$$,'A stored reply counts the message');
select is((select messages_used || '/' || reserved_messages || '/' || coach_tokens_used || '/' || coach_reserved_tokens from public.ai_daily_token_ledger where user_id='a2560000-0000-4000-8000-000000000001' and day='2026-10-27'),'1/0/9000/0','Counting moves the message and real tokens to used');
select is((select tokens_used + reserved_tokens from public.ai_daily_token_ledger where user_id='a2560000-0000-4000-8000-000000000001' and day='2026-10-27'),0,'Coach leaves the recipe token budget untouched');

select is((select allowed from public.ai_reserve_coach_message('a2560000-0000-4000-8000-000000000001','2026-10-27',2,100000,1200)),true,'Second message is admitted');
select lives_ok($$select public.ai_settle_coach_message('a2560000-0000-4000-8000-000000000001','2026-10-27',false,1200,0)$$,'A failed call returns the message');
select is((select messages_used || '/' || reserved_messages || '/' || coach_tokens_used || '/' || coach_reserved_tokens from public.ai_daily_token_ledger where user_id='a2560000-0000-4000-8000-000000000001' and day='2026-10-27'),'1/0/9000/0','A returned message and its tokens are not counted');

select is((select allowed from public.ai_reserve_coach_message('a2560000-0000-4000-8000-000000000001','2026-10-27',2,100000,1200)),true,'The returned message can be used again');
select is((select reason from public.ai_reserve_coach_message('a2560000-0000-4000-8000-000000000001','2026-10-27',2,100000,1200)),'messages','An in-flight reservation counts toward the message limit');
select ok((select retry_after between 1 and 86400 * 400 from public.ai_reserve_coach_message('a2560000-0000-4000-8000-000000000001','2026-10-27',2,100000,1200)),'Denial carries a positive retry-after');
select is((select reserved_messages from public.ai_daily_token_ledger where user_id='a2560000-0000-4000-8000-000000000001' and day='2026-10-27'),1,'Denials reserve nothing');

select is((select reason from public.ai_reserve_coach_message('a2560000-0000-4000-8000-000000000001','2026-10-28',5,10000,10001)),'tokens','A turn over the hidden token ceiling is denied with tokens reason');
select is((select reserved_messages from public.ai_daily_token_ledger where user_id='a2560000-0000-4000-8000-000000000001' and day='2026-10-28'),0,'A token denial reserves no message');
select is((select allowed from public.ai_reserve_coach_message('a2560000-0000-4000-8000-000000000001','2026-10-28',5,10000,1200)),true,'A new UTC day starts a new count');
select is((select allowed from public.ai_reserve_coach_message('a2560000-0000-4000-8000-000000000002','2026-10-27',2,100000,1200)),true,'Another user has an independent count');
select is((select allowed from public.ai_reserve_coach_message('a2560000-0000-4000-8000-000000000002','2026-10-27',0,100000,1200)),false,'A zero limit denies');
select lives_ok($$select public.ai_settle_coach_message('a2560000-0000-4000-8000-000000000002','2026-10-27',false,1200,0)$$,'Settle one reservation');
select lives_ok($$select public.ai_settle_coach_message('a2560000-0000-4000-8000-000000000002','2026-10-27',true,1200,0)$$,'A repeated settle does not fail');
select is((select messages_used || '/' || reserved_messages || '/' || coach_reserved_tokens from public.ai_daily_token_ledger where user_id='a2560000-0000-4000-8000-000000000002' and day='2026-10-27'),'0/0/0','A settle without a reservation counts nothing and never goes below zero');

delete from auth.users where id='a2560000-0000-4000-8000-000000000002';
select is((select count(*) from public.ai_daily_token_ledger where user_id='a2560000-0000-4000-8000-000000000002'),0::bigint,'Auth erasure cascades the message count');

select * from finish();
rollback;
