-- Explicit opt-in projection. Existing cards retain NULL; no private records are backfilled.
alter table public.shared_activities add column workout_details jsonb;
-- Serialize projection-source edits with consent confirmation before row locks.
create trigger community_lock_workout_sets before insert or update or delete on public.workout_sets for each statement execute function public.community_lock_write();
create trigger community_lock_exercises before update or delete on public.exercises for each statement execute function public.community_lock_write();
create function public.community_workout_details(p_workout_id uuid,p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; n integer; exercise_count integer;
begin
 select count(*),count(distinct s.exercise_id) into n,exercise_count from public.workout_sets s where s.workout_id=p_workout_id and s.user_id=p_user_id and s.completed_at is not null;
 if n=0 or n>500 or exercise_count>100 then return null;end if;
 if exists(select 1 from public.workout_sets s where s.workout_id=p_workout_id and s.user_id=p_user_id and s.completed_at is not null and (
  s.repetitions<0 or s.repetitions>9999.99 or s.load_kg<0 or s.load_kg>9999.999 or s.duration_seconds<0 or s.duration_seconds>86400)) then return null;end if;
 select jsonb_build_object('exercises',jsonb_agg(g.item order by g.first_sequence)) into result from (
  select min(s.sequence) first_sequence,jsonb_build_object('name',btrim(e.name),'sets',jsonb_agg(jsonb_build_object('setType',s.set_type,'repetitions',s.repetitions,'loadKg',s.load_kg,'durationSeconds',s.duration_seconds) order by s.sequence)) item
  from public.workout_sets s join public.exercises e on e.id=s.exercise_id and e.user_id=p_user_id
  where s.workout_id=p_workout_id and s.user_id=p_user_id and s.completed_at is not null
  group by e.id,e.name
 ) g;
 if exists(select 1 from jsonb_array_elements(result->'exercises') e where length(e->>'name') not between 1 and 120) then return null;end if;
 return result;
end $$;
revoke all on function public.community_workout_details(uuid,uuid) from public,anon,authenticated,service_role;
drop function public.community_publish_activity(uuid,text,text,integer,integer,uuid,integer,boolean);
create or replace function public.community_publish_activity(p_source_workout_id uuid,p_category text,p_shared_day text,p_duration_seconds integer,p_enrollment_generation integer,p_operation_id uuid,p_expected_version integer default 0,p_expected_revoked boolean default false,p_workout_details jsonb default null)
returns setof public.shared_activities language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); gen integer; existing public.shared_activities; op public.community_publication_operations;
 source public.workouts; payload jsonb; current_details jsonb;
begin
 perform public.community_lock();
 if not public.community_active(caller) then raise exception 'community_unavailable'; end if;
 select generation into gen from public.community_profiles where user_id = caller;
 if p_enrollment_generation is null or p_enrollment_generation < 1 or p_expected_version is null or p_expected_version < 0 or p_expected_revoked is null or gen <> p_enrollment_generation or p_operation_id is null then raise exception 'community_conflict'; end if;
 select * into source from public.workouts where id = p_source_workout_id and user_id = caller;
 if source.id is null or source.completed_at is null or source.details #>> '{workoutLifecycle,kind}' is distinct from 'session' then raise exception 'community_unavailable'; end if;
 payload := jsonb_build_object('source',p_source_workout_id,'category',p_category,'day',p_shared_day,'duration',p_duration_seconds,'expectedVersion',p_expected_version,'expectedRevoked',p_expected_revoked);
 if p_workout_details is not null then payload:=payload||jsonb_build_object('workoutDetails',p_workout_details);end if;
 select * into op from public.community_publication_operations where user_id = caller and operation_id = p_operation_id;
 if op.operation_id is not null then
  select * into existing from public.shared_activities where id = op.activity_id;
  if existing.id is null or op.enrollment_generation <> gen or op.payload <> payload or existing.revoked_at is not null or op.activity_version <> existing.version then raise exception 'community_conflict'; end if;
  return next existing; return;
 end if;
 if p_workout_details is not null then
  current_details := public.community_workout_details(p_source_workout_id,caller);
  if current_details is null or p_workout_details <> current_details then raise exception 'community_conflict';end if;
  if exists(select 1 from jsonb_array_elements(current_details->'exercises') e where not public.community_text_safe(e->>'name')) then raise exception 'community_invalid_profile';end if;
 end if;
 if p_shared_day::date > (now() at time zone 'UTC')::date + 1 or p_shared_day::date::text <> p_shared_day or p_shared_day::date not between (source.completed_at at time zone 'UTC')::date - 1 and (source.completed_at at time zone 'UTC')::date + 1
 or (p_duration_seconds is not null and p_duration_seconds <> greatest(0,floor(extract(epoch from(source.completed_at-source.started_at)))::integer)) then raise exception 'community_conflict'; end if;
 select * into existing from public.shared_activities where user_id = caller and source_workout_id = p_source_workout_id;
 if coalesce(existing.version,0) <> p_expected_version or (existing.revoked_at is not null) <> p_expected_revoked then raise exception 'community_conflict'; end if;
 if existing.id is null then
  insert into public.shared_activities(user_id,source_workout_id,category,shared_day,duration_seconds,enrollment_generation,workout_details)
  values(caller,p_source_workout_id,p_category,p_shared_day,p_duration_seconds,gen,p_workout_details) returning * into existing;
 else
  update public.shared_activities set category = p_category, shared_day = p_shared_day, duration_seconds = p_duration_seconds,
  workout_details=p_workout_details,enrollment_generation = gen, revoked_at = null, version = version + 1, published_at = case when revoked_at is null then published_at else now() end where id = existing.id returning * into existing;
 end if;
 insert into public.community_publication_operations(user_id,operation_id,enrollment_generation,activity_id,activity_version,payload)
 values(caller,p_operation_id,gen,existing.id,existing.version,payload);
 return next existing;
