-- BOULDER-001 / ADR-0066: indoor bouldering sessions and boulder ascents.
-- A session is one workouts row tagged details.activityType = 'bouldering'.
-- Every write goes through authenticated security-definer RPCs with owner
-- receipts; tables expose owner-only reads.

create function public.boulder_grade_rank(p_code text) returns smallint language sql immutable set search_path='' as $$
 select (pg_catalog.array_position(array['3','4','4+','5','5+','6A','6A+','6B','6B+','6C','6C+','7A','7A+','7B','7B+','7C','7C+','8A','8A+','8B','8B+','8C','8C+']::text[], p_code) - 1)::smallint;
$$;
revoke all on function public.boulder_grade_rank(text) from public,anon,authenticated;
grant execute on function public.boulder_grade_rank(text) to service_role;

create table public.boulder_ascents (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 workout_id uuid not null,
 client_operation_id uuid not null,
 sequence integer not null check (sequence > 0),
 grade_scale text not null default 'font' check (grade_scale = 'font'),
 grade_code text not null check (public.boulder_grade_rank(grade_code) is not null),
 grade_rank smallint not null check (grade_rank between 0 and 22),
 result text not null check (result in ('flash','sent','not_yet')),
 attempts smallint,
 hold_colour text check (hold_colour is null or hold_colour in ('red','orange','yellow','green','blue','purple','pink','black','white','grey','other')),
 note text check (note is null or (length(note) between 1 and 280 and note = btrim(note))),
 photo_asset_id uuid references public.media_assets(id) on delete set null,
 logged_at timestamptz not null default now(),
 revision integer not null default 1 check (revision > 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key (workout_id, user_id) references public.workouts(id, user_id) on delete cascade,
 unique (user_id, client_operation_id),
 unique (workout_id, sequence),
 check (grade_rank = public.boulder_grade_rank(grade_code)),
 check (case result
  when 'flash' then attempts = 1
  when 'sent' then attempts is null or attempts between 2 and 99
  else attempts is null or attempts between 1 and 99 end)
);
create index boulder_ascents_user_logged_idx on public.boulder_ascents(user_id, logged_at desc);
create index boulder_ascents_workout_idx on public.boulder_ascents(workout_id, sequence);
create index boulder_ascents_photo_idx on public.boulder_ascents(photo_asset_id) where photo_asset_id is not null;
alter table public.boulder_ascents enable row level security;
revoke all on public.boulder_ascents from public, anon, authenticated;
grant select on public.boulder_ascents to authenticated;
grant all on public.boulder_ascents to service_role;
create policy boulder_ascents_owner_select on public.boulder_ascents for select to authenticated using (user_id = (select auth.uid()));

-- Minimal receipts: identity, digest, revision and tombstone; no grades or notes.
create table public.boulder_operation_receipts (
 user_id uuid not null references auth.users(id) on delete cascade,
 operation_id uuid not null,
 kind text not null check (kind in ('session_start','session_finish','ascent_create','ascent_update')),
 session_id uuid,
 ascent_id uuid,
 payload_digest text check (payload_digest is null or payload_digest ~ '^[a-f0-9]{64}$'),
 accepted_revision integer not null default 0 check (accepted_revision >= 0),
 deleted boolean not null default false,
 created_at timestamptz not null default now(),
 primary key (user_id, operation_id)
);
create index boulder_receipts_user_session_idx on public.boulder_operation_receipts(user_id, session_id);
create index boulder_receipts_user_ascent_idx on public.boulder_operation_receipts(user_id, ascent_id);
alter table public.boulder_operation_receipts enable row level security;
revoke all on public.boulder_operation_receipts from public, anon, authenticated;
grant select on public.boulder_operation_receipts to authenticated;
grant all on public.boulder_operation_receipts to service_role;
create policy boulder_receipts_owner_select on public.boulder_operation_receipts for select to authenticated using (user_id = (select auth.uid()));

create index workouts_bouldering_started_idx on public.workouts(user_id, started_at desc, id desc) where details->>'activityType' = 'bouldering';
create unique index workouts_bouldering_one_active_idx on public.workouts(user_id) where details->>'activityType' = 'bouldering' and completed_at is null;

create function public.boulder_admit() returns uuid language plpgsql security definer set search_path='' as $$
declare caller uuid := auth.uid();
begin
 if caller is null then raise exception 'boulder_not_found' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bouldering:'||caller::text,0));
 if exists(select 1 from public.account_deletion_jobs where user_id=caller and status in ('in_progress','failed','completed')) then raise exception 'boulder_invalid' using errcode='22023'; end if;
 return caller;
end; $$;
revoke all on function public.boulder_admit() from public,anon,authenticated,service_role;

create function public.boulder_valid_timezone(p_zone text) returns boolean language sql stable set search_path='' as $$
 select p_zone is not null and length(p_zone) <= 100 and p_zone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+.-]+)*$' and p_zone not in ('Factory','localtime') and p_zone !~ '^(posix|right)/'
  and exists(select 1 from pg_catalog.pg_timezone_names where name=p_zone);
