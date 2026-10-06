-- Domain conflicts must not trigger PostgREST serialization retries.
-- Preserve existing signatures, owner, grants and transaction invariants.
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
 if p_summary->'revision'<>'1'::jsonb then raise exception 'run_invalid' using errcode='22023'; end if;
 if p_summary->>'timePrecision'='day' then start_time:=((p_summary->>'activityDate')::date+time '12:00') at time zone (p_summary->>'recordingTimezone'); end_time:=start_time;
 else start_time:=(p_summary->>'startedAt')::timestamptz; end_time:=start_time+(p_summary->>'durationSeconds')::integer*interval '1 second'; end if;
 row_id:=gen_random_uuid();
 insert into public.workouts(id,user_id,client_operation_id,name,notes,source,started_at,completed_at,details) values(row_id,caller,p_operation,p_name,p_notes,'manual',start_time,end_time,jsonb_build_object('activityType','running','workoutLifecycle',jsonb_build_object('kind','session'),'runSummary',p_summary));
 insert into public.run_operation_receipts(user_id,operation_id,kind,run_id,payload_digest,accepted_revision) values(caller,p_operation,'create',row_id,digest,1);
 return query select * from public.workouts where id=row_id and user_id=caller;
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
 if p_summary->>'timePrecision'='day' then start_time:=((p_summary->>'activityDate')::date+time '12:00') at time zone (p_summary->>'recordingTimezone'); end_time:=start_time;
 else start_time:=(p_summary->>'startedAt')::timestamptz; end_time:=start_time+(p_summary->>'durationSeconds')::integer*interval '1 second'; end if;
 update public.workouts set name=p_name,notes=p_notes,started_at=start_time,completed_at=end_time,details=jsonb_build_object('activityType','running','workoutLifecycle',jsonb_build_object('kind','session'),'runSummary',p_summary),updated_at=now() where id=p_id and user_id=caller;
 insert into public.run_operation_receipts(user_id,operation_id,kind,run_id,payload_digest,accepted_revision) values(caller,p_operation,'update',p_id,digest,revision+1);
 return query select * from public.workouts where id=p_id and user_id=caller;
end; $$;

create or replace function public.run_cancel(p_operation uuid) returns setof public.workouts language plpgsql security definer set search_path='' as $$
declare caller uuid; receipt public.run_operation_receipts;
begin
 caller:=public.run_admit(); if p_operation is null then raise exception 'run_invalid' using errcode='22023'; end if;
 select * into receipt from public.run_operation_receipts where user_id=caller and operation_id=p_operation;
 if found then
  if receipt.kind<>'create' then raise exception 'run_conflict' using errcode='PT409'; end if;
  update public.run_operation_receipts set deleted=true where user_id=caller and operation_id=p_operation;
  delete from public.workouts where id=receipt.run_id and user_id=caller and details->>'activityType'='running';
 else insert into public.run_operation_receipts(user_id,operation_id,kind,deleted) values(caller,p_operation,'create',true); end if;
 return;
end; $$;
