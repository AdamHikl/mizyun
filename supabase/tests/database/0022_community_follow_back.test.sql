begin;
-- Synthetic fixture explicitly activates Community; production defaults stay closed.
update public.community_operations set enabled=true,enrollment=true,discovery=true,publish=true,engagement=true,cohort_required=false;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
create function pg_temp.receipt() returns trigger language plpgsql as $$
begin
 new.terms_version := '2026-09-29'; new.terms_accepted_at := now();
 -- This package can be verified before or after concurrent COMM-03 enrollment.
 if to_jsonb(new) ? 'adult_declared_at' then
  new := jsonb_populate_record(new,jsonb_build_object('terms_version','2026-09-30','adult_declared_at',now()));
 end if;
 return new;
end $$;
create trigger community_fixture_receipt before insert on public.community_profiles for each row execute function pg_temp.receipt();
insert into auth.users(id,email)
select ('c1660000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid, 'comm166-' || i || '@mizyun.test' from generate_series(1,4) i;
update public.profiles set birth_year = extract(year from now())::integer - 30 where id::text like 'c1660000%';
insert into public.community_profiles(user_id,handle,display_name,is_searchable,status)
select id, 'comm166_' || right(id::text,12), 'Synthetic member', false, 'active' from auth.users where id::text like 'c1660000%';

-- Privileged synthetic seed: B already follows A. C only has a pending request.
insert into public.community_relationships(follower_user_id,target_user_id,status) values
('c1660000-0000-4000-8000-000000000002','c1660000-0000-4000-8000-000000000001','approved'),
('c1660000-0000-4000-8000-000000000003','c1660000-0000-4000-8000-000000000001','pending');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='c1660000-0000-4000-8000-000000000001';
select throws_ok($$select * from public.community_request_follow('c1660000-0000-4000-8000-000000000003',null,'e1660000-0000-4000-8000-000000000001')$$,'P0001','community_unavailable','Pending follower does not authorize hidden follow back');
select is((select status from public.community_request_follow('c1660000-0000-4000-8000-000000000002',null,'e1660000-0000-4000-8000-000000000002')),'pending','Approved hidden follower receives pending request, never auto approval');
select is((select status from public.community_relationships where follower_user_id='c1660000-0000-4000-8000-000000000002' and target_user_id=auth.uid()),'approved','Incoming approval stays independent');
select lives_ok($$select * from public.community_request_follow('c1660000-0000-4000-8000-000000000002',null,'e1660000-0000-4000-8000-000000000002')$$,'Lost response retry succeeds');
select is((select count(*) from public.community_relationships where follower_user_id=auth.uid() and target_user_id='c1660000-0000-4000-8000-000000000002'),1::bigint,'Retry creates no duplicate outgoing edge');
select throws_ok($$update public.community_relationships set status='approved' where follower_user_id=auth.uid()$$,'P0001','community_unavailable','Follow back sender cannot approve own request');
update public.community_relationships set status='canceled' where follower_user_id=auth.uid();
select throws_ok($$select * from public.community_request_follow('c1660000-0000-4000-8000-000000000002',null,'e1660000-0000-4000-8000-000000000003')$$,'P0001','community_rate_limited','Follow back preserves cancellation cooldown');
set local request.jwt.claim.sub='c1660000-0000-4000-8000-000000000004';
select throws_ok($$select * from public.community_request_follow('c1660000-0000-4000-8000-000000000002',null,'e1660000-0000-4000-8000-000000000004')$$,'P0001','community_unavailable','Outsider guessed UUID remains denied');
reset role;
set local request.jwt.claim.role='service_role';
delete from public.community_relationships where follower_user_id='c1660000-0000-4000-8000-000000000001';
delete from public.community_relationships where follower_user_id='c1660000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='c1660000-0000-4000-8000-000000000001';
select throws_ok($$select * from public.community_request_follow('c1660000-0000-4000-8000-000000000002',null,'e1660000-0000-4000-8000-000000000005')$$,'P0001','community_unavailable','Removing incoming approval removes hidden follow-back capability');
reset role;
set local request.jwt.claim.role='service_role';
insert into public.community_relationships(follower_user_id,target_user_id,status) values('c1660000-0000-4000-8000-000000000002','c1660000-0000-4000-8000-000000000001','approved');
insert into public.community_blocks(blocker_user_id,blocked_user_id) values('c1660000-0000-4000-8000-000000000002','c1660000-0000-4000-8000-000000000001');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
select throws_ok($$select * from public.community_request_follow('c1660000-0000-4000-8000-000000000002',null,'e1660000-0000-4000-8000-000000000006')$$,'P0001','community_unavailable','Bilateral blocking denies follow back');
reset role;
select * from finish();
rollback;
