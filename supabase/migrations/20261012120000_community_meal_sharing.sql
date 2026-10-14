begin;
-- Meals reuse the existing follower audience, safety, export and erasure lifecycle.
alter table public.shared_activities alter column source_workout_id drop not null;
alter table public.shared_activities add column activity_kind text not null default 'workout' check(activity_kind in ('workout','meal'));
alter table public.shared_activities add column source_meal_id uuid references public.food_entries(id) on delete cascade;
alter table public.shared_activities add column meal_details jsonb;
alter table public.shared_activities add constraint community_activity_source_kind check (
 (activity_kind='workout' and source_workout_id is not null and source_meal_id is null and meal_details is null) or
 (activity_kind='meal' and source_workout_id is null and source_meal_id is not null and meal_details is not null and category='other' and duration_seconds is null and workout_details is null));
create unique index shared_activities_author_meal_unique on public.shared_activities(user_id,source_meal_id) where source_meal_id is not null;
create index shared_activities_source_meal on public.shared_activities(source_meal_id) where source_meal_id is not null;
-- Table reads remain owner-only under existing RLS; recipients use redacted RPCs.
create trigger community_lock_food_entries before update or delete on public.food_entries for each statement execute function public.community_lock_write();

create function public.community_meal_details(p_meal_id uuid,p_user_id uuid,p_nutrition boolean) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('name',btrim(name),'caloriesKcal',case when p_nutrition then calories_kcal end,
 'proteinG',case when p_nutrition then protein_g end,'carbsG',case when p_nutrition then carbohydrate_g end,'fatG',case when p_nutrition then fat_g end)
 from public.food_entries where id=p_meal_id and user_id=p_user_id and confirmed_by_user
 and (not p_nutrition or (coalesce(calories_kcal between 0 and 20000,true) and coalesce(protein_g between 0 and 10000,true) and coalesce(carbohydrate_g between 0 and 10000,true) and coalesce(fat_g between 0 and 10000,true)))
$$;
revoke all on function public.community_meal_details(uuid,uuid,boolean) from public,anon,authenticated,service_role;

create function public.community_publish_meal_activity(p_source_meal_id uuid,p_shared_day text,p_enrollment_generation integer,p_operation_id uuid,p_expected_version integer,p_expected_revoked boolean,p_meal_details jsonb)
returns setof public.shared_activities language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid();gen integer;existing public.shared_activities;op public.community_publication_operations;source public.food_entries;payload jsonb;current_details jsonb;nutrition boolean;
begin
 perform public.community_lock();
 if not public.community_active(caller) then raise exception 'community_unavailable';end if;
 select generation into gen from public.community_profiles where user_id=caller;
 if p_enrollment_generation is null or gen<>p_enrollment_generation or p_operation_id is null or p_expected_version is null or p_expected_version<0 or p_expected_revoked is null then raise exception 'community_conflict';end if;
 select * into source from public.food_entries where id=p_source_meal_id and user_id=caller;
 if source.id is null or not source.confirmed_by_user then raise exception 'community_unavailable';end if;
 payload:=jsonb_build_object('kind','meal','source',p_source_meal_id,'day',p_shared_day,'expectedVersion',p_expected_version,'expectedRevoked',p_expected_revoked,'mealDetails',p_meal_details);
 select * into op from public.community_publication_operations where user_id=caller and operation_id=p_operation_id;
 if op.operation_id is not null then
 select * into existing from public.shared_activities where id=op.activity_id;
 if existing.id is null or op.enrollment_generation<>gen or op.payload<>payload or existing.revoked_at is not null or op.activity_version<>existing.version then raise exception 'community_conflict';end if;
 return next existing;return;end if;
 if p_meal_details is null or jsonb_typeof(p_meal_details)<>'object' or (select count(*) from jsonb_object_keys(p_meal_details))<>5 then raise exception 'community_conflict';end if;
 nutrition:=coalesce(p_meal_details->'caloriesKcal'<>'null'::jsonb or p_meal_details->'proteinG'<>'null'::jsonb or p_meal_details->'carbsG'<>'null'::jsonb or p_meal_details->'fatG'<>'null'::jsonb,false);
 current_details:=public.community_meal_details(p_source_meal_id,caller,nutrition);
 if p_meal_details is distinct from current_details or length(p_meal_details->>'name') not between 1 and 200 then raise exception 'community_conflict';end if;
 if not public.community_text_safe(p_meal_details->>'name') then raise exception 'community_invalid_profile';end if;
 if p_shared_day is null or p_shared_day::date::text<>p_shared_day or p_shared_day::date>(now() at time zone 'UTC')::date+1 or p_shared_day::date not between (source.consumed_at at time zone 'UTC')::date-1 and (source.consumed_at at time zone 'UTC')::date+1 then raise exception 'community_conflict';end if;
 select * into existing from public.shared_activities where user_id=caller and source_meal_id=p_source_meal_id;
 if coalesce(existing.version,0)<>p_expected_version or (existing.revoked_at is not null)<>p_expected_revoked then raise exception 'community_conflict';end if;
 if existing.id is null then
 insert into public.shared_activities(user_id,activity_kind,source_meal_id,category,shared_day,enrollment_generation,meal_details)
 values(caller,'meal',p_source_meal_id,'other',p_shared_day,gen,p_meal_details) returning * into existing;
 else
 update public.shared_activities set shared_day=p_shared_day,meal_details=p_meal_details,enrollment_generation=gen,revoked_at=null,version=version+1,published_at=case when revoked_at is null then published_at else now() end where id=existing.id returning * into existing;
 end if;
 insert into public.community_publication_operations(user_id,operation_id,enrollment_generation,activity_id,activity_version,payload) values(caller,p_operation_id,gen,existing.id,existing.version,payload);
 return next existing;
