begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
set local request.jwt.claim.role='service_role';
select no_plan();
insert into auth.users(id,email) values
 ('f2300000-0000-4000-8000-000000000001','illustration-a@mizyun.test'),
 ('f2300000-0000-4000-8000-000000000002','illustration-b@mizyun.test'),
 ('f2300000-0000-4000-8000-000000000003','illustration-c@mizyun.test'),
 ('f2300000-0000-4000-8000-000000000004','illustration-d@mizyun.test');
insert into public.profiles(id,birth_year) values
 ('f2300000-0000-4000-8000-000000000001',1990),('f2300000-0000-4000-8000-000000000002',1990),
 ('f2300000-0000-4000-8000-000000000003',2012),('f2300000-0000-4000-8000-000000000004',1990)
 on conflict(id) do update set birth_year=excluded.birth_year;
insert into public.user_ai_consents(user_id,granted,confirmed_adult,consent_version) values
 ('f2300000-0000-4000-8000-000000000001',true,true,'2026-09-08'),
 ('f2300000-0000-4000-8000-000000000002',true,true,'2026-09-08'),
 ('f2300000-0000-4000-8000-000000000003',true,true,'2026-09-08');
insert into public.food_entries(id,user_id,name,consumed_at) values
 ('a2300000-0000-4000-8000-000000000001','f2300000-0000-4000-8000-000000000001','Toast',now()),
 ('a2300000-0000-4000-8000-000000000002','f2300000-0000-4000-8000-000000000002','Toast',now()),
 ('a2300000-0000-4000-8000-000000000003','f2300000-0000-4000-8000-000000000003','Toast',now()),
 ('a2300000-0000-4000-8000-000000000004','f2300000-0000-4000-8000-000000000004','Toast',now());
