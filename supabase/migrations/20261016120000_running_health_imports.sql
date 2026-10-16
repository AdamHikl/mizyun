-- RUN-06: one-time, user-selected copies of completed Health running workouts.
-- Not a sync: no cursors, reconciliation or source-deletion tracking. Imported
-- metrics are read-only provider facts; name, notes, environment and effort stay
-- editable. Preserve existing signatures, owners, grants, PT409 conflict codes
-- and the RPC-only/receipt invariants from the RUN-02 migrations.

-- Workout provenance: imported runs are not relabelled manual. Replace the
-- single-column source check whatever its generated name.
do $$
declare c record;
begin
 for c in select con.conname from pg_catalog.pg_constraint con
  where con.conrelid='public.workouts'::regclass and con.contype='c'
   and con.conkey=array[(select attnum from pg_catalog.pg_attribute where attrelid='public.workouts'::regclass and attname='source')]
 loop execute format('alter table public.workouts drop constraint %I',c.conname); end loop;
end; $$;
alter table public.workouts add constraint workouts_source_check check (source in ('manual','health_import'));

alter table public.run_operation_receipts drop constraint run_operation_receipts_kind_check;
alter table public.run_operation_receipts add constraint run_operation_receipts_kind_check check (kind in ('create','update','import'));

-- One stored copy per provider workout while it exists; deleting it allows a later explicit re-import.
create unique index workouts_run_health_import_idx on public.workouts(
 user_id,
 (details->'runSummary'->'origin'->>'provider'),
 (details->'runSummary'->'origin'->>'sourceAppId'),
 (details->'runSummary'->'origin'->>'externalId')
) where details->>'activityType'='running' and details->'runSummary'->'origin'->>'kind'='health_import';

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

-- Invoker trigger: authenticated table writes cannot bypass the transaction RPC.
-- The stored source must match the run origin and never changes.
create or replace function public.run_workout_guard() returns trigger language plpgsql set search_path='' as $$
declare tagged boolean; summary jsonb; start_time timestamptz; end_time timestamptz; owner_name text;
begin
 tagged := case when tg_op='DELETE' then old.details->>'activityType'='running' or old.details ? 'runSummary'
 else new.details->>'activityType'='running' or new.details ? 'runSummary' or (tg_op='UPDATE' and (old.details->>'activityType'='running' or old.details ? 'runSummary')) end;
 if not coalesce(tagged,false) then
  if tg_op='DELETE' then return old; end if;
  if new.source <> 'manual' then raise exception 'run_invalid' using errcode='22023'; end if;
  return new;
 end if;
 select pg_catalog.pg_get_userbyid(relowner) into owner_name from pg_catalog.pg_class where oid='public.workouts'::regclass;
 if current_user <> owner_name and not (tg_op='DELETE' and current_user='service_role') then raise exception 'run_requires_rpc' using errcode='42501'; end if;
 if tg_op='DELETE' then return old; end if;
 if new.details->>'activityType' is distinct from 'running' or new.details - array['activityType','workoutLifecycle','runSummary'] <> '{}'::jsonb or new.details->'workoutLifecycle' is distinct from '{"kind":"session"}'::jsonb or new.source not in ('manual','health_import') or new.client_operation_id is null or length(btrim(new.name)) not between 1 and 200 or length(coalesce(new.notes,''))>4000
 then raise exception 'run_invalid' using errcode='22023'; end if;
 if tg_op='UPDATE' and (new.user_id is distinct from old.user_id or new.id is distinct from old.id or new.client_operation_id is distinct from old.client_operation_id or new.source is distinct from old.source) then raise exception 'run_invalid' using errcode='22023'; end if;
 summary:=new.details->'runSummary'; perform public.run_validate(summary);
 if new.source <> (case when summary->'origin'->>'kind'='health_import' then 'health_import' else 'manual' end) then raise exception 'run_invalid' using errcode='22023'; end if;
 if summary->>'timePrecision'='day' then
  start_time:=((summary->>'activityDate')::date+time '12:00') at time zone (summary->>'recordingTimezone'); end_time:=start_time;
 else start_time:=(summary->>'startedAt')::timestamptz; end_time:=start_time+(summary->>'durationSeconds')::integer*interval '1 second'; end if;
 if new.started_at is distinct from start_time or new.completed_at is distinct from end_time or exists(select 1 from public.workout_sets where workout_id=new.id) then raise exception 'run_invalid' using errcode='22023'; end if;
 return new;
end; $$;

