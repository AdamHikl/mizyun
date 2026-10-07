begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
update public.community_operations set enabled=true,enrollment=true,discovery=true,publish=true,engagement=true,cohort_required=false;
update public.community_feature_controls set enabled=true where feature='messaging';
insert into auth.users(id,email) values
 ('51000000-0000-4000-8000-000000000001','reads-a@mizyun.test'),
 ('51000000-0000-4000-8000-000000000002','reads-b@mizyun.test'),
 ('51000000-0000-4000-8000-000000000003','reads-c@mizyun.test');
update public.profiles set birth_year=1990 where id::text like '51000000%';
create temporary table message_read_pages(name text primary key,body jsonb);
grant all on message_read_pages to authenticated;
set local role authenticated;set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='51000000-0000-4000-8000-000000000001';
select * from public.community_save_profile('reads_a','A','AA',null,true,true,'2026-09-30');
select * from public.community_messaging_rpc('preferences','{"enabled":true}');
set local request.jwt.claim.sub='51000000-0000-4000-8000-000000000002';
select * from public.community_save_profile('reads_b','B','BB',null,true,true,'2026-09-30');
select * from public.community_messaging_rpc('preferences','{"enabled":true}');
set local request.jwt.claim.sub='51000000-0000-4000-8000-000000000003';
select * from public.community_save_profile('reads_c','C','CC',null,true,true,'2026-09-30');
select * from public.community_messaging_rpc('preferences','{"enabled":true}');
reset role;
insert into public.community_relationships(follower_user_id,target_user_id,status) values
 ('51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002','approved'),
 ('51000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000001','approved');
