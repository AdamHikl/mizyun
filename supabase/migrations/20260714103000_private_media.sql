insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'private-media',
  'private-media',
  false,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket_id text not null default 'private-media',
  object_path text not null,
  purpose text not null check (purpose in ('food', 'progress', 'workout', 'profile')),
  mime_type text not null,
  byte_size bigint check (byte_size >= 0),
  width integer,
  height integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  unique (bucket_id, object_path)
);

create index media_assets_user_time_idx
on public.media_assets(user_id, created_at desc);

alter table public.media_assets enable row level security;

create policy "media_assets_own_all"
on public.media_assets for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "private_media_select_own"
on storage.objects for select to authenticated
using (
  bucket_id = 'private-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "private_media_insert_own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'private-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "private_media_update_own"
on storage.objects for update to authenticated
using (
  bucket_id = 'private-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'private-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "private_media_delete_own"
on storage.objects for delete to authenticated
using (
  bucket_id = 'private-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
