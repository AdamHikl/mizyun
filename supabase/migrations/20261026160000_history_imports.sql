-- #333 / ADR-0083: user-confirmed history imports from Hevy, Strong, the
-- user's own Strava account export and a generic CSV. One batch row per
-- confirmed import; every imported workout or run carries the batch id and a
-- per-record import key, so retries and overlapping re-imports write each
-- record once and the whole batch can be removed. Writes go only through the
-- security-definer RPCs below. Preserves the RUN-02/RUN-06 run invariants.

create table public.history_import_batches (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 format text not null check (format in ('hevy','strong','strava','generic')),
 file_name text check (file_name is null or (length(file_name) between 1 and 200 and btrim(file_name) = file_name)),
 request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
 status text not null default 'importing' check (status in ('importing','complete')),
 chunks_done integer not null default 0 check (chunks_done between 0 and 1000),
 workout_count integer not null default 0 check (workout_count >= 0),
 set_count integer not null default 0 check (set_count >= 0),
 run_count integer not null default 0 check (run_count >= 0),
 duplicate_count integer not null default 0 check (duplicate_count >= 0),
 overlap_count integer not null default 0 check (overlap_count >= 0),
 first_started_at timestamptz,
 last_started_at timestamptz,
 created_exercise_ids uuid[] not null default '{}',
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 unique (id, user_id),
 check ((status = 'complete') = (completed_at is not null))
);
create index history_import_batches_user_id_idx on public.history_import_batches(user_id, created_at desc);
alter table public.history_import_batches enable row level security;
create policy history_import_batches_select_own on public.history_import_batches for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.history_import_batches from anon;
revoke insert, update, delete, truncate on public.history_import_batches from authenticated;
grant select on public.history_import_batches to authenticated;

alter table public.workouts
 add column import_batch_id uuid,
 add column import_key text check (import_key is null or (length(import_key) between 3 and 300 and import_key ~ '^(hevy|strong|strava|generic):')),
 add constraint workouts_import_batch_fkey foreign key (import_batch_id, user_id) references public.history_import_batches(id, user_id) on delete cascade,
 add constraint workouts_import_pair_check check ((import_batch_id is null) = (import_key is null));
create unique index workouts_import_key_idx on public.workouts(user_id, import_key) where import_key is not null;
create index workouts_import_batch_idx on public.workouts(import_batch_id) where import_batch_id is not null;

do $$
declare c record;
begin
 for c in select con.conname from pg_catalog.pg_constraint con
  where con.conrelid='public.workouts'::regclass and con.contype='c'
   and con.conkey=array[(select attnum from pg_catalog.pg_attribute where attrelid='public.workouts'::regclass and attname='source')]
 loop execute format('alter table public.workouts drop constraint %I',c.conname); end loop;
end; $$;
alter table public.workouts add constraint workouts_source_check check (source in ('manual','health_import','file_import'));
alter table public.workouts add constraint workouts_file_import_source_check check ((source = 'file_import') = (import_batch_id is not null));

-- Provenance is set only by the import RPCs and never changes afterwards.
create function public.history_import_workout_guard() returns trigger language plpgsql set search_path='' as $$
declare owner_name text;
begin
 if tg_op = 'UPDATE' then
  if new.import_batch_id is distinct from old.import_batch_id or new.import_key is distinct from old.import_key
   or (new.source is distinct from old.source and 'file_import' in (new.source, old.source))
  then raise exception 'history_import_invalid' using errcode='22023'; end if;
  return new;
 end if;
 if new.import_batch_id is null and new.import_key is null and new.source <> 'file_import' then return new; end if;
 select pg_catalog.pg_get_userbyid(relowner) into owner_name from pg_catalog.pg_class where oid='public.workouts'::regclass;
 if current_user <> owner_name then raise exception 'history_import_requires_rpc' using errcode='42501'; end if;
 return new;
end; $$;
revoke all on function public.history_import_workout_guard() from public,anon,authenticated,service_role;
create trigger history_import_workout_guard before insert or update on public.workouts for each row execute function public.history_import_workout_guard();

