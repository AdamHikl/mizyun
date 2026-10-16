-- BOULDER-05 / ADR-0067: explicit Community sharing of a completed indoor
-- bouldering session. A separate `bouldering` activity kind reuses the follower
-- audience, safety, export, retention and erasure lifecycle of ADR-0030/0056.
-- The card stores only an allowlisted snapshot: local day, top grade, sends,
-- flashes and an optional per-grade send breakdown. Gym name, notes, photos,
-- hold colours, per-boulder attempts, times and projects are never shared.

alter table public.shared_activities drop constraint shared_activities_activity_kind_check;
alter table public.shared_activities add constraint shared_activities_activity_kind_check check (activity_kind in ('workout','meal','bouldering'));
alter table public.shared_activities add column bouldering_details jsonb;
alter table public.shared_activities drop constraint community_activity_source_kind;
alter table public.shared_activities add constraint community_activity_source_kind check (
 (activity_kind='workout' and source_workout_id is not null and source_meal_id is null and meal_details is null and bouldering_details is null) or
 (activity_kind='meal' and source_workout_id is null and source_meal_id is not null and meal_details is not null and bouldering_details is null and category='other' and duration_seconds is null and workout_details is null) or
 (activity_kind='bouldering' and source_workout_id is not null and source_meal_id is null and meal_details is null and bouldering_details is not null and category='other' and duration_seconds is null and workout_details is null));
-- The existing (user_id, source_workout_id) unique index keeps one card per
-- session; the guard below keeps that card bouldering-kind only.

-- Serialize ascent edits with publication like food_entries/workout_sets.
create trigger community_lock_boulder_ascents before insert or update or delete on public.boulder_ascents for each statement execute function public.community_lock_write();

-- Bouldering sessions stay blocked from the strength card, routine shares and
-- challenge contributions; only an explicit bouldering-kind card may reference one,
-- and a bouldering-kind card may reference nothing else.
create or replace function public.boulder_child_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare workout_id uuid; is_session boolean;
begin
 if tg_table_name='workout_sets' then workout_id:=new.workout_id; else workout_id:=new.source_workout_id; end if;
 is_session:=exists(select 1 from public.workouts where id=workout_id and (details->>'activityType'='bouldering' or details ? 'boulderSession'));
 if tg_table_name='shared_activities' then
  if new.activity_kind='bouldering' then
   -- During erasure/session cascades the source row may already be gone.
   if tg_op='INSERT' and not is_session then raise exception 'boulder_invalid' using errcode='22023'; end if;
   return new;
  end if;
 end if;
 if is_session then raise exception 'boulder_invalid' using errcode='22023'; end if;
 return new;
end; $$;
revoke all on function public.boulder_child_guard() from public,anon,authenticated,service_role;

-- Allowlisted projection of the caller's completed session. Never reads gym,
-- notes, photos, colours, attempts, times or project links.
create function public.community_bouldering_details(p_session uuid,p_user uuid,p_breakdown boolean) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'activityDate',w.details->'boulderSession'->>'activityDate',
  'topGrade',(select a.grade_code from public.boulder_ascents a where a.workout_id=w.id and a.user_id=p_user and a.result in ('flash','sent') order by a.grade_rank desc limit 1),
  'sends',(select count(*)::integer from public.boulder_ascents a where a.workout_id=w.id and a.user_id=p_user and a.result in ('flash','sent')),
  'flashes',(select count(*)::integer from public.boulder_ascents a where a.workout_id=w.id and a.user_id=p_user and a.result='flash'),
  'gradeBreakdown',case when p_breakdown then coalesce((select jsonb_agg(jsonb_build_object('grade',g.grade_code,'sends',g.n) order by g.grade_rank desc)
   from (select a.grade_code,a.grade_rank,count(*)::integer n from public.boulder_ascents a where a.workout_id=w.id and a.user_id=p_user and a.result in ('flash','sent') group by a.grade_code,a.grade_rank) g),'[]'::jsonb) end)
 from public.workouts w
 where w.id=p_session and w.user_id=p_user and w.details->>'activityType'='bouldering' and w.completed_at is not null
$$;
revoke all on function public.community_bouldering_details(uuid,uuid,boolean) from public,anon,authenticated,service_role;

