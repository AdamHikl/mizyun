begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
update public.community_operations set enabled=true,enrollment=true,discovery=true,publish=true,engagement=true,delivery=false,cohort_required=false;
update public.community_feature_controls set enabled=true;
set local request.jwt.claim.role='service_role';
insert into auth.users(id,email) select ('c4100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'privacy-reduction-'||n||'@mizyun.test' from generate_series(1,2)n;
update public.profiles set birth_year=1990 where id::text like 'c4100000-%';
insert into public.community_profiles(user_id,handle,display_name,status,terms_version,terms_accepted_at,adult_declared_at)
select id,'privacy_'||right(id::text,12),'Synthetic member','active','2026-09-30',now(),now() from auth.users where id::text like 'c4100000-%';
insert into public.workouts(id,user_id,name,started_at,completed_at,details)
select ('d4100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('c4100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic private workout',now(),now(),'{}' from generate_series(1,2)n;
insert into public.shared_activities(id,user_id,source_workout_id,shared_day,enrollment_generation,workout_details)
select ('a4100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('c4100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('d4100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'2026-10-11',1,'{"exercises":[]}' from generate_series(1,2)n;
insert into public.community_comment_settings(activity_id,user_id,enabled)
select id,user_id,true from public.shared_activities where id::text like 'a4100000-%';
insert into public.community_groups(id,user_id,created_by,operation_id,name,rules)
values('b4100000-0000-4000-8000-000000000001','c4100000-0000-4000-8000-000000000002','c4100000-0000-4000-8000-000000000002','b4100000-0000-4000-8000-000000000002','Private foreign group','Synthetic rules');
insert into public.community_challenges(id,user_id,group_id,title,start_day,end_day,timezone,goal_days)
select ('b4100000-0000-4000-8000-'||lpad((n+2)::text,12,'0'))::uuid,'c4100000-0000-4000-8000-000000000002','b4100000-0000-4000-8000-000000000001','Private foreign challenge','2026-10-11','2026-10-12','UTC',1 from generate_series(1,2)n;
insert into public.community_challenge_members(user_id,challenge_id,generation)
select 'c4100000-0000-4000-8000-000000000001',id,1 from public.community_challenges where id::text like 'b4100000-%';
insert into public.community_challenge_members(user_id,challenge_id,generation)
values('c4100000-0000-4000-8000-000000000002','b4100000-0000-4000-8000-000000000003',1);

set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='c4100000-0000-4000-8000-000000000001';
select is((select count(*) from public.community_export_page('challenges')),0::bigint,'Participant owns no challenge and need not make a contribution');
select is((select count(*) from public.community_export_page('challengeMemberships')),2::bigint,'Export includes own joined challenge consent even without contributions');
select ok((select bool_and(not item ?| array['userId','user_id','title','participants','groupId']) from public.community_export_page('challengeMemberships')),'Membership export excludes other participant identities and private challenge payload');
select is((select count(*) from public.community_export_page('challengeMemberships',null,1)),1::bigint,'Membership export bounds each page');
select is((select count(*) from public.community_export_page('challengeMemberships',(select min(item_key) from public.community_export_page('challengeMemberships')),1)),1::bigint,'Membership keyset reaches the remaining row');
select is((select count(*) from public.community_export_page('commentSettings')),1::bigint,'Own comment setting export excludes foreign owner settings');
select is((select item->>'activityId' from public.community_export_page('commentSettings')),'a4100000-0000-4000-8000-000000000001','Comment setting export identifies only caller-owned activity');
select ok((select item-'activityId'-'enabled'='{}'::jsonb from public.community_export_page('commentSettings')),'Comment setting export has only the declared sanitized fields');
select is((select count(*) from public.community_export_page('commentSettings','a4100000-0000-4000-8000-000000000001',1)),0::bigint,'Comment setting cursor cannot repeat prior row');
select throws_ok($$select * from public.community_export_page('commentSettings',null,501)$$,'P0001','community_access_denied','New export wrapper rejects unbounded reads');
select ok(not has_function_privilege('authenticated','public.community_export_page_before_privacy_reductions(text,text,integer)','EXECUTE'),'Caller cannot bypass new export wrapper');
select ok(not has_function_privilege('authenticated','public.community_capture_privacy_reduction()','EXECUTE'),'Caller cannot invoke reduction capture');
select ok(not has_function_privilege('service_role','public.community_revocation_replay_before_privacy_reductions(jsonb)','EXECUTE'),'Worker cannot bypass extended replay validation');
reset role;set local request.jwt.claim.role='service_role';

-- Editing a live projection to a summary is a reduction, not an unpublish.
update public.shared_activities set workout_details=null,version=version+1 where id='a4100000-0000-4000-8000-000000000001';
select is((select count(*) from public.community_revocation_events where kind='activity' and target_id='a4100000-0000-4000-8000-000000000001' and generation=1),1::bigint,'Detailed to summary sharing emits a scoped artifact reduction');
select ok((select revoked_at is null from public.shared_activities where id='a4100000-0000-4000-8000-000000000001'),'Capture preserves live summary share behavior');
update public.shared_activities set version=version+1 where id='a4100000-0000-4000-8000-000000000001';
select is((select count(*) from public.community_revocation_events where kind='activity' and target_id='a4100000-0000-4000-8000-000000000001'),1::bigint,'No-op content/version change creates no reduction event');
insert into public.community_comments(id,activity_id,user_id,body,generation)
values('a4100000-0000-4000-8000-000000000003','a4100000-0000-4000-8000-000000000001','c4100000-0000-4000-8000-000000000001','Synthetic original comment',1);
update public.community_comments set body='Synthetic replacement comment',version=version+1 where id='a4100000-0000-4000-8000-000000000003';
select is((select count(*) from public.community_revocation_events where kind='comment' and target_id='a4100000-0000-4000-8000-000000000003' and generation=1),1::bigint,'Edited-away comment text emits a content-free reduction');
insert into public.community_messages(id,user_id,recipient_id,body,original_digest,sender_generation,recipient_generation)
values('a4100000-0000-4000-8000-000000000004','c4100000-0000-4000-8000-000000000001','c4100000-0000-4000-8000-000000000002','Synthetic original message',repeat('a',64),1,1);
update public.community_messages set body='Synthetic replacement message',version=version+1 where id='a4100000-0000-4000-8000-000000000004';
select is((select count(*) from public.community_revocation_events where kind='message' and target_id='a4100000-0000-4000-8000-000000000004' and generation=1),1::bigint,'Edited-away message text emits a sender-generation reduction');
insert into public.community_mutes(user_id,target_user_id) values('c4100000-0000-4000-8000-000000000001','c4100000-0000-4000-8000-000000000002');
select is((select count(*) from public.community_revocation_events where kind='mute' and user_id='c4100000-0000-4000-8000-000000000001' and generation=1 and related_user_id='c4100000-0000-4000-8000-000000000002'),1::bigint,'Mute addition records recipient preference and concrete generation');
insert into public.community_comment_preferences(user_id,allow_mentions) values('c4100000-0000-4000-8000-000000000001',true);
update public.community_comment_preferences set allow_mentions=false where user_id='c4100000-0000-4000-8000-000000000001';
select is((select count(*) from public.community_revocation_events where kind='mention_optout' and user_id='c4100000-0000-4000-8000-000000000001' and generation=1),1::bigint,'Mention consent narrowing records recipient-generation barrier');
update public.community_comment_settings set enabled=false where activity_id='a4100000-0000-4000-8000-000000000001';
select is((select count(*) from public.community_revocation_events where kind='comment_setting_optout' and target_id='a4100000-0000-4000-8000-000000000001' and generation=1),1::bigint,'Per-card comment disabling records exact owned artifact');
insert into public.community_notification_preferences(user_id,requests,reactions,moderation,muted)
values('c4100000-0000-4000-8000-000000000001',false,true,true,false);
select is((select count(*) from public.community_revocation_events where kind='notification_optout' and user_id='c4100000-0000-4000-8000-000000000001' and generation=1),1::bigint,'Initial saved delivery opt-out narrows enabled defaults');
update public.community_notification_preferences set quiet_start=60,quiet_end=120 where user_id='c4100000-0000-4000-8000-000000000001';
select is((select count(*) from public.community_revocation_events where kind='notification_optout' and user_id='c4100000-0000-4000-8000-000000000001'),2::bigint,'Quiet-hour addition records conservative delivery reduction');
update public.community_notification_preferences set requests=true,quiet_start=null,quiet_end=null where user_id='c4100000-0000-4000-8000-000000000001';
select is((select count(*) from public.community_revocation_events where kind='notification_optout' and user_id='c4100000-0000-4000-8000-000000000001'),2::bigint,'Pure preference widening creates no reduction event');
select throws_ok($$select public.community_revocation_replay('[]')$$,'P0001','community_restore_quarantine_required','Extended replay remains denied on live/default database');
select * from finish();rollback;
