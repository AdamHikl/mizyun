-- NUTR-REC-001: explicitly authorized recurring meals, durable occurrence ledger.
create table public.recurring_meal_schedules (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  template jsonb not null check (jsonb_typeof(template) = 'object'),
  initial_request jsonb not null,
  local_time text not null check (local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  time_zone text not null,
  weekdays integer[] not null,
  enabled boolean not null default true,
  effective_from timestamptz not null default now(),
  stopped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  check (cardinality(weekdays) between 1 and 7 and weekdays <@ array[0,1,2,3,4,5,6])
);
create index recurring_meal_schedules_user_idx on public.recurring_meal_schedules(user_id);
create index recurring_meal_schedules_active_idx on public.recurring_meal_schedules(id) where enabled and stopped_at is null;
create table public.recurring_meal_occurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  schedule_id uuid not null,
  local_date date not null,
  food_entry_id uuid references public.food_entries(id) on delete set null,
  skipped boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (schedule_id, user_id) references public.recurring_meal_schedules(id, user_id) on delete cascade,
  unique (schedule_id, local_date)
);
create index recurring_meal_occurrences_user_idx on public.recurring_meal_occurrences(user_id);
alter table public.recurring_meal_schedules enable row level security;
alter table public.recurring_meal_occurrences enable row level security;
revoke all on public.recurring_meal_schedules, public.recurring_meal_occurrences from anon, authenticated;
grant select on public.recurring_meal_schedules, public.recurring_meal_occurrences to authenticated;
grant all on public.recurring_meal_schedules, public.recurring_meal_occurrences to service_role;
create policy recurring_meal_schedules_owner on public.recurring_meal_schedules for select to authenticated using (user_id = (select auth.uid()));
create policy recurring_meal_occurrences_owner on public.recurring_meal_occurrences for select to authenticated using (user_id = (select auth.uid()));

-- Validate direct RPC calls as well as API inputs. Normalization is not authorization.
create function public.recurring_meal_validate(p_time text, p_zone text, p_days integer[])
returns void language plpgsql set search_path = '' as $$
begin
  if p_time is null or p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or p_zone is null or p_zone !~ '^[A-Za-z_]+(/[A-Za-z0-9_+.-]+)*$'
    or p_zone in ('Factory','localtime') or p_zone ~ '^(posix|right)/'
    or not exists(select 1 from pg_catalog.pg_timezone_names where name = p_zone)
    or p_days is null or cardinality(p_days) not between 1 and 7
    or not (p_days <@ array[0,1,2,3,4,5,6]) or array_position(p_days, null) is not null
    or cardinality(p_days) <> (select count(distinct d) from unnest(p_days) d)
  then raise exception 'recurring_invalid' using errcode = '22023'; end if;
end; $$;
revoke all on function public.recurring_meal_validate(text,text,integer[]) from public,anon,authenticated,service_role;

create function public.recurring_meal_admit(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null then raise exception 'recurring_not_found' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('recurring-meal:' || p_user::text, 0));
  if exists(select 1 from public.account_deletion_jobs where user_id=p_user and status in ('in_progress','failed','completed'))
  then raise exception 'recurring_invalid' using errcode = '22023'; end if;
end; $$;
revoke all on function public.recurring_meal_admit(uuid) from public,anon,authenticated,service_role;

create function public.recurring_meal_snapshot(p_user uuid, p_source uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f public.food_entries;
begin
  select * into f from public.food_entries where id=p_source and user_id=p_user and confirmed_by_user;
  if not found then raise exception 'recurring_not_found' using errcode='P0002'; end if;
  if length(btrim(f.name)) not between 1 and 200
    or f.calories_kcal not between 0 and 20000 or f.protein_g not between 0 and 10000
    or f.carbohydrate_g not between 0 and 10000 or f.fat_g not between 0 and 10000
    or jsonb_typeof(f.details) is distinct from 'object'
  then raise exception 'recurring_invalid' using errcode='22023'; end if;
  return jsonb_build_object('name',f.name,'calories_kcal',f.calories_kcal,'protein_g',f.protein_g,
    'carbohydrate_g',f.carbohydrate_g,'fat_g',f.fat_g,'fibre_g',f.fibre_g,
    'saturated_fat_g',f.saturated_fat_g,'total_sugars_g',f.total_sugars_g,
    'sodium_mg',f.sodium_mg,'cholesterol_mg',f.cholesterol_mg,'confidence',f.confidence,
    'details',f.details - 'recurringMeal' - 'mealGroup');
end; $$;
revoke all on function public.recurring_meal_snapshot(uuid,uuid) from public,anon,authenticated,service_role;

create function public.recurring_meal_create(p_id uuid,p_source uuid,p_time text,p_zone text,p_days integer[])
returns setof public.recurring_meal_schedules language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); s public.recurring_meal_schedules; t jsonb; r jsonb;
begin
  perform public.recurring_meal_admit(u);
  perform public.recurring_meal_validate(p_time,p_zone,p_days);
  if p_id is null or p_source is null then raise exception 'recurring_invalid' using errcode='22023'; end if;
  p_days := array(select d from unnest(p_days) d order by d);
  r := jsonb_build_object('source',p_source,'time',p_time,'zone',p_zone,'days',p_days);
  select * into s from public.recurring_meal_schedules where id=p_id;
  if found then
    if s.user_id<>u then raise exception 'recurring_not_found' using errcode='P0002'; end if;
    if s.stopped_at is not null or s.initial_request<>r then raise exception 'recurring_conflict' using errcode='23505'; end if;
    return next s; return;
  end if;
  if (select count(*) from public.recurring_meal_schedules where user_id=u and stopped_at is null)>=20
  then raise exception 'recurring_invalid' using errcode='22023'; end if;
  t := public.recurring_meal_snapshot(u,p_source);
  insert into public.recurring_meal_schedules(id,user_id,name,template,initial_request,local_time,time_zone,weekdays)
    values(p_id,u,t->>'name',t,r,p_time,p_zone,p_days) returning * into s;
  return next s;
