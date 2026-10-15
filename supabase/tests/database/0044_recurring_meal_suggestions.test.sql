begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id,email) values
 ('a2440000-0000-4000-8000-000000000001','mrs-a@synthetic.invalid'),
 ('a2440000-0000-4000-8000-000000000002','mrs-b@synthetic.invalid'),
 ('a2440000-0000-4000-8000-000000000003','mrs-manual@synthetic.invalid'),
 ('a2440000-0000-4000-8000-000000000004','mrs-stale@synthetic.invalid'),
 ('a2440000-0000-4000-8000-000000000005','mrs-generated@synthetic.invalid'),
 ('a2440000-0000-4000-8000-000000000006','mrs-deleting@synthetic.invalid');
-- Build actual clock-relative evidence, never a caller-controllable acceptance clock.
insert into public.food_entries(id,user_id,name,consumed_at,created_at,updated_at,calories_kcal,protein_g,carbohydrate_g,fat_g,confirmed_by_user,details)
select gen_random_uuid(),u.id,'Oats with banana',date_trunc('day',now())+(extract(hour from now())::int*60+(extract(minute from now())::int/15)*15)*interval '1 minute'-d*interval '1 day',
 date_trunc('milliseconds',now()),date_trunc('milliseconds',now()),300.00,10,40,10,true,'{"grams":100}'::jsonb
