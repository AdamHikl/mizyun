begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id,email) values
 ('a2460000-0000-4000-8000-000000000001','mrs-weekly-accept@synthetic.invalid'),
 ('a2460000-0000-4000-8000-000000000002','mrs-weekly-tamper@synthetic.invalid'),
 ('a2460000-0000-4000-8000-000000000003','mrs-weekly-daily@synthetic.invalid');
-- Clock-relative evidence: today (d) and d-7 share a weekday, as do d-2 and d-9.
-- Today's entry is the fresh source saved now; earlier ones have fixed times.
create temporary table mrs_weekly_entries(label text,user_id uuid,id uuid primary key default gen_random_uuid(),consumed_at timestamptz);
insert into mrs_weekly_entries(label,user_id,consumed_at)
select label,u,case when back=0 then date_trunc('minute',now()) else date_trunc('day',now())-back*interval '1 day'+minute*interval '1 minute' end
from (values('a2460000-0000-4000-8000-000000000001'::uuid),('a2460000-0000-4000-8000-000000000002'::uuid)) users(u)
cross join (values('d',0,0),('d-2',2,390),('d-7',7,360),('d-9',9,420),('d-3',3,400),('d-14',14,360)) x(label,back,minute)
where label in('d','d-2','d-7','d-9') or u='a2460000-0000-4000-8000-000000000002';
insert into mrs_weekly_entries(label,user_id,consumed_at)
select 'daily-'||back,'a2460000-0000-4000-8000-000000000003',date_trunc('day',now())+(extract(hour from now())::int*60+(extract(minute from now())::int/15)*15)*interval '1 minute'-back*interval '1 day'
from generate_series(0,2) back;
insert into public.food_entries(id,user_id,name,consumed_at,created_at,updated_at,calories_kcal,protein_g,carbohydrate_g,fat_g,confirmed_by_user,details)
select id,user_id,'Oats with banana',consumed_at,date_trunc('milliseconds',now()),date_trunc('milliseconds',now()),300.00,10,40,10,true,'{"grams":100}'::jsonb from mrs_weekly_entries;

-- Builds a proposal the way packages/core does, written independently of the
-- validator: percentile_disc(0.5) is the lower median for an even count.
create function pg_temp.mrs_weekly(p_user uuid,p_labels text[],p_policy text default 'mrs-weekly-2w-v1',p_reason text default 'weekly_pattern') returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.food_entries; ev jsonb; tuples jsonb; ident jsonb; candidate text; m integer; days jsonb;
begin
 select food.* into f from public.food_entries food join pg_temp.mrs_weekly_entries w on w.id=food.id where w.user_id=p_user and w.label=any(p_labels) order by food.consumed_at desc limit 1;
 select jsonb_agg(jsonb_build_object('id',food.id,'updatedAt',public.recurring_suggestion_instant(food.updated_at),'localDate',(food.consumed_at at time zone 'UTC')::date::text) order by food.consumed_at),
  jsonb_agg(jsonb_build_array(food.id,public.recurring_suggestion_instant(food.updated_at),(food.consumed_at at time zone 'UTC')::date::text) order by food.consumed_at),
  percentile_disc(0.5) within group(order by extract(hour from food.consumed_at at time zone 'UTC')::int*60+extract(minute from food.consumed_at at time zone 'UTC')::int)
 into ev,tuples,m from public.food_entries food join pg_temp.mrs_weekly_entries w on w.id=food.id where w.user_id=p_user and w.label=any(p_labels);
 select jsonb_agg(distinct extract(dow from (food.consumed_at at time zone 'UTC')::date)::int) into days from public.food_entries food join pg_temp.mrs_weekly_entries w on w.id=food.id where w.user_id=p_user and w.label=any(p_labels);
 m:=((m+7)/15)*15;
 ident:=public.recurring_suggestion_identity(to_jsonb(f));
 candidate:='mrs1-'||public.recurring_suggestion_digest(public.recurring_suggestion_json(jsonb_build_array(p_policy,'UTC',public.recurring_suggestion_json(ident),tuples)));
 return jsonb_build_object('candidateId',candidate,'familyKey','oats with banana','sourceEntryId',f.id,'sourceUpdatedAt',public.recurring_suggestion_instant(f.updated_at),'evidence',ev,'evidenceDigest',public.recurring_suggestion_digest(public.recurring_suggestion_json(tuples)),
 'name',f.name,'caloriesKcal',300,'proteinG',10,'carbohydrateG',40,'fatG',10,'grams',100,'policyVersion',p_policy,'reasonCode',p_reason,'localTime',lpad((m/60)::text,2,'0')||':'||lpad((m%60)::text,2,'0'),'timeZone','UTC',
 'weekdays',case when p_reason='weekly_pattern' then days else jsonb_build_array(0,1,2,3,4,5,6) end,'startLocalDate',((now() at time zone 'UTC')::date+1)::text,'expiresAt',public.recurring_suggestion_instant(date_trunc('milliseconds',f.created_at)+interval '7 days'));