create function public.community_publish_bouldering_activity(p_source_session_id uuid,p_shared_day text,p_enrollment_generation integer,p_operation_id uuid,p_expected_version integer,p_expected_revoked boolean,p_bouldering_details jsonb)
returns setof public.shared_activities language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid();gen integer;existing public.shared_activities;op public.community_publication_operations;source public.workouts;payload jsonb;current_details jsonb;breakdown boolean;
begin
 -- Same lock order as boulder_* RPCs (per-user bouldering lock, then the
 -- community lock, then rows) so a concurrent ascent write cannot deadlock.
 if caller is not null then perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bouldering:'||caller::text,0)); end if;
 perform public.community_lock();
 if not public.community_active(caller) then raise exception 'community_unavailable';end if;
 select generation into gen from public.community_profiles where user_id=caller;
 if p_enrollment_generation is null or gen<>p_enrollment_generation or p_operation_id is null or p_expected_version is null or p_expected_version<0 or p_expected_revoked is null then raise exception 'community_conflict';end if;
 select * into source from public.workouts where id=p_source_session_id and user_id=caller and details->>'activityType'='bouldering';
 if source.id is null or source.completed_at is null then raise exception 'community_unavailable';end if;
 payload:=jsonb_build_object('kind','bouldering','source',p_source_session_id,'day',p_shared_day,'expectedVersion',p_expected_version,'expectedRevoked',p_expected_revoked,'boulderingDetails',p_bouldering_details);
 select * into op from public.community_publication_operations where user_id=caller and operation_id=p_operation_id;
 if op.operation_id is not null then
 select * into existing from public.shared_activities where id=op.activity_id;
 if existing.id is null or op.enrollment_generation<>gen or op.payload<>payload or existing.revoked_at is not null or op.activity_version<>existing.version then raise exception 'community_conflict';end if;
 return next existing;return;end if;
 if p_bouldering_details is null or jsonb_typeof(p_bouldering_details)<>'object' or (select count(*) from jsonb_object_keys(p_bouldering_details))<>5
 or not p_bouldering_details ?& array['activityDate','topGrade','sends','flashes','gradeBreakdown'] then raise exception 'community_conflict';end if;
 breakdown:=p_bouldering_details->'gradeBreakdown'<>'null'::jsonb;
 current_details:=public.community_bouldering_details(p_source_session_id,caller,breakdown);
 -- The exact client-previewed snapshot must equal the server projection.
 if current_details is null or p_bouldering_details is distinct from current_details then raise exception 'community_conflict';end if;
 -- The session's local day is already the user's calendar day; no tolerance.
 if p_shared_day is null or p_shared_day<>current_details->>'activityDate' or p_shared_day::date>(now() at time zone 'UTC')::date+1 then raise exception 'community_conflict';end if;
 select * into existing from public.shared_activities where user_id=caller and source_workout_id=p_source_session_id;
 if existing.id is not null and existing.activity_kind<>'bouldering' then raise exception 'community_conflict';end if;
 if coalesce(existing.version,0)<>p_expected_version or (existing.revoked_at is not null)<>p_expected_revoked then raise exception 'community_conflict';end if;
 if existing.id is null then
 insert into public.shared_activities(user_id,activity_kind,source_workout_id,category,shared_day,enrollment_generation,bouldering_details)
 values(caller,'bouldering',p_source_session_id,'other',p_shared_day,gen,current_details) returning * into existing;
 else
 update public.shared_activities set shared_day=p_shared_day,bouldering_details=current_details,enrollment_generation=gen,revoked_at=null,version=version+1,published_at=case when revoked_at is null then published_at else now() end where id=existing.id returning * into existing;
 end if;
 insert into public.community_publication_operations(user_id,operation_id,enrollment_generation,activity_id,activity_version,payload) values(caller,p_operation_id,gen,existing.id,existing.version,payload);
 return next existing;
end $$;
revoke all on function public.community_publish_bouldering_activity(uuid,text,integer,uuid,integer,boolean,jsonb) from public,anon;
grant execute on function public.community_publish_bouldering_activity(uuid,text,integer,uuid,integer,boolean,jsonb) to authenticated,service_role;

