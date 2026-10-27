begin;
-- SEC-02: per-owner private-media quota. The bucket only caps each file
-- (15 MiB), and every client and signed-upload path writes owner-prefixed
-- objects (`<uid>/...`), so the database bounds each owner's object count and
-- total bytes for every writer role (authenticated direct upload, signed
-- upload completed as service_role, and API service writes). Usage is read
-- from storage.objects under an owner lock rather than a counter table, so it
-- cannot drift from the bytes that actually exist.
--
-- Limits: meal backups are <=256 KiB, boulder/progress photos ~0.4-1.5 MB.
-- 10,000 objects / 3 GiB covers years of heavy use while keeping one account
-- from filling the single server's disk. Operators change the single settings
-- row; clients have no access to it.
create table public.private_media_quota_settings (
 singleton boolean primary key default true check (singleton),
 max_objects bigint not null check (max_objects>0),
 max_bytes bigint not null check (max_bytes>0),
 updated_at timestamptz not null default now()
);
alter table public.private_media_quota_settings enable row level security;
revoke all on public.private_media_quota_settings from public,anon,authenticated;
grant all on public.private_media_quota_settings to service_role;
insert into public.private_media_quota_settings(max_objects,max_bytes) values(10000,3221225472);

create function public.private_media_quota() returns table(max_objects bigint,max_bytes bigint)
language sql stable security definer set search_path='' as $$
 select max_objects,max_bytes from public.private_media_quota_settings where singleton
$$;
revoke all on function public.private_media_quota() from public,anon,authenticated;

-- Owner of an owner-prefixed private-media object, or null for any other name.
create function public.private_media_owner(p_name text) returns uuid
language sql immutable set search_path='' as $$
 select case when split_part(p_name,'/',1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and strpos(p_name,'/')>0 then split_part(p_name,'/',1)::uuid end
$$;

-- Byte size recorded by Storage. Absent while Storage tests permission before
-- the upload; the completed upload row always carries it.
create function public.private_media_object_bytes(p_metadata jsonb) returns bigint
language sql immutable set search_path='' as $$
 select case when p_metadata->>'size' ~ '^[0-9]{1,15}$' then (p_metadata->>'size')::bigint else 0 end
$$;

-- Usage of one owner, excluding the named objects (the row being written).
-- The C-collated range uses idx_objects_bucket_id_name; '0' follows '/'.
create function public.private_media_usage(p_user_id uuid,p_exclude text[] default '{}')
returns table(object_count bigint,total_bytes bigint)
language sql stable security definer set search_path='' as $$
 select count(*),coalesce(sum(public.private_media_object_bytes(o.metadata)),0)::bigint
 from storage.objects o
 where o.bucket_id='private-media'
  and o.name collate "C">=p_user_id::text||'/' and o.name collate "C"<p_user_id::text||'0'
  and not (o.name=any(p_exclude))
$$;
revoke all on function public.private_media_usage(uuid,text[]) from public,anon,authenticated;
grant execute on function public.private_media_usage(uuid,text[]) to service_role;

create function public.private_media_quota_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner_id uuid;used record;q record;new_bytes bigint;
begin
 if new.bucket_id is distinct from 'private-media' then return new;end if;
 owner_id:=public.private_media_owner(new.name);
 if owner_id is null then return new;end if;
 -- Clients only reach storage.objects through Storage's rolled-back
 -- permission test; the final row is written as service_role. Upload tests
 -- carry {mimetype, contentLength}; a copy test carries the source metadata,
 -- whose `size` the copy request can override (copyMetadata=false), so the
 -- final row could under-report bytes. No Mizyun client copies private media.
 -- Clients therefore never set or change `size`; only Storage's service-role
 -- completion records it. Sessions without JWT claims (restores, operators)
 -- are not clients.
 if auth.role() in ('anon','authenticated') and (
  (tg_op='INSERT' and new.metadata ? 'size') or
  (tg_op='UPDATE' and new.metadata->'size' is distinct from old.metadata->'size')) then
  raise exception 'storage_copy_unavailable';
 end if;
 new_bytes:=public.private_media_object_bytes(new.metadata);
 -- Metadata/access-time refreshes that neither move nor grow an object stay
 -- allowed, so an owner above a lowered quota can still read and delete.
 if tg_op='UPDATE' and old.bucket_id='private-media' and old.name=new.name
  and new_bytes<=public.private_media_object_bytes(old.metadata) then return new;end if;
 -- Serialize one owner's concurrent uploads so parallel writes cannot each
 -- pass a check against the same pre-upload total.
 perform pg_advisory_xact_lock(hashtextextended('private-media-quota:'||owner_id::text,0));
 select * into q from public.private_media_quota();
 select * into used from public.private_media_usage(owner_id,
  case when tg_op='UPDATE' then array[new.name,old.name] else array[new.name] end);
 -- A missing settings row fails closed.
 if q.max_objects is null or used.object_count+1>q.max_objects or used.total_bytes+new_bytes>q.max_bytes then
  raise exception 'storage_quota_exceeded';
 end if;
 return new;
end $$;
revoke all on function public.private_media_quota_write() from public,anon,authenticated;
create trigger private_media_quota_write before insert or update on storage.objects
 for each row execute function public.private_media_quota_write();

-- API pre-check before issuing a signed upload: owner-scoped, reports only
-- whether one more object of p_byte_size fits.
create function public.private_media_quota_check(p_byte_size bigint) returns table(allowed boolean)
language plpgsql stable security definer set search_path='' as $$
declare used record;q record;
begin
 if auth.uid() is null then raise exception 'storage_quota_access_denied';end if;
 if p_byte_size is null or p_byte_size<0 then raise exception 'storage_quota_invalid_input';end if;
 select * into q from public.private_media_quota();
 select * into used from public.private_media_usage(auth.uid());
 return query select coalesce(used.object_count+1<=q.max_objects and used.total_bytes+p_byte_size<=q.max_bytes,false);
end $$;
revoke all on function public.private_media_quota_check(bigint) from public,anon;
grant execute on function public.private_media_quota_check(bigint) to authenticated;
commit;