end $$;
revoke all on function public.community_publish_meal_activity(uuid,text,integer,uuid,integer,boolean,jsonb) from public,anon;
grant execute on function public.community_publish_meal_activity(uuid,text,integer,uuid,integer,boolean,jsonb) to authenticated,service_role;

create function public.community_revoke_meal_activities(p_source_meal_id uuid) returns void language plpgsql security definer set search_path='' as $$begin
 perform public.community_lock();
 if auth.uid() is null then raise exception 'community_unavailable';end if;
 update public.shared_activities set revoked_at=coalesce(revoked_at,now()) where source_meal_id=p_source_meal_id and user_id=auth.uid();
end $$;
revoke all on function public.community_revoke_meal_activities(uuid) from public,anon;
grant execute on function public.community_revoke_meal_activities(uuid) to authenticated,service_role;

create function public.community_meal_source_changed() returns trigger language plpgsql security definer set search_path='' as $$begin
 if TG_OP='DELETE' or old.name is distinct from new.name or old.consumed_at is distinct from new.consumed_at or old.confirmed_by_user is distinct from new.confirmed_by_user
 or old.calories_kcal is distinct from new.calories_kcal or old.protein_g is distinct from new.protein_g or old.carbohydrate_g is distinct from new.carbohydrate_g or old.fat_g is distinct from new.fat_g then
 update public.shared_activities set revoked_at=coalesce(revoked_at,now()) where source_meal_id=old.id and user_id=old.user_id;
 end if;
 if TG_OP='DELETE' then return old;else return new;end if;
end $$;
create trigger community_meal_source_changed before update or delete on public.food_entries for each row execute function public.community_meal_source_changed();
revoke all on function public.community_meal_source_changed() from public,anon,authenticated,service_role;

-- Any meal projection replacement may reduce disclosed data. Reuse the activity
-- ledger kind so offline replay revokes the historical artifact without health data.
create function public.community_capture_meal_reduction() returns trigger language plpgsql security definer set search_path='' as $$begin
 if current_database()='mizyun_restore' and current_setting('mizyun.restore_environment',true)='dev' and current_setting('mizyun.revocation_replaying',true)='on' then return new;end if;
 if old.activity_kind='meal' and old.revoked_at is null and new.revoked_at is null and old.meal_details is distinct from new.meal_details then
 insert into public.community_revocation_events(user_id,kind,generation,target_id) values(old.user_id,'activity',old.enrollment_generation,old.id);
 end if;return new;
end $$;
create trigger community_capture_meal_reduction before update on public.shared_activities for each row execute function public.community_capture_meal_reduction();
revoke all on function public.community_capture_meal_reduction() from public,anon,authenticated,service_role;

alter function public.community_get_activity(uuid) rename to community_get_activity_before_meals;
create function public.community_get_activity(p_activity_id uuid) returns setof public.shared_activities language plpgsql volatile security definer set search_path='' as $$declare a public.shared_activities;begin
 for a in select * from public.community_get_activity_before_meals(p_activity_id) loop if a.user_id<>auth.uid() then a.source_meal_id:=null;end if; return next a;end loop;