select ok(not has_function_privilege('authenticated','public.meal_illustration_claim(uuid,text,text,uuid)','EXECUTE'),'Clients cannot invoke admission RPC');
select ok(not has_function_privilege('anon','public.meal_illustration_complete(uuid,uuid,text,text)','EXECUTE'),'Anon cannot publish bytes');
select is((select count(*) from public.meal_illustration_claim('f2300000-0000-4000-8000-000000000003',repeat('a',64),'2026-09-08','a2300000-0000-4000-8000-000000000003')),0::bigint,'Minor cannot reserve');
select is((select count(*) from public.meal_illustration_claim('f2300000-0000-4000-8000-000000000004',repeat('a',64),'2026-09-08','a2300000-0000-4000-8000-000000000004')),0::bigint,'Missing consent cannot reserve');
select is((select count(*) from public.meal_illustration_claim('f2300000-0000-4000-8000-000000000001',repeat('a',64),'old','a2300000-0000-4000-8000-000000000001')),0::bigint,'Outdated consent cannot reserve');
select is((select count(*) from public.meal_illustration_claim('f2300000-0000-4000-8000-000000000001',repeat('a',64),'2026-09-08','a2300000-0000-4000-8000-000000000002')),0::bigint,'Cross-owner source cannot reserve');
select throws_ok($$insert into public.meal_illustrations(user_id,source_entry_id,dish_key) values('f2300000-0000-4000-8000-000000000001','a2300000-0000-4000-8000-000000000002',repeat('f',64))$$,'23503',null,'Composite source FK prevents cross-owner cache');
select is((select claimed from public.meal_illustration_claim('f2300000-0000-4000-8000-000000000001',repeat('a',64),'2026-09-08','a2300000-0000-4000-8000-000000000001')),true,'First request claims one durable attempt');
select is((select claimed from public.meal_illustration_claim('f2300000-0000-4000-8000-000000000001',repeat('a',64),'2026-09-08','a2300000-0000-4000-8000-000000000001')),false,'Retry replays without new spend');
select is((select attempts from public.meal_illustration_user_usage where user_id='f2300000-0000-4000-8000-000000000001'),1,'Retry keeps one charge');
select is((select count(*) from public.meal_illustration_claim('f2300000-0000-4000-8000-000000000001',repeat('b',64),'2026-09-08','a2300000-0000-4000-8000-000000000001')),0::bigint,'Per-user concurrency blocks second dish');
select is((select claimed from public.meal_illustration_claim('f2300000-0000-4000-8000-000000000002',repeat('a',64),'2026-09-08','a2300000-0000-4000-8000-000000000002')),true,'Second account receives own independent cache');
update public.profiles set birth_year=1990 where id='f2300000-0000-4000-8000-000000000003';
select is((select count(*) from public.meal_illustration_claim('f2300000-0000-4000-8000-000000000003',repeat('a',64),'2026-09-08','a2300000-0000-4000-8000-000000000003')),0::bigint,'Global concurrency blocks third account');
select public.meal_illustration_complete('f2300000-0000-4000-8000-000000000001',(select id from public.meal_illustrations where user_id='f2300000-0000-4000-8000-000000000001'),'AQIDBA==','2026-09-08');
select is((select state from public.meal_illustrations where user_id='f2300000-0000-4000-8000-000000000001'),'ready','Current consent can publish bounded bytes');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='f2300000-0000-4000-8000-000000000001';
select is((select count(*) from public.meal_illustrations),1::bigint,'Owner sees only own private image');
select throws_ok($$insert into public.meal_illustrations(user_id,source_entry_id,dish_key) values(auth.uid(),'a2300000-0000-4000-8000-000000000001',repeat('e',64))$$,'42501',null,'Owner cannot forge admission rows');
select throws_ok($$update public.meal_illustrations set state='failed'$$,'42501',null,'Owner cannot reset cache/spend state');
select throws_ok($$delete from public.meal_illustrations$$,'42501',null,'Owner cannot delete ledger through direct table');
select throws_ok($$update public.meal_illustration_user_usage set attempts=0$$,'42501',null,'Owner cannot reset charged usage');
select throws_ok($$select * from public.meal_illustration_environment_usage$$,'42501',null,'Owner cannot read global admission usage');
set local request.jwt.claim.sub='f2300000-0000-4000-8000-000000000004';
select is((select count(*) from public.meal_illustrations),0::bigint,'Other account cannot read private bytes');
select is((select count(*) from public.meal_illustration_user_usage),0::bigint,'Other account cannot read owner technical ledger');
reset role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claim.sub='';
update public.user_ai_consents set granted=false,revoked_at=now() where user_id='f2300000-0000-4000-8000-000000000002';
select public.meal_illustration_complete('f2300000-0000-4000-8000-000000000002',(select id from public.meal_illustrations where user_id='f2300000-0000-4000-8000-000000000002'),'AQIDBA==','2026-09-08');
select is((select state from public.meal_illustrations where user_id='f2300000-0000-4000-8000-000000000002'),'failed','Revoked consent blocks completion atomically');
select ok((select image_base64 is null from public.meal_illustrations where user_id='f2300000-0000-4000-8000-000000000002'),'Revoked output is never retained');
update public.food_entries set name='New dish' where id='a2300000-0000-4000-8000-000000000001';
select is((select count(*) from public.meal_illustrations where user_id='f2300000-0000-4000-8000-000000000001'),0::bigint,'Rename erases original generated bytes');
select is((select attempts from public.meal_illustration_user_usage where user_id='f2300000-0000-4000-8000-000000000001'),1,'Rename retains charge');
select lives_ok($$select * from public.meal_illustration_claim('f2300000-0000-4000-8000-000000000001',repeat('c',64),'2026-09-08','a2300000-0000-4000-8000-000000000001')$$,'Renamed source can reserve a newly charged dish');
update public.meal_illustrations set lease_until=now()-interval '1 second' where user_id='f2300000-0000-4000-8000-000000000001';
select is((select state from public.meal_illustration_claim('f2300000-0000-4000-8000-000000000001',repeat('c',64),'2026-09-08','a2300000-0000-4000-8000-000000000001')),'unknown','Restart-expired generation becomes terminal unknown');
select public.meal_illustration_complete('f2300000-0000-4000-8000-000000000001',(select id from public.meal_illustrations where user_id='f2300000-0000-4000-8000-000000000001'),'AQIDBA==','2026-09-08');
select ok((select image_base64 is null from public.meal_illustrations where user_id='f2300000-0000-4000-8000-000000000001'),'Expired completion cannot publish');
delete from public.food_entries where id='a2300000-0000-4000-8000-000000000001';
select is((select count(*) from public.meal_illustrations where user_id='f2300000-0000-4000-8000-000000000001'),0::bigint,'Meal deletion cascades cache bytes and jobs');
select is((select attempts from public.meal_illustration_user_usage where user_id='f2300000-0000-4000-8000-000000000001'),2,'Deletion retains failed/unknown attempt charges');
insert into public.food_entries(id,user_id,name,consumed_at) values('a2300000-0000-4000-8000-000000000005','f2300000-0000-4000-8000-000000000001','Soup',now());
update public.meal_illustration_user_usage set attempts=5 where user_id='f2300000-0000-4000-8000-000000000001';
select is((select count(*) from public.meal_illustration_claim('f2300000-0000-4000-8000-000000000001',repeat('d',64),'2026-09-08','a2300000-0000-4000-8000-000000000005')),0::bigint,'Daily cap cannot be reset by meal deletion');
update public.meal_illustration_user_usage set day=date_trunc('month',now())::date,attempts=30 where user_id='f2300000-0000-4000-8000-000000000001';
select is((select count(*) from public.meal_illustration_claim('f2300000-0000-4000-8000-000000000001',repeat('d',64),'2026-09-08','a2300000-0000-4000-8000-000000000005')),0::bigint,'Monthly cap survives day rollover');
update public.meal_illustration_environment_usage set attempts=50 where day=current_date;
select is((select count(*) from public.meal_illustration_claim('f2300000-0000-4000-8000-000000000003',repeat('d',64),'2026-09-08','a2300000-0000-4000-8000-000000000003')),0::bigint,'Environment daily cap prevents many-account spend');
update public.meal_illustration_environment_usage set attempts=0 where day=current_date;
insert into public.meal_illustration_environment_usage(day,attempts)
 values(case when current_date=date_trunc('month',now())::date then current_date+1 else date_trunc('month',now())::date end,500)
 on conflict(day) do update set attempts=500;
select is((select count(*) from public.meal_illustration_claim('f2300000-0000-4000-8000-000000000003',repeat('d',64),'2026-09-08','a2300000-0000-4000-8000-000000000003')),0::bigint,'Environment monthly cap blocks a new day independently of its daily count');
delete from public.meal_illustration_environment_usage where day=case when current_date=date_trunc('month',now())::date then current_date+1 else date_trunc('month',now())::date end;
update public.meal_illustration_environment_usage set attempts=50 where day=current_date;
delete from auth.users where id='f2300000-0000-4000-8000-000000000001';
select is((select count(*) from public.meal_illustration_user_usage where user_id='f2300000-0000-4000-8000-000000000001'),0::bigint,'Account erasure cascades technical owner ledger');
select is((select attempts from public.meal_illustration_environment_usage where day=current_date),50,'Aggregate environment budget survives account erasure');
select is((select count(*) from public.meal_illustrations where user_id='f2300000-0000-4000-8000-000000000002'),1::bigint,'Other account artwork/job remains intact');
select * from finish();
rollback;