from auth.users u cross join generate_series(0,2) d where email like 'mrs-%@synthetic.invalid';
create function pg_temp.mrs_proposal(p_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.food_entries; ev jsonb; tuples jsonb; ident jsonb; candidate text;
begin
 select * into f from public.food_entries where user_id=p_user and not exists(select 1 from public.recurring_meal_occurrences o where o.food_entry_id=food_entries.id) order by consumed_at desc,created_at desc limit 1;
 select jsonb_agg(jsonb_build_object('id',id,'updatedAt',public.recurring_suggestion_instant(updated_at),'localDate',(consumed_at at time zone 'UTC')::date::text) order by consumed_at),
 jsonb_agg(jsonb_build_array(id,public.recurring_suggestion_instant(updated_at),(consumed_at at time zone 'UTC')::date::text) order by consumed_at)
 into ev,tuples from public.food_entries where user_id=p_user and not exists(select 1 from public.recurring_meal_occurrences o where o.food_entry_id=food_entries.id);
 ident:=public.recurring_suggestion_identity(to_jsonb(f));
 candidate:='mrs1-'||public.recurring_suggestion_digest(public.recurring_suggestion_json(jsonb_build_array('mrs-exact-3-v1','UTC',public.recurring_suggestion_json(ident),tuples)));
 return jsonb_build_object('candidateId',candidate,'familyKey','oats with banana','sourceEntryId',f.id,'sourceUpdatedAt',public.recurring_suggestion_instant(f.updated_at),'evidence',ev,'evidenceDigest',public.recurring_suggestion_digest(public.recurring_suggestion_json(tuples)),
 'name',f.name,'caloriesKcal',300,'proteinG',10,'carbohydrateG',40,'fatG',10,'grams',100,'policyVersion','mrs-exact-3-v1','reasonCode','three_consecutive_days','localTime',to_char(f.consumed_at at time zone 'UTC','HH24:MI'),'timeZone','UTC','weekdays',jsonb_build_array(0,1,2,3,4,5,6),'startLocalDate',((now() at time zone 'UTC')::date+1)::text,'expiresAt',public.recurring_suggestion_instant(date_trunc('milliseconds',f.created_at)+interval '7 days'));
end; $$;
create temporary table mrs_cases(user_id uuid primary key,request jsonb);
insert into mrs_cases select id,jsonb_build_object('operationId',gen_random_uuid(),'proposal',pg_temp.mrs_proposal(id),'localTime',to_char(date_trunc('hour',now())+(extract(minute from now())::int/15)*interval '15 minutes','HH24:MI'),'timeZone','UTC','weekdays',jsonb_build_array(0,1,2,3,4,5,6)) from auth.users where email like 'mrs-%@synthetic.invalid';
grant select on mrs_cases to authenticated;
select ok((select relrowsecurity from pg_class where oid='public.recurring_meal_suggestion_states'::regclass),'Family controls have RLS');
select ok((select relrowsecurity from pg_class where oid='public.recurring_meal_suggestion_preferences'::regclass),'Preferences have RLS');
select ok((select relrowsecurity from pg_class where oid='public.recurring_meal_suggestion_receipts'::regclass),'Immutable receipts have RLS');
select ok(not has_table_privilege('anon','public.recurring_meal_suggestion_states','SELECT'),'Anonymous cannot read health-derived families');
select ok(not has_table_privilege('authenticated','public.recurring_meal_suggestion_states','INSERT'),'Owners cannot bypass decision validation');
select ok(not has_table_privilege('authenticated','public.recurring_meal_suggestion_states','UPDATE'),'Owners cannot rewrite acceptance links');
select ok(not has_table_privilege('authenticated','public.recurring_meal_suggestion_receipts','DELETE'),'Owners cannot erase immutable retry receipts directly');
select ok(not has_function_privilege('anon','public.recurring_suggestion_accept(jsonb)','EXECUTE'),'Anonymous acceptance denied');
select ok(not has_function_privilege('authenticated','public.recurring_suggestion_validate(uuid,jsonb)','EXECUTE'),'Private evidence validator not callable');
select is(public.recurring_suggestion_family(U&'  O\0301ats\00A0 WITH   Banana  '),U&'\00D3ats with banana','NFC/JS whitespace/ASCII family normalization');
select is(public.recurring_suggestion_family(U&'\0130STANBUL OATS'),U&'\0130stanbul oats','Turkish dotted I preserved with ASCII case fold');
select is(public.recurring_suggestion_family(U&'\039F\03A3 OATS'),U&'\039F\03A3 oats','Greek uppercase sigma copied-name key stays stable');
select isnt(public.recurring_suggestion_family(U&'\039F\03A3 OATS'),public.recurring_suggestion_family(U&'\03BF\03C2 oats'),'Non-ASCII case variants conservatively remain distinct');
select is(public.recurring_suggestion_json('["meal",300.00,null,0,1.500,100]'::jsonb),'["meal",300,null,0,1.5,100]','Canonical exact number/null identity');
select is(public.recurring_suggestion_json('[0.00000001020]'::jsonb),'[1.02e-8]','Small-number JSON.stringify parity');
select is(public.recurring_suggestion_digest('hello'),'4f9f2cab','FNV consistency fixture parity');
-- A copy is saved when the user taps Copy, so evidence hours apart stays valid at its median time.
insert into auth.users(id,email) values('a2440000-0000-4000-8000-000000000007','wide-times@synthetic.invalid');
insert into public.food_entries(id,user_id,name,consumed_at,created_at,updated_at,calories_kcal,protein_g,carbohydrate_g,fat_g,confirmed_by_user,details)
select gen_random_uuid(),'a2440000-0000-4000-8000-000000000007','Oats with banana',
 case d when 0 then date_trunc('minute',now()) when 1 then date_trunc('day',now())-interval '1 day'+interval '21 hours' else date_trunc('day',now())-interval '2 days'+interval '3 hours' end,
 date_trunc('milliseconds',now()),date_trunc('milliseconds',now()),300.00,10,40,10,true,'{"grams":100}'::jsonb
from generate_series(0,2) d;
select lives_ok(format('select public.recurring_suggestion_validate(%L::uuid,%L::jsonb)','a2440000-0000-4000-8000-000000000007',
 jsonb_set(pg_temp.mrs_proposal('a2440000-0000-4000-8000-000000000007'),'{localTime}',to_jsonb((select lpad((m/60)::text,2,'0')||':'||lpad((m%60)::text,2,'0')
   from (select ((greatest(180,least(1260,extract(hour from now() at time zone 'UTC')::int*60+extract(minute from now() at time zone 'UTC')::int))+7)/15)*15 m) x)))),
 'Evidence logged hours apart validates at its rounded median time');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a2440000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select lives_ok(format('select * from public.recurring_suggestion_decide(%L::jsonb,''shown'')',(select request->'proposal' from mrs_cases where user_id=auth.uid())),'Shown records one durable private impression');
select lives_ok(format('select * from public.recurring_suggestion_decide(%L::jsonb,''shown'')',(select request->'proposal' from mrs_cases where user_id=auth.uid())),'Shown replay is idempotent');
select is((select count(*)::int from public.recurring_meal_suggestion_states),1,'Owner reads only their state');
select lives_ok(format('select * from public.recurring_suggestion_accept(%L::jsonb)',(select request from mrs_cases where user_id=auth.uid())),'Acceptance creates and skips atomically');
select is((select count(*)::int from public.recurring_meal_schedules where user_id=auth.uid()),1,'One accepted schedule');
select ok((select skipped and local_date=(now() at time zone 'UTC')::date and food_entry_id is null from public.recurring_meal_occurrences where user_id=auth.uid()),'Today skipped without a food entry');
select is((select count(*)::int from public.food_entries where user_id=auth.uid()),3,'Acceptance never creates today food');
select lives_ok(format('select * from public.recurring_suggestion_accept(%L::jsonb)',(select request from mrs_cases where user_id=auth.uid())),'Lost-response same-operation replay succeeds');
select throws_ok(format('select * from public.recurring_suggestion_accept(%L::jsonb)',(select jsonb_set(request,'{localTime}','"09:15"') from mrs_cases where user_id=auth.uid())),'23505',null,'Changed immutable replay conflicts');
select throws_ok(format('select * from public.recurring_meal_create(gen_random_uuid(),%L::uuid,%L,''UTC'',array[0,1,2,3,4,5,6])',(select request->'proposal'->>'sourceEntryId' from mrs_cases where user_id=auth.uid()),(select request->>'localTime' from mrs_cases where user_id=auth.uid())),'23505',null,'Suggestion-first equivalent manual create conflicts under owner lock');
select ok((select created from public.recurring_meal_suggestion_receipts where user_id=auth.uid()),'Receipt freezes first creation');
select lives_ok('select * from public.recurring_meal_stop((select id from public.recurring_meal_schedules where user_id=auth.uid()))','Stop succeeds');
select ok(not (select (result->'schedule'->>'enabled')::boolean from public.recurring_suggestion_accept((select request from mrs_cases where user_id=auth.uid()))),'Stopped lost-response replay stays stopped');
select throws_ok(format('select * from public.recurring_suggestion_accept(%L::jsonb)',(select jsonb_set(request,'{operationId}',to_jsonb(gen_random_uuid()::text)) from mrs_cases where user_id=auth.uid())),'23505',null,'Another operation cannot restart stopped accepted family');
select lives_ok('select * from public.recurring_suggestion_preferences(null,true)','Reset succeeds');
select ok((select accepted_schedule_id is not null from public.recurring_meal_suggestion_states),'Reset preserves accepted stopped suppression');

select set_config('request.jwt.claim.sub','a2440000-0000-4000-8000-000000000002',true);
select is((select count(*)::int from public.recurring_meal_suggestion_states),0,'Owner B cannot read A state');
select is((select count(*)::int from public.recurring_meal_suggestion_receipts),0,'Owner B cannot read A receipt');
select throws_ok(format('select * from public.recurring_suggestion_accept(%L::jsonb)',(select request from mrs_cases where user_id='a2440000-0000-4000-8000-000000000001')),'23505',null,'Foreign owner proposal cannot authorize acceptance');
select lives_ok(format('select * from public.recurring_suggestion_decide(%L::jsonb,''not_now'')',(select request->'proposal' from mrs_cases where user_id=auth.uid())),'Not now persists family cooldown');
select ok((select cooldown_until>now()+interval '29 days' from public.recurring_meal_suggestion_states),'Not now cooldown is thirty days');
select throws_ok(format('select * from public.recurring_suggestion_accept(%L::jsonb)',(select request from mrs_cases where user_id=auth.uid())),'23505',null,'Cooldown blocks stale acceptance');
select lives_ok('select * from public.recurring_suggestion_preferences(false,false)','Global suggestions disabled');
select lives_ok('select * from public.recurring_suggestion_preferences(true,true)','User re-enables and resets dismissal');
select lives_ok(format('select * from public.recurring_suggestion_decide(%L::jsonb,''never'')',(select request->'proposal' from mrs_cases where user_id=auth.uid())),'Never persists across policy changes');
select ok((select never from public.recurring_meal_suggestion_states),'Permanent family dismissal persisted');

select set_config('request.jwt.claim.sub','a2440000-0000-4000-8000-000000000003',true);
select lives_ok(format('select * from public.recurring_meal_create(gen_random_uuid(),%L::uuid,%L,''UTC'',array[0,1,2,3,4,5,6])',(select request->'proposal'->>'sourceEntryId' from mrs_cases where user_id=auth.uid()),(select request->>'localTime' from mrs_cases where user_id=auth.uid())),'Manual-first schedule created');
select lives_ok('select * from public.recurring_meal_update((select id from public.recurring_meal_schedules where user_id=auth.uid()),''{"enabled":false}'')','Pause manual equivalent');
select ok(not (select (result->>'created')::boolean from public.recurring_suggestion_accept((select request from mrs_cases where user_id=auth.uid()))),'Manual-first paused schedule reused');
select is((select count(*)::int from public.recurring_meal_occurrences where user_id=auth.uid()),0,'Existing equivalent is never skipped');
select is((select count(*)::int from public.recurring_meal_schedules where user_id=auth.uid()),1,'Manual-first acceptance has one schedule');

reset role;
-- RESET ROLE does not clear JWT claims; maintenance must have no owner principal.
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','service_role',true);
update public.food_entries set updated_at=updated_at+interval '1 microsecond' where id=(select request->'proposal'->>'sourceEntryId' from mrs_cases where user_id='a2440000-0000-4000-8000-000000000004')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a2440000-0000-4000-8000-000000000004',true);
select throws_ok(format('select * from public.recurring_suggestion_accept(%L::jsonb)',(select request from mrs_cases where user_id=auth.uid())),'23505',null,'Even microsecond source change rejects frozen nutrition');
select is((select count(*)::int from public.recurring_meal_schedules where user_id=auth.uid()),0,'Stale failure leaves no partial schedule');
select is((select count(*)::int from public.recurring_meal_suggestion_receipts where user_id=auth.uid()),0,'Stale failure leaves no partial receipt');
reset role;
-- RESET ROLE does not clear JWT claims; maintenance must have no owner principal.
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','service_role',true);
-- Give generated source no client marker: only the durable occurrence ledger proves provenance.
insert into public.recurring_meal_schedules(id,user_id,name,template,initial_request,local_time,time_zone,weekdays,enabled)
select 'b2440000-0000-4000-8000-000000000005',user_id,'Different template','{"name":"Different template"}','{}','00:00','UTC',array[0],false from mrs_cases where user_id='a2440000-0000-4000-8000-000000000005';
insert into public.recurring_meal_occurrences(user_id,schedule_id,local_date,food_entry_id)
select user_id,'b2440000-0000-4000-8000-000000000005',(now() at time zone 'UTC')::date,(request->'proposal'->>'sourceEntryId')::uuid from mrs_cases where user_id='a2440000-0000-4000-8000-000000000005';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a2440000-0000-4000-8000-000000000005',true);
select throws_ok(format('select * from public.recurring_suggestion_accept(%L::jsonb)',(select request from mrs_cases where user_id=auth.uid())),'23505',null,'Ledger rejects generated source after client marker removal');
select ok((select context->'generatedEntryIds' ? (select request->'proposal'->>'sourceEntryId' from mrs_cases where user_id=auth.uid()) from public.recurring_suggestion_context(array[(select request->'proposal'->>'sourceEntryId' from mrs_cases where user_id=auth.uid())::uuid])),'Private context uses authoritative ledger');
reset role;
-- RESET ROLE does not clear JWT claims; maintenance must have no owner principal.
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','service_role',true);
insert into public.food_entries(id,user_id,name,consumed_at,created_at,updated_at,calories_kcal,protein_g,carbohydrate_g,fat_g,confirmed_by_user,details)
select gen_random_uuid(),user_id,name,consumed_at,now(),now(),calories_kcal,protein_g,carbohydrate_g,fat_g,true,details from public.food_entries where id=(select request->'proposal'->>'sourceEntryId' from mrs_cases where user_id='a2440000-0000-4000-8000-000000000005')::uuid;
update mrs_cases set request=jsonb_set(request,'{proposal}',pg_temp.mrs_proposal(user_id)) where user_id='a2440000-0000-4000-8000-000000000005';
-- An intentional copy receives its own ID and no ledger/marker: eligible again.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a2440000-0000-4000-8000-000000000005',true);
select lives_ok(format('select * from public.recurring_suggestion_accept(%L::jsonb)',(select request from mrs_cases where user_id=auth.uid())),'Confirmed intentional copy without automatic provenance qualifies');
reset role;
-- RESET ROLE does not clear JWT claims; maintenance must have no owner principal.
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','service_role',true);
-- Source erasure after success cannot destroy operation recovery.
delete from public.food_entries where id=(select request->'proposal'->>'sourceEntryId' from mrs_cases where user_id='a2440000-0000-4000-8000-000000000005')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a2440000-0000-4000-8000-000000000005',true);
select lives_ok(format('select * from public.recurring_suggestion_accept(%L::jsonb)',(select request from mrs_cases where user_id=auth.uid())),'Accepted replay survives source deletion');
reset role;
-- RESET ROLE does not clear JWT claims; maintenance must have no owner principal.
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','service_role',true);
insert into public.account_deletion_jobs(user_id,status,challenge_hash,expires_at) values('a2440000-0000-4000-8000-000000000006','in_progress','mrs-synthetic',now()+interval '1 hour');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a2440000-0000-4000-8000-000000000006',true);
select throws_ok(format('select * from public.recurring_suggestion_accept(%L::jsonb)',(select request from mrs_cases where user_id=auth.uid())),'22023',null,'Deleting owner cannot accept');
select throws_ok(format('select * from public.recurring_suggestion_decide(%L::jsonb,''shown'')',(select request->'proposal' from mrs_cases where user_id=auth.uid())),'22023',null,'Deleting owner cannot record decisions');
select throws_ok('select * from public.recurring_suggestion_preferences(false,false)','22023',null,'Deleting owner cannot write preferences');
select lives_ok('select * from public.recurring_suggestion_clear()','Deletion-aware erasure remains retryable');
reset role;
-- RESET ROLE does not clear JWT claims; maintenance must have no owner principal.
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','service_role',true);
select throws_ok('insert into public.recurring_meal_suggestion_preferences(user_id,enabled) values(''a2440000-0000-4000-8000-000000000006'',true)','22023',null,'Restore cannot bypass erasure barrier');
select throws_ok('insert into public.recurring_meal_suggestion_states(user_id,family_key,accepted_schedule_id) values(''a2440000-0000-4000-8000-000000000002'',''foreign'',''b2440000-0000-4000-8000-000000000005'')','23503',null,'Cross-owner schedule foreign key rejects forged links');
select * from finish();
rollback;
