-- BOULDER-001 BLD-04 / ADR-0066 §6: projects across sessions.
-- A "not yet" boulder opens a project unless the user chose "Try again" on an
-- existing open project. There is no automatic matching by grade or colour.

create table public.boulder_projects (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 grade_scale text not null default 'font' check (grade_scale = 'font'),
 grade_code text not null check (public.boulder_grade_rank(grade_code) is not null),
 grade_rank smallint not null check (grade_rank between 0 and 22),
 hold_colour text check (hold_colour is null or hold_colour in ('red','orange','yellow','green','blue','purple','pink','black','white','grey','other')),
 status text not null default 'open' check (status in ('open','sent','archived')),
 first_logged_at timestamptz not null,
 sent_at timestamptz,
 sent_ascent_id uuid,
 revision integer not null default 1 check (revision > 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (id, user_id),
 check (grade_rank = public.boulder_grade_rank(grade_code)),
 check (case when status = 'sent' then sent_at is not null and sent_ascent_id is not null else sent_at is null and sent_ascent_id is null end)
);
create index boulder_projects_user_status_idx on public.boulder_projects(user_id, status, first_logged_at desc);
alter table public.boulder_projects enable row level security;
revoke all on public.boulder_projects from public, anon, authenticated;
grant select on public.boulder_projects to authenticated;
grant all on public.boulder_projects to service_role;
create policy boulder_projects_owner_select on public.boulder_projects for select to authenticated using (user_id = (select auth.uid()));
create trigger boulder_projects_set_updated_at before update on public.boulder_projects for each row execute function public.set_updated_at();

alter table public.boulder_ascents add column project_id uuid;
alter table public.boulder_ascents add constraint boulder_ascents_project_fk foreign key (project_id, user_id) references public.boulder_projects(id, user_id) on delete set null (project_id);
create index boulder_ascents_project_idx on public.boulder_ascents(project_id, logged_at) where project_id is not null;

-- Derive project state from its linked boulders. A project with no boulders
-- left (its only boulder was deleted) is removed; archived stays archived
-- unless a linked boulder is a send.
create function public.boulder_project_refresh(p_project uuid) returns void language plpgsql security definer set search_path='' as $$
declare first_ascent public.boulder_ascents; first_send public.boulder_ascents; current public.boulder_projects;
begin
 if p_project is null then return; end if;
 select * into current from public.boulder_projects where id=p_project for update;
 if not found then return; end if;
 select * into first_ascent from public.boulder_ascents where project_id=p_project order by logged_at, sequence limit 1;
 if not found then delete from public.boulder_projects where id=p_project; return; end if;
 select * into first_send from public.boulder_ascents where project_id=p_project and result in ('flash','sent') order by logged_at, sequence limit 1;
 update public.boulder_projects set
  grade_code=first_ascent.grade_code, grade_rank=first_ascent.grade_rank, hold_colour=first_ascent.hold_colour, first_logged_at=first_ascent.logged_at,
  status=case when first_send.id is not null then 'sent' when current.status='archived' then 'archived' else 'open' end,
  sent_at=first_send.logged_at, sent_ascent_id=first_send.id,
  revision=current.revision+1
 where id=p_project;
end; $$;
revoke all on function public.boulder_project_refresh(uuid) from public,anon,authenticated,service_role;

create function public.boulder_ascent_project_sync() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op in ('UPDATE','DELETE') then perform public.boulder_project_refresh(old.project_id); end if;
 if tg_op in ('INSERT','UPDATE') and new.project_id is distinct from (case when tg_op='UPDATE' then old.project_id end) then perform public.boulder_project_refresh(new.project_id); end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end; $$;
revoke all on function public.boulder_ascent_project_sync() from public,anon,authenticated,service_role;
create trigger boulder_ascent_project_sync after insert or update or delete on public.boulder_ascents for each row execute function public.boulder_ascent_project_sync();

-- Create gains an optional explicit project link. The old overload is replaced.
drop function public.boulder_ascent_create(uuid,uuid,text,text,integer,text,text,uuid);
create function public.boulder_ascent_create(p_session uuid,p_operation uuid,p_grade text,p_result text,p_attempts integer,p_colour text,p_note text,p_photo uuid,p_project uuid default null) returns setof public.boulder_ascents language plpgsql security definer set search_path='' as $$
declare caller uuid; receipt public.boulder_operation_receipts; digest text; row_id uuid; next_sequence integer; project uuid;
begin
 caller:=public.boulder_admit();
 if p_operation is null or p_session is null then raise exception 'boulder_invalid' using errcode='22023'; end if;
 -- The project key is added only when linked, so BLD-02 receipts still replay.
 digest:=encode(extensions.digest((jsonb_build_object('session',p_session,'grade',p_grade,'result',p_result,'attempts',p_attempts,'colour',p_colour,'note',p_note,'photo',p_photo)||case when p_project is null then '{}'::jsonb else jsonb_build_object('project',p_project) end)::text,'sha256'),'hex');
 select * into receipt from public.boulder_operation_receipts where user_id=caller and operation_id=p_operation;
 if found then
  if receipt.deleted then raise exception 'boulder_removed' using errcode='P0003'; end if;
  if receipt.kind<>'ascent_create' or receipt.payload_digest is distinct from digest then raise exception 'boulder_conflict' using errcode='PT409'; end if;
  return query select * from public.boulder_ascents where id=receipt.ascent_id and user_id=caller; return;
 end if;
 if exists(select 1 from public.boulder_operation_receipts where user_id=caller and session_id=p_session and kind='session_start' and deleted) then raise exception 'boulder_removed' using errcode='P0003'; end if;
 perform 1 from public.workouts where id=p_session and user_id=caller and details->>'activityType'='bouldering' for update;
 if not found then raise exception 'boulder_not_found' using errcode='P0002'; end if;
 perform public.boulder_validate_ascent(p_grade,p_result,p_attempts,p_colour,p_note);
 perform public.boulder_check_photo(caller,p_photo);
 if p_project is not null then
  -- A flash is a first-try send, so it cannot continue a project.
  if p_result='flash' then raise exception 'boulder_invalid' using errcode='22023'; end if;
  -- A project sent or removed elsewhere is a distinct, recoverable outcome.
  perform 1 from public.boulder_projects where id=p_project and user_id=caller and status in ('open','archived') for update;
  if not found then raise exception 'boulder_project_unavailable' using errcode='PT409'; end if;
  project:=p_project;
 elsif p_result='not_yet' then
  project:=gen_random_uuid();
  insert into public.boulder_projects(id,user_id,grade_code,grade_rank,hold_colour,first_logged_at) values(project,caller,p_grade,public.boulder_grade_rank(p_grade),p_colour,now());
 end if;
 select coalesce(max(sequence),0)+1 into next_sequence from public.boulder_ascents where workout_id=p_session and user_id=caller;
 row_id:=gen_random_uuid();
 insert into public.boulder_ascents(id,user_id,workout_id,client_operation_id,sequence,grade_code,grade_rank,result,attempts,hold_colour,note,photo_asset_id,project_id)
 values(row_id,caller,p_session,p_operation,next_sequence,p_grade,public.boulder_grade_rank(p_grade),p_result,p_attempts,p_colour,p_note,p_photo,project);
 insert into public.boulder_operation_receipts(user_id,operation_id,kind,session_id,ascent_id,payload_digest,accepted_revision) values(caller,p_operation,'ascent_create',p_session,row_id,digest,1);
 return query select * from public.boulder_ascents where id=row_id and user_id=caller;
end; $$;

-- Archive or reopen. Sent projects keep their history and cannot be archived.
create function public.boulder_project_set_archived(p_id uuid,p_archived boolean) returns setof public.boulder_projects language plpgsql security definer set search_path='' as $$
declare caller uuid; existing public.boulder_projects;
begin
 caller:=public.boulder_admit();
 if p_archived is null then raise exception 'boulder_invalid' using errcode='22023'; end if;
 select * into existing from public.boulder_projects where id=p_id and user_id=caller for update;
 if not found then raise exception 'boulder_not_found' using errcode='P0002'; end if;
 if existing.status='sent' then raise exception 'boulder_conflict' using errcode='PT409'; end if;
 if existing.status <> (case when p_archived then 'archived' else 'open' end) then
  update public.boulder_projects set status=case when p_archived then 'archived' else 'open' end, revision=existing.revision+1 where id=p_id and user_id=caller;
 end if;
 return query select * from public.boulder_projects where id=p_id and user_id=caller;
end; $$;

revoke all on function public.boulder_ascent_create(uuid,uuid,text,text,integer,text,text,uuid,uuid),public.boulder_project_set_archived(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.boulder_ascent_create(uuid,uuid,text,text,integer,text,text,uuid,uuid),public.boulder_project_set_archived(uuid,boolean) to authenticated;