end; $$;
create function pg_temp.mrs_validate(p_user text,p_proposal jsonb) returns text language sql as $$
 select format('select public.recurring_suggestion_validate(%L::uuid,%L::jsonb)',p_user,p_proposal);
$$;
create temporary table mrs_weekly_cases(user_id uuid primary key,request jsonb);
insert into mrs_weekly_cases select 'a2460000-0000-4000-8000-000000000001',jsonb_build_object('operationId',gen_random_uuid(),'proposal',p,'localTime',p->>'localTime','timeZone','UTC','weekdays',p->'weekdays')
from pg_temp.mrs_weekly('a2460000-0000-4000-8000-000000000001',array['d','d-2','d-7','d-9']) p;
grant select on mrs_weekly_cases to authenticated;

select ok(not has_function_privilege('authenticated','public.recurring_suggestion_validate_weekly(uuid,jsonb)','EXECUTE'),'Weekly evidence validator not callable by owners');
select ok(not has_function_privilege('anon','public.recurring_suggestion_validate_weekly(uuid,jsonb)','EXECUTE'),'Weekly evidence validator not callable anonymously');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.recurring_suggestion_validate_weekly(uuid,jsonb)'::regprocedure),'Weekly validator is security definer with an empty search_path');
select is((select jsonb_array_length(request->'proposal'->'evidence') from mrs_weekly_cases),4,'Two weekdays in both weeks give four evidence entries');
select is((select request->'proposal'->'weekdays' from mrs_weekly_cases),
 (select jsonb_agg(v order by v) from (select distinct extract(dow from (now() at time zone 'UTC')::date-k)::int v from unnest(array[0,2]) k) x),'Weekdays use 0 = Sunday dow for today and two days ago');
select lives_ok(pg_temp.mrs_validate('a2460000-0000-4000-8000-000000000001',(select request->'proposal' from mrs_weekly_cases)),'Valid weekly proposal re-validates at its lower-median time');

-- Tampering and structural rejections (validator called as the maintenance role).
select throws_ok(pg_temp.mrs_validate('a2460000-0000-4000-8000-000000000002',jsonb_set(pg_temp.mrs_weekly('a2460000-0000-4000-8000-000000000002',array['d','d-2','d-7','d-9']),'{weekdays}',
 (select jsonb_agg(v order by v) from (select distinct extract(dow from (now() at time zone 'UTC')::date-k)::int v from unnest(array[0,1,2]) k) x))),'23505',null,'Added weekday rejected');
select throws_ok(pg_temp.mrs_validate('a2460000-0000-4000-8000-000000000002',jsonb_set(pg_temp.mrs_weekly('a2460000-0000-4000-8000-000000000002',array['d','d-2','d-7','d-9']),'{weekdays}',
 jsonb_build_array(extract(dow from now() at time zone 'UTC')::int))),'23505',null,'Dropped weekday rejected');
select throws_ok(pg_temp.mrs_validate('a2460000-0000-4000-8000-000000000002',jsonb_set(pg_temp.mrs_weekly('a2460000-0000-4000-8000-000000000002',array['d','d-2','d-7','d-9']),'{localTime}',
 to_jsonb(case when pg_temp.mrs_weekly('a2460000-0000-4000-8000-000000000002',array['d','d-2','d-7','d-9'])->>'localTime'='06:00' then '06:15' else '06:00' end))),'23505',null,'Tampered time rejected');