-- Runs: a `file_import` origin (Strava activities.csv) joins manual and Health
-- origins. Bodies below are the 20261016120000 definitions with only the
-- file-import branches added.
create or replace function public.run_validate(p_summary jsonb) returns void language plpgsql set search_path='' as $$
declare d date; zone text; start_time timestamptz; duration numeric; distance numeric; effort numeric; origin jsonb;
begin
 if p_summary is null or jsonb_typeof(p_summary) <> 'object' or
  not p_summary ?& array['version','activityDate','recordingTimezone','timePrecision','startedAt','durationSeconds','durationBasis','distanceMeters','environment','perceivedExertion','origin','timestampEnvelope','revision'] or
  p_summary - array['version','activityDate','recordingTimezone','timePrecision','startedAt','durationSeconds','durationBasis','distanceMeters','environment','perceivedExertion','origin','timestampEnvelope','revision'] <> '{}'::jsonb or
  p_summary->'version' <> '1'::jsonb or jsonb_typeof(p_summary->'durationBasis') <> 'string' or p_summary->>'durationBasis' not in ('elapsed','active') or
  jsonb_typeof(p_summary->'origin') <> 'object' or
  jsonb_typeof(p_summary->'activityDate') <> 'string' or p_summary->>'activityDate' !~ '^\d{4}-\d{2}-\d{2}$' or
  jsonb_typeof(p_summary->'recordingTimezone') <> 'string' or length(p_summary->>'recordingTimezone') > 100 or
  jsonb_typeof(p_summary->'durationSeconds') <> 'number' or jsonb_typeof(p_summary->'revision') <> 'number' or
  jsonb_typeof(p_summary->'environment') <> 'string' or
  jsonb_typeof(p_summary->'timePrecision') <> 'string' or jsonb_typeof(p_summary->'timestampEnvelope') <> 'string' or
  p_summary->>'environment' not in ('outdoor','treadmill','unspecified')
 then raise exception 'run_invalid' using errcode='22023'; end if;
 origin := p_summary->'origin';
 if origin = '{"kind":"manual"}'::jsonb then
  if p_summary->>'durationBasis' <> 'elapsed' then raise exception 'run_invalid' using errcode='22023'; end if;
 elsif origin->'kind' = '"file_import"'::jsonb then
  -- History import (ADR-0083): the user's own export file, never a provider API.
  if not origin ?& array['kind','format','externalId'] or origin - array['kind','format','externalId'] <> '{}'::jsonb or
   jsonb_typeof(origin->'format') <> 'string' or origin->>'format' not in ('strava') or
   jsonb_typeof(origin->'externalId') <> 'string' or length(origin->>'externalId') not between 1 and 255 or btrim(origin->>'externalId') <> origin->>'externalId' or
   p_summary->>'timePrecision' <> 'instant' or p_summary->>'durationBasis' <> 'elapsed'
  then raise exception 'run_invalid' using errcode='22023'; end if;
 elsif not origin ?& array['kind','provider','sourceAppId','sourceAppName','externalId'] or
  origin - array['kind','provider','sourceAppId','sourceAppName','externalId'] <> '{}'::jsonb or
  origin->'kind' <> '"health_import"'::jsonb or
  jsonb_typeof(origin->'provider') <> 'string' or origin->>'provider' not in ('apple_health','health_connect') or
  jsonb_typeof(origin->'sourceAppId') <> 'string' or length(origin->>'sourceAppId') not between 1 and 255 or btrim(origin->>'sourceAppId') <> origin->>'sourceAppId' or
  jsonb_typeof(origin->'externalId') <> 'string' or length(origin->>'externalId') not between 1 and 255 or btrim(origin->>'externalId') <> origin->>'externalId' or
  (origin->'sourceAppName' <> 'null'::jsonb and (jsonb_typeof(origin->'sourceAppName') <> 'string' or length(origin->>'sourceAppName') not between 1 and 200 or btrim(origin->>'sourceAppName') <> origin->>'sourceAppName')) or
  p_summary->>'timePrecision' <> 'instant'
 then raise exception 'run_invalid' using errcode='22023'; end if;
 d := (p_summary->>'activityDate')::date; zone := p_summary->>'recordingTimezone';
 if to_char(d,'YYYY-MM-DD') <> p_summary->>'activityDate' or zone !~ '^[A-Za-z_]+(/[A-Za-z0-9_+.-]+)*$' or zone in ('Factory','localtime') or zone ~ '^(posix|right)/' or not exists(select 1 from pg_catalog.pg_timezone_names where name=zone)
 then raise exception 'run_invalid' using errcode='22023'; end if;
 duration := (p_summary->>'durationSeconds')::numeric;
 if duration <> trunc(duration) or duration not between 1 and 86400 or (p_summary->>'revision')::numeric <> trunc((p_summary->>'revision')::numeric) or (p_summary->>'revision')::numeric not between 1 and 2147483647
 then raise exception 'run_invalid' using errcode='22023'; end if;
 if p_summary->'distanceMeters' <> 'null'::jsonb then
  if jsonb_typeof(p_summary->'distanceMeters') <> 'number' then raise exception 'run_invalid' using errcode='22023'; end if;
  distance := (p_summary->>'distanceMeters')::numeric;
  if distance <= 0 or distance > 1000000 or distance*100 <> trunc(distance*100) then raise exception 'run_invalid' using errcode='22023'; end if;
 end if;
 if p_summary->'perceivedExertion' <> 'null'::jsonb then
  if jsonb_typeof(p_summary->'perceivedExertion') <> 'number' then raise exception 'run_invalid' using errcode='22023'; end if;
  effort := (p_summary->>'perceivedExertion')::numeric;
  if effort not between 0 and 10 or effort*10 <> trunc(effort*10) then raise exception 'run_invalid' using errcode='22023'; end if;
 end if;
 if d > (now() at time zone zone)::date then raise exception 'run_invalid' using errcode='22023'; end if;
 if p_summary->>'timePrecision' = 'day' then
  if p_summary->'startedAt' <> 'null'::jsonb or p_summary->>'timestampEnvelope' <> 'date_anchor' then raise exception 'run_invalid' using errcode='22023'; end if;
  if ((d+time '12:00') at time zone zone) at time zone zone <> d+time '12:00' then raise exception 'run_invalid' using errcode='22023'; end if;
 elsif p_summary->>'timePrecision' = 'instant' then
  if jsonb_typeof(p_summary->'startedAt') <> 'string' or p_summary->>'startedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' or p_summary->>'timestampEnvelope' <> 'observed' then raise exception 'run_invalid' using errcode='22023'; end if;
  start_time := (p_summary->>'startedAt')::timestamptz;
  if (start_time at time zone zone)::date <> d or start_time + duration * interval '1 second' > now() then raise exception 'run_invalid' using errcode='22023'; end if;
 else raise exception 'run_invalid' using errcode='22023'; end if;
