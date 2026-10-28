begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local request.jwt.claim.role='service_role';
set local request.jwt.claim.sub='';
set local storage.allow_delete_query='true';
select no_plan();
insert into auth.users(id,email) values
 ('f2560000-0000-4000-8000-000000000001','quota-a@mizyun.test'),
 ('f2560000-0000-4000-8000-000000000002','quota-b@mizyun.test');

select is((select max_objects from public.private_media_quota()),10000::bigint,'Default object quota is generous');
select is((select max_bytes from public.private_media_quota()),3221225472::bigint,'Default byte quota is 3 GiB');
select ok(not has_table_privilege('authenticated','public.private_media_quota_settings','SELECT,INSERT,UPDATE,DELETE'),'Clients cannot read or change quota settings');
select ok(not has_function_privilege('authenticated','public.private_media_usage(uuid,text[])','EXECUTE'),'Clients cannot read another owner usage');
select ok(not has_function_privilege('anon','public.private_media_quota_check(bigint)','EXECUTE'),'Anonymous callers cannot probe quota');
select ok(has_function_privilege('authenticated','public.private_media_quota_check(bigint)','EXECUTE'),'Signed-in owners can pre-check quota');

-- Small limits keep the assertions fast; the trigger reads the same row.
update public.private_media_quota_settings set max_objects=3,max_bytes=1000;

-- Storage models: a client upload first runs a rolled-back permission test as
-- the caller ({mimetype, contentLength}, no size); the final row, with the
-- real size, is upserted as service_role (standard, signed and TUS uploads).
reset role;set local request.jwt.claim.role='service_role';set local request.jwt.claim.sub='';
select lives_ok($$insert into storage.objects(bucket_id,name,metadata) values('private-media','f2560000-0000-4000-8000-000000000001/a1.jpg','{"size":600}')$$,'Upload under quota succeeds');
set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='f2560000-0000-4000-8000-000000000001';
select is((select allowed from public.private_media_quota_check(400)),true,'Pre-check allows an object that exactly fills the byte quota');
select is((select allowed from public.private_media_quota_check(401)),false,'Pre-check refuses an object over the byte quota');
select lives_ok($$insert into storage.objects(bucket_id,name,metadata) values('private-media','f2560000-0000-4000-8000-000000000001/a2.jpg','{"mimetype":"image/jpeg","contentLength":1}')$$,'Direct upload permission test counts one object');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) values('private-media','f2560000-0000-4000-8000-000000000001/copy.jpg','{"size":0,"mimetype":"image/jpeg"}')$$,'P0001','storage_copy_unavailable','Client copy test with an overridable size is refused');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) values('private-media','f2560000-0000-4000-8000-000000000001/copy2.jpg','{"size":600,"mimetype":"image/jpeg"}')$$,'P0001','storage_copy_unavailable','Client copy test with the source size is also refused');
reset role;set local request.jwt.claim.role='service_role';set local request.jwt.claim.sub='';
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) values('private-media','f2560000-0000-4000-8000-000000000001/a2.jpg','{"size":401}') on conflict (bucket_id,name) do update set metadata=excluded.metadata$$,'P0001','storage_quota_exceeded','Completing an upload over the byte quota is rejected');
select lives_ok($$insert into storage.objects(bucket_id,name,metadata) values('private-media','f2560000-0000-4000-8000-000000000001/a2.jpg','{"size":400}') on conflict (bucket_id,name) do update set metadata=excluded.metadata$$,'Upsert that exactly fills the byte quota does not double count');
select throws_ok($$update storage.objects set metadata='{"size":401}' where name='f2560000-0000-4000-8000-000000000001/a2.jpg'$$,'P0001','storage_quota_exceeded','Growing an object past the byte quota is rejected');
select lives_ok($$update storage.objects set metadata='{"size":10}',last_accessed_at=now() where name='f2560000-0000-4000-8000-000000000001/a2.jpg'$$,'Shrinking an existing object is always allowed');
select lives_ok($$insert into storage.objects(bucket_id,name,metadata) values('private-media','f2560000-0000-4000-8000-000000000001/a3.jpg','{"size":1}')$$,'Third object fills the object quota');
set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='f2560000-0000-4000-8000-000000000001';
select is((select allowed from public.private_media_quota_check(0)),false,'Pre-check refuses one object over the count quota');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) values('private-media','f2560000-0000-4000-8000-000000000001/a4.jpg','{"mimetype":"image/jpeg","contentLength":1}')$$,'P0001','storage_quota_exceeded','Direct upload permission test fails at the count quota');
select lives_ok($$update storage.objects set name='f2560000-0000-4000-8000-000000000001/a3-renamed.jpg' where name='f2560000-0000-4000-8000-000000000001/a3.jpg'$$,'Renaming within the owner folder does not double count');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) values('private-media','f2560000-0000-4000-8000-000000000002/planted.jpg','{"mimetype":"image/jpeg","contentLength":1}')$$,'42501',null,'Owner still cannot write into another owner folder');

