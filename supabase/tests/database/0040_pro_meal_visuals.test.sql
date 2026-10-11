begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local request.jwt.claim.role='service_role';
set local request.jwt.claim.sub='';
select no_plan();
insert into auth.users(id,email) values
 ('f2400000-0000-4000-8000-000000000001','visual-free@mizyun.test'),
 ('f2400000-0000-4000-8000-000000000002','visual-paid@mizyun.test'),
 ('f2400000-0000-4000-8000-000000000003','visual-pass@mizyun.test');
update public.profiles set birth_year=1990,plan_tier=case when id='f2400000-0000-4000-8000-000000000002' then 'paid' else 'free' end where id::text like 'f2400000-%';
insert into public.beta_pro_requests(user_id,email,status) values('f2400000-0000-4000-8000-000000000003','visual-pass@mizyun.test','approved');
insert into public.user_ai_consents(user_id,granted,confirmed_adult,consent_version)
 select id,true,true,'2026-09-08' from auth.users where id::text like 'f2400000-%';
insert into public.food_entries(id,user_id,name,consumed_at) values
 ('a2400000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000001','Toast',now()),
 ('a2400000-0000-4000-8000-000000000002','f2400000-0000-4000-8000-000000000002','Soup',now()),
 ('a2400000-0000-4000-8000-000000000003','f2400000-0000-4000-8000-000000000003','Rice',now());
select is(public.meal_visuals_pro('f2400000-0000-4000-8000-000000000001'),false,'Free has no meal visuals');
select is(public.meal_visuals_pro('f2400000-0000-4000-8000-000000000002'),true,'Paid profile has meal visuals');
select is(public.meal_visuals_pro('f2400000-0000-4000-8000-000000000003'),true,'Approved existing pass has meal visuals without paid profile');
select ok(not has_function_privilege('authenticated','public.meal_photo_without_pro(text,jsonb,uuid)','EXECUTE'),'Old photo implementation cannot bypass Pro wrapper');
select ok(not has_function_privilege('service_role','public.meal_illustration_authorized_without_pro(uuid,text)','EXECUTE'),'Base AI admission is not an exposed bypass');
select is((select count(*) from public.meal_illustration_claim('f2400000-0000-4000-8000-000000000001',repeat('a',64),'2026-09-08','a2400000-0000-4000-8000-000000000001')),0::bigint,'Free cannot reserve generation');
select is((select count(*) from public.meal_illustration_user_usage where user_id='f2400000-0000-4000-8000-000000000001'),0::bigint,'Denied Free request never charges budget');
select is((select claimed from public.meal_illustration_claim('f2400000-0000-4000-8000-000000000002',repeat('b',64),'2026-09-08','a2400000-0000-4000-8000-000000000002')),true,'Paid can reserve generation');
select is((select claimed from public.meal_illustration_claim('f2400000-0000-4000-8000-000000000003',repeat('c',64),'2026-09-08','a2400000-0000-4000-8000-000000000003')),true,'Approved pass can reserve own generation');
select public.meal_illustration_complete('f2400000-0000-4000-8000-000000000002',(select id from public.meal_illustrations where user_id='f2400000-0000-4000-8000-000000000002'),'AQIDBA==','2026-09-08');
update public.beta_pro_requests set status='rejected' where user_id='f2400000-0000-4000-8000-000000000003';
select public.meal_illustration_complete('f2400000-0000-4000-8000-000000000003',(select id from public.meal_illustrations where user_id='f2400000-0000-4000-8000-000000000003'),'AQIDBA==','2026-09-08');
select is((select state from public.meal_illustrations where user_id='f2400000-0000-4000-8000-000000000003'),'failed','Revoked pass blocks late generation completion');
create temp table visual_photo(value jsonb);grant all on visual_photo to authenticated,service_role;
select throws_ok($$select public.meal_photo('begin',jsonb_build_object('mealId','a2400000-0000-4000-8000-000000000001','operationId','d2400000-0000-4000-8000-000000000001','digest',repeat('a',64),'width',10,'height',10,'byteSize',100),'f2400000-0000-4000-8000-000000000001')$$,'P0001','meal_photo_unavailable','Free cannot save retained photos even with trusted mutation transport');
insert into visual_photo select public.meal_photo('begin',jsonb_build_object('mealId','a2400000-0000-4000-8000-000000000002','operationId','d2400000-0000-4000-8000-000000000002','digest',repeat('a',64),'width',10,'height',10,'byteSize',100),'f2400000-0000-4000-8000-000000000002');
insert into storage.objects(bucket_id,name) select 'private-media',value->>'objectPath' from visual_photo;
select public.meal_photo('commit',jsonb_build_object('mealId','a2400000-0000-4000-8000-000000000002','assetId',(select value->>'assetId' from visual_photo)),'f2400000-0000-4000-8000-000000000002');
insert into public.media_assets(id,user_id,object_path,purpose,mime_type,byte_size) values('b2400000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000002','f2400000-0000-4000-8000-000000000002/b2400000-0000-4000-8000-000000000001.jpg','food','image/jpeg',100);
insert into storage.objects(bucket_id,name) values('private-media','f2400000-0000-4000-8000-000000000002/b2400000-0000-4000-8000-000000000001.jpg');
-- Model older client-admitted coordinates; the new admission guard stays enabled for all assertions.
alter table public.media_assets disable trigger food_media_pro_write;
insert into public.media_assets(id,user_id,object_path,purpose,mime_type,byte_size) values
 ('b2400000-0000-4000-8000-000000000021','f2400000-0000-4000-8000-000000000002','f2400000-0000-4000-8000-000000000002/custom-food.jpg','food','image/jpeg',100),
 ('b2400000-0000-4000-8000-000000000022','f2400000-0000-4000-8000-000000000002','f2400000-0000-4000-8000-000000000002/../peer/private.jpg','food','image/jpeg',100),
 ('b2400000-0000-4000-8000-000000000023','f2400000-0000-4000-8000-000000000002','f2400000-0000-4000-8000-000000000001/custom-profile.jpg','food','image/jpeg',100);
