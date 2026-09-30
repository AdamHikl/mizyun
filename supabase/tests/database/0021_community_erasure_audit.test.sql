begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
update public.community_operations set enabled=true,enrollment=true,discovery=true,publish=true,engagement=true,delivery=true,cohort_required=false;
insert into auth.users(id,email)
select ('c2100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'audit-erasure-'||n||'@mizyun.test' from generate_series(1,4) n;
update public.profiles set birth_year=1990 where id::text like 'c2100000-%';
set local request.jwt.claim.role='service_role';
insert into public.community_profiles(user_id,handle,display_name,status,terms_version,terms_accepted_at,adult_declared_at)
select id,'audit_'||right(id::text,12),'Synthetic member','active','2026-09-30',now(),now() from auth.users where id::text like 'c2100000-%';
insert into public.community_reports(id,reporter_user_id,target_type,target_id,reason,status,subject_user_id,decision,notes,staff_notes,evidence_snapshot)
values
('d2100000-0000-4000-8000-000000000001','c2100000-0000-4000-8000-000000000001','profile','c2100000-0000-4000-8000-000000000002','harassment','resolved','c2100000-0000-4000-8000-000000000002','ban','Reporter private quote','Copied staff quote','{"private":"synthetic reporter quote"}'),
('d2100000-0000-4000-8000-000000000002','c2100000-0000-4000-8000-000000000003','profile','c2100000-0000-4000-8000-000000000004','harassment','resolved','c2100000-0000-4000-8000-000000000004','ban','Direct cascade quote','Copied direct quote','{"private":"synthetic subject quote"}');
insert into public.community_moderation_sanctions(user_id,report_id,kind) values
('c2100000-0000-4000-8000-000000000002','d2100000-0000-4000-8000-000000000001','ban'),
('c2100000-0000-4000-8000-000000000004','d2100000-0000-4000-8000-000000000002','ban');
insert into public.community_moderation_actions(id,report_id,target_type,target_id,action,reason,staff_operator,staff_notes) values
('e2100000-0000-4000-8000-000000000001','d2100000-0000-4000-8000-000000000001','profile','c2100000-0000-4000-8000-000000000002','ban','Private reporter quote copied to reason','c2100000-0000-4000-8000-000000000004','Private reporter quote copied to staff notes'),
('e2100000-0000-4000-8000-000000000002','d2100000-0000-4000-8000-000000000002','profile','c2100000-0000-4000-8000-000000000004','ban','Private subject quote copied to reason','c2100000-0000-4000-8000-000000000002','Private subject quote copied to staff notes');
select ok((select staff_notes is not null from public.community_moderation_actions where id='e2100000-0000-4000-8000-000000000001'),'Fixture begins with actual duplicated case evidence');
create temporary table audit_original_time as select id,created_at,retention_expires_at from public.community_moderation_actions;
insert into public.account_deletion_jobs(id,user_id,challenge_hash,status,stage,expires_at,worker_id,lease_expires_at)
values('f2100000-0000-4000-8000-000000000001','c2100000-0000-4000-8000-000000000001','synthetic-audit-challenge','in_progress','auth',now()+interval '5 minutes','audit-worker',now()+interval '2 minutes');
select lives_ok($$select * from public.community_account_cleanup_batch('c2100000-0000-4000-8000-000000000001','f2100000-0000-4000-8000-000000000001','audit-worker',500)$$,'Live leased account cleanup minimizes duplicated audit evidence');
select ok((select reason='Retained moderation audit metadata; evidence removed.' and staff_notes is null from public.community_moderation_actions where id='e2100000-0000-4000-8000-000000000001'),'Worker erasure clears both audit free-text fields');
select ok((select action='ban' and report_id='d2100000-0000-4000-8000-000000000001' and target_id='c2100000-0000-4000-8000-000000000002' from public.community_moderation_actions where id='e2100000-0000-4000-8000-000000000001'),'Surviving subject retains only required sanction action/case metadata');
select ok((select a.created_at=t.created_at and a.retention_expires_at=t.retention_expires_at from public.community_moderation_actions a join audit_original_time t using(id) where a.id='e2100000-0000-4000-8000-000000000001'),'Minimization preserves audit chronology and original retention deadline');
delete from auth.users where id='c2100000-0000-4000-8000-000000000001';
select is((select count(*) from public.community_moderation_sanctions where report_id='d2100000-0000-4000-8000-000000000001'),1::bigint,'Reporter Auth erasure preserves the live independent sanction');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='c2100000-0000-4000-8000-000000000002';
select lives_ok($$select * from public.community_create_moderation_appeal('d2100000-0000-4000-8000-000000000001','Review minimal sanction case')$$,'Surviving subject can still appeal after reporter erasure');
select ok(not coalesce(has_function_privilege('authenticated',to_regprocedure('public.community_minimize_erased_audit()'),'EXECUTE'),false),'User cannot invoke audit minimizer as an arbitrary erasure oracle');
reset role;
delete from auth.users where id='c2100000-0000-4000-8000-000000000003';
select ok((select reason='Retained moderation audit metadata; evidence removed.' and staff_notes is null from public.community_moderation_actions where id='e2100000-0000-4000-8000-000000000002'),'Direct reporter Auth cascade also clears audit evidence');
delete from auth.users where id='c2100000-0000-4000-8000-000000000004';
select ok((select target_id='deleted' and staff_notes is null and reason='Retained moderation audit metadata; evidence removed.' from public.community_moderation_actions where id='e2100000-0000-4000-8000-000000000002'),'Deleted subject leaves no audit target identity or copied quotes');
select ok((select a.action='ban' and a.created_at=t.created_at and a.retention_expires_at=t.retention_expires_at from public.community_moderation_actions a join audit_original_time t using(id) where a.id='e2100000-0000-4000-8000-000000000002'),'Direct cascade retains action/time metadata without extending retention');
-- Late inspection/maintenance inserts cannot reintroduce an erased quote.
insert into public.community_moderation_actions(report_id,target_type,target_id,action,reason,staff_notes)
values('d2100000-0000-4000-8000-000000000001','profile','c2100000-0000-4000-8000-000000000002','inspect','Attempted erased reporter quote','Attempted erased reporter quote'),
(null,'profile','c2100000-0000-4000-8000-000000000002','inspect','Orphan copied quote','Orphan copied quote'),
('d2100000-0000-4000-8000-000000000002','profile','c2100000-0000-4000-8000-000000000004','inspect','Deleted subject copied quote','Deleted subject copied quote');
select ok((select bool_and(reason='Retained moderation audit metadata; evidence removed.' and staff_notes is null) from public.community_moderation_actions where action='inspect'),'Later audit inserts cannot restore private evidence after erasure');
select ok((select target_id='deleted' from public.community_moderation_actions where action='inspect' and report_id is null),'Orphan audit rows carry no subject reference');
select ok((select target_id='deleted' from public.community_moderation_actions where action='inspect' and report_id='d2100000-0000-4000-8000-000000000002'),'Late erased-subject audit carries no target reference');
delete from public.community_reports where id='d2100000-0000-4000-8000-000000000002';
select ok((select bool_and(target_id='deleted' and staff_notes is null) from public.community_moderation_actions where report_id is null),'Case deletion retains only minimized orphan audit metadata');
select * from finish();
rollback;
