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
select ('c1430000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid, 'comm143-' || i || '@mizyun.test' from generate_series(1,65) i;
update public.profiles set birth_year = extract(year from now())::integer - 30 where id::text like 'c1430000%';
insert into public.community_profiles(user_id,handle,display_name,is_searchable,status)
select id, 'comm143_' || right(id::text,12), 'Synthetic member', true, 'active' from auth.users where id::text like 'c1430000%';
set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = 'c1430000-0000-4000-8000-000000000001';
select lives_ok($$select * from public.community_request_follow('c1430000-0000-4000-8000-000000000002',null,'e1430000-0000-4000-8000-000000000001')$$, 'request succeeds');
select lives_ok($$select * from public.community_request_follow('c1430000-0000-4000-8000-000000000002',null,'e1430000-0000-4000-8000-000000000001')$$, 'lost response retry succeeds');
select is((select count(*) from public.community_relationships where follower_user_id = auth.uid()),1::bigint,'retry creates one edge');
select throws_ok($$select * from public.community_request_follow('c1430000-0000-4000-8000-000000000003',null,'e1430000-0000-4000-8000-000000000001')$$,'P0001','community_conflict','operation target reuse conflicts');
select throws_ok($$update public.community_relationships set status='approved' where follower_user_id = auth.uid()$$,'P0001','community_unavailable','sender cannot approve');
update public.community_relationships set status = 'canceled' where follower_user_id = auth.uid();
select throws_ok($$select * from public.community_request_follow('c1430000-0000-4000-8000-000000000002',null,'e1430000-0000-4000-8000-000000000101')$$,'P0001','community_rate_limited','cancel cooldown enforced');
select is((select status from public.community_request_follow('c1430000-0000-4000-8000-000000000002',null,'e1430000-0000-4000-8000-000000000001')),'canceled','old retry cannot revive canceled edge');
reset role;set local request.jwt.claim.role='service_role';
set local request.jwt.claim.role = 'service_role';
create temporary table old_edge as select id from public.community_relationships where follower_user_id = 'c1430000-0000-4000-8000-000000000001';
grant select on old_edge to authenticated;
alter table public.community_relationships disable trigger community_guard_relationship;
update public.community_relationships set updated_at = now() - interval '49 hours' where follower_user_id = 'c1430000-0000-4000-8000-000000000001';
alter table public.community_relationships enable trigger community_guard_relationship;
update public.community_follow_cooldowns set expires_at = now() - interval '1 hour' where user_id = 'c1430000-0000-4000-8000-000000000001';
set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.role = 'authenticated';
select lives_ok($$select * from public.community_request_follow('c1430000-0000-4000-8000-000000000002',null,'e1430000-0000-4000-8000-000000000002')$$,'new operation after cooldown succeeds');
select isnt((select id from public.community_relationships where follower_user_id=auth.uid()),(select id from old_edge),'new request has distinct incarnation ID');
select throws_ok($$select * from public.community_request_follow('c1430000-0000-4000-8000-000000000002',null,'e1430000-0000-4000-8000-000000000001')$$,'P0001','community_conflict','old operation cannot act on later incarnation');
set local request.jwt.claim.sub = 'c1430000-0000-4000-8000-000000000002';
update public.community_relationships set status='approved' where target_user_id=auth.uid();
set local request.jwt.claim.sub = 'c1430000-0000-4000-8000-000000000001';
select lives_ok($$select public.community_set_mute('c1430000-0000-4000-8000-000000000002',true)$$,'following member can mute');
select is((select count(*) from public.community_mutes),1::bigint,'owner sees mute');
select is((select count(*) from public.community_relationships where status='approved'),1::bigint,'mute leaves audience edge approved');
set local request.jwt.claim.sub = 'c1430000-0000-4000-8000-000000000002';
select is((select count(*) from public.community_mutes),0::bigint,'target cannot inspect owner mute');
select throws_ok($$select public.community_set_mute('c1430000-0000-4000-8000-000000000001',true)$$,'P0001','community_unavailable','reverse follow is independent');
reset role;set local request.jwt.claim.role='service_role';
set local request.jwt.claim.role='service_role';
-- Rate history remains when the live edge is removed.
delete from public.community_relationships where follower_user_id='c1430000-0000-4000-8000-000000000001';
insert into public.community_follow_request_events(user_id) select 'c1430000-0000-4000-8000-000000000001'::uuid from generate_series(1,8);
set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='c1430000-0000-4000-8000-000000000001';
select throws_ok($$select * from public.community_request_follow('c1430000-0000-4000-8000-000000000003',null,'e1430000-0000-4000-8000-000000000102')$$,'P0001','community_rate_limited','10/minute survives relationship deletion');
reset role;set local request.jwt.claim.role='service_role';
set local request.jwt.claim.role='service_role';
update public.community_follow_request_events set created_at=(pg_catalog.date_trunc('day',now() at time zone 'UTC') at time zone 'UTC');
insert into public.community_follow_request_events(user_id,created_at) select 'c1430000-0000-4000-8000-000000000001'::uuid,(pg_catalog.date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') from generate_series(1,40);
set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.role='authenticated';
select throws_ok($$select * from public.community_request_follow('c1430000-0000-4000-8000-000000000003',null,'e1430000-0000-4000-8000-000000000103')$$,'P0001','community_rate_limited','50/day uses immutable request history');
reset role;set local request.jwt.claim.role='service_role';
set local request.jwt.claim.role='service_role';
update public.community_follow_request_events set created_at = (pg_catalog.date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') - interval '2 minutes';
set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.role='authenticated';
select lives_ok($$select * from public.community_request_follow('c1430000-0000-4000-8000-000000000003',null,'e1430000-0000-4000-8000-000000000110')$$,'prior UTC day does not consume current day allowance');
reset role;set local request.jwt.claim.role='service_role';
set local request.jwt.claim.role='service_role';
delete from public.community_relationships;
delete from public.community_follow_request_events;
insert into public.community_relationships(follower_user_id,target_user_id,status)
select 'c1430000-0000-4000-8000-000000000001'::uuid,('c1430000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,'approved' from generate_series(2,31)i;
insert into public.community_relationships(follower_user_id,target_user_id,status) values('c1430000-0000-4000-8000-000000000001','c1430000-0000-4000-8000-000000000032','pending');
set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='c1430000-0000-4000-8000-000000000032';
select throws_ok($$update public.community_relationships set status='approved' where target_user_id=auth.uid()$$,'P0001','community_rate_limited','30 approved following cap enforced at direct DB boundary');
reset role;set local request.jwt.claim.role='service_role';
set local request.jwt.claim.role='service_role';
delete from public.community_relationships;
insert into public.community_relationships(follower_user_id,target_user_id,status)
select ('c1430000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,'c1430000-0000-4000-8000-000000000001'::uuid,'approved' from generate_series(2,31)i;
insert into public.community_relationships(follower_user_id,target_user_id,status) values('c1430000-0000-4000-8000-000000000032','c1430000-0000-4000-8000-000000000001','pending');
set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='c1430000-0000-4000-8000-000000000001';
select throws_ok($$update public.community_relationships set status='approved' where target_user_id=auth.uid() and status='pending'$$,'P0001','community_rate_limited','30 approved followers cap enforced');
reset role;set local request.jwt.claim.role='service_role';
set local request.jwt.claim.role='service_role';
delete from public.community_relationships;
insert into public.community_relationships(follower_user_id,target_user_id,status)
select ('c1430000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,'c1430000-0000-4000-8000-000000000001'::uuid,'pending' from generate_series(2,51)i;
set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='c1430000-0000-4000-8000-000000000052';
select throws_ok($$select * from public.community_request_follow('c1430000-0000-4000-8000-000000000001',null,'e1430000-0000-4000-8000-000000000104')$$,'P0001','community_rate_limited','50 incoming cap enforced');
reset role;set local request.jwt.claim.role='service_role';
set local request.jwt.claim.role='service_role';
delete from public.community_relationships;
insert into public.community_relationships(follower_user_id,target_user_id,status)
select 'c1430000-0000-4000-8000-000000000001'::uuid,('c1430000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,'pending' from generate_series(2,21)i;
set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='c1430000-0000-4000-8000-000000000001';
select throws_ok($$select * from public.community_request_follow('c1430000-0000-4000-8000-000000000022',null,'e1430000-0000-4000-8000-000000000105')$$,'P0001','community_rate_limited','20 outgoing cap enforced');
set local request.jwt.claim.sub='c1430000-0000-4000-8000-000000000060';
select * from public.community_request_follow('c1430000-0000-4000-8000-000000000061',null,'e1430000-0000-4000-8000-000000000120');
update public.community_relationships set status='canceled' where follower_user_id=auth.uid();
insert into public.community_blocks(blocker_user_id,blocked_user_id) values(auth.uid(),'c1430000-0000-4000-8000-000000000061');
select is((select is_unavailable from public.community_is_unavailable('c1430000-0000-4000-8000-000000000061')),true,'blocked target yields neutral unavailable');
select is((select is_unavailable from public.community_is_unavailable('c1430000-0000-4000-8000-000000000099')),true,'missing target yields same neutral unavailable');
select throws_ok($$select * from public.community_is_blocked('c1430000-0000-4000-8000-000000000061')$$,'42501','permission denied for function community_is_blocked','block-specific public RPC cannot be called');
delete from public.community_blocks where blocker_user_id=auth.uid();
select throws_ok($$select * from public.community_request_follow('c1430000-0000-4000-8000-000000000061',null,'e1430000-0000-4000-8000-000000000121')$$,'P0001','community_rate_limited','block/unblock deleting live edge cannot bypass cooldown');
select throws_ok($$select * from public.community_request_follow('c1430000-0000-4000-8000-000000000061',null,null)$$,'P0001','community_conflict','null request operation is rejected');
select throws_ok($$select * from public.community_request_follow('c1430000-0000-4000-8000-000000000061')$$,'42501','permission denied for function community_request_follow','legacy operation-free RPC is unavailable');
select * from finish();
rollback;