$$;
revoke all on function public.boulder_valid_timezone(text) from public,anon,authenticated,service_role;

-- Invoker trigger: authenticated table writes cannot create, alter or delete a bouldering session.
create function public.boulder_workout_guard() returns trigger language plpgsql set search_path='' as $$
declare tagged boolean; owner_name text; s jsonb;
begin
 tagged := case when tg_op='DELETE' then old.details->>'activityType'='bouldering' or old.details ? 'boulderSession'
 else new.details->>'activityType'='bouldering' or new.details ? 'boulderSession' or (tg_op='UPDATE' and (old.details->>'activityType'='bouldering' or old.details ? 'boulderSession')) end;
 if not coalesce(tagged,false) then if tg_op='DELETE' then return old; else return new; end if; end if;
 select pg_catalog.pg_get_userbyid(relowner) into owner_name from pg_catalog.pg_class where oid='public.workouts'::regclass;
 if current_user <> owner_name and not (tg_op='DELETE' and current_user='service_role') then raise exception 'boulder_requires_rpc' using errcode='42501'; end if;
 if tg_op='DELETE' then return old; end if;
 s := new.details->'boulderSession';
 if new.details->>'activityType' is distinct from 'bouldering' or new.details - array['activityType','workoutLifecycle','boulderSession'] <> '{}'::jsonb
  or new.details->'workoutLifecycle' is distinct from '{"kind":"session"}'::jsonb or new.source <> 'manual' or new.client_operation_id is null
  or length(btrim(new.name)) not between 1 and 200 or length(coalesce(new.notes,''))>4000
  or jsonb_typeof(s) is distinct from 'object' or s - array['version','gradeScale','recordingTimezone','activityDate','gymName'] <> '{}'::jsonb
  or not s ?& array['version','gradeScale','recordingTimezone','activityDate','gymName']
  or s->'version' <> '1'::jsonb or s->'gradeScale' <> '"font"'::jsonb
  or jsonb_typeof(s->'recordingTimezone') <> 'string' or not public.boulder_valid_timezone(s->>'recordingTimezone')
  or jsonb_typeof(s->'activityDate') <> 'string' or s->>'activityDate' !~ '^\d{4}-\d{2}-\d{2}$'
  or (s->'gymName' <> 'null'::jsonb and (jsonb_typeof(s->'gymName') <> 'string' or length(s->>'gymName') not between 1 and 60 or s->>'gymName' <> btrim(s->>'gymName')))
  or (new.completed_at is not null and new.completed_at < new.started_at)
 then raise exception 'boulder_invalid' using errcode='22023'; end if;
 if to_char((s->>'activityDate')::date,'YYYY-MM-DD') <> s->>'activityDate' then raise exception 'boulder_invalid' using errcode='22023'; end if;
 if tg_op='UPDATE' and (new.user_id is distinct from old.user_id or new.id is distinct from old.id or new.client_operation_id is distinct from old.client_operation_id or new.started_at is distinct from old.started_at or new.details->'boulderSession'->'activityDate' is distinct from old.details->'boulderSession'->'activityDate') then raise exception 'boulder_invalid' using errcode='22023'; end if;
 if exists(select 1 from public.workout_sets where workout_id=new.id) then raise exception 'boulder_invalid' using errcode='22023'; end if;
 return new;
end; $$;
revoke all on function public.boulder_workout_guard() from public,anon,authenticated,service_role;
create trigger boulder_workout_guard before insert or update or delete on public.workouts for each row execute function public.boulder_workout_guard();

-- Removing an ascent (directly or through its session) tombstones its receipts,
-- so a delayed create or edit replay cannot resurrect it.
create function public.boulder_ascent_tombstone() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.boulder_operation_receipts set deleted=true where user_id=old.user_id and ascent_id=old.id;
 return old;
