drop function public.community_publish_activity(uuid,text,text,integer,integer,uuid);
-- Explicit card refresh keeps feed chronology and never silently broadcasts anew.
create or replace function public.community_publish_activity(p_source_workout_id uuid,p_category text,p_shared_day text,p_duration_seconds integer,p_enrollment_generation integer,p_operation_id uuid,p_expected_version integer default 0,p_expected_revoked boolean default false)
returns setof public.shared_activities language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); gen integer; existing public.shared_activities; op public.community_publication_operations;
 source public.workouts; payload jsonb;
begin
 perform public.community_lock();
 if not public.community_active(caller) then raise exception 'community_unavailable'; end if;
 select generation into gen from public.community_profiles where user_id = caller;
 if p_enrollment_generation is null or p_enrollment_generation < 1 or p_expected_version is null or p_expected_version < 0 or p_expected_revoked is null or gen <> p_enrollment_generation or p_operation_id is null then raise exception 'community_conflict'; end if;
 select * into source from public.workouts where id = p_source_workout_id and user_id = caller;
 if source.id is null or source.completed_at is null or source.details #>> '{workoutLifecycle,kind}' is distinct from 'session' then raise exception 'community_unavailable'; end if;
 payload := jsonb_build_object('source',p_source_workout_id,'category',p_category,'day',p_shared_day,'duration',p_duration_seconds,'expectedVersion',p_expected_version,'expectedRevoked',p_expected_revoked);
 select * into op from public.community_publication_operations where user_id = caller and operation_id = p_operation_id;
 if op.operation_id is not null then
  select * into existing from public.shared_activities where id = op.activity_id;
  if existing.id is null or op.enrollment_generation <> gen or op.payload <> payload or existing.revoked_at is not null or op.activity_version <> existing.version then raise exception 'community_conflict'; end if;
  return next existing; return;
 end if;
 if p_shared_day::date > (now() at time zone 'UTC')::date + 1 or p_shared_day::date::text <> p_shared_day or p_shared_day::date not between (source.completed_at at time zone 'UTC')::date - 1 and (source.completed_at at time zone 'UTC')::date + 1
 or (p_duration_seconds is not null and p_duration_seconds <> greatest(0,floor(extract(epoch from(source.completed_at-source.started_at)))::integer)) then raise exception 'community_conflict'; end if;
 select * into existing from public.shared_activities where user_id = caller and source_workout_id = p_source_workout_id;
 if coalesce(existing.version,0) <> p_expected_version or (existing.revoked_at is not null) <> p_expected_revoked then raise exception 'community_conflict'; end if;
 if existing.id is null then
  insert into public.shared_activities(user_id,source_workout_id,category,shared_day,duration_seconds,enrollment_generation)
  values(caller,p_source_workout_id,p_category,p_shared_day,p_duration_seconds,gen) returning * into existing;
 else
  update public.shared_activities set category = p_category, shared_day = p_shared_day, duration_seconds = p_duration_seconds,
  enrollment_generation = gen, revoked_at = null, version = version + 1, published_at = case when revoked_at is null then published_at else now() end where id = existing.id returning * into existing;
 end if;
 insert into public.community_publication_operations(user_id,operation_id,enrollment_generation,activity_id,activity_version,payload)
 values(caller,p_operation_id,gen,existing.id,existing.version,payload);
 return next existing;
end $$;

revoke all on function public.community_publish_activity(uuid,text,text,integer,integer,uuid,integer,boolean) from public,anon;
grant execute on function public.community_publish_activity(uuid,text,text,integer,integer,uuid,integer,boolean) to authenticated, service_role;

-- Aggregate UTC counters survive withdrawal/re-enrollment and card cleanup.
create table public.community_publication_usage (
 user_id uuid not null references auth.users(id) on delete cascade,
 usage_day date not null, used integer not null check(used between 1 and 20),
 primary key(user_id,usage_day)
);
alter table public.community_publication_usage enable row level security;
revoke all on public.community_publication_usage from public,anon,authenticated;
grant all on public.community_publication_usage to service_role;
create function public.community_publication_quota() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.uid() <> new.user_id then return new; end if;
 if tg_op='UPDATE' and new.version=old.version then return new; end if;
 perform public.community_lock();
 if exists(select 1 from public.community_publication_usage where user_id=new.user_id and usage_day=(now() at time zone 'UTC')::date and used>=20) then raise exception 'community_rate_limited'; end if;
 insert into public.community_publication_usage(user_id,usage_day,used) values(new.user_id,(now() at time zone 'UTC')::date,1)
 on conflict(user_id,usage_day) do update set used=public.community_publication_usage.used+1;
 return new;
end $$;
revoke all on function public.community_publication_quota() from public,anon,authenticated;
create trigger community_publication_quota before insert or update on public.shared_activities for each row execute function public.community_publication_quota();

drop function public.community_update_activity(uuid,integer);
create or replace function public.community_update_activity(p_activity_id uuid,p_duration_seconds integer,p_expected_version integer default 1)
returns setof public.shared_activities language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); a public.shared_activities; source public.workouts;
begin
 perform public.community_lock();
 select * into a from public.shared_activities where id = p_activity_id and user_id = caller and revoked_at is null;
 if p_expected_version is null or a.version <> p_expected_version then raise exception 'community_conflict'; end if;
 if a.id is null or not public.community_active(caller) or a.enrollment_generation <> (select generation from public.community_profiles where user_id = caller) then raise exception 'community_unavailable'; end if;
 select * into source from public.workouts where id = a.source_workout_id and user_id = caller;
 if source.completed_at is null or source.details #>> '{workoutLifecycle,kind}' is distinct from 'session'
 or (p_duration_seconds is not null and p_duration_seconds <> greatest(0,floor(extract(epoch from(source.completed_at-source.started_at)))::integer)) then raise exception 'community_conflict'; end if;
 if a.duration_seconds is not distinct from p_duration_seconds then return next a; return; end if;
 return query update public.shared_activities set duration_seconds = p_duration_seconds, version = version + 1
 where id = p_activity_id returning *;
end $$;


revoke all on function public.community_update_activity(uuid,integer,integer) from public,anon;
grant execute on function public.community_update_activity(uuid,integer,integer) to authenticated,service_role;

create function public.community_unpublish_activity(p_activity_id uuid,p_expected_version integer) returns void language plpgsql security definer set search_path='' as $$
declare a public.shared_activities;
begin
 perform public.community_lock();
 select * into a from public.shared_activities where id=p_activity_id and user_id=auth.uid();
 if a.id is null then raise exception 'community_unavailable'; end if;
 if p_expected_version is null or a.version <> p_expected_version then raise exception 'community_conflict'; end if;
 update public.shared_activities set revoked_at=coalesce(revoked_at,now()) where id=a.id;
end $$;
revoke all on function public.community_unpublish_activity(uuid,integer) from public,anon;
grant execute on function public.community_unpublish_activity(uuid,integer) to authenticated,service_role;
