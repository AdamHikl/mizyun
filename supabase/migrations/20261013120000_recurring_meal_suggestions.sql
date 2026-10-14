-- MRS: private owner controls and immutable transactional acceptance receipts.
create table public.recurring_meal_suggestion_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
create table public.recurring_meal_suggestion_states (
  user_id uuid not null references auth.users(id) on delete cascade,
  family_key text not null check(length(family_key) between 1 and 200),
  first_shown_at timestamptz,
  expires_at timestamptz,
  cooldown_until timestamptz,
  never boolean not null default false,
  accepted_schedule_id uuid,
  updated_at timestamptz not null default now(),
  primary key(user_id,family_key),
  foreign key(accepted_schedule_id,user_id) references public.recurring_meal_schedules(id,user_id)
);
create table public.recurring_meal_suggestion_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  request jsonb not null,
  schedule_id uuid not null,
  created boolean not null,
  start_local_date date not null,
  created_at timestamptz not null default now(),
  primary key(user_id,operation_id),
  foreign key(schedule_id,user_id) references public.recurring_meal_schedules(id,user_id)
);
alter table public.recurring_meal_suggestion_preferences enable row level security;
alter table public.recurring_meal_suggestion_states enable row level security;
alter table public.recurring_meal_suggestion_receipts enable row level security;
revoke all on public.recurring_meal_suggestion_preferences,public.recurring_meal_suggestion_states,public.recurring_meal_suggestion_receipts from anon,authenticated;
grant select on public.recurring_meal_suggestion_preferences,public.recurring_meal_suggestion_states,public.recurring_meal_suggestion_receipts to authenticated;
grant all on public.recurring_meal_suggestion_preferences,public.recurring_meal_suggestion_states,public.recurring_meal_suggestion_receipts to service_role;
create policy recurring_suggestion_preferences_owner on public.recurring_meal_suggestion_preferences for select to authenticated using(user_id=(select auth.uid()));
create policy recurring_suggestion_states_owner on public.recurring_meal_suggestion_states for select to authenticated using(user_id=(select auth.uid()));
create policy recurring_suggestion_receipts_owner on public.recurring_meal_suggestion_receipts for select to authenticated using(user_id=(select auth.uid()));