end; $$;
revoke all on function public.boulder_ascent_tombstone() from public,anon,authenticated,service_role;
create trigger boulder_ascent_tombstone after delete on public.boulder_ascents for each row execute function public.boulder_ascent_tombstone();
create function public.boulder_session_tombstone() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.details->>'activityType'='bouldering' then update public.boulder_operation_receipts set deleted=true where user_id=old.user_id and session_id=old.id; end if;
 return old;
end; $$;
revoke all on function public.boulder_session_tombstone() from public,anon,authenticated,service_role;
create trigger boulder_session_tombstone after delete on public.workouts for each row execute function public.boulder_session_tombstone();
create trigger boulder_ascents_set_updated_at before update on public.boulder_ascents for each row execute function public.set_updated_at();

-- A bouldering session cannot receive strength sets or enter strength-only
-- Community surfaces (cards, routine shares, challenge days) until those are designed.
create function public.boulder_child_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare workout_id uuid;
begin
 if tg_table_name='workout_sets' then workout_id:=new.workout_id; else workout_id:=new.source_workout_id; end if;
 if exists(select 1 from public.workouts where id=workout_id and (details->>'activityType'='bouldering' or details ? 'boulderSession')) then raise exception 'boulder_invalid' using errcode='22023'; end if;
 return new;
end; $$;
revoke all on function public.boulder_child_guard() from public,anon,authenticated,service_role;
create trigger boulder_set_guard before insert or update on public.workout_sets for each row execute function public.boulder_child_guard();
create trigger boulder_share_guard before insert or update on public.shared_activities for each row execute function public.boulder_child_guard();
create trigger boulder_routine_share_guard before insert or update on public.community_routine_shares for each row execute function public.boulder_child_guard();
create trigger boulder_challenge_guard before insert or update on public.community_challenge_contributions for each row execute function public.boulder_child_guard();

create function public.boulder_session_start(p_operation uuid,p_timezone text,p_gym_name text) returns setof public.workouts language plpgsql security definer set search_path='' as $$
declare caller uuid; receipt public.boulder_operation_receipts; digest text; row_id uuid; gym text;
begin
 caller:=public.boulder_admit();
 if p_operation is null or not coalesce(public.boulder_valid_timezone(p_timezone),false) then raise exception 'boulder_invalid' using errcode='22023'; end if;
 gym:=nullif(btrim(coalesce(p_gym_name,'')),'');
 if gym is not null and length(gym) > 60 then raise exception 'boulder_invalid' using errcode='22023'; end if;
 digest:=encode(extensions.digest(jsonb_build_object('timezone',p_timezone,'gym',gym)::text,'sha256'),'hex');
 select * into receipt from public.boulder_operation_receipts where user_id=caller and operation_id=p_operation;
 if found then
  if receipt.deleted then raise exception 'boulder_removed' using errcode='P0003'; end if;
  if receipt.kind<>'session_start' or receipt.payload_digest is distinct from digest then raise exception 'boulder_conflict' using errcode='PT409'; end if;
  return query select * from public.workouts where id=receipt.session_id and user_id=caller; return;
 end if;
 if exists(select 1 from public.workouts where user_id=caller and details->>'activityType'='bouldering' and completed_at is null) then raise exception 'boulder_session_active' using errcode='PT409'; end if;
 row_id:=gen_random_uuid();
 insert into public.workouts(id,user_id,client_operation_id,name,notes,source,started_at,completed_at,details)
 values(row_id,caller,p_operation,'Bouldering',null,'manual',now(),null,jsonb_build_object('activityType','bouldering','workoutLifecycle',jsonb_build_object('kind','session'),
  'boulderSession',jsonb_build_object('version',1,'gradeScale','font','recordingTimezone',p_timezone,'activityDate',to_char((now() at time zone p_timezone)::date,'YYYY-MM-DD'),'gymName',gym)));
 insert into public.boulder_operation_receipts(user_id,operation_id,kind,session_id,payload_digest,accepted_revision) values(caller,p_operation,'session_start',row_id,digest,1);
 return query select * from public.workouts where id=row_id and user_id=caller;
end; $$;