end; $$;
revoke all on function public.recurring_meal_create(uuid,uuid,text,text,integer[]) from public,anon,authenticated,service_role;
grant execute on function public.recurring_meal_create(uuid,uuid,text,text,integer[]) to authenticated;

create function public.recurring_meal_update(p_id uuid,p_patch jsonb)
returns setof public.recurring_meal_schedules language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); s public.recurring_meal_schedules; old_s public.recurring_meal_schedules;
begin
  perform public.recurring_meal_admit(u);
  select * into s from public.recurring_meal_schedules where id=p_id and user_id=u and stopped_at is null for update;
  if not found then return; end if;
  if p_patch is null or jsonb_typeof(p_patch)<>'object' or p_patch='{}'::jsonb
    or exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('sourceEntryId','localTime','timeZone','weekdays','enabled'))
    or exists(select 1 from jsonb_each(p_patch) e where e.value='null'::jsonb)
    or (p_patch ? 'enabled' and jsonb_typeof(p_patch->'enabled')<>'boolean')
    or (p_patch ? 'weekdays' and jsonb_typeof(p_patch->'weekdays')<>'array')
    or (p_patch ? 'weekdays' and exists(select 1 from jsonb_array_elements(p_patch->'weekdays') d where jsonb_typeof(d)<>'number' or d::text !~ '^[0-6]$'))
    or (p_patch ? 'localTime' and jsonb_typeof(p_patch->'localTime')<>'string')
    or (p_patch ? 'timeZone' and jsonb_typeof(p_patch->'timeZone')<>'string')
    or (p_patch ? 'sourceEntryId' and jsonb_typeof(p_patch->'sourceEntryId')<>'string')
  then raise exception 'recurring_invalid' using errcode='22023'; end if;
  old_s := s;
  s.local_time := coalesce(p_patch->>'localTime',s.local_time);
  s.time_zone := coalesce(p_patch->>'timeZone',s.time_zone);
  if p_patch ? 'weekdays' then s.weekdays := array(select d::integer from jsonb_array_elements_text(p_patch->'weekdays') d order by d::integer); end if;
  s.enabled := coalesce((p_patch->>'enabled')::boolean,s.enabled);
  perform public.recurring_meal_validate(s.local_time,s.time_zone,s.weekdays);
  if p_patch ? 'sourceEntryId' then s.template := public.recurring_meal_snapshot(u,(p_patch->>'sourceEntryId')::uuid); s.name:=s.template->>'name'; end if;
  if row(s.name,s.template,s.local_time,s.time_zone,s.weekdays,s.enabled) is not distinct from
    row(old_s.name,old_s.template,old_s.local_time,old_s.time_zone,old_s.weekdays,old_s.enabled)
  then return next s; return; end if;
  update public.recurring_meal_schedules set name=s.name,template=s.template,local_time=s.local_time,time_zone=s.time_zone,
    weekdays=s.weekdays,enabled=s.enabled,effective_from=now(),updated_at=now() where id=p_id returning * into s;
  return next s;
