begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values ('f2490000-0000-4000-8000-000000000001','project-a@mizyun.test'),('f2490000-0000-4000-8000-000000000002','project-b@mizyun.test');
create temporary table ids(label text primary key,id uuid);
grant all on ids to authenticated;

select ok((select relrowsecurity from pg_class where oid='public.boulder_projects'::regclass),'RLS on boulder_projects');
select ok(not has_table_privilege('authenticated','public.boulder_projects','INSERT'),'No direct project insert');
select ok(not has_table_privilege('authenticated','public.boulder_projects','UPDATE'),'No direct project update');
select ok(not has_table_privilege('authenticated','public.boulder_projects','DELETE'),'No direct project delete');
select ok(not has_function_privilege('anon','public.boulder_project_set_archived(uuid,boolean)','EXECUTE'),'Anon cannot archive');
select ok(has_function_privilege('authenticated','public.boulder_project_set_archived(uuid,boolean)','EXECUTE'),'Authenticated can archive through the RPC');
select ok(not has_function_privilege('authenticated','public.boulder_project_refresh(uuid)','EXECUTE'),'Refresh helper is private');
select is((select count(*) from pg_proc where proname='boulder_ascent_create' and pronamespace='public'::regnamespace),1::bigint,'Old create overload is replaced');
select ok(exists(select 1 from pg_indexes where tablename='boulder_projects' and indexdef like '%(user_id, status, first_logged_at DESC)%'),'Owner index on projects');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='f2490000-0000-4000-8000-000000000001';
insert into ids select 's1',id from public.boulder_session_start('b2490000-0000-4000-8000-0000000000a1','UTC',null);

-- Not yet opens a project; a send without a project does not.
insert into ids select 'a1',id from public.boulder_ascent_create((select id from ids where label='s1'),'c2490000-0000-4000-8000-0000000000b1','7A','not_yet',3,'red',null,null);
insert into ids select 'p1',project_id from public.boulder_ascents where id=(select id from ids where label='a1');
select ok((select id from ids where label='p1') is not null,'Not yet boulder is linked to a new project');
select is((select status||' '||grade_code||' '||hold_colour from public.boulder_projects where id=(select id from ids where label='p1')),'open 7A red','Project copies grade and colour');
insert into ids select 'a2',id from public.boulder_ascent_create((select id from ids where label='s1'),'c2490000-0000-4000-8000-0000000000b2','6A','flash',1,null,null,null);
select ok((select project_id is null from public.boulder_ascents where id=(select id from ids where label='a2')),'A send without Try again opens no project');
select is((select count(*) from public.boulder_projects),1::bigint,'Only one project exists');

-- Replays keep the same link and create no extra project.
select is((select project_id from public.boulder_ascent_create((select id from ids where label='s1'),'c2490000-0000-4000-8000-0000000000b1','7A','not_yet',3,'red',null,null)),(select id from ids where label='p1'),'Create replay keeps the project');
select is((select count(*) from public.boulder_projects),1::bigint,'Replay opens no extra project');
select throws_ok($$select * from public.boulder_ascent_create((select id from ids where label='s1'),'c2490000-0000-4000-8000-0000000000b1','7A','not_yet',3,'red',null,null,(select id from ids where label='p1'))$$,'PT409','boulder_conflict','Changing the project link on replay conflicts');

-- Try again in a later session, then send.
select ok((select completed_at is not null from public.boulder_session_finish((select id from ids where label='s1'),'d2490000-0000-4000-8000-0000000000f1',null)),'First session finished');
insert into ids select 's2',id from public.boulder_session_start('b2490000-0000-4000-8000-0000000000a2','UTC',null);
insert into ids select 'a3',id from public.boulder_ascent_create((select id from ids where label='s2'),'c2490000-0000-4000-8000-0000000000b3','7A','not_yet',4,'red',null,null,(select id from ids where label='p1'));
select is((select project_id from public.boulder_ascents where id=(select id from ids where label='a3')),(select id from ids where label='p1'),'Try again links the existing project');
select is((select count(*) from public.boulder_projects),1::bigint,'Try again opens no new project');
insert into ids select 'a4',id from public.boulder_ascent_create((select id from ids where label='s2'),'c2490000-0000-4000-8000-0000000000b4','7A','sent',6,'red',null,null,(select id from ids where label='p1'));
select is((select status from public.boulder_projects where id=(select id from ids where label='p1')),'sent','Linked send marks the project sent');
select is((select sent_ascent_id from public.boulder_projects where id=(select id from ids where label='p1')),(select id from ids where label='a4'),'Sending ascent recorded');
select throws_ok($$select * from public.boulder_ascent_create((select id from ids where label='s2'),'c2490000-0000-4000-8000-0000000000b5','7A','sent',2,null,null,null,(select id from ids where label='p1'))$$,'PT409','boulder_project_unavailable','A sent project cannot be linked again');
select throws_ok($$select * from public.boulder_project_set_archived((select id from ids where label='p1'),true)$$,'PT409','boulder_conflict','A sent project cannot be archived');

