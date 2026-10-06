-- One private, bounded JPEG per saved meal. Uploads never issue bearer tickets.
alter table public.food_entries add column photo_asset_id uuid references public.media_assets(id) on delete set null;
create table public.meal_photos (
 id uuid primary key references public.media_assets(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 food_entry_id uuid not null,
 operation_id uuid not null,
 digest text not null check (digest ~ '^[a-f0-9]{64}$'),
 state text not null check(state in ('uploading','ready','deleted')),
 width integer not null check(width between 1 and 640),
 height integer not null check(height between 1 and 640),
 created_at timestamptz not null default now(),
 unique(user_id,operation_id)
);
create unique index meal_photos_active_meal_idx on public.meal_photos(food_entry_id) where state<>'deleted';
create index meal_photos_user_idx on public.meal_photos(user_id,id);
create table public.meal_photo_cleanup_jobs (
 object_path text primary key,
 user_id uuid not null,
 created_at timestamptz not null default now()
);
create index meal_photo_cleanup_user_idx on public.meal_photo_cleanup_jobs(user_id);
alter table public.meal_photos enable row level security;
alter table public.meal_photo_cleanup_jobs enable row level security;
revoke all on public.meal_photos,public.meal_photo_cleanup_jobs from public,anon,authenticated;
grant select on public.meal_photos to authenticated;
grant all on public.meal_photos,public.meal_photo_cleanup_jobs to service_role;
create policy meal_photos_own_select on public.meal_photos for select to authenticated using(user_id=(select auth.uid()));

create function public.meal_photo_revoke(p_id uuid,p_clear_meal boolean default true) returns void language plpgsql security definer set search_path='' as $$
declare p public.meal_photos;begin
 perform 1 from public.food_entries where id=(select food_entry_id from public.meal_photos where id=p_id) for update;
 select * into p from public.meal_photos where id=p_id for update;
 if p.id is null then return;end if;
 update public.meal_photos set state='deleted' where id=p.id;
 if p_clear_meal then update public.food_entries set photo_asset_id=null where photo_asset_id=p.id;end if;
 update public.media_assets set deleted_at=coalesce(deleted_at,now()) where id=p.id;
 insert into public.meal_photo_cleanup_jobs(object_path,user_id) values(p.user_id::text||'/meal-photos/'||p.id::text||'.jpg',p.user_id) on conflict do nothing;
end $$;
revoke all on function public.meal_photo_revoke(uuid,boolean) from public,anon,authenticated;

create function public.meal_photo(p_operation text,p_args jsonb,p_user_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.food_entries;p public.meal_photos;new_id uuid;photo_owner_id uuid;begin
 if p_operation<>'get' and auth.role()<>'service_role' then raise exception 'meal_photo_not_found';end if;
 photo_owner_id:=case when auth.role()='service_role' then p_user_id else auth.uid() end;
 if photo_owner_id is null then raise exception 'meal_photo_not_found';end if;
 select * into m from public.food_entries where id=(p_args->>'mealId')::uuid and user_id=photo_owner_id for update;
 if m.id is null then raise exception 'meal_photo_not_found';end if;
 if exists(select 1 from public.account_deletion_jobs where user_id=photo_owner_id and status in ('in_progress','failed')) then raise exception 'meal_photo_unavailable';end if;
 if p_operation='begin' then
  select * into p from public.meal_photos where user_id=photo_owner_id and operation_id=(p_args->>'operationId')::uuid for update;
  if p.id is not null then
   if p.food_entry_id<>m.id or p.digest<>p_args->>'digest' or p.state='deleted' then raise exception 'meal_photo_conflict';end if;
  else
   if exists(select 1 from public.meal_photos where food_entry_id=m.id and state<>'deleted') then raise exception 'meal_photo_conflict';end if;
   new_id:=gen_random_uuid();
   insert into public.media_assets(id,user_id,object_path,purpose,mime_type,byte_size,width,height,metadata)
    values(new_id,photo_owner_id,photo_owner_id::text||'/meal-photos/'||new_id::text||'.jpg','food','image/jpeg',(p_args->>'byteSize')::integer,(p_args->>'width')::integer,(p_args->>'height')::integer,jsonb_build_object('mealId',m.id,'clientOperationId',p_args->>'operationId','inputDigest',p_args->>'digest'));
   insert into public.meal_photos(id,user_id,food_entry_id,operation_id,digest,state,width,height) values(new_id,photo_owner_id,m.id,(p_args->>'operationId')::uuid,p_args->>'digest','uploading',(p_args->>'width')::integer,(p_args->>'height')::integer) returning * into p;
  end if;
 elsif p_operation='commit' then
  select * into p from public.meal_photos where id=(p_args->>'assetId')::uuid and food_entry_id=m.id and user_id=photo_owner_id for update;
  if p.id is null or p.state='deleted' then raise exception 'meal_photo_conflict';end if;
  if not exists(select 1 from storage.objects where bucket_id='private-media' and name=photo_owner_id::text||'/meal-photos/'||p.id::text||'.jpg') then raise exception 'meal_photo_unavailable';end if;
  update public.meal_photos set state='ready' where id=p.id;
  update public.food_entries set photo_asset_id=p.id where id=m.id;
 elsif p_operation='get' then
  select * into p from public.meal_photos where food_entry_id=m.id and user_id=photo_owner_id and state='ready';
 elsif p_operation='remove' then
  for p in select * from public.meal_photos where food_entry_id=m.id and user_id=photo_owner_id and state<>'deleted' for update loop perform public.meal_photo_revoke(p.id);end loop;
  return 'null'::jsonb;
 else raise exception 'meal_photo_invalid_input';end if;
 if p.id is null then return 'null'::jsonb;end if;
 return jsonb_build_object('assetId',p.id,'width',p.width,'height',p.height,'state',p.state,'objectPath',p.user_id::text||'/meal-photos/'||p.id::text||'.jpg');
end $$;
revoke all on function public.meal_photo(text,jsonb,uuid) from public,anon;
grant execute on function public.meal_photo(text,jsonb,uuid) to authenticated,service_role;

-- A saved meal disappearing invalidates uploads, URLs and queues byte removal.
create function public.meal_photo_meal_delete() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.meal_photos;begin
 -- Auth cascade removes all photo/media rows; their own DELETE triggers queue bytes.
 if not exists(select 1 from auth.users where id=old.user_id) then return old;end if;
 for p in select * from public.meal_photos where food_entry_id=old.id and state<>'deleted' for update loop perform public.meal_photo_revoke(p.id,false);end loop;return old;
end $$;
create trigger meal_photo_meal_delete before delete on public.food_entries for each row execute function public.meal_photo_meal_delete();
create function public.meal_photo_asset_delete() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.meal_photos;begin
 if tg_op='UPDATE' and exists(select 1 from public.meal_photos where id=old.id) and (new.user_id<>old.user_id or new.bucket_id<>old.bucket_id or new.object_path<>old.object_path or new.purpose<>old.purpose or new.mime_type<>old.mime_type or new.byte_size<>old.byte_size or new.width<>old.width or new.height<>old.height) then raise exception 'meal_photo_conflict';end if;
 if tg_op='DELETE' or (old.deleted_at is null and new.deleted_at is not null) then
  select * into p from public.meal_photos where id=old.id for update;
  if p.id is not null then
   if exists(select 1 from auth.users where id=p.user_id) then
    update public.meal_photos set state='deleted' where id=p.id;
    if p.state<>'deleted' then update public.food_entries set photo_asset_id=null where photo_asset_id=p.id;end if;
   end if;
   insert into public.meal_photo_cleanup_jobs(object_path,user_id) values(p.user_id::text||'/meal-photos/'||p.id::text||'.jpg',p.user_id) on conflict do nothing;
  end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger meal_photo_asset_delete before delete or update on public.media_assets for each row execute function public.meal_photo_asset_delete();

-- Serialized against revocation. Prevents uploading into a deleted meal and
-- prevents rewrites of an already retained image, even from direct Storage calls.
create function public.meal_photo_storage_write() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.meal_photos;begin
 if tg_op='UPDATE' and old.bucket_id='private-media' and split_part(old.name,'/',2)='meal-photos' and (old.name<>new.name or old.bucket_id<>new.bucket_id) then raise exception 'meal_photo_conflict';end if;
 if new.bucket_id='private-media' and split_part(new.name,'/',2)='meal-photos' then
  select * into p from public.meal_photos where user_id::text||'/meal-photos/'||id::text||'.jpg'=new.name for update;
  if auth.role()<>'service_role' or p.id is null or p.state<>'uploading' or not exists(select 1 from public.food_entries where id=p.food_entry_id and user_id=p.user_id) or exists(select 1 from public.account_deletion_jobs where user_id=p.user_id and status in ('in_progress','failed')) then raise exception 'meal_photo_conflict';end if;
 end if;return new;
end $$;
create trigger meal_photo_storage_write before insert or update on storage.objects for each row execute function public.meal_photo_storage_write();
create policy meal_photo_storage_select on storage.objects as restrictive for select to authenticated using(
 bucket_id<>'private-media' or split_part(name,'/',2)<>'meal-photos' or exists(select 1 from public.meal_photos p where p.user_id=auth.uid() and p.state='ready' and name=p.user_id::text||'/meal-photos/'||p.id::text||'.jpg')
);
-- Guard typed association even when clients write directly through PostgREST.
create function public.meal_photo_association() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.photo_asset_id is not null and not exists(select 1 from public.meal_photos p where p.id=new.photo_asset_id and p.user_id=new.user_id and p.food_entry_id=new.id and p.state='ready') then raise exception 'meal_photo_invalid_input';end if;return new;
end $$;
create trigger meal_photo_association before insert or update on public.food_entries for each row execute function public.meal_photo_association();
-- Expired interrupted uploads retain cleanup authority across restarts/account cascades.
create function public.meal_photo_cleanup_pending() returns void language plpgsql security definer set search_path='' as $$declare p public.meal_photos;begin
 for p in select * from public.meal_photos where state='uploading' and created_at<now()-interval '1 hour' limit 100 loop perform public.meal_photo_revoke(p.id);end loop;
end $$;
revoke all on function public.meal_photo_cleanup_pending() from public,anon,authenticated;
grant execute on function public.meal_photo_cleanup_pending() to service_role;

create function public.meal_photo_link_delete() returns trigger language plpgsql security definer set search_path='' as $$begin
 insert into public.meal_photo_cleanup_jobs(object_path,user_id) values(old.user_id::text||'/meal-photos/'||old.id::text||'.jpg',old.user_id) on conflict do nothing;return old;
end $$;
create trigger meal_photo_link_delete before delete on public.meal_photos for each row execute function public.meal_photo_link_delete();