end; $$;
revoke all on function public.recurring_meal_update(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.recurring_meal_update(uuid,jsonb) to authenticated;

create function public.recurring_meal_stop(p_id uuid)
returns table(ok boolean) language plpgsql security definer set search_path = '' as $$
begin
  perform public.recurring_meal_admit(auth.uid());
  update public.recurring_meal_schedules set enabled=false,stopped_at=coalesce(stopped_at,now()),updated_at=now()
    where id=p_id and user_id=auth.uid();
  return query select found;
end; $$;
revoke all on function public.recurring_meal_stop(uuid) from public,anon,authenticated,service_role;
grant execute on function public.recurring_meal_stop(uuid) to authenticated;

create function public.recurring_meal_skip(p_id uuid,p_date date)
returns table(ok boolean) language plpgsql security definer set search_path = '' as $$
declare s public.recurring_meal_schedules; f uuid;
begin
  perform public.recurring_meal_admit(auth.uid());
  select * into s from public.recurring_meal_schedules where id=p_id and user_id=auth.uid() and stopped_at is null for update;
  if not found then return query select false; return; end if;
  if p_date is null or p_date<>(now() at time zone s.time_zone)::date then raise exception 'recurring_invalid' using errcode='22023'; end if;
  insert into public.recurring_meal_occurrences(user_id,schedule_id,local_date,skipped)
    values(s.user_id,s.id,p_date,true) on conflict(schedule_id,local_date) do update set skipped=true
    returning food_entry_id into f;
  delete from public.food_entries where id=f and user_id=s.user_id;
  return query select true;
end; $$;
revoke all on function public.recurring_meal_skip(uuid,date) from public,anon,authenticated,service_role;
grant execute on function public.recurring_meal_skip(uuid,date) to authenticated;

-- Deletion admission shares the worker's owner lock; not merely eventual cascade.
create function public.recurring_meal_deletion_barrier()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('in_progress','failed','completed') then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('recurring-meal:' || new.user_id::text,0));
    update public.recurring_meal_schedules set enabled=false,stopped_at=coalesce(stopped_at,now()),updated_at=now() where user_id=new.user_id;
  end if;
  return new;
end; $$;
revoke all on function public.recurring_meal_deletion_barrier() from public,anon,authenticated,service_role;
create trigger recurring_meal_deletion_barrier before insert or update of status on public.account_deletion_jobs
  for each row execute function public.recurring_meal_deletion_barrier();

-- Service-only clock parameter supports deterministic SQL acceptance; API always omits it.
create function public.recurring_meal_tick(p_now timestamptz default now())
returns table(generated integer) language plpgsql security definer set search_path = '' as $$
declare candidate record; s public.recurring_meal_schedules; d date; due timestamptz; f uuid; n integer:=0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'recurring_not_found' using errcode='42501'; end if;
  if p_now is null or not isfinite(p_now) then raise exception 'recurring_invalid' using errcode='22023'; end if;
  for candidate in select id,user_id from public.recurring_meal_schedules q
    where enabled and stopped_at is null
      and extract(dow from p_now at time zone time_zone)::integer=any(weekdays)
      and (((p_now at time zone time_zone)::date+local_time::time) at time zone time_zone) between effective_from and p_now
      and not exists(select 1 from public.recurring_meal_occurrences o where o.schedule_id=q.id and o.local_date=(p_now at time zone q.time_zone)::date)
    order by user_id,id limit 500
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('recurring-meal:' || candidate.user_id::text,0));
    select * into s from public.recurring_meal_schedules where id=candidate.id for update;
    if not found or not s.enabled or s.stopped_at is not null then continue; end if;
    if exists(select 1 from public.account_deletion_jobs where user_id=s.user_id and status in ('in_progress','failed','completed')) then continue; end if;
    d := (p_now at time zone s.time_zone)::date;
    due := (d+s.local_time::time) at time zone s.time_zone;
    if due>p_now or due<s.effective_from or not (extract(dow from d)::integer=any(s.weekdays)) then continue; end if;
    if exists(select 1 from public.recurring_meal_occurrences where schedule_id=s.id and local_date=d) then continue; end if;
    f := gen_random_uuid();
    insert into public.food_entries(id,user_id,consumed_at,name,calories_kcal,protein_g,carbohydrate_g,fat_g,
      fibre_g,saturated_fat_g,total_sugars_g,sodium_mg,cholesterol_mg,source,confidence,confirmed_by_user,details)
    select f,s.user_id,due,s.name,(s.template->>'calories_kcal')::numeric,(s.template->>'protein_g')::numeric,
      (s.template->>'carbohydrate_g')::numeric,(s.template->>'fat_g')::numeric,
      case when access.pro then (s.template->>'fibre_g')::numeric end,case when access.pro then (s.template->>'saturated_fat_g')::numeric end,
      case when access.pro then (s.template->>'total_sugars_g')::numeric end,case when access.pro then (s.template->>'sodium_mg')::numeric end,
      case when access.pro then (s.template->>'cholesterol_mg')::numeric end,'manual',(s.template->>'confidence')::numeric,true,
      coalesce(s.template->'details','{}'::jsonb)||jsonb_build_object('recurringMeal',jsonb_build_object('scheduleId',s.id,'localDate',d::text,'timeZone',s.time_zone))
    from (select exists(select 1 from public.profiles where id=s.user_id and plan_tier='paid')
      or exists(select 1 from public.beta_pro_requests where user_id=s.user_id and status='approved') as pro) access;
    insert into public.recurring_meal_occurrences(user_id,schedule_id,local_date,food_entry_id) values(s.user_id,s.id,d,f);
    n := n+1;
  end loop;
  return query select n;
end; $$;
revoke all on function public.recurring_meal_tick(timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.recurring_meal_tick(timestamptz) to service_role;