create function public.boulder_session_finish(p_id uuid,p_operation uuid,p_notes text) returns setof public.workouts language plpgsql security definer set search_path='' as $$
declare caller uuid; receipt public.boulder_operation_receipts; existing public.workouts; digest text; clean_notes text;
begin
 caller:=public.boulder_admit();
 if p_operation is null then raise exception 'boulder_invalid' using errcode='22023'; end if;
 clean_notes:=nullif(btrim(coalesce(p_notes,'')),'');
 if clean_notes is not null and length(clean_notes) > 4000 then raise exception 'boulder_invalid' using errcode='22023'; end if;
 digest:=encode(extensions.digest(jsonb_build_object('session',p_id,'notes',clean_notes)::text,'sha256'),'hex');
 select * into receipt from public.boulder_operation_receipts where user_id=caller and operation_id=p_operation;
 if found then
  if receipt.deleted then raise exception 'boulder_removed' using errcode='P0003'; end if;
  if receipt.kind<>'session_finish' or receipt.session_id is distinct from p_id or receipt.payload_digest is distinct from digest then raise exception 'boulder_conflict' using errcode='PT409'; end if;
  return query select * from public.workouts where id=p_id and user_id=caller; return;
 end if;
 if exists(select 1 from public.boulder_operation_receipts where user_id=caller and session_id=p_id and kind='session_start' and deleted) then raise exception 'boulder_removed' using errcode='P0003'; end if;
 select * into existing from public.workouts where id=p_id and user_id=caller and details->>'activityType'='bouldering' for update;
 if not found then raise exception 'boulder_not_found' using errcode='P0002'; end if;
 if existing.completed_at is not null then raise exception 'boulder_conflict' using errcode='PT409'; end if;
 update public.workouts set completed_at=greatest(now(),existing.started_at),notes=clean_notes,updated_at=now() where id=p_id and user_id=caller;
 insert into public.boulder_operation_receipts(user_id,operation_id,kind,session_id,payload_digest,accepted_revision) values(caller,p_operation,'session_finish',p_id,digest,1);
 return query select * from public.workouts where id=p_id and user_id=caller;
end; $$;

create function public.boulder_session_remove(p_id uuid) returns setof public.workouts language plpgsql security definer set search_path='' as $$
declare caller uuid;
begin
 caller:=public.boulder_admit();
 delete from public.workouts where id=p_id and user_id=caller and details->>'activityType'='bouldering';
 return;
end; $$;

create function public.boulder_validate_ascent(p_grade text,p_result text,p_attempts integer,p_colour text,p_note text) returns void language plpgsql immutable set search_path='' as $$
begin
 if public.boulder_grade_rank(p_grade) is null or p_result is null or p_result not in ('flash','sent','not_yet')
  or (p_colour is not null and p_colour not in ('red','orange','yellow','green','blue','purple','pink','black','white','grey','other'))
  or (p_note is not null and (length(p_note) not between 1 and 280 or p_note <> btrim(p_note)))
  or not (case p_result when 'flash' then p_attempts is not null and p_attempts = 1
   when 'sent' then p_attempts is null or p_attempts between 2 and 99
   else p_attempts is null or p_attempts between 1 and 99 end)
 then raise exception 'boulder_invalid' using errcode='22023'; end if;
end; $$;
revoke all on function public.boulder_validate_ascent(text,text,integer,text,text) from public,anon,authenticated,service_role;

create function public.boulder_check_photo(p_caller uuid,p_photo uuid) returns void language plpgsql stable security definer set search_path='' as $$
begin
 if p_photo is not null and not exists(select 1 from public.media_assets where id=p_photo and user_id=p_caller and purpose='workout' and deleted_at is null)
 then raise exception 'boulder_invalid' using errcode='22023'; end if;
end; $$;
revoke all on function public.boulder_check_photo(uuid,uuid) from public,anon,authenticated,service_role;

create function public.boulder_ascent_create(p_session uuid,p_operation uuid,p_grade text,p_result text,p_attempts integer,p_colour text,p_note text,p_photo uuid) returns setof public.boulder_ascents language plpgsql security definer set search_path='' as $$
declare caller uuid; receipt public.boulder_operation_receipts; digest text; row_id uuid; next_sequence integer;
begin
 caller:=public.boulder_admit();
 if p_operation is null or p_session is null then raise exception 'boulder_invalid' using errcode='22023'; end if;
 digest:=encode(extensions.digest(jsonb_build_object('session',p_session,'grade',p_grade,'result',p_result,'attempts',p_attempts,'colour',p_colour,'note',p_note,'photo',p_photo)::text,'sha256'),'hex');
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
 select coalesce(max(sequence),0)+1 into next_sequence from public.boulder_ascents where workout_id=p_session and user_id=caller;
 row_id:=gen_random_uuid();
 insert into public.boulder_ascents(id,user_id,workout_id,client_operation_id,sequence,grade_code,grade_rank,result,attempts,hold_colour,note,photo_asset_id)
 values(row_id,caller,p_session,p_operation,next_sequence,p_grade,public.boulder_grade_rank(p_grade),p_result,p_attempts,p_colour,p_note,p_photo);
 insert into public.boulder_operation_receipts(user_id,operation_id,kind,session_id,ascent_id,payload_digest,accepted_revision) values(caller,p_operation,'ascent_create',p_session,row_id,digest,1);
 return query select * from public.boulder_ascents where id=row_id and user_id=caller;