select throws_ok(pg_temp.mrs_validate('a2460000-0000-4000-8000-000000000002',jsonb_set(pg_temp.mrs_weekly('a2460000-0000-4000-8000-000000000002',array['d','d-2','d-7','d-9']),'{evidenceDigest}','"00000000"')),'23505',null,'Tampered evidence digest rejected');
select throws_ok(pg_temp.mrs_validate('a2460000-0000-4000-8000-000000000002',pg_temp.mrs_weekly('a2460000-0000-4000-8000-000000000002',array['d','d-2','d-3','d-7'])),'23505',null,'Weekday seen once (missing occurrence) rejected');
select throws_ok(pg_temp.mrs_validate('a2460000-0000-4000-8000-000000000002',pg_temp.mrs_weekly('a2460000-0000-4000-8000-000000000002',array['d','d-2','d-7','d-14'])),'23505',null,'Evidence outside the fourteen-day window rejected');
select throws_ok(pg_temp.mrs_validate('a2460000-0000-4000-8000-000000000002',pg_temp.mrs_weekly('a2460000-0000-4000-8000-000000000002',array['d','d-7'])),'22023',null,'A single weekday is not a weekly pattern');
select throws_ok(pg_temp.mrs_validate('a2460000-0000-4000-8000-000000000002',pg_temp.mrs_weekly('a2460000-0000-4000-8000-000000000002',array['d','d-2','d-7','d-9'],'mrs-exact-3-v1')),'22023',null,'Weekly reason with daily policy rejected');
select throws_ok(pg_temp.mrs_validate('a2460000-0000-4000-8000-000000000002',pg_temp.mrs_weekly('a2460000-0000-4000-8000-000000000002',array['d','d-2','d-7','d-9'],'mrs-exact-3-v1','three_consecutive_days')),'22023',null,'Weekly evidence cannot pass as a daily proposal');
select throws_ok(pg_temp.mrs_validate('a2460000-0000-4000-8000-000000000002',
 (select jsonb_set(p,'{evidence}',(select jsonb_agg(value order by ordinality desc) from jsonb_array_elements(p->'evidence') with ordinality)) from pg_temp.mrs_weekly('a2460000-0000-4000-8000-000000000002',array['d','d-2','d-7','d-9']) p)),'23505',null,'Out-of-order evidence rejected');
select throws_ok(pg_temp.mrs_validate('a2460000-0000-4000-8000-000000000001',pg_temp.mrs_weekly('a2460000-0000-4000-8000-000000000002',array['d','d-2','d-7','d-9'])),'23505',null,'Another owner''s evidence cannot validate');

-- The daily policy is unaffected.
select lives_ok(pg_temp.mrs_validate('a2460000-0000-4000-8000-000000000003',pg_temp.mrs_weekly('a2460000-0000-4000-8000-000000000003',array['daily-0','daily-1','daily-2'],'mrs-exact-3-v1','three_consecutive_days')),'Daily three-day proposal still validates');
select throws_ok(pg_temp.mrs_validate('a2460000-0000-4000-8000-000000000003',pg_temp.mrs_weekly('a2460000-0000-4000-8000-000000000003',array['daily-0','daily-1','daily-2'])),'22023',null,'Three-day evidence cannot pass as weekly');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a2460000-0000-4000-8000-000000000001',true);
select lives_ok(format('select * from public.recurring_suggestion_decide(%L::jsonb,''shown'')',(select request->'proposal' from mrs_weekly_cases)),'Weekly offer records an impression');
select lives_ok(format('select * from public.recurring_suggestion_accept(%L::jsonb)',(select request from mrs_weekly_cases)),'Weekly acceptance creates and skips atomically');
select is((select weekdays from public.recurring_meal_schedules where user_id=auth.uid()),
 (select array_agg(v order by v) from (select distinct extract(dow from (now() at time zone 'UTC')::date-k)::int v from unnest(array[0,2]) k) x),'Schedule uses the proposal weekdays');
select is((select start_local_date from public.recurring_meal_suggestion_receipts where user_id=auth.uid()),
 (select min((now() at time zone 'UTC')::date+k) from generate_series(1,7) k where extract(dow from (now() at time zone 'UTC')::date+k)::int in(extract(dow from (now() at time zone 'UTC')::date)::int,extract(dow from (now() at time zone 'UTC')::date-2)::int)),
 'First automatic day is the next selected weekday');
select lives_ok(format('select * from public.recurring_suggestion_accept(%L::jsonb)',(select request from mrs_weekly_cases)),'Lost-response weekly replay succeeds');
select is((select count(*)::int from public.recurring_meal_schedules where user_id=auth.uid()),1,'Replay keeps one schedule');
select throws_ok(format('select * from public.recurring_meal_create(gen_random_uuid(),%L::uuid,%L,''UTC'',%L::integer[])',
 (select request->'proposal'->>'sourceEntryId' from mrs_weekly_cases),(select request->>'localTime' from mrs_weekly_cases),(select weekdays from public.recurring_meal_schedules where user_id=auth.uid())),'23505',null,'Equivalent manual weekly schedule conflicts');
select * from finish();
rollback;