alter table public.media_assets enable trigger food_media_pro_write;
insert into storage.objects(bucket_id,name) values('private-media','f2400000-0000-4000-8000-000000000002/custom-food.jpg');
select lives_ok($$insert into storage.objects(bucket_id,name) values('private-media','f2400000-0000-4000-8000-000000000001/custom-profile.jpg')$$,'Misowned legacy food metadata cannot poison another owner nonfood upload');
set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='f2400000-0000-4000-8000-000000000001';
select is((select count(*) from storage.objects where name=auth.uid()::text||'/custom-profile.jpg'),1::bigint,'Free correct owner can read nonfood object despite foreign legacy metadata');
reset role;set local request.jwt.claim.role='service_role';set local request.jwt.claim.sub='';
select lives_ok($$update storage.objects set name='f2400000-0000-4000-8000-000000000001/custom-profile-renamed.jpg' where name='f2400000-0000-4000-8000-000000000001/custom-profile.jpg'$$,'Foreign legacy metadata cannot block correct nonfood object movement');
select lives_ok($$update public.media_assets set deleted_at=now() where id='b2400000-0000-4000-8000-000000000023'$$,'Foreign legacy metadata remains erasable without poisoning another owner ledger');
select is((select count(*) from public.food_media_paths where path_key=public.food_media_path_key('f2400000-0000-4000-8000-000000000001/custom-profile.jpg')),0::bigint,'Soft-deleting misowned legacy metadata never classifies another owner path');
select throws_ok($$update storage.objects set name='f2400000-0000-4000-8000-000000000002/escaped.jpg' where name='f2400000-0000-4000-8000-000000000002/b2400000-0000-4000-8000-000000000001.jpg'$$,'P0001','meal_photo_conflict','Generic food object cannot move outside its classification');
-- Commit stores a photo and invalidates that meal's illustration; use another owned source for cache read regression.
insert into public.food_entries(id,user_id,name,consumed_at) values('a2400000-0000-4000-8000-000000000004','f2400000-0000-4000-8000-000000000002','Bread',now());
select lives_ok($$select * from public.meal_illustration_claim('f2400000-0000-4000-8000-000000000002',repeat('d',64),'2026-09-08','a2400000-0000-4000-8000-000000000004')$$,'Paid cache remains independently scoped');
select public.meal_illustration_complete('f2400000-0000-4000-8000-000000000002',(select id from public.meal_illustrations where user_id='f2400000-0000-4000-8000-000000000002'),'AQIDBA==','2026-09-08');
set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='f2400000-0000-4000-8000-000000000002';
select is((select count(*) from public.meal_photos),1::bigint,'Paid owner reads retained photo metadata');
select is((select count(*) from public.meal_illustrations),1::bigint,'Paid owner reads private generated bytes');
select is((select count(*) from storage.objects where name=(select value->>'objectPath' from visual_photo)),1::bigint,'Paid owner has direct private Storage read');
select is((select count(*) from storage.objects where name=auth.uid()::text||'/custom-food.jpg'),1::bigint,'Paid owner reads safe legacy registered food without a ledger backfill');
select throws_ok($$insert into public.media_assets(user_id,object_path,purpose,mime_type,byte_size) values(auth.uid(),auth.uid()::text||'/../peer/private.jpg','food','image/jpeg',100)$$,'P0001','meal_photo_conflict','Owner cannot register literal traversal for privileged export');
select throws_ok($$insert into public.media_assets(user_id,object_path,purpose,mime_type,byte_size) values(auth.uid(),auth.uid()::text||'/%2e%2e/peer/private.jpg','food','image/jpeg',100)$$,'P0001','meal_photo_conflict','Owner cannot register encoded traversal for privileged export');
select throws_ok($$update public.profiles set plan_tier='paid' where id=auth.uid()$$,'42501',null,'Client cannot forge paid tier');
reset role;set local request.jwt.claim.role='service_role';set local request.jwt.claim.sub='';
update public.profiles set plan_tier='free' where id='f2400000-0000-4000-8000-000000000002';
select is((select count(*) from public.meal_photos where user_id='f2400000-0000-4000-8000-000000000002' and state='ready'),1::bigint,'Downgrade keeps retained photo');
select is((select count(*) from public.meal_illustrations where user_id='f2400000-0000-4000-8000-000000000002' and image_base64 is not null),1::bigint,'Owner-scoped service export retains generated bytes after downgrade');
set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='f2400000-0000-4000-8000-000000000002';
select is((select count(*) from public.meal_photos),0::bigint,'Downgrade hides direct photo table read');
select is((select count(*) from public.meal_illustrations),0::bigint,'Downgrade hides direct generated bytes');
select is((select count(*) from storage.objects where name=(select value->>'objectPath' from visual_photo)),0::bigint,'Downgrade blocks direct download/signing lookup');
select is((select count(*) from storage.objects where name=auth.uid()::text||'/custom-food.jpg'),0::bigint,'Legacy food classification still denies Free Storage read without ledger');
select ok((select count(*) from public.food_media_paths where user_id=auth.uid())>0,'Free owner retains access to technical classification for private export');
select is((select count(*) from public.food_media_paths where user_id='f2400000-0000-4000-8000-000000000001'),0::bigint,'Technical classification is isolated from another owner');
select throws_ok($$insert into public.food_media_paths(path_key,user_id) values(repeat('e',64),auth.uid())$$,'42501',null,'Client cannot forge technical classification');
select lives_ok($$update public.media_assets set deleted_at=now() where id='b2400000-0000-4000-8000-000000000021'$$,'Free can soft-delete unchanged safe legacy food metadata');
select lives_ok($$update public.media_assets set deleted_at=now() where id='b2400000-0000-4000-8000-000000000022'$$,'Free can soft-delete unchanged unsafe legacy metadata without privileged Storage IO');
select lives_ok($$delete from public.media_assets where id='b2400000-0000-4000-8000-000000000022'$$,'Unsafe legacy metadata remains erasable');
select throws_ok($$select public.meal_photo('get','{"mealId":"a2400000-0000-4000-8000-000000000002"}')$$,'P0001','meal_photo_unavailable','Downgrade blocks direct RPC photo read');
select lives_ok($$update public.food_entries set name='Edited saved food facts' where id='a2400000-0000-4000-8000-000000000002'$$,'Downgrade preserves ordinary edit with unchanged retained photo');
select lives_ok($$update public.food_entries set photo_asset_id=null where id='a2400000-0000-4000-8000-000000000002'$$,'Downgrade can clear retained association');
select throws_ok($$update public.food_entries set photo_asset_id=(select (value->>'assetId')::uuid from visual_photo) where id='a2400000-0000-4000-8000-000000000002'$$,'P0001','meal_photo_unavailable','Free cannot reattach saved photo through direct Data API');
select throws_ok($$insert into public.media_assets(user_id,object_path,purpose,mime_type,byte_size) values(auth.uid(),auth.uid()::text||'/b2400000-0000-4000-8000-000000000001.jpg','food','image/jpeg',100)$$,'P0001','meal_photo_unavailable','Generic food media metadata cannot bypass retention access');
select is((select count(*) from storage.objects where name='f2400000-0000-4000-8000-000000000002/b2400000-0000-4000-8000-000000000001.jpg'),0::bigint,'Free cannot directly sign registered generic food bytes');
select throws_ok($$update public.media_assets set purpose='profile' where id='b2400000-0000-4000-8000-000000000001'$$,'P0001','meal_photo_conflict','Reclassification cannot unlock food bytes after downgrade');
select lives_ok($$delete from public.media_assets where id='b2400000-0000-4000-8000-000000000001'$$,'Owner can erase food metadata after downgrade');
select throws_ok($$insert into public.media_assets(id,user_id,object_path,purpose,mime_type,byte_size) values('b2400000-0000-4000-8000-000000000002',auth.uid(),auth.uid()::text||'/b2400000-0000-4000-8000-000000000001.jpg','profile','image/jpeg',100)$$,'P0001','meal_photo_conflict','Classification survives deleted metadata and prevents relabel');
select is((select count(*) from storage.objects where name='f2400000-0000-4000-8000-000000000002/b2400000-0000-4000-8000-000000000001.jpg'),0::bigint,'Delete and relabel cannot unlock queued food bytes');
reset role;set local request.jwt.claim.role='service_role';set local request.jwt.claim.sub='';
select is((select count(*) from public.meal_photo_cleanup_jobs where object_path like '%/../peer/private.jpg'),0::bigint,'Unsafe legacy traversal never becomes a privileged cleanup coordinate');
set local storage.allow_delete_query='true';
delete from storage.objects where name='f2400000-0000-4000-8000-000000000002/b2400000-0000-4000-8000-000000000001.jpg';
set local storage.allow_delete_query='false';
delete from public.meal_photo_cleanup_jobs where object_path='f2400000-0000-4000-8000-000000000002/b2400000-0000-4000-8000-000000000001.jpg';
select is((select count(*) from public.food_media_paths where path_key=public.food_media_path_key('f2400000-0000-4000-8000-000000000002/b2400000-0000-4000-8000-000000000001.jpg')),1::bigint,'Food classification survives completed byte cleanup');
select throws_ok($$insert into storage.objects(bucket_id,name) values('private-media','f2400000-0000-4000-8000-000000000002/b2400000-0000-4000-8000-000000000001.jpg')$$,'P0001','meal_photo_unavailable','Old generic upload ticket cannot restore erased food after cleanup');
select lives_ok($$select public.meal_photo('remove','{"mealId":"a2400000-0000-4000-8000-000000000002"}','f2400000-0000-4000-8000-000000000002')$$,'Downgrade preserves owner photo erasure');
select is((select count(*) from public.meal_photo_cleanup_jobs where user_id='f2400000-0000-4000-8000-000000000002' and object_path like '%/meal-photos/%'),1::bigint,'Erasure keeps durable byte cleanup authority for retained food');
-- Upload admitted as paid, downgrade before Storage insertion/commit.
update public.profiles set plan_tier='paid' where id='f2400000-0000-4000-8000-000000000001';
delete from visual_photo;
insert into visual_photo select public.meal_photo('begin',jsonb_build_object('mealId','a2400000-0000-4000-8000-000000000001','operationId','d2400000-0000-4000-8000-000000000011','digest',repeat('a',64),'width',10,'height',10,'byteSize',100),'f2400000-0000-4000-8000-000000000001');
update public.profiles set plan_tier='free' where id='f2400000-0000-4000-8000-000000000001';
select throws_ok($$insert into storage.objects(bucket_id,name) select 'private-media',value->>'objectPath' from visual_photo$$,'P0001','meal_photo_conflict','Downgrade blocks even late service Storage upload');
select throws_ok($$select public.meal_photo('commit',jsonb_build_object('mealId','a2400000-0000-4000-8000-000000000001','assetId',(select value->>'assetId' from visual_photo)),'f2400000-0000-4000-8000-000000000001')$$,'P0001','meal_photo_unavailable','Downgrade blocks late photo commit');
select lives_ok($$delete from public.food_entries where id='a2400000-0000-4000-8000-000000000001'$$,'Free meal deletion still revokes pending photo');
select lives_ok($$delete from auth.users where id='f2400000-0000-4000-8000-000000000002'$$,'Downgraded account erasure still cascades private artwork');
select is((select count(*) from public.meal_illustrations where user_id='f2400000-0000-4000-8000-000000000002'),0::bigint,'Account erase removes retained generated bytes');
select is((select count(*) from public.food_media_paths where user_id='f2400000-0000-4000-8000-000000000002'),0::bigint,'Account erase cascades owner technical classification');
select throws_ok($$insert into storage.objects(bucket_id,name) values('private-media','f2400000-0000-4000-8000-000000000002/b2400000-0000-4000-8000-000000000001.jpg')$$,'P0001','meal_photo_conflict','Erased Auth owner cannot replay a remaining generic bearer ticket');
select * from finish();
rollback;