-- Version-independent family normalization. Explicit JS whitespace set, NFC and
-- ASCII case folding; other Unicode case is preserved to avoid locale drift.
-- Identity remains private health-derived data.
create function public.recurring_suggestion_family(p_name text) returns text
language sql immutable set search_path='' as $$
  select translate(btrim(regexp_replace(normalize(p_name,NFC),U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',' ','g')),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz');
$$;
create function public.recurring_suggestion_identity(p_template jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_array(public.recurring_suggestion_family(p_template->>'name'),p_template->'calories_kcal',p_template->'protein_g',p_template->'carbohydrate_g',p_template->'fat_g',case when jsonb_typeof(p_template->'details'->'grams')='number' then p_template->'details'->'grams' else 'null'::jsonb end);
$$;
-- JSON.stringify parity for the arrays used in consistency digests (never auth).
create function public.recurring_suggestion_json(p_value jsonb) returns text
language plpgsql immutable set search_path='' as $$
declare result text; digits text; zeroes integer;
begin
 if jsonb_typeof(p_value)='array' then
   select '['||coalesce(string_agg(public.recurring_suggestion_json(value),',' order by ordinality),'')||']' into result from jsonb_array_elements(p_value) with ordinality;
   return result;
 elsif jsonb_typeof(p_value)='number' then
   if abs((p_value::text)::numeric)>0 and abs((p_value::text)::numeric)<0.000001 then
     digits:=rtrim(split_part(abs((p_value::text)::numeric)::text,'.',2),'0');
     zeroes:=length(digits)-length(ltrim(digits,'0')); digits:=ltrim(digits,'0');
     return case when (p_value::text)::numeric<0 then '-' else '' end||left(digits,1)||case when length(digits)>1 then '.'||substr(digits,2) else '' end||'e-'||(zeroes+1)::text;
   end if;
   return case when position('.' in p_value::text)>0 then rtrim(rtrim(p_value::text,'0'),'.') else p_value::text end;
 end if;
 return p_value::text;
end; $$;
create function public.recurring_suggestion_digest(p_value text) returns text
language plpgsql immutable set search_path='' as $$
declare h bigint:=2166136261; c integer; i integer;
begin
 for i in 1..length(p_value) loop
   c:=ascii(substr(p_value,i,1));
   if c>65535 then
     h:=((h # (55296+((c-65536)/1024))) * 16777619)%4294967296;
     c:=56320+((c-65536)%1024);
   end if;
   h:=((h # c::bigint)*16777619)%4294967296;
 end loop;
 return lpad(to_hex(h),8,'0');
end; $$;
create function public.recurring_suggestion_instant(p_at timestamptz) returns text
language sql immutable set search_path='' as $$
 select to_char(p_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')||'.'||case when extract(microseconds from p_at)::bigint%1000=0 then to_char(p_at at time zone 'UTC','MS') else rtrim(to_char(p_at at time zone 'UTC','US'),'0') end||'Z';
$$;

-- Independently validate the evidence and frozen proposal under row locks.
-- Does not trust either the client's consistency digest or nutrition snapshot.
create function public.recurring_suggestion_validate(p_user uuid,p_proposal jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e jsonb; f public.food_entries; src public.food_entries; ident jsonb; other_ident jsonb;
  tuples jsonb:='[]'; minutes integer[]:='{}'; d date; zone text; family text;
  time text; median integer; digest text; candidate text; n integer:=0; expiry timestamptz; state public.recurring_meal_suggestion_states;
begin
 if p_proposal is null or jsonb_typeof(p_proposal)<>'object' or jsonb_typeof(p_proposal->'evidence')<>'array' or jsonb_array_length(p_proposal->'evidence')<>3
   or not(p_proposal ?& array['candidateId','familyKey','sourceEntryId','sourceUpdatedAt','evidence','evidenceDigest','name','caloriesKcal','proteinG','carbohydrateG','fatG','grams','policyVersion','reasonCode','localTime','timeZone','weekdays','startLocalDate','expiresAt']) or p_proposal->>'policyVersion' is distinct from 'mrs-exact-3-v1' or p_proposal->>'reasonCode' is distinct from 'three_consecutive_days'
 then raise exception 'suggestion_invalid' using errcode='22023'; end if;
 zone:=p_proposal->>'timeZone';
 perform public.recurring_meal_validate('12:00',zone,array[0]);
 d:=(now() at time zone zone)::date;
 -- Lock in UUID order, including supporting entries, against concurrent edit/delete.
 perform 1 from public.food_entries where user_id=p_user and id in(select (value->>'id')::uuid from jsonb_array_elements(p_proposal->'evidence')) order by id for update;
 for e in select value from jsonb_array_elements(p_proposal->'evidence') loop
   if jsonb_typeof(e) is distinct from 'object' or not(e ?& array['id','updatedAt','localDate']) then raise exception 'suggestion_invalid' using errcode='22023'; end if;
   select * into f from public.food_entries where user_id=p_user and id=(e->>'id')::uuid;
   if not found or not f.confirmed_by_user or f.consumed_at>now() or f.created_at>now() or f.updated_at>now()
     or f.updated_at is distinct from (e->>'updatedAt')::timestamptz or e->>'localDate' is distinct from (d-2+n)::text
     or (f.consumed_at at time zone zone)::date<>d-2+n
     or (f.details->'recurringMeal' is not null and f.details->'recurringMeal'<>'null'::jsonb)
     or exists(select 1 from public.recurring_meal_occurrences where user_id=p_user and food_entry_id=f.id)
   then raise exception 'suggestion_stale' using errcode='23505'; end if;
   other_ident:=public.recurring_suggestion_identity(to_jsonb(f));
   if n=0 then ident:=other_ident; elsif ident<>other_ident then raise exception 'suggestion_stale' using errcode='23505'; end if;
   if exists(select 1 from jsonb_array_elements(other_ident) with ordinality v where ordinality>1 and value<>'null'::jsonb and (jsonb_typeof(value)<>'number' or (value::text)::numeric not between 0 and 20000))
   then raise exception 'suggestion_invalid' using errcode='22023'; end if;
   tuples:=tuples||jsonb_build_array(jsonb_build_array(f.id,e->>'updatedAt',e->>'localDate'));
   minutes:=array_append(minutes,extract(hour from f.consumed_at at time zone zone)::integer*60+extract(minute from f.consumed_at at time zone zone)::integer);
   src:=f; n:=n+1;
 end loop;
 family:=ident->>0;
 if family='' or lower(family)=any(array['breakfast','lunch','dinner','snack','meal','food','brunch','supper','raňajky','obed','večera','desiata','olovrant'])
   or src.id is distinct from (p_proposal->>'sourceEntryId')::uuid or src.updated_at is distinct from (p_proposal->>'sourceUpdatedAt')::timestamptz
   or (src.created_at at time zone zone)::date<>d or src.created_at<now()-interval '24 hours'
   or family is distinct from p_proposal->>'familyKey' or src.name is distinct from p_proposal->>'name'
   or ident<>jsonb_build_array(family,p_proposal->'caloriesKcal',p_proposal->'proteinG',p_proposal->'carbohydrateG',p_proposal->'fatG',p_proposal->'grams')
 then raise exception 'suggestion_stale' using errcode='23505'; end if;
 select array_agg(v order by v) into minutes from unnest(minutes) v;
 median:=((minutes[2]+7)/15)*15;
 if minutes[3]-minutes[1]>90 or median>=1440 then raise exception 'suggestion_stale' using errcode='23505'; end if;
 time:=lpad((median/60)::text,2,'0')||':'||lpad((median%60)::text,2,'0');
 digest:=public.recurring_suggestion_digest(public.recurring_suggestion_json(tuples));
 candidate:='mrs1-'||public.recurring_suggestion_digest(public.recurring_suggestion_json(jsonb_build_array('mrs-exact-3-v1',zone,public.recurring_suggestion_json(ident),tuples)));
 select * into state from public.recurring_meal_suggestion_states where user_id=p_user and family_key=family;
 expiry:=case when (state.cooldown_until<=now() or state.expires_at+interval '30 days'<=now()) then date_trunc('milliseconds',src.created_at)+interval '7 days' else coalesce(state.expires_at,date_trunc('milliseconds',src.created_at)+interval '7 days') end;
 if p_proposal->>'evidenceDigest' is distinct from digest or p_proposal->>'candidateId' is distinct from candidate
   or p_proposal->>'localTime' is distinct from time or p_proposal->'weekdays' is distinct from '[0,1,2,3,4,5,6]'::jsonb
   or p_proposal->>'startLocalDate' is distinct from (d+1)::text or ((p_proposal->>'expiresAt')::timestamptz is distinct from expiry and (p_proposal->>'expiresAt')::timestamptz is distinct from date_trunc('milliseconds',src.created_at)+interval '7 days') or expiry<=now()
 then raise exception 'suggestion_stale' using errcode='23505'; end if;
 return public.recurring_meal_snapshot(p_user,src.id);
end; $$;

create function public.recurring_suggestion_context(p_entry_ids uuid[])
returns table(context jsonb) language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
 if u is null then raise exception 'suggestion_not_found' using errcode='42501'; end if;
 if cardinality(p_entry_ids)>5000 then raise exception 'suggestion_invalid' using errcode='22023'; end if;
 return query select jsonb_build_object('userId',u,'enabled',coalesce((select enabled from public.recurring_meal_suggestion_preferences where user_id=u),true),
 'states',coalesce((select jsonb_agg(to_jsonb(s)) from public.recurring_meal_suggestion_states s where user_id=u),'[]'::jsonb),
 'schedules',coalesce((select jsonb_agg(jsonb_build_object('identityKey',public.recurring_suggestion_json(public.recurring_suggestion_identity(template)),'localTime',local_time,'timeZone',time_zone,'weekdays',weekdays,'stopped',stopped_at is not null)) from public.recurring_meal_schedules where user_id=u and stopped_at is null),'[]'::jsonb),
 'generatedEntryIds',coalesce((select jsonb_agg(food_entry_id) from public.recurring_meal_occurrences where user_id=u and food_entry_id=any(p_entry_ids)),'[]'::jsonb));
end; $$;

create function public.recurring_suggestion_decide(p_proposal jsonb,p_decision text)
returns table(ok boolean) language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); family text; s public.recurring_meal_suggestion_states;
begin
 perform public.recurring_meal_admit(u);
 if p_decision is null or p_decision not in('shown','not_now','never') then raise exception 'suggestion_invalid' using errcode='22023'; end if;
 family:=p_proposal->>'familyKey';
 select * into s from public.recurring_meal_suggestion_states where user_id=u and family_key=family;
 -- A repeated decision on a currently shown offer never extends its lifetime/cooldown.
 if found and s.first_shown_at is not null and s.expires_at>now() then
   if p_decision='shown' then return query select true; return; end if;
   if (p_decision='never' and s.never) or (p_decision='not_now' and s.cooldown_until>now()) then return query select true; return; end if;
 end if;
 perform public.recurring_suggestion_validate(u,p_proposal);
 if coalesce((select enabled from public.recurring_meal_suggestion_preferences where user_id=u),true)=false
   or s.never or s.accepted_schedule_id is not null or s.cooldown_until>now() or (s.cooldown_until is null and s.expires_at<=now() and s.expires_at+interval '30 days'>now())
 then raise exception 'suggestion_stale' using errcode='23505'; end if;
 if p_decision='shown' and exists(select 1 from public.recurring_meal_suggestion_states where user_id=u and family_key<>family and first_shown_at>now()-interval '7 days')
 then raise exception 'suggestion_stale' using errcode='23505'; end if;
 insert into public.recurring_meal_suggestion_states(user_id,family_key,first_shown_at,expires_at,cooldown_until,never)
 values(u,family,now(),date_trunc('milliseconds',now())+interval '7 days',case when p_decision='not_now' then now()+interval '30 days' end,p_decision='never')
 on conflict(user_id,family_key) do update set
   first_shown_at=case when (public.recurring_meal_suggestion_states.cooldown_until<=now() or public.recurring_meal_suggestion_states.expires_at+interval '30 days'<=now()) then excluded.first_shown_at else coalesce(public.recurring_meal_suggestion_states.first_shown_at,excluded.first_shown_at) end,
   expires_at=case when (public.recurring_meal_suggestion_states.cooldown_until<=now() or public.recurring_meal_suggestion_states.expires_at+interval '30 days'<=now()) then excluded.expires_at else coalesce(public.recurring_meal_suggestion_states.expires_at,excluded.expires_at) end,
   cooldown_until=case when p_decision='not_now' then excluded.cooldown_until when p_decision='shown' then null else public.recurring_meal_suggestion_states.cooldown_until end,
   never=public.recurring_meal_suggestion_states.never or excluded.never,updated_at=now();
 return query select true;
end; $$;

create function public.recurring_suggestion_preferences(p_enabled boolean default null,p_reset boolean default false)
returns table(enabled boolean) language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
 if u is null then raise exception 'suggestion_not_found' using errcode='42501'; end if;
 if p_enabled is not null or p_reset then
   perform public.recurring_meal_admit(u);
   if p_enabled is not null then insert into public.recurring_meal_suggestion_preferences(user_id,enabled) values(u,p_enabled) on conflict(user_id) do update set enabled=excluded.enabled,updated_at=now(); end if;
   if p_reset then update public.recurring_meal_suggestion_states set never=false,cooldown_until=null,first_shown_at=null,expires_at=null,updated_at=now() where user_id=u and accepted_schedule_id is null; end if;
 end if;
 return query select coalesce((select p.enabled from public.recurring_meal_suggestion_preferences p where user_id=u),true);
end; $$;

create function public.recurring_suggestion_accept(p_request jsonb)
returns table(result jsonb) language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); r public.recurring_meal_suggestion_receipts; s public.recurring_meal_schedules;
 t jsonb; proposal jsonb; family text; v_operation_id uuid; v_schedule_id uuid; days integer[]; local_today date; start date; made boolean:=false; skipped boolean; state public.recurring_meal_suggestion_states;
begin
 perform public.recurring_meal_admit(u);
 if p_request is null or jsonb_typeof(p_request) is distinct from 'object' or not(p_request ?& array['operationId','proposal','localTime','timeZone','weekdays']) then raise exception 'suggestion_invalid' using errcode='22023'; end if;
 v_operation_id:=(p_request->>'operationId')::uuid;
 if v_operation_id is null then raise exception 'suggestion_invalid' using errcode='22023'; end if;
 select receipt.* into r from public.recurring_meal_suggestion_receipts receipt where receipt.user_id=u and receipt.operation_id=v_operation_id;
 if found then
   if r.request<>p_request then raise exception 'suggestion_conflict' using errcode='23505'; end if;
   select schedule.* into s from public.recurring_meal_schedules schedule where schedule.id=r.schedule_id and schedule.user_id=u;
   return query select jsonb_build_object('schedule',to_jsonb(s),'created',r.created,'startLocalDate',r.start_local_date::text); return;
 end if;
 proposal:=p_request->'proposal';
 if p_request->>'timeZone' is distinct from proposal->>'timeZone' then raise exception 'suggestion_stale' using errcode='23505'; end if;
 if jsonb_typeof(p_request->'weekdays') is distinct from 'array' or exists(select 1 from jsonb_array_elements(p_request->'weekdays') v where jsonb_typeof(v)<>'number' or v::text!~'^[0-6]$') then raise exception 'suggestion_invalid' using errcode='22023'; end if;
 days:=array(select value::integer from jsonb_array_elements_text(p_request->'weekdays') order by value::integer);
 perform public.recurring_meal_validate(p_request->>'localTime',p_request->>'timeZone',days);
 t:=public.recurring_suggestion_validate(u,proposal); family:=proposal->>'familyKey';
 select controls.* into state from public.recurring_meal_suggestion_states controls where controls.user_id=u and controls.family_key=family;
 if coalesce((select preferences.enabled from public.recurring_meal_suggestion_preferences preferences where preferences.user_id=u),true)=false or state.never or state.cooldown_until>now() or (state.cooldown_until is null and state.expires_at<=now() and state.expires_at+interval '30 days'>now())
 then raise exception 'suggestion_stale' using errcode='23505'; end if;
 -- Accepted/Stopped remains a permanent negative signal, including another operation.
 if state.accepted_schedule_id is not null then
   select schedule.* into s from public.recurring_meal_schedules schedule where schedule.id=state.accepted_schedule_id and schedule.user_id=u;
   if s.stopped_at is not null then raise exception 'suggestion_stale' using errcode='23505'; end if;
 end if;
 -- Equivalence uses current template, including paused schedules and edited snapshots.
 select schedule.* into s from public.recurring_meal_schedules schedule where schedule.user_id=u and schedule.stopped_at is null
   and public.recurring_suggestion_identity(schedule.template)=public.recurring_suggestion_identity(t)
   and schedule.local_time=p_request->>'localTime' and schedule.time_zone=p_request->>'timeZone' and schedule.weekdays=days
   order by schedule.created_at,schedule.id limit 1 for update;
 local_today:=(now() at time zone (p_request->>'timeZone'))::date; start:=local_today+1;
 while not(extract(dow from start)::integer=any(days)) loop start:=start+1; end loop;
 if not found then
   if state.accepted_schedule_id is not null then raise exception 'suggestion_stale' using errcode='23505'; end if;
   v_schedule_id:=gen_random_uuid();
   select created_schedule.* into s from public.recurring_meal_create(v_schedule_id,(proposal->>'sourceEntryId')::uuid,p_request->>'localTime',p_request->>'timeZone',days) created_schedule;
   select outcome.ok into skipped from public.recurring_meal_skip(v_schedule_id,local_today) outcome;
   if skipped is distinct from true then raise exception 'suggestion_skip_failed' using errcode='23505'; end if;
   made:=true;
 end if;
 insert into public.recurring_meal_suggestion_states(user_id,family_key,accepted_schedule_id) values(u,family,s.id)
 on conflict(user_id,family_key) do update set accepted_schedule_id=excluded.accepted_schedule_id,updated_at=now();
 insert into public.recurring_meal_suggestion_receipts(user_id,operation_id,request,schedule_id,created,start_local_date)
 values(u,v_operation_id,p_request,s.id,made,start);
 return query select jsonb_build_object('schedule',to_jsonb(s),'created',made,'startLocalDate',start::text);
end; $$;

-- Reciprocal manual-create check after the SAME owner lock. Existing id retries
-- resolve first; new manual equivalents of suggestion-linked schedules conflict.
create or replace function public.recurring_meal_create(p_id uuid,p_source uuid,p_time text,p_zone text,p_days integer[])
returns setof public.recurring_meal_schedules language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); s public.recurring_meal_schedules; t jsonb; r jsonb;
begin
 perform public.recurring_meal_admit(u); perform public.recurring_meal_validate(p_time,p_zone,p_days);
 if p_id is null or p_source is null then raise exception 'recurring_invalid' using errcode='22023'; end if;
 p_days:=array(select d from unnest(p_days) d order by d);
 r:=jsonb_build_object('source',p_source,'time',p_time,'zone',p_zone,'days',p_days);
 select * into s from public.recurring_meal_schedules where id=p_id;
 if found then
   if s.user_id<>u then raise exception 'recurring_not_found' using errcode='P0002'; end if;
   if s.stopped_at is not null or s.initial_request<>r then raise exception 'recurring_conflict' using errcode='23505'; end if;
   return next s; return;
 end if;
 if(select count(*) from public.recurring_meal_schedules where user_id=u and stopped_at is null)>=20 then raise exception 'recurring_invalid' using errcode='22023'; end if;
 t:=public.recurring_meal_snapshot(u,p_source);
 if exists(select 1 from public.recurring_meal_schedules q join public.recurring_meal_suggestion_states x on x.user_id=q.user_id and x.accepted_schedule_id=q.id
   where q.user_id=u and q.stopped_at is null and public.recurring_suggestion_identity(q.template)=public.recurring_suggestion_identity(t)
   and q.local_time=p_time and q.time_zone=p_zone and q.weekdays=p_days)
 then raise exception 'recurring_already_scheduled' using errcode='23505'; end if;
 insert into public.recurring_meal_schedules(id,user_id,name,template,initial_request,local_time,time_zone,weekdays) values(p_id,u,t->>'name',t,r,p_time,p_zone,p_days) returning * into s;
 return next s;
end; $$;

create function public.recurring_suggestion_clear() returns table(ok boolean)
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'suggestion_not_found' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('recurring-meal:'||auth.uid()::text,0));
 -- Retried erasure is allowed after admission closes; never clears the barrier.
 if not exists(select 1 from public.account_deletion_jobs where user_id=auth.uid() and status in('in_progress','failed','completed')) then raise exception 'suggestion_invalid' using errcode='22023'; end if;
 delete from public.recurring_meal_suggestion_receipts where user_id=auth.uid();
 delete from public.recurring_meal_suggestion_states where user_id=auth.uid();
 delete from public.recurring_meal_suggestion_preferences where user_id=auth.uid();
 return query select true;
end; $$;

revoke all on function public.recurring_suggestion_family(text),public.recurring_suggestion_identity(jsonb),public.recurring_suggestion_json(jsonb),public.recurring_suggestion_digest(text),public.recurring_suggestion_instant(timestamptz),public.recurring_suggestion_validate(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.recurring_suggestion_context(uuid[]),public.recurring_suggestion_decide(jsonb,text),public.recurring_suggestion_preferences(boolean,boolean),public.recurring_suggestion_accept(jsonb),public.recurring_suggestion_clear() from public,anon,authenticated,service_role;
grant execute on function public.recurring_suggestion_context(uuid[]),public.recurring_suggestion_decide(jsonb,text),public.recurring_suggestion_preferences(boolean,boolean),public.recurring_suggestion_accept(jsonb),public.recurring_suggestion_clear() to authenticated;

create function public.recurring_suggestion_write_barrier() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform public.recurring_meal_admit(new.user_id);
 return new;
end; $$;
revoke all on function public.recurring_suggestion_write_barrier() from public,anon,authenticated,service_role;
create trigger recurring_suggestion_preferences_barrier before insert or update on public.recurring_meal_suggestion_preferences for each row execute function public.recurring_suggestion_write_barrier();
create trigger recurring_suggestion_states_barrier before insert or update on public.recurring_meal_suggestion_states for each row execute function public.recurring_suggestion_write_barrier();
create trigger recurring_suggestion_receipts_barrier before insert or update on public.recurring_meal_suggestion_receipts for each row execute function public.recurring_suggestion_write_barrier();
