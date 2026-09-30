begin;
-- Environment-local controls. Only the service role can manage admission/delivery.
create table public.community_operations(singleton boolean primary key default true check(singleton),enabled boolean not null default true,enrollment boolean not null default true,discovery boolean not null default true,publish boolean not null default true,engagement boolean not null default true,delivery boolean not null default false,cohort_required boolean not null default false);
insert into public.community_operations default values;
create table public.community_pilot_cohort(user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.community_operations enable row level security;alter table public.community_pilot_cohort enable row level security;
revoke all on public.community_operations,public.community_pilot_cohort from public,anon,authenticated;
grant all on public.community_operations,public.community_pilot_cohort to service_role;
create function public.community_operation_enabled(p_operation text,p_user uuid) returns boolean language sql stable security definer set search_path='' as $$select coalesce((select enabled and case p_operation when 'enrollment' then enrollment when 'discovery' then discovery when 'publish' then publish when 'engagement' then engagement when 'delivery' then delivery else false end and (not cohort_required or exists(select 1 from public.community_pilot_cohort where user_id=p_user)) from public.community_operations where singleton),false) $$;
create function public.community_operation_guard() returns trigger language plpgsql security definer set search_path='' as $$declare op text;u uuid;begin
 if tg_table_name='community_profiles' then
 if new.status<>'active' then return new;end if;
 op:='enrollment';u:=new.user_id;
 elsif tg_table_name='shared_activities' then
 if new.revoked_at is not null then return new;end if;
 op:='publish';u:=new.user_id;
 elsif tg_table_name='community_relationships' then
 if new.status not in ('pending','approved') then return new;end if;
 op:='engagement';u:=case when new.status='approved' then new.target_user_id else new.follower_user_id end;
 elsif tg_table_name='community_reactions' then op:='engagement';u:=new.user_id;
 else op:='discovery';u:=new.inviter_user_id;end if;
 if not public.community_operation_enabled(op,u) then raise exception 'community_unavailable';end if;return new;end $$;
create trigger community_ops_profile before insert or update on public.community_profiles for each row execute function public.community_operation_guard();
create trigger community_ops_publication before insert or update on public.shared_activities for each row execute function public.community_operation_guard();
create trigger community_ops_relationship before insert or update on public.community_relationships for each row execute function public.community_operation_guard();
create trigger community_ops_reaction before insert or update on public.community_reactions for each row execute function public.community_operation_guard();
create trigger community_ops_invitation before insert on public.community_invitations for each row execute function public.community_operation_guard();
-- Rename underlying query functions; wrapper gate excludes safety reads by ID.
alter function public.community_profile_by_handle(text) rename to community_profile_by_handle_ungated;
create function public.community_profile_by_handle(p_handle text) returns setof public.community_profiles language plpgsql security definer set search_path='' as $$begin if not public.community_operation_enabled('discovery',auth.uid()) then raise exception 'community_unavailable';end if;return query select * from public.community_profile_by_handle_ungated(p_handle);end $$;
alter function public.community_handle_available(text) rename to community_handle_available_ungated;
create function public.community_handle_available(p_handle text) returns table(available boolean) language plpgsql security definer set search_path='' as $$begin if not public.community_operation_enabled('discovery',auth.uid()) then raise exception 'community_unavailable';end if;return query select * from public.community_handle_available_ungated(p_handle);end $$;
-- Safe worker metrics contain aggregates only, no social/health identifiers.
create function public.community_operations_metrics() returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('pendingDelivery',(select count(*) from public.community_notification_outbox where status='pending'),'oldestQueueSeconds',coalesce((select extract(epoch from now()-min(next_attempt_at))::bigint from public.community_notification_outbox where status='pending'),0),'openReports',(select count(*) from public.community_reports where status in ('submitted','under_review')),'failedDelivery',(select count(*) from public.community_notification_outbox where status='failed')) $$;
do $$declare f record;begin for f in select p.oid::regprocedure name,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('community_operation_enabled','community_operation_guard','community_profile_by_handle_ungated','community_profile_by_handle','community_handle_available_ungated','community_handle_available','community_operations_metrics') loop execute format('revoke all on function %s from public,anon,authenticated',f.name);execute format('grant execute on function %s to service_role',f.name);if f.proname in ('community_profile_by_handle','community_handle_available') then execute format('grant execute on function %s to authenticated',f.name);end if;end loop;end $$;
-- Bounded query-on-read: approved-author index probes, at most one page per author.
create index community_activity_author_page on public.shared_activities(user_id,published_at desc,id desc) where revoked_at is null;
create or replace function public.community_feed(p_limit integer,p_before_time timestamptz,p_before_id uuid)
returns setof public.shared_activities language plpgsql volatile security definer set search_path='' as $$declare a public.shared_activities;n integer:=greatest(1,least(coalesce(p_limit,20),50));u uuid:=auth.uid();begin
 if not public.community_active(u) then return;end if;
 for a in
 with candidate_authors as materialized (
 select u as user_id union select target_user_id from (select target_user_id from public.community_relationships where follower_user_id=u and status='approved' order by target_user_id limit 100) approved
 ), eligible_authors as materialized (
 select p.user_id,p.generation from candidate_authors c join public.community_profiles p on p.user_id=c.user_id
 where public.community_active(u) and public.community_active(p.user_id) and not public.community_blocked_between(u,p.user_id)
 and not exists(select 1 from public.community_mutes m where m.user_id=u and m.target_user_id=p.user_id)
 )
 select page.* from eligible_authors author cross join lateral (
 select s.* from public.shared_activities s where s.user_id=author.user_id and s.enrollment_generation=author.generation and s.revoked_at is null and s.published_at>now()-interval '365 days'
 and (p_before_time is null or (s.published_at,s.id)<(p_before_time,p_before_id))
 order by s.published_at desc,s.id desc limit n
 ) page order by page.published_at desc,page.id desc limit n loop
 if a.user_id<>u then a.source_workout_id:='00000000-0000-0000-0000-000000000000';end if;return next a;
 end loop;
end $$;
commit;