end; $$;

create or replace function public.run_workout_guard() returns trigger language plpgsql set search_path='' as $$
declare tagged boolean; summary jsonb; start_time timestamptz; end_time timestamptz; owner_name text;
begin
 tagged := case when tg_op='DELETE' then old.details->>'activityType'='running' or old.details ? 'runSummary'
 else new.details->>'activityType'='running' or new.details ? 'runSummary' or (tg_op='UPDATE' and (old.details->>'activityType'='running' or old.details ? 'runSummary')) end;
 if not coalesce(tagged,false) then
  if tg_op='DELETE' then return old; end if;
  if new.source not in ('manual','file_import') then raise exception 'run_invalid' using errcode='22023'; end if;
  return new;
 end if;
 select pg_catalog.pg_get_userbyid(relowner) into owner_name from pg_catalog.pg_class where oid='public.workouts'::regclass;
 if current_user <> owner_name and not (tg_op='DELETE' and current_user='service_role') then raise exception 'run_requires_rpc' using errcode='42501'; end if;
 if tg_op='DELETE' then return old; end if;
 if new.details->>'activityType' is distinct from 'running' or new.details - array['activityType','workoutLifecycle','runSummary'] <> '{}'::jsonb or new.details->'workoutLifecycle' is distinct from '{"kind":"session"}'::jsonb or new.source not in ('manual','health_import','file_import') or new.client_operation_id is null or length(btrim(new.name)) not between 1 and 200 or length(coalesce(new.notes,''))>4000
 then raise exception 'run_invalid' using errcode='22023'; end if;
 if tg_op='UPDATE' and (new.user_id is distinct from old.user_id or new.id is distinct from old.id or new.client_operation_id is distinct from old.client_operation_id or new.source is distinct from old.source) then raise exception 'run_invalid' using errcode='22023'; end if;
 summary:=new.details->'runSummary'; perform public.run_validate(summary);
 if new.source <> (case summary->'origin'->>'kind' when 'health_import' then 'health_import' when 'file_import' then 'file_import' else 'manual' end) then raise exception 'run_invalid' using errcode='22023'; end if;
 if summary->>'timePrecision'='day' then
  start_time:=((summary->>'activityDate')::date+time '12:00') at time zone (summary->>'recordingTimezone'); end_time:=start_time;
 else start_time:=(summary->>'startedAt')::timestamptz; end_time:=start_time+(summary->>'durationSeconds')::integer*interval '1 second'; end if;
 if new.started_at is distinct from start_time or new.completed_at is distinct from end_time or exists(select 1 from public.workout_sets where workout_id=new.id) then raise exception 'run_invalid' using errcode='22023'; end if;
 return new;
end; $$;

create or replace function public.run_update(p_id uuid,p_operation uuid,p_expected_revision integer,p_name text,p_notes text,p_summary jsonb) returns setof public.workouts language plpgsql security definer set search_path='' as $$
declare caller uuid; receipt public.run_operation_receipts; existing public.workouts; digest text; revision integer; start_time timestamptz; end_time timestamptz;
begin
 caller:=public.run_admit();
 if p_operation is null or p_expected_revision is null or p_expected_revision<1 then raise exception 'run_invalid' using errcode='22023'; end if;
 if exists(select 1 from public.run_operation_receipts where user_id=caller and run_id=p_id and deleted) then raise exception 'run_removed' using errcode='P0003'; end if;
 select * into existing from public.workouts where id=p_id and user_id=caller and details->>'activityType'='running' for update;
 if not found then raise exception 'run_not_found' using errcode='P0002'; end if;
 revision:=(existing.details->'runSummary'->>'revision')::integer;
 digest:=encode(extensions.digest(jsonb_build_object('name',p_name,'notes',p_notes,'summary',p_summary,'expectedRevision',p_expected_revision)::text,'sha256'),'hex');
 select * into receipt from public.run_operation_receipts where user_id=caller and operation_id=p_operation;
 if found then
  if receipt.deleted then raise exception 'run_removed' using errcode='P0003'; end if;
  if receipt.kind<>'update' or receipt.run_id is distinct from p_id or receipt.payload_digest is distinct from digest or receipt.accepted_revision<>revision then raise exception 'run_conflict' using errcode='PT409'; end if;
  return next existing; return;
 end if;
 if revision<>p_expected_revision then raise exception 'run_conflict' using errcode='PT409'; end if;
 perform public.run_validate(p_summary);
 if (p_summary->>'revision')::integer<>revision+1 then raise exception 'run_invalid' using errcode='22023'; end if;
 if existing.details->'runSummary'->'origin'->>'kind' in ('health_import','file_import') then
  if p_summary - array['environment','perceivedExertion','revision'] <> (existing.details->'runSummary') - array['environment','perceivedExertion','revision'] then raise exception 'run_invalid' using errcode='22023'; end if;
 elsif p_summary->'origin'<>'{"kind":"manual"}'::jsonb then raise exception 'run_invalid' using errcode='22023'; end if;
 if p_summary->>'timePrecision'='day' then start_time:=((p_summary->>'activityDate')::date+time '12:00') at time zone (p_summary->>'recordingTimezone'); end_time:=start_time;
 else start_time:=(p_summary->>'startedAt')::timestamptz; end_time:=start_time+(p_summary->>'durationSeconds')::integer*interval '1 second'; end if;
 update public.workouts set name=p_name,notes=p_notes,started_at=start_time,completed_at=end_time,details=jsonb_build_object('activityType','running','workoutLifecycle',jsonb_build_object('kind','session'),'runSummary',p_summary),updated_at=now() where id=p_id and user_id=caller;
 insert into public.run_operation_receipts(user_id,operation_id,kind,run_id,payload_digest,accepted_revision) values(caller,p_operation,'update',p_id,digest,revision+1);
 return query select * from public.workouts where id=p_id and user_id=caller;
