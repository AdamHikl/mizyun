begin;
-- Independent rollout controls. No existing audience or participation is widened.
create table public.community_feature_controls (
 feature text primary key check(feature in ('comments','groups','challenges','messaging','media','routines','discovery')),
 enabled boolean not null default false,
 updated_at timestamptz not null default now()
);
alter table public.community_feature_controls enable row level security;
revoke all on public.community_feature_controls from public,anon,authenticated;
grant select,update on public.community_feature_controls to service_role;
insert into public.community_feature_controls(feature) values ('comments'),('groups'),('challenges'),('messaging'),('media'),('routines'),('discovery');
create function public.community_feature_enabled(p_feature text,p_user uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select public.community_active(p_user) and public.community_operation_enabled('engagement',p_user) and coalesce((select enabled from public.community_feature_controls where feature=p_feature),false)
$$;
-- Safe status projection: authenticated cohort members see switches, never cohort identities.
create function public.community_feature_status() returns table(feature text,enabled boolean)
language sql volatile security definer set search_path='' as $$
 select f.feature, public.community_feature_enabled(f.feature,auth.uid()) from public.community_feature_controls f where auth.uid() is not null
$$;
revoke all on function public.community_feature_enabled(text,uuid),public.community_feature_status() from public,anon,authenticated;
grant execute on function public.community_feature_status() to authenticated;
grant execute on function public.community_feature_enabled(text,uuid) to service_role;
-- Expanded types use separately authorized evidence/target-specific removal RPCs.
alter table public.community_reports drop constraint community_reports_target_type_check;
alter table public.community_reports add constraint community_reports_target_type_check check(target_type in ('profile','activity','comment','group','group_post','routine','message','challenge','media'));
alter table public.community_report_receipts drop constraint community_report_receipts_target_type_check;
alter table public.community_report_receipts add constraint community_report_receipts_target_type_check check(target_type in ('profile','activity','comment','group','group_post','routine','message','challenge','media'));
commit;