create function public.community_revoke_bouldering_activities(p_source_session_id uuid) returns void language plpgsql security definer set search_path='' as $$begin
 perform public.community_lock();
 if auth.uid() is null then raise exception 'community_unavailable';end if;
 update public.shared_activities set revoked_at=coalesce(revoked_at,now()) where source_workout_id=p_source_session_id and user_id=auth.uid() and activity_kind='bouldering';
end $$;
revoke all on function public.community_revoke_bouldering_activities(uuid) from public,anon;
grant execute on function public.community_revoke_bouldering_activities(uuid) to authenticated,service_role;

-- Any session change that could alter the snapshot, deleting the session, or any
-- ascent write in it revokes the card. During account erasure the auth.users row
-- is already gone and the cascade deletes the card itself, so revocation is
-- skipped there (an update would re-check the owner foreign key).
create function public.community_bouldering_session_changed() returns trigger language plpgsql security definer set search_path='' as $$begin
 if old.details->>'activityType'='bouldering' and (TG_OP='DELETE' or old.details is distinct from new.details or old.notes is distinct from new.notes
 or old.completed_at is distinct from new.completed_at or old.started_at is distinct from new.started_at or old.name is distinct from new.name)
 and exists(select 1 from auth.users where id=old.user_id) then
 update public.shared_activities set revoked_at=coalesce(revoked_at,now()) where source_workout_id=old.id and user_id=old.user_id and activity_kind='bouldering' and revoked_at is null;
 end if;
 if TG_OP='DELETE' then return old;else return new;end if;
end $$;
create trigger community_bouldering_session_changed before update or delete on public.workouts for each row execute function public.community_bouldering_session_changed();
revoke all on function public.community_bouldering_session_changed() from public,anon,authenticated,service_role;

create function public.community_bouldering_ascent_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.boulder_ascents;
begin
 if TG_OP='INSERT' then r:=new;else r:=old;end if;
 -- Photo and project links are never shared; detaching them changes nothing disclosed.
 if TG_OP='UPDATE' and new.workout_id=old.workout_id and new.grade_code=old.grade_code and new.result=old.result then return new;end if;
 if not exists(select 1 from auth.users where id=r.user_id) then if TG_OP='DELETE' then return old;else return new;end if;end if;
 update public.shared_activities set revoked_at=coalesce(revoked_at,now()) where source_workout_id=r.workout_id and user_id=r.user_id and activity_kind='bouldering' and revoked_at is null;
 if TG_OP='UPDATE' and new.workout_id is distinct from old.workout_id then
 update public.shared_activities set revoked_at=coalesce(revoked_at,now()) where source_workout_id=new.workout_id and user_id=new.user_id and activity_kind='bouldering' and revoked_at is null;
 end if;
 if TG_OP='DELETE' then return old;else return new;end if;
end $$;
create trigger community_bouldering_ascent_changed before insert or update or delete on public.boulder_ascents for each row execute function public.community_bouldering_ascent_changed();
revoke all on function public.community_bouldering_ascent_changed() from public,anon,authenticated,service_role;

-- ADR-0052: any replacement of a live bouldering projection may reduce disclosed
-- data. Reuse the activity ledger kind; the event holds no climbing data.
create function public.community_capture_bouldering_reduction() returns trigger language plpgsql security definer set search_path='' as $$begin
 if current_database()='mizyun_restore' and current_setting('mizyun.restore_environment',true)='dev' and current_setting('mizyun.revocation_replaying',true)='on' then return new;end if;
 if old.activity_kind='bouldering' and old.revoked_at is null and new.revoked_at is null and old.bouldering_details is distinct from new.bouldering_details then
 insert into public.community_revocation_events(user_id,kind,generation,target_id) values(old.user_id,'activity',old.enrollment_generation,old.id);
 end if;return new;
end $$;
create trigger community_capture_bouldering_reduction before update on public.shared_activities for each row execute function public.community_capture_bouldering_reduction();
revoke all on function public.community_capture_bouldering_reduction() from public,anon,authenticated,service_role;