end; $$;
-- Installed builds strictly parse manual and Health origins: `p_include_imports`
-- now means Health imports only, and file imports need the new flag.
drop function public.run_list(text,text,text,integer,boolean);
create function public.run_list(p_from text default null,p_to text default null,p_cursor text default null,p_limit integer default 51,p_include_imports boolean default false,p_include_file_imports boolean default false) returns setof public.workouts language plpgsql security invoker set search_path='' as $$
begin
 if p_limit is null or p_limit not between 1 and 101 or (p_from is not null and (p_from !~ '^\d{4}-\d{2}-\d{2}$' or to_char(p_from::date,'YYYY-MM-DD')<>p_from)) or (p_to is not null and (p_to !~ '^\d{4}-\d{2}-\d{2}$' or to_char(p_to::date,'YYYY-MM-DD')<>p_to)) or (p_cursor is not null and p_cursor !~ '^\d{4}-\d{2}-\d{2}:[0-9a-f-]{36}$') then raise exception 'run_invalid' using errcode='22023'; end if;
 return query select w.* from public.workouts w where w.user_id=auth.uid() and w.details->>'activityType'='running'
 and (w.details->'runSummary'->'origin'='{"kind":"manual"}'::jsonb
  or (coalesce(p_include_imports,false) and w.details->'runSummary'->'origin'->>'kind'='health_import')
  or (coalesce(p_include_file_imports,false) and w.details->'runSummary'->'origin'->>'kind'='file_import'))
 and (p_from is null or w.details->'runSummary'->>'activityDate'>=p_from) and (p_to is null or w.details->'runSummary'->>'activityDate'<=p_to)
 and (p_cursor is null or ((w.details->'runSummary'->>'activityDate'),w.id) < (split_part(p_cursor,':',1),split_part(p_cursor,':',2)::uuid))
 order by w.details->'runSummary'->>'activityDate' desc,w.id desc limit p_limit;
end; $$;
revoke all on function public.run_validate(jsonb),public.run_workout_guard() from public,anon,authenticated,service_role;
revoke all on function public.run_update(uuid,uuid,integer,text,text,jsonb),public.run_list(text,text,text,integer,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.run_update(uuid,uuid,integer,text,text,jsonb),public.run_list(text,text,text,integer,boolean,boolean) to authenticated;

-- Serializes each import RPC call per account (concurrent imports stay correct
-- through the chunk index and the unique import key); refused during account erasure.
create function public.history_import_admit() returns uuid language plpgsql security definer set search_path='' as $$
declare caller uuid := auth.uid();
begin
 if caller is null then raise exception 'history_import_not_found' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('history_import:'||caller::text,0));
 if exists(select 1 from public.account_deletion_jobs where user_id=caller and status in ('in_progress','failed','completed')) then raise exception 'history_import_invalid' using errcode='22023'; end if;
 return caller;
end; $$;
revoke all on function public.history_import_admit() from public,anon,authenticated,service_role;