end $$;

revoke all on function public.community_publish_activity(uuid,text,text,integer,integer,uuid,integer,boolean,jsonb) from public,anon;
grant execute on function public.community_publish_activity(uuid,text,text,integer,integer,uuid,integer,boolean,jsonb) to authenticated, service_role;


create or replace function public.community_export_page(p_category text,p_after text default null,p_limit integer default 500)
returns table(item_key text,item jsonb) language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'community_access_denied'; end if;
 if p_limit is null or p_limit<1 or p_limit>500 then raise exception 'community_conflict'; end if;
 if p_category='identity' then
 return query select t.k,to_jsonb(t)-'k' from (select user_id::text as k,user_id,handle,display_name,avatar_symbol,bio,is_searchable,status,generation,terms_version,terms_accepted_at,adult_declared_at,created_at,updated_at from public.community_profiles where (user_id=auth.uid()) and (p_after is null or user_id::text>p_after) order by user_id::text limit p_limit) t;
 elsif p_category='relationships' then
 return query select t.k,to_jsonb(t)-'k' from (select id::text as k,id,follower_user_id,target_user_id,status,created_at,updated_at from public.community_relationships where (follower_user_id=auth.uid() or target_user_id=auth.uid()) and (p_after is null or id::text>p_after) order by id::text limit p_limit) t;
 elsif p_category='blocks' then
 return query select t.k,to_jsonb(t)-'k' from (select id::text as k,id,blocker_user_id,blocked_user_id,created_at from public.community_blocks where (blocker_user_id=auth.uid()) and (p_after is null or id::text>p_after) order by id::text limit p_limit) t;
 elsif p_category='mutes' then
 return query select t.k,to_jsonb(t)-'k' from (select target_user_id::text as k,target_user_id,created_at from public.community_mutes where (user_id=auth.uid()) and (p_after is null or target_user_id::text>p_after) order by target_user_id::text limit p_limit) t;
 elsif p_category='activities' then
 return query select t.k,to_jsonb(t)-'k' from (select id::text as k,id,source_workout_id,category,shared_day,duration_seconds,workout_details,version,published_at,revoked_at from public.shared_activities where (user_id=auth.uid()) and (p_after is null or id::text>p_after) order by id::text limit p_limit) t;
 elsif p_category='reactions' then
 return query select t.k,to_jsonb(t)-'k' from (select id::text as k,id,activity_id,reaction,created_at,updated_at from public.community_reactions where (user_id=auth.uid()) and (p_after is null or id::text>p_after) order by id::text limit p_limit) t;
 elsif p_category='invitations' then
 return query select t.k,to_jsonb(t)-'k' from (select id::text as k,id,expires_at,revoked_at,created_at from public.community_invitations where (inviter_user_id=auth.uid()) and (p_after is null or id::text>p_after) order by id::text limit p_limit) t;
 elsif p_category='reports' then
 return query select t.k,to_jsonb(t)-'k' from (select id::text as k,id,target_type,target_id,reason,notes,status,created_at,updated_at from public.community_reports where (reporter_user_id=auth.uid()) and (p_after is null or id::text>p_after) order by id::text limit p_limit) t;
 elsif p_category='appeals' then
 return query select t.k,to_jsonb(t)-'k' from (select id::text as k,id,report_id,reason,status,resolved_at,created_at,updated_at from public.community_moderation_appeals where (appellant_user_id=auth.uid()) and (p_after is null or id::text>p_after) order by id::text limit p_limit) t;
 elsif p_category='notificationPreferences' then
 return query select t.k,to_jsonb(t)-'k' from (select user_id::text as k,requests,reactions,moderation,muted,timezone,quiet_start,quiet_end from public.community_notification_preferences where (user_id=auth.uid()) and (p_after is null or user_id::text>p_after) order by user_id::text limit p_limit) t;
 elsif p_category='inbox' then
 return query select t.k,to_jsonb(t)-'k' from (select id::text as k,id,actor_user_id,kind,target_id,created_at,read_at,expires_at from public.community_inbox_events where (user_id=auth.uid() and expires_at>now()) and (p_after is null or id::text>p_after) order by id::text limit p_limit) t;
 elsif p_category='pushRegistrations' then
 return query select t.k,to_jsonb(t)-'k' from (select installation_id::text as k,installation_id,generation,updated_at,expires_at from public.community_push_tokens where user_id=auth.uid() and (p_after is null or installation_id::text>p_after) order by installation_id::text limit p_limit) t;
 elsif p_category='delivery' then
 return query select t.k,to_jsonb(t)-'k' from (select id::text as k,id,event_id,status,attempts,next_attempt_at,expires_at from public.community_notification_outbox where user_id=auth.uid() and (p_after is null or id::text>p_after) order by id::text limit p_limit) t;
 else raise exception 'community_conflict'; end if;
end $$;

create or replace function public.community_social_snapshot(p_type text,p_id text) returns jsonb language sql stable security definer set search_path='' as $$
 select case when p_type='profile' then (select jsonb_build_object('handle',handle,'displayName',display_name,'avatarSymbol',avatar_symbol,'bio',bio) from public.community_profiles where user_id::text=p_id)
 when p_type='activity' then (select jsonb_build_object('category',category,'sharedDay',shared_day,'durationSeconds',duration_seconds,'workoutDetails',workout_details) from public.shared_activities where id::text=p_id) end
$$;