end; $$;

create function public.boulder_ascent_update(p_id uuid,p_operation uuid,p_expected_revision integer,p_grade text,p_result text,p_attempts integer,p_colour text,p_note text,p_photo uuid) returns setof public.boulder_ascents language plpgsql security definer set search_path='' as $$
declare caller uuid; receipt public.boulder_operation_receipts; existing public.boulder_ascents; digest text;
begin
 caller:=public.boulder_admit();
 if p_operation is null or p_expected_revision is null or p_expected_revision < 1 then raise exception 'boulder_invalid' using errcode='22023'; end if;
 digest:=encode(extensions.digest(jsonb_build_object('ascent',p_id,'expectedRevision',p_expected_revision,'grade',p_grade,'result',p_result,'attempts',p_attempts,'colour',p_colour,'note',p_note,'photo',p_photo)::text,'sha256'),'hex');
 select * into receipt from public.boulder_operation_receipts where user_id=caller and operation_id=p_operation;
 if found then
  if receipt.deleted then raise exception 'boulder_removed' using errcode='P0003'; end if;
  if receipt.kind<>'ascent_update' or receipt.ascent_id is distinct from p_id or receipt.payload_digest is distinct from digest then raise exception 'boulder_conflict' using errcode='PT409'; end if;
  return query select * from public.boulder_ascents where id=p_id and user_id=caller; return;
 end if;
 if exists(select 1 from public.boulder_operation_receipts where user_id=caller and ascent_id=p_id and deleted) then raise exception 'boulder_removed' using errcode='P0003'; end if;
 select * into existing from public.boulder_ascents where id=p_id and user_id=caller for update;
 if not found then raise exception 'boulder_not_found' using errcode='P0002'; end if;
 if existing.revision <> p_expected_revision then raise exception 'boulder_conflict' using errcode='PT409'; end if;
 perform public.boulder_validate_ascent(p_grade,p_result,p_attempts,p_colour,p_note);
 if p_photo is distinct from existing.photo_asset_id then perform public.boulder_check_photo(caller,p_photo); end if;
 update public.boulder_ascents set grade_code=p_grade,grade_rank=public.boulder_grade_rank(p_grade),result=p_result,attempts=p_attempts,hold_colour=p_colour,note=p_note,photo_asset_id=p_photo,revision=existing.revision+1
 where id=p_id and user_id=caller;
 insert into public.boulder_operation_receipts(user_id,operation_id,kind,session_id,ascent_id,payload_digest,accepted_revision) values(caller,p_operation,'ascent_update',existing.workout_id,p_id,digest,existing.revision+1);
 return query select * from public.boulder_ascents where id=p_id and user_id=caller;
end; $$;

create function public.boulder_ascent_remove(p_id uuid) returns setof public.boulder_ascents language plpgsql security definer set search_path='' as $$
declare caller uuid;
begin
 caller:=public.boulder_admit();
 return query with removed as (delete from public.boulder_ascents where id=p_id and user_id=caller returning *) select * from removed;
end; $$;

revoke all on function public.boulder_session_start(uuid,text,text),public.boulder_session_finish(uuid,uuid,text),public.boulder_session_remove(uuid),
 public.boulder_ascent_create(uuid,uuid,text,text,integer,text,text,uuid),public.boulder_ascent_update(uuid,uuid,integer,text,text,integer,text,text,uuid),public.boulder_ascent_remove(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.boulder_session_start(uuid,text,text),public.boulder_session_finish(uuid,uuid,text),public.boulder_session_remove(uuid),
 public.boulder_ascent_create(uuid,uuid,text,text,integer,text,text,uuid),public.boulder_ascent_update(uuid,uuid,integer,text,text,integer,text,text,uuid),public.boulder_ascent_remove(uuid)
 to authenticated;