-- A positive measurement in `p_scale` decimal places, at most `p_max`; JSON null stays null.
create function public.history_import_measure(p_value jsonb,p_max numeric,p_scale integer,p_allow_zero boolean default false) returns numeric language plpgsql immutable set search_path='' as $$
declare n numeric;
begin
 if p_value is null or p_value='null'::jsonb then return null; end if;
 if jsonb_typeof(p_value)<>'number' then raise exception 'history_import_invalid' using errcode='22023'; end if;
 n:=(p_value#>>'{}')::numeric;
 if (n<0 or (n=0 and not p_allow_zero)) or n>p_max or n*power(10::numeric,p_scale)<>trunc(n*power(10::numeric,p_scale)) then raise exception 'history_import_invalid' using errcode='22023'; end if;
 return n;
end; $$;
revoke all on function public.history_import_measure(jsonb,numeric,integer,boolean) from public,anon,authenticated,service_role;

-- Create the batch, or return it unchanged when the same request is replayed.
create function public.history_import_begin(p_batch uuid,p_format text,p_file_name text,p_digest text) returns setof public.history_import_batches language plpgsql security definer set search_path='' as $$
declare caller uuid; existing public.history_import_batches;
begin
 caller:=public.history_import_admit();
 if p_batch is null or p_format is null or p_format not in ('hevy','strong','strava','generic') or p_digest is null or p_digest !~ '^[0-9a-f]{64}$'
  or (p_file_name is not null and (length(p_file_name) not between 1 and 200 or btrim(p_file_name)<>p_file_name))
 then raise exception 'history_import_invalid' using errcode='22023'; end if;
 select * into existing from public.history_import_batches where id=p_batch;
 if found then
  if existing.user_id<>caller or existing.request_digest<>p_digest or existing.format<>p_format then raise exception 'history_import_conflict' using errcode='PT409'; end if;
  return next existing; return;
 end if;
 return query insert into public.history_import_batches(id,user_id,format,file_name,request_digest) values(p_batch,caller,p_format,p_file_name,p_digest) returning *;
end; $$;

-- Resolve each mapped exercise to a saved record, creating it when missing.
-- Catalog targets reuse a record with that catalogId or exact catalog name;
-- custom targets reuse a non-catalog record with the same name.
create function public.history_import_exercises(p_batch uuid,p_specs jsonb) returns table(spec_key text,exercise_id uuid) language plpgsql security definer set search_path='' as $$
declare caller uuid; spec jsonb; found_id uuid; spec_name text; mode text; catalog text;
begin
 caller:=public.history_import_admit();
 perform 1 from public.history_import_batches where id=p_batch and user_id=caller for update;
 if not found then raise exception 'history_import_not_found' using errcode='P0002'; end if;
 -- A replay that arrives after the original request finished only looks records up.
 if coalesce(jsonb_typeof(p_specs)<>'array' or jsonb_array_length(p_specs)>400,true) then raise exception 'history_import_invalid' using errcode='22023'; end if;
 for spec in select value from jsonb_array_elements(p_specs) loop
  if coalesce(jsonb_typeof(spec)<>'object' or spec - array['key','kind','catalogId','name','trackingMode'] <> '{}'::jsonb
   or jsonb_typeof(spec->'key')<>'string' or length(spec->>'key') not between 1 and 200
   or jsonb_typeof(spec->'name')<>'string' or length(spec->>'name') not between 1 and 120 or btrim(spec->>'name')<>spec->>'name'
   or spec->>'trackingMode' is null or spec->>'trackingMode' not in ('load_reps','duration','duration_distance')
   or spec->>'kind' is null or spec->>'kind' not in ('catalog','custom')
   or (spec->>'kind'='catalog' and (jsonb_typeof(spec->'catalogId') is distinct from 'string' or length(spec->>'catalogId') not between 1 and 120))
   or (spec->>'kind'='custom' and spec ? 'catalogId'),true)
  then raise exception 'history_import_invalid' using errcode='22023'; end if;
  spec_name:=spec->>'name'; mode:=spec->>'trackingMode'; catalog:=spec->>'catalogId'; found_id:=null;
  if spec->>'kind'='catalog' then
   select e.id into found_id from public.exercises e where e.user_id=caller and e.metadata->>'catalogId'=catalog order by e.created_at,e.id limit 1;
   if found_id is null then
    select e.id into found_id from public.exercises e where e.user_id=caller and not (e.metadata ? 'catalogId') and lower(btrim(e.name))=lower(spec_name) order by e.created_at,e.id limit 1;
   end if;
   if found_id is null then
    insert into public.exercises(user_id,name,metadata) values(caller,spec_name,jsonb_build_object('catalogId',catalog,'trackingMode',mode,'importBatchId',p_batch)) returning id into found_id;
    update public.history_import_batches set created_exercise_ids=created_exercise_ids||found_id where id=p_batch;
   end if;
  else
   select e.id into found_id from public.exercises e where e.user_id=caller and not (e.metadata ? 'catalogId') and lower(btrim(e.name))=lower(spec_name) order by e.created_at,e.id limit 1;
   if found_id is null then
    insert into public.exercises(user_id,name,metadata) values(caller,spec_name,jsonb_build_object('custom',true,'trackingMode',mode,'importBatchId',p_batch)) returning id into found_id;
    update public.history_import_batches set created_exercise_ids=created_exercise_ids||found_id where id=p_batch;
   end if;
  end if;
  spec_key:=spec->>'key'; exercise_id:=found_id; return next;
 end loop;
end; $$;

-- Write chunk `p_chunk` (0-based, in order). A replayed earlier chunk is a
-- no-op, so a retried confirm resumes where the lost response stopped.
-- A chunk is atomic, so a record whose import key already exists (an earlier
-- batch, or a repeat inside this chunk) is a duplicate; with p_skip_overlaps a
-- record overlapping another strength session (workouts) or run (runs) is skipped.
create function public.history_import_write(p_batch uuid,p_chunk integer,p_timezone text,p_skip_overlaps boolean,p_workouts jsonb,p_runs jsonb) returns table(workouts integer,sets integer,runs integer,duplicates integer,overlapping integer) language plpgsql security definer set search_path='' as $$
declare caller uuid; batch public.history_import_batches; item jsonb; s jsonb; wid uuid; start_time timestamptz; end_time timestamptz; key text;
 seq integer; summary jsonb; local_day text; n_w integer:=0; n_s integer:=0; n_r integer:=0; n_d integer:=0; n_o integer:=0; set_rows integer;
 exercise_list jsonb; reps numeric; load numeric; dur numeric; dist numeric; rpe numeric; details jsonb;
begin
 caller:=public.history_import_admit();
 select * into batch from public.history_import_batches where id=p_batch and user_id=caller for update;
 if not found then raise exception 'history_import_not_found' using errcode='P0002'; end if;
 if p_chunk is null then raise exception 'history_import_invalid' using errcode='22023'; end if;
 -- An earlier chunk is a no-op even once the batch is complete (late replay).
 if p_chunk<batch.chunks_done then workouts:=0; sets:=0; runs:=0; duplicates:=0; overlapping:=0; return next; return; end if;
 if batch.status<>'importing' or p_chunk>batch.chunks_done then raise exception 'history_import_conflict' using errcode='PT409'; end if;
 if coalesce(jsonb_typeof(p_workouts)<>'array' or jsonb_typeof(p_runs)<>'array' or jsonb_array_length(p_workouts)>200 or jsonb_array_length(p_runs)>200
  or p_skip_overlaps is null or p_timezone is null or length(p_timezone)>100 or p_timezone !~ '^[A-Za-z_]+(/[A-Za-z0-9_+.-]+)*$' or p_timezone in ('Factory','localtime') or p_timezone ~ '^(posix|right)/'
  or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone)
  or (jsonb_array_length(p_runs)>0 and batch.format<>'strava') or (jsonb_array_length(p_workouts)>0 and batch.format='strava')
  or (select count(*) from jsonb_array_elements(p_workouts) w, jsonb_array_elements(case when jsonb_typeof(w.value->'sets')='array' then w.value->'sets' else '[]'::jsonb end))>5000,true)
 then raise exception 'history_import_invalid' using errcode='22023'; end if;

 for item in select value from jsonb_array_elements(p_workouts) loop
  if coalesce(jsonb_typeof(item)<>'object' or item - array['key','name','startedAt','completedAt','notes','sets'] <> '{}'::jsonb
   or jsonb_typeof(item->'key')<>'string' or left(item->>'key',length(batch.format)+1)<>batch.format||':' or length(item->>'key') not between length(batch.format)+2 and 300
   or jsonb_typeof(item->'name')<>'string' or length(btrim(item->>'name')) not between 1 and 200
   or item->>'startedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
   or item->>'completedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
   or (item->'notes'<>'null'::jsonb and (jsonb_typeof(item->'notes')<>'string' or length(item->>'notes')>4000))
   or jsonb_typeof(item->'sets')<>'array' or jsonb_array_length(item->'sets') not between 1 and 500,true)
  then raise exception 'history_import_invalid' using errcode='22023'; end if;
  start_time:=(item->>'startedAt')::timestamptz; end_time:=(item->>'completedAt')::timestamptz; key:=item->>'key';
  if start_time<'1970-01-01T00:00:00Z' or end_time<start_time or end_time>now() or end_time-start_time>interval '2 days' then raise exception 'history_import_invalid' using errcode='22023'; end if;
  if exists(select 1 from public.workouts w where w.user_id=caller and w.import_key=key) then n_d:=n_d+1; continue; end if;
  if p_skip_overlaps and exists(select 1 from public.workouts w where w.user_id=caller and w.import_batch_id is distinct from p_batch
    and w.details->>'activityType' is null and not (w.details ? 'runSummary') and not (w.details ? 'boulderSession')
    and w.details->'workoutLifecycle'->>'kind' is distinct from 'routine'
    and w.started_at<=end_time and w.started_at>=start_time-interval '2 days' and coalesce(w.completed_at,w.started_at)>=start_time) then
   n_o:=n_o+1; continue;
  end if;
  -- Exercise names for the session summary come from the owner's own records.
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name',e.name,'catalogId',e.metadata->'catalogId','restSeconds',90)) order by f.first_seen),'[]'::jsonb) into exercise_list
   from (select (x.value->>'exerciseId')::uuid as eid,min(x.ordinality) as first_seen from jsonb_array_elements(item->'sets') with ordinality x group by 1) f
   join public.exercises e on e.id=f.eid and e.user_id=caller;
  details:=jsonb_build_object('workoutLifecycle',jsonb_build_object('kind','session'),'sessionMode','one_time','entryMode','history_import','importSource',jsonb_build_object('format',batch.format),'sessionExercises',exercise_list);
  wid:=gen_random_uuid();
  insert into public.workouts(id,user_id,name,started_at,completed_at,notes,source,details,import_batch_id,import_key)
   values(wid,caller,btrim(item->>'name'),start_time,end_time,nullif(btrim(item->>'notes'),''),'file_import',details,p_batch,key)
   on conflict (user_id,import_key) where import_key is not null do nothing;
  get diagnostics set_rows = row_count;
  if set_rows=0 then n_d:=n_d+1; continue; end if;
  seq:=0;
  for s in select value from jsonb_array_elements(item->'sets') loop
   if coalesce(jsonb_typeof(s)<>'object' or s - array['exerciseId','setType','repetitions','loadKg','durationSeconds','distanceMeters','perceivedExertion'] <> '{}'::jsonb
    or jsonb_typeof(s->'exerciseId')<>'string' or s->>'exerciseId' !~ '^[0-9a-fA-F-]{36}$' or s->>'setType' not in ('normal','warmup','drop','failure'),true)
   then raise exception 'history_import_invalid' using errcode='22023'; end if;
   reps:=public.history_import_measure(s->'repetitions',9999.99,2); load:=public.history_import_measure(s->'loadKg',9999.999,3);
   dur:=public.history_import_measure(s->'durationSeconds',86400,0); dist:=public.history_import_measure(s->'distanceMeters',1000000,2);
   rpe:=public.history_import_measure(s->'perceivedExertion',10,1,true);
   if reps is null and load is null and dur is null and dist is null then raise exception 'history_import_invalid' using errcode='22023'; end if;
   seq:=seq+1;
   insert into public.workout_sets(user_id,workout_id,exercise_id,sequence,set_type,repetitions,load_kg,duration_seconds,distance_meters,perceived_exertion,completed_at)
    values(caller,wid,(s->>'exerciseId')::uuid,seq,s->>'setType',reps,load,dur::integer,dist,rpe,end_time);
  end loop;
  n_w:=n_w+1; n_s:=n_s+seq;
 end loop;

 for item in select value from jsonb_array_elements(p_runs) loop
  if coalesce(jsonb_typeof(item)<>'object' or item - array['externalId','name','startedAt','durationSeconds','distanceMeters','environment'] <> '{}'::jsonb
   or jsonb_typeof(item->'externalId')<>'string' or length(item->>'externalId') not between 1 and 255 or btrim(item->>'externalId')<>item->>'externalId'
   or jsonb_typeof(item->'name')<>'string' or length(btrim(item->>'name')) not between 1 and 200
   or item->>'startedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$',true)
  then raise exception 'history_import_invalid' using errcode='22023'; end if;
  key:='strava:'||(item->>'externalId');
  start_time:=date_trunc('second',(item->>'startedAt')::timestamptz);
  if start_time<'1970-01-01T00:00:00Z' then raise exception 'history_import_invalid' using errcode='22023'; end if;
  local_day:=to_char(start_time at time zone p_timezone,'YYYY-MM-DD');
  summary:=jsonb_build_object('version',1,'activityDate',local_day,'recordingTimezone',p_timezone,'timePrecision','instant',
   'startedAt',to_char(start_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'durationSeconds',item->'durationSeconds','durationBasis','elapsed',
   'distanceMeters',coalesce(item->'distanceMeters','null'::jsonb),'environment',item->'environment','perceivedExertion',null,
   'origin',jsonb_build_object('kind','file_import','format','strava','externalId',item->>'externalId'),'timestampEnvelope','observed','revision',1);
  perform public.run_validate(summary);
  end_time:=start_time+(summary->>'durationSeconds')::integer*interval '1 second';
  if exists(select 1 from public.workouts w where w.user_id=caller and w.import_key=key) then n_d:=n_d+1; continue; end if;
  if p_skip_overlaps and exists(select 1 from public.workouts w where w.user_id=caller and w.import_batch_id is distinct from p_batch and w.details->>'activityType'='running'
    and w.started_at between start_time-interval '2 days' and end_time+interval '2 days'
    and ((w.details->'runSummary'->>'timePrecision'='instant' and w.started_at<=end_time and w.completed_at>=start_time)
     or (w.details->'runSummary'->>'timePrecision'='day' and w.details->'runSummary'->>'activityDate'=local_day))) then
   n_o:=n_o+1; continue;
  end if;
  insert into public.workouts(id,user_id,client_operation_id,name,notes,source,started_at,completed_at,details,import_batch_id,import_key)
   values(gen_random_uuid(),caller,gen_random_uuid(),btrim(item->>'name'),null,'file_import',start_time,end_time,
    jsonb_build_object('activityType','running','workoutLifecycle',jsonb_build_object('kind','session'),'runSummary',summary),p_batch,key)
   on conflict (user_id,import_key) where import_key is not null do nothing;
  get diagnostics set_rows = row_count;
  if set_rows=0 then n_d:=n_d+1; else n_r:=n_r+1; end if;
 end loop;

 update public.history_import_batches set chunks_done=chunks_done+1,duplicate_count=duplicate_count+n_d,overlap_count=overlap_count+n_o where id=p_batch;
 workouts:=n_w; sets:=n_s; runs:=n_r; duplicates:=n_d; overlapping:=n_o; return next;
end; $$;

-- Close the batch once every chunk landed; counts come from the stored rows.
create function public.history_import_finish(p_batch uuid,p_chunks integer) returns setof public.history_import_batches language plpgsql security definer set search_path='' as $$
declare caller uuid; batch public.history_import_batches;
begin
 caller:=public.history_import_admit();
 select * into batch from public.history_import_batches where id=p_batch and user_id=caller for update;
 if not found then raise exception 'history_import_not_found' using errcode='P0002'; end if;
 if batch.status='complete' then return next batch; return; end if;
 if p_chunks is null or p_chunks<>batch.chunks_done then raise exception 'history_import_conflict' using errcode='PT409'; end if;
 return query update public.history_import_batches b set status='complete',completed_at=now(),
  workout_count=(select count(*) from public.workouts w where w.user_id=caller and w.import_batch_id=p_batch and w.details->>'activityType' is null),
  run_count=(select count(*) from public.workouts w where w.user_id=caller and w.import_batch_id=p_batch and w.details->>'activityType'='running'),
  set_count=(select count(*) from public.workout_sets s join public.workouts w on w.id=s.workout_id where w.user_id=caller and w.import_batch_id=p_batch),
  first_started_at=(select min(w.started_at) from public.workouts w where w.user_id=caller and w.import_batch_id=p_batch),
  last_started_at=(select max(w.started_at) from public.workouts w where w.user_id=caller and w.import_batch_id=p_batch)
  where b.id=p_batch returning b.*;
end; $$;

-- Undo, in bounded steps so each call stays far below the statement timeout:
-- each call removes up to 100 of the batch's workouts or runs and at most
-- about 5,000 of their sets (sets cascade)
-- and reports how many remain. The call that finds none left removes the
-- exercises the batch created that no set of the caller references any more,
-- then the batch row. The caller repeats until `remaining` is 0.
create function public.history_import_delete(p_batch uuid) returns table(workouts integer,runs integer,exercises integer,remaining integer) language plpgsql security definer set search_path='' as $$
declare caller uuid; batch public.history_import_batches;
begin
 caller:=public.history_import_admit();
 select * into batch from public.history_import_batches where id=p_batch and user_id=caller for update;
 if not found then raise exception 'history_import_not_found' using errcode='P0002'; end if;
 with ordered as (select w.id,w.details->>'activityType' as kind,
   row_number() over (order by w.started_at,w.id) as n,
   sum((select count(*) from public.workout_sets x where x.workout_id=w.id and x.user_id=caller)) over (order by w.started_at,w.id) as set_total
   from public.workouts w where w.user_id=caller and w.import_batch_id=p_batch),
  doomed as (select id,kind from ordered where n<=100 and (n=1 or set_total<=5000)),
  removed as (delete from public.workouts w using doomed d where w.id=d.id and w.user_id=caller returning d.kind)
 select count(*) filter (where kind is null),count(*) filter (where kind='running') into workouts,runs from removed;
 select count(*) into remaining from public.workouts w where w.user_id=caller and w.import_batch_id=p_batch;
 exercises:=0;
 if remaining=0 then
  with gone as (delete from public.exercises e where e.user_id=caller and e.id=any(batch.created_exercise_ids)
   and not exists(select 1 from public.workout_sets s where s.user_id=caller and s.exercise_id=e.id) returning 1)
  select count(*) into exercises from gone;
  delete from public.history_import_batches where id=p_batch and user_id=caller;
 end if;
 return next;
end; $$;

-- Preview only: how many records (full import keys) already exist or overlap. Reads under RLS.
create function public.history_import_check(p_format text,p_items jsonb) returns table(existing integer,overlapping integer) language plpgsql stable security invoker set search_path='' as $$
declare caller uuid := auth.uid();
begin
 if caller is null then raise exception 'history_import_not_found' using errcode='42501'; end if;
 if p_format is null or p_format not in ('hevy','strong','strava','generic') or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>10000 then raise exception 'history_import_invalid' using errcode='22023'; end if;
 return query
 with items as (
  select x->>'key' as key,x->>'kind' as kind,(x->>'startedAt')::timestamptz as start_time,(x->>'completedAt')::timestamptz as end_time,x->>'activityDate' as local_day
  from jsonb_array_elements(p_items) x
 ), marked as (
  select i.*,exists(select 1 from public.workouts w where w.user_id=caller and w.import_key=i.key) as is_existing from items i
 )
 select count(*) filter (where is_existing)::integer,
  count(*) filter (where not is_existing and (
   (kind='workout' and exists(select 1 from public.workouts w where w.user_id=caller and w.details->>'activityType' is null and not (w.details ? 'runSummary') and not (w.details ? 'boulderSession')
     and w.details->'workoutLifecycle'->>'kind' is distinct from 'routine' and w.started_at<=end_time and w.started_at>=start_time-interval '2 days' and coalesce(w.completed_at,w.started_at)>=start_time))
   or (kind='run' and exists(select 1 from public.workouts w where w.user_id=caller and w.details->>'activityType'='running'
     and w.started_at between start_time-interval '2 days' and end_time+interval '2 days'
     and ((w.details->'runSummary'->>'timePrecision'='instant' and w.started_at<=end_time and w.completed_at>=start_time)
      or (w.details->'runSummary'->>'timePrecision'='day' and w.details->'runSummary'->>'activityDate'=local_day))))))::integer
 from marked;
end; $$;

revoke all on function public.history_import_begin(uuid,text,text,text),public.history_import_exercises(uuid,jsonb),public.history_import_write(uuid,integer,text,boolean,jsonb,jsonb),
 public.history_import_finish(uuid,integer),public.history_import_delete(uuid),public.history_import_check(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.history_import_begin(uuid,text,text,text),public.history_import_exercises(uuid,jsonb),public.history_import_write(uuid,integer,text,boolean,jsonb,jsonb),
 public.history_import_finish(uuid,integer),public.history_import_delete(uuid),public.history_import_check(text,jsonb) to authenticated;
