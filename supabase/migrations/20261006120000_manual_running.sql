-- RUN-02: minimal durable receipts and authenticated atomic running mutations.
create table public.run_operation_receipts (
 user_id uuid not null references auth.users(id) on delete cascade,
 operation_id uuid not null,
 kind text not null check(kind in ('create','update')),
 run_id uuid,
 payload_digest text check(payload_digest is null or payload_digest ~ '^[a-f0-9]{64}$'),
 accepted_revision integer not null default 0 check(accepted_revision >= 0),
 deleted boolean not null default false,
 created_at timestamptz not null default now(),
 primary key(user_id,operation_id)
);
create index run_receipts_user_run_idx on public.run_operation_receipts(user_id,run_id);
alter table public.run_operation_receipts enable row level security;
revoke all on public.run_operation_receipts from public, anon, authenticated;
grant select on public.run_operation_receipts to authenticated;
grant all on public.run_operation_receipts to service_role;
create policy run_receipts_owner on public.run_operation_receipts for select to authenticated using(user_id = (select auth.uid()));
create index workouts_running_date_idx on public.workouts(user_id,(details->'runSummary'->>'activityDate') desc,id desc) where details->>'activityType' = 'running';

create function public.run_validate(p_summary jsonb) returns void language plpgsql set search_path='' as $$
declare d date; zone text; start_time timestamptz; duration numeric; distance numeric; effort numeric;
begin
 if p_summary is null or jsonb_typeof(p_summary) <> 'object' or
  not p_summary ?& array['version','activityDate','recordingTimezone','timePrecision','startedAt','durationSeconds','durationBasis','distanceMeters','environment','perceivedExertion','origin','timestampEnvelope','revision'] or
  p_summary - array['version','activityDate','recordingTimezone','timePrecision','startedAt','durationSeconds','durationBasis','distanceMeters','environment','perceivedExertion','origin','timestampEnvelope','revision'] <> '{}'::jsonb or
  p_summary->'version' <> '1'::jsonb or p_summary->>'durationBasis' <> 'elapsed' or p_summary->'origin' <> '{"kind":"manual"}'::jsonb or
  jsonb_typeof(p_summary->'activityDate') <> 'string' or p_summary->>'activityDate' !~ '^\d{4}-\d{2}-\d{2}$' or
  jsonb_typeof(p_summary->'recordingTimezone') <> 'string' or length(p_summary->>'recordingTimezone') > 100 or
  jsonb_typeof(p_summary->'durationSeconds') <> 'number' or jsonb_typeof(p_summary->'revision') <> 'number' or
  jsonb_typeof(p_summary->'durationBasis') <> 'string' or jsonb_typeof(p_summary->'environment') <> 'string' or
  jsonb_typeof(p_summary->'timePrecision') <> 'string' or jsonb_typeof(p_summary->'timestampEnvelope') <> 'string' or
  p_summary->>'environment' not in ('outdoor','treadmill','unspecified')
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
revoke all on function public.run_validate(jsonb) from public,anon,authenticated,service_role;

create function public.run_admit() returns uuid language plpgsql security definer set search_path='' as $$
declare caller uuid := auth.uid();
begin
 if caller is null then raise exception 'run_not_found' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('running:'||caller::text,0));
 if exists(select 1 from public.account_deletion_jobs where user_id=caller and status in ('in_progress','failed','completed')) then raise exception 'run_invalid' using errcode='22023'; end if;
 return caller;
end; $$;
revoke all on function public.run_admit() from public,anon,authenticated,service_role;

-- Invoker trigger: authenticated table writes cannot bypass the transaction RPC.
create function public.run_workout_guard() returns trigger language plpgsql set search_path='' as $$
declare tagged boolean; summary jsonb; start_time timestamptz; end_time timestamptz; owner_name text;
begin
 tagged := case when tg_op='DELETE' then old.details->>'activityType'='running' or old.details ? 'runSummary'
 else new.details->>'activityType'='running' or new.details ? 'runSummary' or (tg_op='UPDATE' and (old.details->>'activityType'='running' or old.details ? 'runSummary')) end;
 if not coalesce(tagged,false) then if tg_op='DELETE' then return old; else return new; end if; end if;
 select pg_catalog.pg_get_userbyid(relowner) into owner_name from pg_catalog.pg_class where oid='public.workouts'::regclass;
 if current_user <> owner_name and not (tg_op='DELETE' and current_user='service_role') then raise exception 'run_requires_rpc' using errcode='42501'; end if;
 if tg_op='DELETE' then return old; end if;
 if new.details->>'activityType' is distinct from 'running' or new.details - array['activityType','workoutLifecycle','runSummary'] <> '{}'::jsonb or new.details->'workoutLifecycle' is distinct from '{"kind":"session"}'::jsonb or new.source <> 'manual' or new.client_operation_id is null or length(btrim(new.name)) not between 1 and 200 or length(coalesce(new.notes,''))>4000
 then raise exception 'run_invalid' using errcode='22023'; end if;
 if tg_op='UPDATE' and (new.user_id is distinct from old.user_id or new.id is distinct from old.id or new.client_operation_id is distinct from old.client_operation_id) then raise exception 'run_invalid' using errcode='22023'; end if;
 summary:=new.details->'runSummary'; perform public.run_validate(summary);
 if summary->>'timePrecision'='day' then
  start_time:=((summary->>'activityDate')::date+time '12:00') at time zone (summary->>'recordingTimezone'); end_time:=start_time;
 else start_time:=(summary->>'startedAt')::timestamptz; end_time:=start_time+(summary->>'durationSeconds')::integer*interval '1 second'; end if;
 if new.started_at is distinct from start_time or new.completed_at is distinct from end_time or exists(select 1 from public.workout_sets where workout_id=new.id) then raise exception 'run_invalid' using errcode='22023'; end if;
 return new;
