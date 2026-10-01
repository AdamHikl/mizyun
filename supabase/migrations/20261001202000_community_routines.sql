begin;
-- COMM-22: deliberate immutable targets; private source IDs never cross the boundary.
create table public.community_routine_shares (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 source_workout_id uuid references public.workouts(id) on delete cascade, source_updated_at timestamptz not null,
 operation_id uuid not null, enrollment_generation integer not null, snapshot jsonb not null, version integer not null default 1 check(version=1),
 revoked_at timestamptz, created_at timestamptz not null default now(), unique(user_id,operation_id)
);
create index community_routine_shares_user_idx on public.community_routine_shares(user_id,id);
create index community_routine_shares_source_idx on public.community_routine_shares(source_workout_id);
create table public.community_routine_imports (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 share_id uuid not null, workout_id uuid references public.workouts(id) on delete set null,
 author_handle text not null, snapshot jsonb not null, version integer not null, created_at timestamptz not null default now(), unique(user_id,share_id)
);
create index community_routine_imports_user_idx on public.community_routine_imports(user_id,id);
alter table public.community_routine_shares enable row level security;
alter table public.community_routine_imports enable row level security;
revoke all on public.community_routine_shares,public.community_routine_imports from public,anon,authenticated;
grant all on public.community_routine_shares,public.community_routine_imports to service_role;

create function public.community_routine_projection(p_details jsonb,p_title text) returns jsonb
language plpgsql immutable security definer set search_path='' as $$
declare e jsonb; items jsonb:='[]'; n text; s integer; lo integer; hi integer; rest integer; load numeric; raw text; reps text[];
begin
 if p_details->'workoutLifecycle'->>'kind' is distinct from 'routine' or jsonb_typeof(p_details->'coachPlan'->'exercises') is distinct from 'array'
 or jsonb_array_length(p_details->'coachPlan'->'exercises') not between 1 and 30 or nullif(btrim(p_title),'') is null or char_length(btrim(p_title))>80 then raise exception 'community_invalid_input';end if;
 if not public.community_text_safe(p_title) or p_title ~* '(https?://|www\.|@)' then raise exception 'community_content_violation';end if;
 for e in select value from jsonb_array_elements(p_details->'coachPlan'->'exercises') loop
 n:=btrim(e->>'name');
 if n is null or char_length(n) not between 1 and 120 or not public.community_text_safe(n) or n ~* '(https?://|www\.|@)' then raise exception 'community_content_violation';end if;
 if coalesce(e->>'targetSets',e->>'sets','') !~ '^\d{1,2}$' then raise exception 'community_invalid_input';end if;
 s:=coalesce(e->>'targetSets',e->>'sets')::integer;
 if e->>'targetReps' is not null then
 reps:=regexp_match(e->>'targetReps','^(\d{1,3})(?:-(\d{1,3}))?$');
 if reps is null then raise exception 'community_invalid_input';end if;lo:=reps[1]::integer;hi:=coalesce(reps[2],reps[1])::integer;
 else
 if coalesce(e->>'repsMin','') !~ '^\d{1,3}$' or coalesce(e->>'repsMax','') !~ '^\d{1,3}$' then raise exception 'community_invalid_input';end if;
 lo:=(e->>'repsMin')::integer;hi:=(e->>'repsMax')::integer;end if;
 if coalesce(e->>'restSeconds','90') !~ '^\d{1,4}$' then raise exception 'community_invalid_input';end if;rest:=coalesce(e->>'restSeconds','90')::integer;
 load:=null;raw:=nullif(btrim(e->>'targetLoad'),'');
 if raw is not null then
 reps:=regexp_match(raw,'^(\d+(?:\.\d{1,3})?)\s*(kg|lb|lbs)$','i');
 if reps is null then raise exception 'community_invalid_input';end if;
 load:=round(reps[1]::numeric * case when lower(reps[2])='kg' then 1 else 0.45359237 end,3);
 if load>1000 then raise exception 'community_invalid_input';end if;end if;
 if s not between 1 and 20 or lo not between 1 and 100 or hi not between lo and 100 or rest not between 0 and 1800 then raise exception 'community_invalid_input';end if;
 items:=items||jsonb_build_array(jsonb_build_object('name',n,'sets',s,'repsMin',lo,'repsMax',hi,'loadKg',load,'restSeconds',rest));
 end loop;
 return jsonb_build_object('schemaVersion','2026-10-01','title',btrim(p_title),'exercises',items);