-- Manual create cannot claim a Health origin; imports use run_import.
create or replace function public.run_create(p_operation uuid,p_name text,p_notes text,p_summary jsonb) returns setof public.workouts language plpgsql security definer set search_path='' as $$
declare caller uuid; receipt public.run_operation_receipts; digest text; row_id uuid; start_time timestamptz; end_time timestamptz;
begin
 caller:=public.run_admit();
 if p_operation is null then raise exception 'run_invalid' using errcode='22023'; end if;
 digest:=encode(extensions.digest(jsonb_build_object('name',p_name,'notes',p_notes,'summary',p_summary)::text,'sha256'),'hex');
 select * into receipt from public.run_operation_receipts where user_id=caller and operation_id=p_operation;
 if found then
  if receipt.deleted then raise exception 'run_removed' using errcode='P0003'; end if;
  if receipt.kind<>'create' or receipt.payload_digest is distinct from digest then raise exception 'run_conflict' using errcode='PT409'; end if;
  return query select * from public.workouts where id=receipt.run_id and user_id=caller; return;
 end if;
 perform public.run_validate(p_summary);
 if p_summary->'revision'<>'1'::jsonb or p_summary->'origin'<>'{"kind":"manual"}'::jsonb then raise exception 'run_invalid' using errcode='22023'; end if;
 if p_summary->>'timePrecision'='day' then start_time:=((p_summary->>'activityDate')::date+time '12:00') at time zone (p_summary->>'recordingTimezone'); end_time:=start_time;
 else start_time:=(p_summary->>'startedAt')::timestamptz; end_time:=start_time+(p_summary->>'durationSeconds')::integer*interval '1 second'; end if;
 row_id:=gen_random_uuid();
 insert into public.workouts(id,user_id,client_operation_id,name,notes,source,started_at,completed_at,details) values(row_id,caller,p_operation,p_name,p_notes,'manual',start_time,end_time,jsonb_build_object('activityType','running','workoutLifecycle',jsonb_build_object('kind','session'),'runSummary',p_summary));
 insert into public.run_operation_receipts(user_id,operation_id,kind,run_id,payload_digest,accepted_revision) values(caller,p_operation,'create',row_id,digest,1);
 return query select * from public.workouts where id=row_id and user_id=caller;
end; $$;

-- Imported runs keep every provider fact; only environment, effort, name and notes change.
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
 if existing.details->'runSummary'->'origin'->>'kind'='health_import' then
  if p_summary - array['environment','perceivedExertion','revision'] <> (existing.details->'runSummary') - array['environment','perceivedExertion','revision'] then raise exception 'run_invalid' using errcode='22023'; end if;
 elsif p_summary->'origin'<>'{"kind":"manual"}'::jsonb then raise exception 'run_invalid' using errcode='22023'; end if;
 if p_summary->>'timePrecision'='day' then start_time:=((p_summary->>'activityDate')::date+time '12:00') at time zone (p_summary->>'recordingTimezone'); end_time:=start_time;
 else start_time:=(p_summary->>'startedAt')::timestamptz; end_time:=start_time+(p_summary->>'durationSeconds')::integer*interval '1 second'; end if;
 update public.workouts set name=p_name,notes=p_notes,started_at=start_time,completed_at=end_time,details=jsonb_build_object('activityType','running','workoutLifecycle',jsonb_build_object('kind','session'),'runSummary',p_summary),updated_at=now() where id=p_id and user_id=caller;
 insert into public.run_operation_receipts(user_id,operation_id,kind,run_id,payload_digest,accepted_revision) values(caller,p_operation,'update',p_id,digest,revision+1);
 return query select * from public.workouts where id=p_id and user_id=caller;
end; $$;