-- Recipient feed/get/profile wrappers already replace source_workout_id with the
-- zero UUID for non-owners (profile timeline: always), which covers bouldering
-- cards; they return whole rows, so bouldering_details flows through unchanged.

-- The generic strength publish path must never touch a bouldering session, even
-- one with an existing (possibly revoked) bouldering card.
alter function public.community_publish_activity(uuid,text,text,integer,integer,uuid,integer,boolean,jsonb) rename to community_publish_activity_before_bouldering;
create function public.community_publish_activity(p_source_workout_id uuid,p_category text,p_shared_day text,p_duration_seconds integer,p_enrollment_generation integer,p_operation_id uuid,p_expected_version integer default 0,p_expected_revoked boolean default false,p_workout_details jsonb default null)
returns setof public.shared_activities language plpgsql security definer set search_path='' as $$begin
 perform public.community_lock();
 if exists(select 1 from public.workouts where id=p_source_workout_id and user_id=auth.uid() and (details->>'activityType'='bouldering' or details ? 'boulderSession')) then raise exception 'boulder_invalid' using errcode='22023';end if;
 return query select * from public.community_publish_activity_before_bouldering(p_source_workout_id,p_category,p_shared_day,p_duration_seconds,p_enrollment_generation,p_operation_id,p_expected_version,p_expected_revoked,p_workout_details);
end $$;
revoke all on function public.community_publish_activity_before_bouldering(uuid,text,text,integer,integer,uuid,integer,boolean,jsonb),public.community_publish_activity(uuid,text,text,integer,integer,uuid,integer,boolean,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.community_publish_activity(uuid,text,text,integer,integer,uuid,integer,boolean,jsonb) to authenticated,service_role;

-- Generic duration edits must not change a bouldering projection.
alter function public.community_update_activity(uuid,integer,integer) rename to community_update_activity_before_bouldering;
create function public.community_update_activity(p_activity_id uuid,p_duration_seconds integer,p_expected_version integer default 1)
returns setof public.shared_activities language plpgsql security definer set search_path='' as $$begin
 perform public.community_lock();
 if exists(select 1 from public.shared_activities where id=p_activity_id and user_id=auth.uid() and activity_kind='bouldering') then raise exception 'community_conflict';end if;
 return query select * from public.community_update_activity_before_bouldering(p_activity_id,p_duration_seconds,p_expected_version);
end $$;
revoke all on function public.community_update_activity_before_bouldering(uuid,integer,integer),public.community_update_activity(uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.community_update_activity(uuid,integer,integer) to authenticated,service_role;

alter function public.community_export_page(text,text,integer) rename to community_export_page_before_bouldering;
create function public.community_export_page(p_category text,p_after text default null,p_limit integer default 500) returns table(item_key text,item jsonb)
language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null or p_limit is null or p_limit not between 1 and 500 then raise exception 'community_access_denied';end if;
 if p_category='activities' then
 return query select t.k,to_jsonb(t)-'k' from (select id::text k,id,activity_kind,source_workout_id,source_meal_id,category,shared_day,duration_seconds,workout_details,meal_details,bouldering_details,version,published_at,revoked_at from public.shared_activities where user_id=auth.uid() and (p_after is null or id::text>p_after) order by id::text limit p_limit) t;
 else return query select * from public.community_export_page_before_bouldering(p_category,p_after,p_limit);end if;
end $$;
revoke all on function public.community_export_page_before_bouldering(text,text,integer),public.community_export_page(text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.community_export_page(text,text,integer) to authenticated;

alter function public.community_social_snapshot(text,text) rename to community_social_snapshot_before_bouldering;
create function public.community_social_snapshot(p_type text,p_id text) returns jsonb language sql stable security definer set search_path='' as $$
 select case when p_type='activity' then (select jsonb_build_object('activityKind',activity_kind,'category',category,'sharedDay',shared_day,'durationSeconds',duration_seconds,'workoutDetails',workout_details,'mealDetails',meal_details,'boulderingDetails',bouldering_details) from public.shared_activities where id::text=p_id)
 else public.community_social_snapshot_before_bouldering(p_type,p_id) end
$$;
revoke all on function public.community_social_snapshot_before_bouldering(text,text),public.community_social_snapshot(text,text) from public,anon,authenticated,service_role;