end $$;
create function public.community_routine_snapshot_current(p_details jsonb,p_snapshot jsonb) returns boolean
language plpgsql immutable security definer set search_path='' as $$begin
 return public.community_routine_projection(p_details,p_snapshot->>'title')=p_snapshot;
 exception when others then return false;
end $$;
create function public.community_can_view_routine(p_id uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select auth.uid() is not null and public.community_feature_enabled('routines',auth.uid()) and exists(
 select 1 from public.community_routine_shares r join public.workouts w on w.id=r.source_workout_id and w.user_id=r.user_id
 where r.id=p_id and r.revoked_at is null and w.updated_at=r.source_updated_at and w.details->'workoutLifecycle'->>'kind'='routine' and public.community_routine_snapshot_current(w.details,r.snapshot)
 and public.community_active(r.user_id) and r.enrollment_generation=(select generation from public.community_profiles where user_id=r.user_id) and not public.community_blocked_between(auth.uid(),r.user_id)
 and (r.user_id=auth.uid() or exists(select 1 from public.community_relationships where follower_user_id=auth.uid() and target_user_id=r.user_id and status='approved')))
$$;
create policy community_routine_shares_visible on public.community_routine_shares for select to authenticated using(public.community_can_view_routine(id));
create policy community_routine_imports_owner on public.community_routine_imports for select to authenticated using(user_id=auth.uid());
-- Direct grants remain absent: wire projections are the sole social read boundary.
create function public.community_routine_dto(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',r.id,'authorHandle',p.handle,'version',r.version,'isOwner',r.user_id=auth.uid(),'available',public.community_can_view_routine(r.id),'createdAt',r.created_at,'snapshot',r.snapshot)
 from public.community_routine_shares r join public.community_profiles p on p.user_id=r.user_id where r.id=p_id
$$;
create function public.community_routines(p_operation text,p_args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); w public.workouts; r public.community_routine_shares; receipt public.community_routine_imports;
 sid uuid; op uuid; projection jsonb; items jsonb; lim integer; last_id uuid; next_id uuid; copy_id uuid; plan jsonb; e jsonb; author text;
begin
 perform public.community_lock();
 if caller is null then raise exception 'community_access_denied';end if;
 if p_operation='unshare' then
 update public.community_routine_shares set revoked_at=coalesce(revoked_at,now()) where id=(p_args->>'id')::uuid and user_id=caller;
 -- Idempotent privacy reduction even while frozen or withdrawn; guessed IDs reveal nothing.
 return jsonb_build_object('unshared',true);end if;
 if not public.community_feature_enabled('routines',caller) and not (p_operation='list' and p_args->>'mine'='true') then raise exception 'community_unavailable';end if;
 if p_operation in ('preview','publish') then
 select * into w from public.workouts where id=(p_args->>'sourceWorkoutId')::uuid and user_id=caller for share;
 if w.id is null then raise exception 'community_unavailable';end if;
 if p_operation='preview' then
 projection:=public.community_routine_projection(w.details,p_args->>'title');
 return jsonb_build_object('sourceUpdatedAt',w.updated_at,'snapshot',projection);end if;
 if p_args->'confirmed' is distinct from 'true'::jsonb or p_args->>'operationId' is null then raise exception 'community_invalid_input';end if;
 op:=(p_args->>'operationId')::uuid;
 select * into r from public.community_routine_shares where user_id=caller and operation_id=op;
 if r.id is not null then
 if r.source_workout_id is distinct from w.id or r.snapshot is distinct from p_args->'snapshot' or r.source_updated_at is distinct from (p_args->>'sourceUpdatedAt')::timestamptz then raise exception 'community_conflict';end if;
 if not public.community_can_view_routine(r.id) then raise exception 'community_unavailable';end if;
 return public.community_routine_dto(r.id);end if;
 projection:=public.community_routine_projection(w.details,p_args->'snapshot'->>'title');
 if projection is distinct from p_args->'snapshot' or w.updated_at is distinct from (p_args->>'sourceUpdatedAt')::timestamptz then raise exception 'community_conflict';end if;
 if (select count(*) from public.community_routine_shares where user_id=caller and created_at>now()-interval '1 day')>=10 or (select count(*) from public.community_routine_shares where user_id=caller)>=100 then raise exception 'community_rate_limited';end if;
 insert into public.community_routine_shares(user_id,source_workout_id,source_updated_at,operation_id,enrollment_generation,snapshot) values(caller,w.id,w.updated_at,op,(select generation from public.community_profiles where user_id=caller),projection) returning * into r;
 return public.community_routine_dto(r.id);
 elsif p_operation='list' then
 lim:=coalesce((p_args->>'limit')::integer,20);last_id:=(p_args->>'cursor')::uuid;
 if lim not between 1 and 50 then raise exception 'community_invalid_input';end if;
 select coalesce(jsonb_agg(t.dto order by t.id),'[]') into items from (
 select routine_row.id,public.community_routine_dto(routine_row.id) dto from public.community_routine_shares routine_row where (last_id is null or routine_row.id>last_id) and (coalesce(p_args->>'mine','false')<>'true' or routine_row.user_id=caller) and (public.community_can_view_routine(routine_row.id) or (p_args->>'mine'='true' and routine_row.user_id=caller)) order by routine_row.id limit lim) t;
 if jsonb_array_length(items)=lim then next_id:=(items->(lim-1)->>'id')::uuid;end if;
 return jsonb_build_object('items',items,'nextCursor',next_id);
 elsif p_operation in ('get','import') then
 sid:=(p_args->>'id')::uuid;
 -- Import retries return only the caller's private receipt even after source removal.
 if p_operation='import' then
 if p_args->'confirmed' is distinct from 'true'::jsonb then raise exception 'community_invalid_input';end if;
 select * into receipt from public.community_routine_imports where user_id=caller and share_id=sid;
 if receipt.id is not null then
 if receipt.version is distinct from (p_args->>'version')::integer then raise exception 'community_conflict';end if;
 if receipt.workout_id is null then raise exception 'community_unavailable';end if;
 return jsonb_build_object('workoutId',receipt.workout_id,'alreadyImported',true);end if;end if;
 if not public.community_can_view_routine(sid) then raise exception 'community_unavailable';end if;
 select * into r from public.community_routine_shares where id=sid for share;
 perform 1 from public.workouts where id=r.source_workout_id for share;
 -- Lock source then recheck to serialize edits/deletes with imports.
 if not public.community_can_view_routine(sid) then raise exception 'community_unavailable';end if;
 if p_operation='get' then return public.community_routine_dto(sid);end if;
 if r.user_id=caller or r.version is distinct from (p_args->>'version')::integer then raise exception 'community_conflict';end if;
 if (select count(*) from public.community_routine_imports where user_id=caller and created_at>now()-interval '1 day')>=10 then raise exception 'community_rate_limited';end if;
 select handle into author from public.community_profiles where user_id=r.user_id;
 plan:='[]';for e in select value from jsonb_array_elements(r.snapshot->'exercises') loop
 plan:=plan||jsonb_build_array(jsonb_build_object('name',e->>'name','movementPattern','custom','sets',e->'sets','targetSets',e->'sets',
 'targetReps',case when e->>'repsMin'=e->>'repsMax' then e->>'repsMin' else concat(e->>'repsMin','-',e->>'repsMax') end,
 'repsMin',e->'repsMin','repsMax',e->'repsMax','restSeconds',e->'restSeconds','targetLoad',case when e->'loadKg'='null'::jsonb then null else concat(e->>'loadKg',' kg') end));end loop;
 copy_id:=gen_random_uuid();
 insert into public.workouts(id,user_id,name,started_at,completed_at,notes,source,details) values(copy_id,caller,r.snapshot->>'title',now(),null,null,'manual',
 jsonb_build_object('workoutLifecycle',jsonb_build_object('kind','routine'),'coachPlan',jsonb_build_object('exercises',plan),
 'communityAttribution',jsonb_build_object('shareId',r.id,'authorHandle',author,'version',r.version,'copiedAt',now(),'snapshot',r.snapshot,'independentCopy',true)));
 insert into public.community_routine_imports(user_id,share_id,workout_id,author_handle,snapshot,version) values(caller,r.id,copy_id,author,r.snapshot,r.version);
 return jsonb_build_object('workoutId',copy_id,'alreadyImported',false);
 else raise exception 'community_invalid_input';end if;
end $$;
-- Export hooks omit source IDs and other users' data. Private copies are already
-- exported/deleted as the recipient's ordinary workout records.
create function public.community_routine_export(p_category text,p_after text,p_limit integer) returns table(item_key text,item jsonb)
language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null then raise exception 'community_access_denied';end if;
 if p_limit is null or p_limit not between 1 and 500 then raise exception 'community_conflict';end if;
 if p_category='routineShares' then return query select r.id::text,jsonb_build_object('id',r.id,'snapshot',r.snapshot,'version',r.version,'revokedAt',r.revoked_at,'createdAt',r.created_at) from public.community_routine_shares r where user_id=auth.uid() and (p_after is null or r.id::text>p_after) order by r.id::text limit p_limit;
 elsif p_category='routineImports' then return query select i.id::text,to_jsonb(i)-'user_id' from public.community_routine_imports i where user_id=auth.uid() and (p_after is null or i.id::text>p_after) order by i.id::text limit p_limit;
 else raise exception 'community_conflict';end if;end $$;
create function public.community_routine_withdraw(p_user_id uuid,p_generation integer,p_limit integer) returns integer
language plpgsql security definer set search_path='' as $$declare n integer; c integer;begin
 if p_limit is null or p_limit not between 1 and 500 or not exists(select 1 from public.community_profiles where user_id=p_user_id and generation=p_generation and status<>'active') then raise exception 'community_conflict';end if;
 delete from public.community_routine_shares where id in (select id from public.community_routine_shares where user_id=p_user_id limit p_limit);get diagnostics n=row_count;
 delete from public.community_routine_imports where id in (select id from public.community_routine_imports where user_id=p_user_id limit p_limit);get diagnostics c=row_count;return n+c;
end $$;
revoke all on function public.community_routine_snapshot_current(jsonb,jsonb),public.community_routine_projection(jsonb,text),public.community_can_view_routine(uuid),public.community_routine_dto(uuid),public.community_routines(text,jsonb),public.community_routine_export(text,text,integer),public.community_routine_withdraw(uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.community_routines(text,jsonb),public.community_routine_export(text,text,integer) to authenticated;
grant execute on function public.community_can_view_routine(uuid) to authenticated;
grant execute on function public.community_routine_withdraw(uuid,integer,integer) to service_role;

-- Chain each extension once, preserving prior authorization decisions.
alter function public.community_issue_report_receipt(text,text) rename to community_issue_report_receipt_before_routines;
create function public.community_issue_report_receipt(p_target_type text,p_target_id text) returns table(id uuid)
language plpgsql security definer set search_path='' as $$declare r public.community_routine_shares;receipt_id uuid;begin
 if p_target_type is distinct from 'routine' then return query select * from public.community_issue_report_receipt_before_routines(p_target_type,p_target_id);return;end if;
 perform public.community_lock();
 if not public.community_can_view_routine(p_target_id::uuid) then raise exception 'community_unavailable';end if;
 select * into r from public.community_routine_shares where community_routine_shares.id=p_target_id::uuid and user_id<>auth.uid();
 if r.id is null then raise exception 'community_unavailable';end if;
 select receipt_row.id into receipt_id from public.community_report_receipts receipt_row where receipt_row.user_id=auth.uid() and receipt_row.target_type='routine' and receipt_row.target_id=r.id::text and receipt_row.subject_user_id=r.user_id and receipt_row.evidence_snapshot=r.snapshot and receipt_row.expires_at>now() order by receipt_row.created_at desc,receipt_row.id desc limit 1;
 if receipt_id is null then insert into public.community_report_receipts(user_id,target_type,target_id,subject_user_id,evidence_snapshot) values(auth.uid(),'routine',r.id::text,r.user_id,r.snapshot) returning community_report_receipts.id into receipt_id;end if;
 if receipt_id is null then raise exception 'community_rate_limited';end if;
 return query select receipt_id;
end $$;
alter function public.community_submit_report(text,text,text,text,uuid) rename to community_submit_report_before_routines;
create function public.community_submit_report(p_target_type text,p_target_id text,p_reason text,p_notes text default null,p_interaction_receipt_id uuid default null) returns setof public.community_reports language plpgsql security definer set search_path='' as $$ declare r public.community_reports; receipt public.community_report_receipts; subject uuid; snapshot jsonb; n integer;begin
 if p_target_type is distinct from 'routine' then return query select * from public.community_submit_report_before_routines(p_target_type,p_target_id,p_reason,p_notes,p_interaction_receipt_id);return;end if;
 perform public.community_lock();
 if auth.uid() is null then raise exception 'community_access_denied';end if;
 if p_target_type is null or p_reason is null or p_target_type<>'routine' or p_reason not in ('harassment','offensive_content','impersonation','spam','unsafe_or_sexual_content','other') or char_length(p_notes)>1000 then raise exception 'community_invalid_report';end if;
 if p_interaction_receipt_id is not null then select * into receipt from public.community_report_receipts where id=p_interaction_receipt_id and user_id=auth.uid() and target_type=p_target_type and target_id=p_target_id and expires_at>now();end if;
 if p_interaction_receipt_id is not null and receipt.id is null then raise exception 'community_unavailable';end if;
 if p_interaction_receipt_id is null then select * into receipt from public.community_report_receipts where user_id=auth.uid() and target_type=p_target_type and target_id=p_target_id and expires_at>now() order by created_at desc limit 1;end if;
 if receipt.id is null then
 if public.community_can_view_routine(p_target_id::uuid) then select target_row.user_id,target_row.snapshot into subject,snapshot from public.community_routine_shares target_row where target_row.id=p_target_id::uuid and target_row.user_id<>auth.uid();end if;
 if subject is null then raise exception 'community_unavailable';end if;
 else subject:=receipt.subject_user_id;snapshot:=receipt.evidence_snapshot;end if;
 select * into r from public.community_reports where reporter_user_id=auth.uid() and target_type=p_target_type and target_id=p_target_id and reason=p_reason and status in ('submitted','under_review') order by created_at limit 1 for update;
 if r.id is not null then update public.community_reports set notes=case when nullif(p_notes,'') is null then notes else left(concat_ws(E'\n',notes,p_notes),1000) end,updated_at=now() where id=r.id returning * into r;r.assigned_to:=null;r.staff_notes:=null;r.subject_user_id:=null;r.evidence_snapshot:='{}';return next r;return;end if;
 insert into public.community_report_usage(user_id,report_date,report_count) values(auth.uid(),(now() at time zone 'UTC')::date,1) on conflict(user_id,report_date) do update set report_count=community_report_usage.report_count+1 where community_report_usage.report_count<10 returning report_count into n;
 if n is null then raise exception 'community_rate_limited';end if;
 insert into public.community_reports(reporter_user_id,target_type,target_id,reason,notes,priority,subject_user_id,evidence_snapshot) values(auth.uid(),p_target_type,p_target_id,p_reason,p_notes,case when p_reason in ('harassment','unsafe_or_sexual_content') then 'urgent' else 'normal' end,subject,coalesce(snapshot,'{}')) returning * into r;r.subject_user_id:=null;r.evidence_snapshot:='{}';return next r;
 end $$;

alter function public.community_apply_moderation_action(uuid,text,text,text,integer) rename to community_apply_moderation_action_before_routines;
create function public.community_apply_moderation_action(p_report_id uuid,p_decision text,p_decision_reason text,p_staff_notes text default null,p_suspension_duration_days integer default null)
returns setof public.community_reports language plpgsql security definer set search_path='' as $$declare operator uuid; r public.community_reports;begin
 operator:=public.community_staff_required();perform public.community_lock();select * into r from public.community_reports where id=p_report_id for update;
 if r.target_type is distinct from 'routine' or p_decision is distinct from 'remove' then return query select * from public.community_apply_moderation_action_before_routines(p_report_id,p_decision,p_decision_reason,p_staff_notes,p_suspension_duration_days);return;end if;
 if r.status not in ('submitted','under_review') or (r.assigned_to is not null and r.assigned_to<>operator::text) then raise exception 'community_conflict';end if;
 if operator=r.subject_user_id or operator=r.reporter_user_id then raise exception 'community_access_denied';end if;
 if nullif(btrim(p_decision_reason),'') is null or char_length(p_decision_reason)>500 or char_length(p_staff_notes)>1000 then raise exception 'community_invalid_action';end if;
 update public.community_routine_shares set revoked_at=coalesce(revoked_at,now()) where id::text=r.target_id;
 insert into public.community_moderation_actions(report_id,target_type,target_id,action,reason,staff_operator,staff_notes) values(r.id,r.target_type,r.target_id,'remove',p_decision_reason,operator,p_staff_notes);
 return query update public.community_reports set status='resolved',decision='remove',decision_reason=p_decision_reason,staff_notes=p_staff_notes,assigned_to=operator::text,action_taken_at=now(),updated_at=now() where id=p_report_id returning *;
end $$;
revoke all on function public.community_issue_report_receipt_before_routines(text,text),public.community_submit_report_before_routines(text,text,text,text,uuid),public.community_apply_moderation_action_before_routines(uuid,text,text,text,integer),public.community_issue_report_receipt(text,text),public.community_submit_report(text,text,text,text,uuid),public.community_apply_moderation_action(uuid,text,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.community_issue_report_receipt(text,text),public.community_submit_report(text,text,text,text,uuid),public.community_apply_moderation_action(uuid,text,text,text,integer) to authenticated;
commit;