-- Explicit one-time import. Returns the stored run; the caller created it only
-- when its client_operation_id equals p_operation. An existing copy of the same
-- provider/source/external workout is returned unchanged (and receipted).
create function public.run_import(p_operation uuid,p_name text,p_summary jsonb) returns setof public.workouts language plpgsql security definer set search_path='' as $$
declare caller uuid; receipt public.run_operation_receipts; digest text; row_id uuid; existing_id uuid; start_time timestamptz; end_time timestamptz; violated text;
begin
 caller:=public.run_admit();
 if p_operation is null then raise exception 'run_invalid' using errcode='22023'; end if;
 digest:=encode(extensions.digest(jsonb_build_object('name',p_name,'summary',p_summary)::text,'sha256'),'hex');
 select * into receipt from public.run_operation_receipts where user_id=caller and operation_id=p_operation;
 if found then
  if receipt.deleted then raise exception 'run_removed' using errcode='P0003'; end if;
  if receipt.kind<>'import' or receipt.payload_digest is distinct from digest then raise exception 'run_conflict' using errcode='PT409'; end if;
  return query select * from public.workouts where id=receipt.run_id and user_id=caller; return;
 end if;
 perform public.run_validate(p_summary);
 if p_summary->'revision'<>'1'::jsonb or p_summary->'origin'->>'kind' is distinct from 'health_import' or p_summary->'perceivedExertion'<>'null'::jsonb then raise exception 'run_invalid' using errcode='22023'; end if;
 select id into existing_id from public.workouts where user_id=caller and details->>'activityType'='running' and details->'runSummary'->'origin'->>'kind'='health_import'
  and details->'runSummary'->'origin'->>'provider'=p_summary->'origin'->>'provider'
  and details->'runSummary'->'origin'->>'sourceAppId'=p_summary->'origin'->>'sourceAppId'
  and details->'runSummary'->'origin'->>'externalId'=p_summary->'origin'->>'externalId';
 if existing_id is null then
  start_time:=(p_summary->>'startedAt')::timestamptz; end_time:=start_time+(p_summary->>'durationSeconds')::integer*interval '1 second';
  row_id:=gen_random_uuid();
  begin
   insert into public.workouts(id,user_id,client_operation_id,name,notes,source,started_at,completed_at,details) values(row_id,caller,p_operation,p_name,null,'health_import',start_time,end_time,jsonb_build_object('activityType','running','workoutLifecycle',jsonb_build_object('kind','session'),'runSummary',p_summary));
  exception when unique_violation then
   get stacked diagnostics violated = constraint_name;
   if violated is distinct from 'workouts_run_health_import_idx' then raise exception 'run_conflict' using errcode='PT409'; end if;
   select id into existing_id from public.workouts where user_id=caller and details->>'activityType'='running' and details->'runSummary'->'origin'->>'kind'='health_import'
    and details->'runSummary'->'origin'->>'provider'=p_summary->'origin'->>'provider'
    and details->'runSummary'->'origin'->>'sourceAppId'=p_summary->'origin'->>'sourceAppId'
    and details->'runSummary'->'origin'->>'externalId'=p_summary->'origin'->>'externalId';
   if existing_id is null then raise exception 'run_conflict' using errcode='PT409'; end if;
  end;
 end if;
 insert into public.run_operation_receipts(user_id,operation_id,kind,run_id,payload_digest,accepted_revision) values(caller,p_operation,'import',coalesce(existing_id,row_id),digest,case when existing_id is null then 1 else 0 end);
 return query select * from public.workouts where id=coalesce(existing_id,row_id) and user_id=caller;
end; $$;

-- Older clients' strict parsers accept only manual origins: imports are opt-in.
drop function public.run_list(text,text,text,integer);
create function public.run_list(p_from text default null,p_to text default null,p_cursor text default null,p_limit integer default 51,p_include_imports boolean default false) returns setof public.workouts language plpgsql security invoker set search_path='' as $$
begin
 if p_limit is null or p_limit not between 1 and 101 or (p_from is not null and (p_from !~ '^\d{4}-\d{2}-\d{2}$' or to_char(p_from::date,'YYYY-MM-DD')<>p_from)) or (p_to is not null and (p_to !~ '^\d{4}-\d{2}-\d{2}$' or to_char(p_to::date,'YYYY-MM-DD')<>p_to)) or (p_cursor is not null and p_cursor !~ '^\d{4}-\d{2}-\d{2}:[0-9a-f-]{36}$') then raise exception 'run_invalid' using errcode='22023'; end if;
 return query select w.* from public.workouts w where w.user_id=auth.uid() and w.details->>'activityType'='running'
 and (coalesce(p_include_imports,false) or w.details->'runSummary'->'origin'='{"kind":"manual"}'::jsonb)
 and (p_from is null or w.details->'runSummary'->>'activityDate'>=p_from) and (p_to is null or w.details->'runSummary'->>'activityDate'<=p_to)
 and (p_cursor is null or ((w.details->'runSummary'->>'activityDate'),w.id) < (split_part(p_cursor,':',1),split_part(p_cursor,':',2)::uuid))
 order by w.details->'runSummary'->>'activityDate' desc,w.id desc limit p_limit;
end; $$;

revoke all on function public.run_validate(jsonb),public.run_workout_guard() from public,anon,authenticated,service_role;
revoke all on function public.run_create(uuid,text,text,jsonb),public.run_update(uuid,uuid,integer,text,text,jsonb),public.run_import(uuid,text,jsonb),public.run_list(text,text,text,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.run_create(uuid,text,text,jsonb),public.run_update(uuid,uuid,integer,text,text,jsonb),public.run_import(uuid,text,jsonb),public.run_list(text,text,text,integer,boolean) to authenticated;