end $$;
revoke all on function public.community_get_activity_before_meals(uuid),public.community_get_activity(uuid) from public,anon,authenticated,service_role;
grant execute on function public.community_get_activity(uuid) to authenticated,service_role;

alter function public.community_feed(integer,timestamptz,uuid) rename to community_feed_before_meals;
create function public.community_feed(p_limit integer,p_before_time timestamptz,p_before_id uuid) returns setof public.shared_activities language plpgsql volatile security definer set search_path='' as $$declare a public.shared_activities;begin
 for a in select * from public.community_feed_before_meals(p_limit,p_before_time,p_before_id) loop if a.user_id<>auth.uid() then a.source_meal_id:=null;end if; return next a;end loop;
end $$;
revoke all on function public.community_feed_before_meals(integer,timestamptz,uuid),public.community_feed(integer,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.community_feed(integer,timestamptz,uuid) to authenticated,service_role;

alter function public.community_author_activities(uuid,integer,timestamptz,uuid) rename to community_author_activities_before_meals;
create function public.community_author_activities(p_author_user_id uuid,p_limit integer,p_before_time timestamptz,p_before_id uuid) returns setof public.shared_activities language plpgsql volatile security definer set search_path='' as $$declare a public.shared_activities;begin
 for a in select * from public.community_author_activities_before_meals(p_author_user_id,p_limit,p_before_time,p_before_id) loop a.source_meal_id:=null; return next a;end loop;
end $$;
revoke all on function public.community_author_activities_before_meals(uuid,integer,timestamptz,uuid),public.community_author_activities(uuid,integer,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.community_author_activities(uuid,integer,timestamptz,uuid) to authenticated,service_role;

-- Generic workout edits must not clear/change a meal projection.
alter function public.community_update_activity(uuid,integer,integer) rename to community_update_activity_before_meals;
create function public.community_update_activity(p_activity_id uuid,p_duration_seconds integer,p_expected_version integer default 1)
returns setof public.shared_activities language plpgsql security definer set search_path='' as $$begin
 perform public.community_lock();
 if exists(select 1 from public.shared_activities where id=p_activity_id and user_id=auth.uid() and activity_kind='meal') then raise exception 'community_conflict';end if;
 return query select * from public.community_update_activity_before_meals(p_activity_id,p_duration_seconds,p_expected_version);
end $$;
revoke all on function public.community_update_activity_before_meals(uuid,integer,integer),public.community_update_activity(uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.community_update_activity(uuid,integer,integer) to authenticated,service_role;

alter function public.community_export_page(text,text,integer) rename to community_export_page_before_meals;
create function public.community_export_page(p_category text,p_after text default null,p_limit integer default 500) returns table(item_key text,item jsonb)
language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null or p_limit is null or p_limit not between 1 and 500 then raise exception 'community_access_denied';end if;
 if p_category='activities' then
 return query select t.k,to_jsonb(t)-'k' from (select id::text k,id,activity_kind,source_workout_id,source_meal_id,category,shared_day,duration_seconds,workout_details,meal_details,version,published_at,revoked_at from public.shared_activities where user_id=auth.uid() and (p_after is null or id::text>p_after) order by id::text limit p_limit) t;
 else return query select * from public.community_export_page_before_meals(p_category,p_after,p_limit);end if;
end $$;
revoke all on function public.community_export_page_before_meals(text,text,integer),public.community_export_page(text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.community_export_page(text,text,integer) to authenticated;

alter function public.community_social_snapshot(text,text) rename to community_social_snapshot_before_meals;
create function public.community_social_snapshot(p_type text,p_id text) returns jsonb language sql stable security definer set search_path='' as $$
 select case when p_type='activity' then (select jsonb_build_object('activityKind',activity_kind,'category',category,'sharedDay',shared_day,'durationSeconds',duration_seconds,'workoutDetails',workout_details,'mealDetails',meal_details) from public.shared_activities where id::text=p_id)
 else public.community_social_snapshot_before_meals(p_type,p_id) end
$$;
revoke all on function public.community_social_snapshot_before_meals(text,text),public.community_social_snapshot(text,text) from public,anon,authenticated,service_role;
commit;