end; $$;
revoke all on function public.run_workout_guard() from public,anon,authenticated,service_role;
create trigger run_workout_guard before insert or update or delete on public.workouts for each row execute function public.run_workout_guard();
create function public.run_delete_tombstone() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.details->>'activityType'='running' then update public.run_operation_receipts set deleted=true where user_id=old.user_id and run_id=old.id; end if; return old;
end; $$;
revoke all on function public.run_delete_tombstone() from public,anon,authenticated,service_role;
create trigger run_delete_tombstone after delete on public.workouts for each row execute function public.run_delete_tombstone();

create function public.run_create(p_operation uuid,p_name text,p_notes text,p_summary jsonb) returns setof public.workouts language plpgsql security definer set search_path='' as $$
declare caller uuid; receipt public.run_operation_receipts; digest text; row_id uuid; start_time timestamptz; end_time timestamptz;
begin
 caller:=public.run_admit();
 if p_operation is null then raise exception 'run_invalid' using errcode='22023'; end if;
 digest:=encode(extensions.digest(jsonb_build_object('name',p_name,'notes',p_notes,'summary',p_summary)::text,'sha256'),'hex');
 select * into receipt from public.run_operation_receipts where user_id=caller and operation_id=p_operation;
 if found then
  if receipt.deleted then raise exception 'run_removed' using errcode='P0003'; end if;
  if receipt.kind<>'create' or receipt.payload_digest is distinct from digest then raise exception 'run_conflict' using errcode='40001'; end if;
  return query select * from public.workouts where id=receipt.run_id and user_id=caller; return;
 end if;
 perform public.run_validate(p_summary);
 if p_summary->'revision'<>'1'::jsonb then raise exception 'run_invalid' using errcode='22023'; end if;
 if p_summary->>'timePrecision'='day' then start_time:=((p_summary->>'activityDate')::date+time '12:00') at time zone (p_summary->>'recordingTimezone'); end_time:=start_time;
 else start_time:=(p_summary->>'startedAt')::timestamptz; end_time:=start_time+(p_summary->>'durationSeconds')::integer*interval '1 second'; end if;
 row_id:=gen_random_uuid();
 insert into public.workouts(id,user_id,client_operation_id,name,notes,source,started_at,completed_at,details) values(row_id,caller,p_operation,p_name,p_notes,'manual',start_time,end_time,jsonb_build_object('activityType','running','workoutLifecycle',jsonb_build_object('kind','session'),'runSummary',p_summary));
 insert into public.run_operation_receipts(user_id,operation_id,kind,run_id,payload_digest,accepted_revision) values(caller,p_operation,'create',row_id,digest,1);
 return query select * from public.workouts where id=row_id and user_id=caller;
end; $$;

create function public.run_update(p_id uuid,p_operation uuid,p_expected_revision integer,p_name text,p_notes text,p_summary jsonb) returns setof public.workouts language plpgsql security definer set search_path='' as $$
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
  if receipt.kind<>'update' or receipt.run_id is distinct from p_id or receipt.payload_digest is distinct from digest or receipt.accepted_revision<>revision then raise exception 'run_conflict' using errcode='40001'; end if;
  return next existing; return;
 end if;
 if revision<>p_expected_revision then raise exception 'run_conflict' using errcode='40001'; end if;
 perform public.run_validate(p_summary);
 if (p_summary->>'revision')::integer<>revision+1 then raise exception 'run_invalid' using errcode='22023'; end if;
 if p_summary->>'timePrecision'='day' then start_time:=((p_summary->>'activityDate')::date+time '12:00') at time zone (p_summary->>'recordingTimezone'); end_time:=start_time;
 else start_time:=(p_summary->>'startedAt')::timestamptz; end_time:=start_time+(p_summary->>'durationSeconds')::integer*interval '1 second'; end if;
 update public.workouts set name=p_name,notes=p_notes,started_at=start_time,completed_at=end_time,details=jsonb_build_object('activityType','running','workoutLifecycle',jsonb_build_object('kind','session'),'runSummary',p_summary),updated_at=now() where id=p_id and user_id=caller;
 insert into public.run_operation_receipts(user_id,operation_id,kind,run_id,payload_digest,accepted_revision) values(caller,p_operation,'update',p_id,digest,revision+1);
 return query select * from public.workouts where id=p_id and user_id=caller;