-- Owner B is isolated from A's usage.
set local request.jwt.claim.sub='f2560000-0000-4000-8000-000000000002';
select is((select allowed from public.private_media_quota_check(1000)),true,'Another owner sees only their own usage');
select lives_ok($$insert into storage.objects(bucket_id,name,metadata) values('private-media','f2560000-0000-4000-8000-000000000002/b1.jpg','{"mimetype":"image/jpeg","contentLength":1}')$$,'Another owner passes the permission test');
select is((select count(*) from storage.objects where name like 'f2560000-0000-4000-8000-000000000001/%'),0::bigint,'Another owner cannot see A objects');

-- Final service-role writes (signed uploads, API meal photos) are bounded per owner.
reset role;set local request.jwt.claim.role='service_role';set local request.jwt.claim.sub='';
update storage.objects set metadata='{"size":1000}' where name='f2560000-0000-4000-8000-000000000002/b1.jpg';
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) values('private-media','f2560000-0000-4000-8000-000000000001/signed.jpg','{"size":1}')$$,'P0001','storage_quota_exceeded','Service-role signed upload is bounded by the owner count quota');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) values('private-media','f2560000-0000-4000-8000-000000000002/b2.jpg','{"size":1}')$$,'P0001','storage_quota_exceeded','Service-role write over the byte quota is rejected');
update public.private_media_quota_settings set max_objects=1,max_bytes=10;
select lives_ok($$update storage.objects set last_accessed_at=now() where name='f2560000-0000-4000-8000-000000000001/a1.jpg'$$,'An owner over a lowered quota can still refresh objects');
set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='f2560000-0000-4000-8000-000000000001';
select is((select count(*) from storage.objects where name like 'f2560000-0000-4000-8000-000000000001/%'),3::bigint,'An owner over a lowered quota can still read objects');
select throws_ok($$update storage.objects set metadata=metadata||'{"size":0}' where name='f2560000-0000-4000-8000-000000000001/a1.jpg'$$,'P0001','storage_copy_unavailable','A client cannot under-report an object size');
select lives_ok($$update storage.objects set last_accessed_at=now() where name='f2560000-0000-4000-8000-000000000001/a1.jpg'$$,'A client metadata-preserving update is not a size change');
reset role;set local request.jwt.claim.role='service_role';set local request.jwt.claim.sub='';
update public.private_media_quota_settings set max_objects=3,max_bytes=1000;
select lives_ok($$insert into storage.objects(bucket_id,name,metadata) values('community-media','quarantine/f2560000-0000-4000-8000-000000000009/image.jpg','{"size":5000}')$$,'Community media keeps its own server-side bounds');

-- Deleting frees quota, even for an owner above a lowered quota.
update public.private_media_quota_settings set max_objects=1;
select lives_ok($$delete from storage.objects where name='f2560000-0000-4000-8000-000000000001/a1.jpg'$$,'Over-quota owner objects remain deletable');
update public.private_media_quota_settings set max_objects=3;
set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='f2560000-0000-4000-8000-000000000001';
select is((select allowed from public.private_media_quota_check(500)),true,'Deleting an object frees count and bytes');
reset role;set local request.jwt.claim.role='service_role';set local request.jwt.claim.sub='';
select lives_ok($$insert into storage.objects(bucket_id,name,metadata) values('private-media','f2560000-0000-4000-8000-000000000001/a5.jpg','{"size":500}')$$,'Upload succeeds after freeing quota');

-- A missing settings row fails closed.
reset role;set local request.jwt.claim.role='service_role';
delete from public.private_media_quota_settings;
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) values('private-media','f2560000-0000-4000-8000-000000000002/c.jpg','{"size":0}')$$,'P0001','storage_quota_exceeded','Missing quota settings reject uploads');
set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='f2560000-0000-4000-8000-000000000002';
select is((select allowed from public.private_media_quota_check(0)),false,'Missing quota settings refuse pre-check');
reset role;set local request.jwt.claim.role='anon';set local request.jwt.claim.sub='';
select throws_ok($$select public.private_media_quota_check(0)$$,'P0001','storage_quota_access_denied','Pre-check requires a signed-in owner');
select * from finish();
rollback;
