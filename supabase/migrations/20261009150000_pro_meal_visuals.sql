-- Pro meal display/retention; downgrade preserves owner export and erasure.
-- Existing approved Beta/Launch Pass and server-owned paid tier are the authority.
create function public.meal_visuals_pro(p_user_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare tier text; pass_status text;
begin
 if auth.role()='authenticated' and p_user_id is distinct from auth.uid() then return false;end if;
 select status into pass_status from public.beta_pro_requests where user_id=p_user_id for share;
 -- Match the existing approval/revocation trigger's beta-row -> profile lock order.
 select plan_tier into tier from public.profiles where id=p_user_id for share;
 return coalesce(tier='paid' or pass_status='approved',false);
end $$;
revoke all on function public.meal_visuals_pro(uuid) from public,anon;
grant execute on function public.meal_visuals_pro(uuid) to authenticated,service_role;

create function public.food_media_path_key(p_path text) returns text
language sql immutable strict set search_path='' as $$select encode(extensions.digest(p_path,'sha256'),'hex')$$;
revoke all on function public.food_media_path_key(text) from public,anon;
grant execute on function public.food_media_path_key(text) to authenticated,service_role;

-- Classification survives byte cleanup and metadata deletion while the owner exists.
create table public.food_media_paths (
 path_key text primary key check(path_key ~ '^[a-f0-9]{64}$'),
 user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
create index food_media_paths_user_idx on public.food_media_paths(user_id);
alter table public.food_media_paths enable row level security;
revoke all on public.food_media_paths from public,anon,authenticated;
grant select on public.food_media_paths to authenticated;
grant all on public.food_media_paths to service_role;
create policy food_media_paths_owner on public.food_media_paths for select to authenticated using(user_id=auth.uid());
insert into public.food_media_paths(path_key,user_id,created_at)
 select public.food_media_path_key(object_path),user_id,created_at from public.media_assets where purpose='food' and bucket_id='private-media'
 and split_part(object_path,'/',1)=user_id::text;

-- Locks entitlement rows for the duration of admission/completion transactions.
alter function public.meal_illustration_authorized(uuid,text) rename to meal_illustration_authorized_without_pro;
revoke all on function public.meal_illustration_authorized_without_pro(uuid,text) from public,anon,authenticated,service_role;
create function public.meal_illustration_authorized(p_user_id uuid,p_consent_version text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if not public.meal_visuals_pro(p_user_id) then return false;end if;
 return public.meal_illustration_authorized_without_pro(p_user_id,p_consent_version);
end $$;
revoke all on function public.meal_illustration_authorized(uuid,text) from public,anon,authenticated;
grant execute on function public.meal_illustration_authorized(uuid,text) to service_role;

create policy meal_illustrations_pro_read on public.meal_illustrations as restrictive
 for select to authenticated using(public.meal_visuals_pro(user_id));
create policy meal_photos_pro_read on public.meal_photos as restrictive
 for select to authenticated using(public.meal_visuals_pro(user_id));

-- Remove remains an ownership-protected erasure operation after downgrade.
alter function public.meal_photo(text,jsonb,uuid) rename to meal_photo_without_pro;
revoke all on function public.meal_photo_without_pro(text,jsonb,uuid) from public,anon,authenticated,service_role;
create function public.meal_photo(p_operation text,p_args jsonb,p_user_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
 if p_operation<>'get' and auth.role()<>'service_role' then raise exception 'meal_photo_not_found';end if;
 owner_id:=case when auth.role()='service_role' then p_user_id else auth.uid() end;
 if owner_id is null then raise exception 'meal_photo_not_found';end if;
 if p_operation in ('get','begin','commit') and not public.meal_visuals_pro(owner_id) then raise exception 'meal_photo_unavailable';end if;
 return public.meal_photo_without_pro(p_operation,p_args,p_user_id);
end $$;
revoke all on function public.meal_photo(text,jsonb,uuid) from public,anon;
grant execute on function public.meal_photo(text,jsonb,uuid) to authenticated,service_role;

create or replace function public.meal_photo_storage_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare p public.meal_photos;
begin
 -- Old bearer upload tickets cannot recreate bytes after their Auth owner is erased.
 if new.bucket_id='private-media' then
  perform 1 from auth.users where id::text=split_part(new.name,'/',1) for key share;
  if not found then raise exception 'meal_photo_conflict';end if;
  perform 1 from public.account_deletion_jobs where user_id::text=split_part(new.name,'/',1) for share;
  if exists(select 1 from public.account_deletion_jobs where user_id::text=split_part(new.name,'/',1) and status in ('in_progress','failed','completed')) then raise exception 'meal_photo_conflict';end if;
 end if;
 if tg_op='UPDATE' and old.bucket_id='private-media' and split_part(old.name,'/',2)='meal-photos' and (old.name<>new.name or old.bucket_id<>new.bucket_id) then raise exception 'meal_photo_conflict';end if;
 if tg_op='UPDATE' and (old.name<>new.name or old.bucket_id<>new.bucket_id) and old.bucket_id='private-media' and (exists(select 1 from public.food_media_paths where path_key=public.food_media_path_key(old.name)) or exists(select 1 from public.media_assets where user_id::text=split_part(old.name,'/',1) and bucket_id=old.bucket_id and object_path=old.name and purpose='food')) then raise exception 'meal_photo_conflict';end if;
 if new.bucket_id='private-media' and split_part(new.name,'/',2)='meal-photos' then
  select * into p from public.meal_photos where user_id::text||'/meal-photos/'||id::text||'.jpg'=new.name for update;
  if auth.role()<>'service_role' or p.id is null or p.state<>'uploading' or not public.meal_visuals_pro(p.user_id) or not exists(select 1 from public.food_entries where id=p.food_entry_id and user_id=p.user_id) or exists(select 1 from public.account_deletion_jobs where user_id=p.user_id and status in ('in_progress','failed')) then raise exception 'meal_photo_conflict';end if;
 end if;
 -- Generic food-purpose private media cannot bypass the dedicated retained-photo route.
 if exists(select 1 from public.meal_photo_cleanup_jobs j where j.object_path=new.name and new.bucket_id='private-media') then raise exception 'meal_photo_conflict';end if;
 if new.bucket_id='private-media' and (exists(select 1 from public.food_media_paths where path_key=public.food_media_path_key(new.name)) or exists(select 1 from public.media_assets where user_id::text=split_part(new.name,'/',1) and bucket_id=new.bucket_id and object_path=new.name and purpose='food')) and
 (not public.meal_visuals_pro(split_part(new.name,'/',1)::uuid) or not exists(select 1 from public.media_assets where user_id::text=split_part(new.name,'/',1) and bucket_id=new.bucket_id and object_path=new.name and purpose='food' and deleted_at is null)) then raise exception 'meal_photo_unavailable';end if;
 return new;
end $$;

create function public.meal_visuals_storage_read(p_bucket text,p_path text) returns boolean
language sql security definer set search_path='' as $$
 select p_bucket<>'private-media' or (split_part(p_path,'/',1)=auth.uid()::text and
  not exists(select 1 from public.account_deletion_jobs where user_id=auth.uid() and status in ('in_progress','failed','completed')) and
  not exists(select 1 from public.meal_photo_cleanup_jobs where object_path=p_path)
  and ((split_part(p_path,'/',2)<>'meal-photos' and not exists(select 1 from public.food_media_paths where path_key=public.food_media_path_key(p_path)) and not exists(select 1 from public.media_assets where user_id=auth.uid() and bucket_id=p_bucket and object_path=p_path and purpose='food'))
       or (public.meal_visuals_pro(auth.uid()) and exists(select 1 from public.media_assets where user_id=auth.uid() and bucket_id=p_bucket and object_path=p_path and purpose='food' and deleted_at is null))));
$$;
revoke all on function public.meal_visuals_storage_read(text,text) from public,anon;
grant execute on function public.meal_visuals_storage_read(text,text) to authenticated,service_role;
create policy private_food_media_pro_read on storage.objects as restrictive for select to authenticated
 using(public.meal_visuals_storage_read(bucket_id,name));

create function public.food_media_pro_write() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.bucket_id='private-media' and new.purpose<>'food' and exists(select 1 from public.food_media_paths where path_key=public.food_media_path_key(new.object_path)) then raise exception 'meal_photo_conflict';end if;
 if new.purpose='food' and (tg_op='INSERT' or old.purpose is distinct from new.purpose or old.object_path is distinct from new.object_path or old.user_id is distinct from new.user_id or old.bucket_id is distinct from new.bucket_id) and (new.bucket_id<>'private-media' or new.object_path ~ '[[:cntrl:]]' or new.object_path !~ ('^'||new.user_id::text||'/(meal-photos/)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$')) then raise exception 'meal_photo_conflict';end if;
 if tg_op='UPDATE' and old.purpose='food' and (new.purpose<>old.purpose or new.user_id<>old.user_id or new.bucket_id<>old.bucket_id or new.object_path<>old.object_path) then raise exception 'meal_photo_conflict';end if;
 if new.purpose='food' and (tg_op='INSERT' or old.purpose is distinct from new.purpose) and not public.meal_visuals_pro(new.user_id) then raise exception 'meal_photo_unavailable';end if;
 if new.purpose='food' and split_part(new.object_path,'/',1)=new.user_id::text then insert into public.food_media_paths(path_key,user_id) values(public.food_media_path_key(new.object_path),new.user_id) on conflict do nothing;end if;
 return new;
end $$;
create trigger food_media_pro_write before insert or update on public.media_assets
 for each row execute function public.food_media_pro_write();
revoke all on function public.food_media_pro_write() from public,anon,authenticated;

create function public.food_media_cleanup() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.purpose='food' and old.bucket_id='private-media' and old.object_path !~ '[[:cntrl:]]' and old.object_path ~ ('^'||old.user_id::text||'/(meal-photos/)?[a-zA-Z0-9_-]{1,100}\.(jpg|jpeg|png|webp)$')
 and (tg_op='DELETE' or (old.deleted_at is null and new.deleted_at is not null)) then
  insert into public.meal_photo_cleanup_jobs(object_path,user_id) values(old.object_path,old.user_id) on conflict do nothing;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger food_media_cleanup before delete or update on public.media_assets
 for each row execute function public.food_media_cleanup();
revoke all on function public.food_media_cleanup() from public,anon,authenticated;

create or replace function public.meal_photo_association() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.photo_asset_id is not null then
  if not exists(select 1 from public.meal_photos p where p.id=new.photo_asset_id and p.user_id=new.user_id and p.food_entry_id=new.id and p.state='ready') then raise exception 'meal_photo_invalid_input';end if;
  if (tg_op='INSERT' or new.photo_asset_id is distinct from old.photo_asset_id) and not public.meal_visuals_pro(new.user_id) then raise exception 'meal_photo_unavailable';end if;
 end if;
 return new;
end $$;