end; $$;

create function public.run_get(p_id uuid) returns setof public.workouts language sql security invoker set search_path='' as $$
 select * from public.workouts where id=p_id and user_id=auth.uid() and details->>'activityType'='running';
$$;
create function public.run_list(p_from text default null,p_to text default null,p_cursor text default null,p_limit integer default 51) returns setof public.workouts language plpgsql security invoker set search_path='' as $$
begin
 if p_limit is null or p_limit not between 1 and 101 or (p_from is not null and (p_from !~ '^\d{4}-\d{2}-\d{2}$' or to_char(p_from::date,'YYYY-MM-DD')<>p_from)) or (p_to is not null and (p_to !~ '^\d{4}-\d{2}-\d{2}$' or to_char(p_to::date,'YYYY-MM-DD')<>p_to)) or (p_cursor is not null and p_cursor !~ '^\d{4}-\d{2}-\d{2}:[0-9a-f-]{36}$') then raise exception 'run_invalid' using errcode='22023'; end if;
 return query select w.* from public.workouts w where w.user_id=auth.uid() and w.details->>'activityType'='running'
 and (p_from is null or w.details->'runSummary'->>'activityDate'>=p_from) and (p_to is null or w.details->'runSummary'->>'activityDate'<=p_to)
 and (p_cursor is null or ((w.details->'runSummary'->>'activityDate'),w.id) < (split_part(p_cursor,':',1),split_part(p_cursor,':',2)::uuid))
 order by w.details->'runSummary'->>'activityDate' desc,w.id desc limit p_limit;
end; $$;
create function public.run_remove(p_id uuid) returns setof public.workouts language plpgsql security definer set search_path='' as $$
declare caller uuid;
begin
 caller:=public.run_admit();
 delete from public.workouts where id=p_id and user_id=caller and details->>'activityType'='running'; return;
end; $$;
create function public.run_cancel(p_operation uuid) returns setof public.workouts language plpgsql security definer set search_path='' as $$
declare caller uuid; receipt public.run_operation_receipts;
begin
 caller:=public.run_admit(); if p_operation is null then raise exception 'run_invalid' using errcode='22023'; end if;
 select * into receipt from public.run_operation_receipts where user_id=caller and operation_id=p_operation;
 if found then
  if receipt.kind<>'create' then raise exception 'run_conflict' using errcode='40001'; end if;
  update public.run_operation_receipts set deleted=true where user_id=caller and operation_id=p_operation;
  delete from public.workouts where id=receipt.run_id and user_id=caller and details->>'activityType'='running';
 else insert into public.run_operation_receipts(user_id,operation_id,kind,deleted) values(caller,p_operation,'create',true); end if;
 return;
end; $$;

-- A run cannot be made into a set or shared using the existing strength projection.
create function public.run_child_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare workout_id uuid;
begin
 if tg_table_name='workout_sets' then workout_id:=new.workout_id; else workout_id:=new.source_workout_id; end if;
 if exists(select 1 from public.workouts where id=workout_id and (details->>'activityType'='running' or details ? 'runSummary')) then raise exception 'run_invalid' using errcode='22023'; end if;
 return new;
end; $$;
revoke all on function public.run_child_guard() from public,anon,authenticated,service_role;
create trigger run_set_guard before insert or update on public.workout_sets for each row execute function public.run_child_guard();
create trigger run_share_guard before insert or update on public.shared_activities for each row execute function public.run_child_guard();
revoke all on function public.run_create(uuid,text,text,jsonb),public.run_update(uuid,uuid,integer,text,text,jsonb),public.run_get(uuid),public.run_list(text,text,text,integer),public.run_remove(uuid),public.run_cancel(uuid) from public,anon,authenticated,service_role;
grant execute on function public.run_create(uuid,text,text,jsonb),public.run_update(uuid,uuid,integer,text,text,jsonb),public.run_get(uuid),public.run_list(text,text,text,integer),public.run_remove(uuid),public.run_cancel(uuid) to authenticated;

create trigger run_routine_share_guard before insert or update on public.community_routine_shares for each row execute function public.run_child_guard();
create trigger run_challenge_guard before insert or update on public.community_challenge_contributions for each row execute function public.run_child_guard();