-- Equal timestamps force the UUID tie-breaker across the exact 50-row boundary.
insert into public.community_messages(id,user_id,recipient_id,body,original_digest,sender_generation,recipient_generation,created_at)
select ('52000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 '51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002',
 'message '||i,md5('message '||i),1,1,now()-interval '1 hour' from generate_series(1,53) i;
set local role authenticated;set local request.jwt.claim.sub='51000000-0000-4000-8000-000000000002';
insert into message_read_pages select 'latest',result from public.community_messaging_rpc('latest','{"peerId":"51000000-0000-4000-8000-000000000001"}');
select is((select jsonb_array_length(body->'messages') from message_read_pages where name='latest'),50,'Recent page is bounded to 50');
select is((select body->'messages'->0->>'text' from message_read_pages where name='latest'),'message 4','Recent page renders chronological order');
select is((select body->'messages'->49->>'text' from message_read_pages where name='latest'),'message 53','Recent page includes the latest equal-time message');
select is((select body->'nextBefore'->>'id' from message_read_pages where name='latest'),'52000000-0000-4000-8000-000000000004','Older cursor uses the oldest delivered tuple');
select is((select count(*) from public.community_report_receipts_for_caller() where target_type='message' and target_id='52000000-0000-4000-8000-000000000053'),1::bigint,'Latest-page incoming message issues report authority');
select is((select result->'threads'->0->'latestMessage'->>'text' from public.community_messaging_rpc('threads','{}')),'message 53','Summary is the latest authorized stored message');
-- Arrival and edit do not move the older-page tuple; no cursor-row lookup.
reset role;
insert into public.community_messages(id,user_id,recipient_id,body,original_digest,sender_generation,recipient_generation,created_at) values
 ('52000000-0000-4000-8000-000000000054','51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002','new arrival',md5('new arrival'),1,1,now());
update public.community_messages set body='edited message',edited_at=now(),version=2 where id='52000000-0000-4000-8000-000000000053';
update public.community_messages set created_at=now()-interval '91 days' where id='52000000-0000-4000-8000-000000000004';
set local role authenticated;
insert into message_read_pages select 'older',result from public.community_messaging_rpc('latest',jsonb_build_object('peerId','51000000-0000-4000-8000-000000000001','before',(select body->'nextBefore' from message_read_pages where name='latest')));
select is((select jsonb_array_length(body->'messages') from message_read_pages where name='older'),3,'Expired boundary row does not break older paging');
select is((select body->'messages'->0->>'text' from message_read_pages where name='older'),'message 1','Older page is chronological');
select is((select body->'messages'->2->>'text' from message_read_pages where name='older'),'message 3','Older page does not duplicate boundary or new arrival');
select ok((select body->'nextBefore'='null'::jsonb from message_read_pages where name='older'),'No invented further page when fewer than 50 remain');
select is((select result->'threads'->0->'latestMessage'->>'text' from public.community_messaging_rpc('threads','{}')),'new arrival','New arrival becomes authoritative thread summary');
reset role;delete from public.community_messages where id='52000000-0000-4000-8000-000000000002';
set local role authenticated;
select is((select jsonb_array_length(result->'messages') from public.community_messaging_rpc('latest',jsonb_build_object('peerId','51000000-0000-4000-8000-000000000001','before',(select body->'nextBefore' from message_read_pages where name='latest')))),2,'Physical deletion between pages cannot duplicate or recreate text');
set local request.jwt.claim.sub='51000000-0000-4000-8000-000000000003';
select throws_ok($$select * from public.community_messaging_rpc('latest','{"peerId":"51000000-0000-4000-8000-000000000001"}')$$,'P0001','community_unavailable','Unrelated member cannot read a guessed recent conversation');
select is((select jsonb_array_length(result->'threads') from public.community_messaging_rpc('threads','{}')),0,'Unrelated summaries do not expose peer text');
select ok(not has_function_privilege('authenticated','public.community_messaging_rpc_before_reads(text,jsonb)','execute'),'Legacy dispatcher is not directly callable');
set local request.jwt.claim.sub='51000000-0000-4000-8000-000000000001';
select * from public.community_messaging_rpc('delete','{"id":"52000000-0000-4000-8000-000000000054"}');
set local request.jwt.claim.sub='51000000-0000-4000-8000-000000000002';
select ok((select (result->'threads'->0->'latestMessage'->>'deleted')::boolean and result->'threads'->0->'latestMessage'->'text'='null'::jsonb from public.community_messaging_rpc('threads','{}')),'Summary tombstone never retains deleted text');
select * from public.community_messaging_rpc('preferences','{"enabled":false}');
select is((select jsonb_array_length(result->'threads') from public.community_messaging_rpc('threads','{}')),0,'Own opt-out hides thread summaries');
set local request.jwt.claim.sub='51000000-0000-4000-8000-000000000001';
select throws_ok($$select * from public.community_messaging_rpc('latest','{"peerId":"51000000-0000-4000-8000-000000000002"}')$$,'P0001','community_unavailable','Peer opt-out hides recent conversation');
select is((select jsonb_array_length(result->'threads') from public.community_messaging_rpc('threads','{}')),0,'Peer opt-out hides summary');
select lives_ok($$select * from public.community_messaging_rpc('listMine','{}')$$,'Owner management remains available after opt-out');
reset role;update public.community_messaging_preferences set enabled=true where user_id='51000000-0000-4000-8000-000000000002';
set local role authenticated;insert into public.community_blocks(blocker_user_id,blocked_user_id) values(auth.uid(),'51000000-0000-4000-8000-000000000002');
select throws_ok($$select * from public.community_messaging_rpc('latest','{"peerId":"51000000-0000-4000-8000-000000000002"}')$$,'P0001','community_unavailable','Block immediately hides recent conversation');
select is((select jsonb_array_length(result->'threads') from public.community_messaging_rpc('threads','{}')),0,'Blocked summary disappears');
reset role;
-- More than one full summary page, all sharing a timestamp. Output is bounded,
-- and paging is independent from the continued existence of the cursor row.
insert into auth.users(id,email) select ('53000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'reads-bulk-'||i||'@mizyun.test' from generate_series(1,32)i;
update public.profiles set birth_year=1990 where id::text like '53000000%';
insert into public.community_profiles(user_id,handle,display_name,terms_version,terms_accepted_at,adult_declared_at)
select ('53000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'reads_bulk_'||i,'Bulk '||i,'2026-09-30',now(),now() from generate_series(1,32)i;
insert into public.community_messaging_preferences(user_id,enabled,muted,generation) select user_id,true,false,1 from public.community_profiles where user_id::text like '53000000%';
insert into public.community_relationships(follower_user_id,target_user_id,status)
select '51000000-0000-4000-8000-000000000001'::uuid,user_id,'approved' from public.community_profiles where user_id::text like '53000000%'
union all select user_id,'51000000-0000-4000-8000-000000000001'::uuid,'approved' from public.community_profiles where user_id::text like '53000000%';
insert into public.community_messages(id,user_id,recipient_id,body,original_digest,sender_generation,recipient_generation,created_at)
select ('54000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'51000000-0000-4000-8000-000000000001',('53000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'bulk '||i,md5('bulk '||i),1,1,now()-interval '2 hours' from generate_series(1,32)i;
set local role authenticated;
insert into message_read_pages select 'threads',result from public.community_messaging_rpc('threads','{}');
select is((select jsonb_array_length(body->'threads') from message_read_pages where name='threads'),30,'Summary output is bounded to 30 real threads');
select is((select body->'threads'->0->'latestMessage'->>'text' from message_read_pages where name='threads'),'bulk 32','Equal-time summaries use UUID tie-breaker descending');
select is((select body->'nextBefore'->>'id' from message_read_pages where name='threads'),'54000000-0000-4000-8000-000000000003','Summary cursor is the last delivered tuple');
reset role;
delete from public.community_messages where id='54000000-0000-4000-8000-000000000003';
update public.community_profiles set generation=2 where user_id='53000000-0000-4000-8000-000000000001';
set local role authenticated;
insert into message_read_pages select 'threads_older',result from public.community_messaging_rpc('threads',jsonb_build_object('before',(select body->'nextBefore' from message_read_pages where name='threads')));
select is((select jsonb_array_length(body->'threads') from message_read_pages where name='threads_older'),1,'Removed summary cursor and peer-generation loss preserve authorized older paging');
select is((select body->'threads'->0->'latestMessage'->>'text' from message_read_pages where name='threads_older'),'bulk 2','Older summary excludes changed membership generation');
select ok((select body->'nextBefore'='null'::jsonb from message_read_pages where name='threads_older'),'Last summary page has no invented continuation');
reset role;
select * from finish();
rollback;
