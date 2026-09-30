begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Synthetic principals only; exercise real Auth FK cascades, not a mocked delete.
insert into auth.users(id,email)
select ('c0150000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,
 'erase015-' || i || '@mizyun.test' from generate_series(1,12) i;
update public.profiles set birth_year = 1990 where id::text like 'c0150000%';
insert into public.community_profiles(user_id,handle,display_name,is_searchable,status,
 terms_version,terms_accepted_at,adult_declared_at)
select id,'erase015_' || right(id::text,12),'Synthetic member',true,'active',
 '2026-09-30',now(),now() from auth.users where id::text like 'c0150000%';
insert into public.community_relationships(follower_user_id,target_user_id,status)
select ('c0150000-0000-4000-8000-' || lpad((2*i-1)::text,12,'0'))::uuid,
 ('c0150000-0000-4000-8000-' || lpad((2*i)::text,12,'0'))::uuid,
 case when i in (1,3,5) then 'declined' else 'canceled' end
from generate_series(1,6) i;
-- Capture existing cooldowns before deleting either participant.
set local request.jwt.claim.role = 'service_role';
update public.community_relationships set status = status where follower_user_id::text like 'c0150000%';

select lives_ok($$delete from auth.users where id='c0150000-0000-4000-8000-000000000001'$$,'declined requester Auth deletion succeeds');
select lives_ok($$delete from auth.users where id='c0150000-0000-4000-8000-000000000003'$$,'canceled requester Auth deletion succeeds');
select lives_ok($$delete from auth.users where id='c0150000-0000-4000-8000-000000000006'$$,'declined target Auth deletion succeeds');
select lives_ok($$delete from auth.users where id='c0150000-0000-4000-8000-000000000008'$$,'canceled target Auth deletion succeeds');
select is((select count(*) from auth.users where id in (
 'c0150000-0000-4000-8000-000000000001','c0150000-0000-4000-8000-000000000003',
 'c0150000-0000-4000-8000-000000000006','c0150000-0000-4000-8000-000000000008')),0::bigint,'all four deleting principals are erased');
select is((select count(*) from public.community_relationships where follower_user_id in (
 'c0150000-0000-4000-8000-000000000001','c0150000-0000-4000-8000-000000000003',
 'c0150000-0000-4000-8000-000000000005','c0150000-0000-4000-8000-000000000007')),0::bigint,'their request edges cascade');
select is((select count(*) from public.community_follow_cooldowns where user_id in (
 'c0150000-0000-4000-8000-000000000001','c0150000-0000-4000-8000-000000000003',
 'c0150000-0000-4000-8000-000000000005','c0150000-0000-4000-8000-000000000007')),0::bigint,'deleted principal cooldowns are not resurrected');

-- These surviving pairs must create a new cooldown on edge cleanup, not merely
-- retain a pre-seeded row. Deleted-account pairs above keep their seeded rows.
delete from public.community_follow_cooldowns where user_id in (
 'c0150000-0000-4000-8000-000000000009','c0150000-0000-4000-8000-000000000011');
select is((select count(*) from public.community_follow_cooldowns where user_id in (
 'c0150000-0000-4000-8000-000000000009','c0150000-0000-4000-8000-000000000011')),0::bigint,'ordinary cleanup starts without pre-existing cooldowns');

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = 'c0150000-0000-4000-8000-000000000009';
select lives_ok($$insert into public.community_blocks(blocker_user_id,blocked_user_id) values(auth.uid(),'c0150000-0000-4000-8000-000000000010')$$,'block still cleans a declined edge');
reset role;
select is((select count(*) from public.community_follow_cooldowns where user_id='c0150000-0000-4000-8000-000000000009' and expires_at > now()),1::bigint,'block preserves cooldown while both Auth principals exist');
set local role authenticated;
set local request.jwt.claim.sub = 'c0150000-0000-4000-8000-000000000011';
select lives_ok($$select public.community_withdraw_profile()$$,'withdrawal still cleans a canceled edge');
reset role;
select is((select count(*) from public.community_follow_cooldowns where user_id='c0150000-0000-4000-8000-000000000011' and expires_at > now()),1::bigint,'withdrawal preserves cooldown while both Auth principals exist');
select is((select count(*) from public.community_relationships where follower_user_id in (
 'c0150000-0000-4000-8000-000000000009','c0150000-0000-4000-8000-000000000011')),0::bigint,'block and withdrawal remove ordinary edges');
select ok(not has_function_privilege('anon','public.community_capture_follow_cooldown()','EXECUTE'),'anonymous cannot invoke capture trigger');
select ok(not has_function_privilege('authenticated','public.community_capture_follow_cooldown()','EXECUTE'),'authenticated cannot invoke capture trigger');
select * from finish();
rollback;
