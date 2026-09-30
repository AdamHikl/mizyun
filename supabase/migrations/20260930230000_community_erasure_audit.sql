-- Keep action/time/operator audit metadata while erasing duplicated case evidence.
begin;
create index community_actions_target on public.community_moderation_actions(target_type,target_id);
create function public.community_audit_erasure_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare report public.community_reports;target_exists boolean;erased_operator boolean:=false;
begin
 select r.* into report from public.community_reports r where r.id=new.report_id;
 target_exists:=case new.target_type
 when 'profile' then exists(select 1 from auth.users where id::text=new.target_id)
 when 'activity' then exists(select 1 from public.shared_activities where id::text=new.target_id)
 else false end;
 if tg_op='UPDATE' then erased_operator:=old.staff_operator is not null and new.staff_operator is null;end if;
 if report.id is null or report.reporter_user_id is null or report.subject_user_id is null
 or not target_exists or erased_operator then
 new.reason:='Retained moderation audit metadata; evidence removed.';new.staff_notes:=null;
 end if;
 if report.id is null or report.subject_user_id is null or not target_exists then new.target_id:='deleted';end if;
 return new;
end $$;
create trigger community_audit_erasure_guard before insert or update on public.community_moderation_actions
for each row execute function public.community_audit_erasure_guard();
create function public.community_minimize_erased_audit() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='community_reports' then
 if tg_op='DELETE' then
 update public.community_moderation_actions set target_id='deleted',reason='Retained moderation audit metadata; evidence removed.',staff_notes=null where report_id=old.id;
 elsif (old.reporter_user_id is not null and new.reporter_user_id is null)
 or (old.subject_user_id is not null and new.subject_user_id is null) then
 update public.community_moderation_actions set target_id=case when new.subject_user_id is null then 'deleted' else target_id end,
 reason='Retained moderation audit metadata; evidence removed.',staff_notes=null where report_id=new.id;
 end if;
 elsif tg_table_name='community_profiles' then
 update public.community_moderation_actions set target_id='deleted',reason='Retained moderation audit metadata; evidence removed.',staff_notes=null
 where target_type='profile' and target_id=old.user_id::text;
 else
 update public.community_moderation_actions set target_id='deleted',reason='Retained moderation audit metadata; evidence removed.',staff_notes=null
 where target_type='activity' and target_id=old.id::text;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger community_report_audit_erasure before delete on public.community_reports
for each row execute function public.community_minimize_erased_audit();
create trigger community_report_reference_audit_erasure after update of reporter_user_id,subject_user_id on public.community_reports
for each row execute function public.community_minimize_erased_audit();
create trigger community_profile_audit_erasure before delete on public.community_profiles
for each row execute function public.community_minimize_erased_audit();
create trigger community_activity_audit_erasure before delete on public.shared_activities
for each row execute function public.community_minimize_erased_audit();
-- Reconcile prior erasures without extending any action's retention deadline.
update public.community_moderation_actions a set reason=a.reason where a.report_id is null
 or not exists(select 1 from public.community_reports r where r.id=a.report_id and r.reporter_user_id is not null and r.subject_user_id is not null)
 or (a.target_type='profile' and not exists(select 1 from auth.users u where u.id::text=a.target_id))
 or (a.target_type='activity' and not exists(select 1 from public.shared_activities s where s.id::text=a.target_id));
revoke all on function public.community_audit_erasure_guard(),public.community_minimize_erased_audit() from public,anon,authenticated,service_role;
commit;