-- Editing or deleting the send reopens the project.
select is((select revision from public.boulder_ascent_update((select id from ids where label='a4'),'d2490000-0000-4000-8000-0000000000c1',1,'7A','not_yet',6,'red',null,null)),2,'Send edited to not yet');
select is((select status from public.boulder_projects where id=(select id from ids where label='p1')),'open','Project reopens after the send is edited away');
select is((select revision from public.boulder_ascent_update((select id from ids where label='a4'),'d2490000-0000-4000-8000-0000000000c2',2,'7A','sent',6,'red',null,null)),3,'Edited back to sent');
select is((select status from public.boulder_projects where id=(select id from ids where label='p1')),'sent','Project is sent again');
select is((select count(*) from public.boulder_ascent_remove((select id from ids where label='a4'))),1::bigint,'Sending ascent removed');
select is((select status||coalesce(sent_at::text,'-') from public.boulder_projects where id=(select id from ids where label='p1')),'open-','Project reopens and clears sent fields');

select throws_ok($$select * from public.boulder_ascent_create((select id from ids where label='s2'),'c2490000-0000-4000-8000-0000000000b7','7A','flash',1,null,null,null,(select id from ids where label='p1'))$$,'22023','boulder_invalid','A flash cannot continue a project');

-- Archive and reopen.
select is((select status from public.boulder_project_set_archived((select id from ids where label='p1'),true)),'archived','Archive');
select is((select status from public.boulder_project_set_archived((select id from ids where label='p1'),true)),'archived','Archive is idempotent');
insert into ids select 'a5',id from public.boulder_ascent_create((select id from ids where label='s2'),'c2490000-0000-4000-8000-0000000000b6','7A','not_yet',null,'red',null,null,(select id from ids where label='p1'));
select is((select status from public.boulder_projects where id=(select id from ids where label='p1')),'archived','Trying an archived project keeps it archived');
select is((select status from public.boulder_project_set_archived((select id from ids where label='p1'),false)),'open','Reopen');

-- Isolation
set local request.jwt.claim.sub='f2490000-0000-4000-8000-000000000002';
select is((select count(*) from public.boulder_projects),0::bigint,'Other user reads no projects');
select throws_ok($$select * from public.boulder_project_set_archived((select id from ids where label='p1'),true)$$,'P0002','boulder_not_found','Other user cannot archive');
insert into ids select 'sb',id from public.boulder_session_start('b2490000-0000-4000-8000-0000000000b9','UTC',null);
select throws_ok($$select * from public.boulder_ascent_create((select id from ids where label='sb'),'c2490000-0000-4000-8000-0000000000e1','7A','not_yet',null,null,null,null,(select id from ids where label='p1'))$$,'PT409','boulder_project_unavailable','Other user cannot link the project');

-- Deleting the last linked boulders removes the project; session removal cascades.
set local request.jwt.claim.sub='f2490000-0000-4000-8000-000000000001';
select is((select count(*) from public.boulder_ascent_remove((select id from ids where label='a5'))),1::bigint,'Remove a linked try');
select is((select count(*) from public.boulder_session_remove((select id from ids where label='s2'))),0::bigint,'Remove the second session');
select is((select status from public.boulder_projects where id=(select id from ids where label='p1')),'open','Project survives while the first try remains');
select is((select count(*) from public.boulder_ascent_remove((select id from ids where label='a1'))),1::bigint,'Remove the last linked boulder');
select is((select count(*) from public.boulder_projects),0::bigint,'Project without boulders is removed');

-- Erasure with live projects linked across sessions.
insert into ids select 's3',id from public.boulder_session_start('b2490000-0000-4000-8000-0000000000a3','UTC',null);
insert into ids select 'a6',id from public.boulder_ascent_create((select id from ids where label='s3'),'c2490000-0000-4000-8000-0000000000c6','6C','not_yet',2,'green',null,null);
select ok((select completed_at is not null from public.boulder_session_finish((select id from ids where label='s3'),'d2490000-0000-4000-8000-0000000000f3',null)),'Third session finished');
insert into ids select 'p2',project_id from public.boulder_ascents where id=(select id from ids where label='a6');
insert into ids select 's4',id from public.boulder_session_start('b2490000-0000-4000-8000-0000000000a4','UTC',null);
select ok((select project_id from public.boulder_ascent_create((select id from ids where label='s4'),'c2490000-0000-4000-8000-0000000000c7','6C','not_yet',3,'green',null,null,(select id from ids where label='p2')))=(select id from ids where label='p2'),'Open project spans two sessions');
insert into ids select 'a8',id from public.boulder_ascent_create((select id from ids where label='s4'),'c2490000-0000-4000-8000-0000000000c8','7B','not_yet',null,null,null,null);
select ok((select project_id from public.boulder_ascent_create((select id from ids where label='s4'),'c2490000-0000-4000-8000-0000000000c9','7B','sent',5,null,null,null,(select project_id from public.boulder_ascents where id=(select id from ids where label='a8')))) is not null,'Second project is sent');
select is((select count(*) from public.boulder_projects),2::bigint,'One open and one sent project before erasure');
-- Erasure
reset role;
delete from auth.users where id='f2490000-0000-4000-8000-000000000001';
select is((select count(*) from public.boulder_projects where user_id='f2490000-0000-4000-8000-000000000001'),0::bigint,'Erasure removes projects');
select is((select count(*) from public.boulder_ascents where user_id='f2490000-0000-4000-8000-000000000001'),0::bigint,'Erasure removes linked boulders');
select is((select count(*) from public.boulder_operation_receipts where user_id='f2490000-0000-4000-8000-000000000001'),0::bigint,'Erasure removes receipts');
select is((select count(*) from public.workouts where user_id='f2490000-0000-4000-8000-000000000001'),0::bigint,'Erasure removes sessions');

select * from finish();
rollback;
