-- COMM-03: fresh, separate consent and conservative UTC eligibility. Forward only.
begin;
alter table public.community_profiles add column adult_declared_at timestamptz;

create or replace function public.community_eligible(p_user_id uuid) returns boolean
language sql volatile security definer set search_path = '' as $$
 select exists(select 1 from public.profiles p where p.id = p_user_id
   and p.birth_year between 1900 and extract(year from now() at time zone 'UTC')::integer - 19)
 and not exists(select 1 from public.account_deletion_jobs d where d.user_id = p_user_id
   and d.status in ('in_progress','completed','failed'))
$$;
create or replace function public.community_active(p_user_id uuid) returns boolean
language sql volatile security definer set search_path = '' as $$
 select public.community_eligible(p_user_id) and exists(select 1 from public.community_profiles p
   where p.user_id = p_user_id and p.status = 'active' and p.terms_version = '2026-09-30'
     and p.terms_accepted_at is not null and p.adult_declared_at is not null)
$$;
-- Old rules are not acceptance of the revised rules; normal cleanup severs all
-- authority, while immutable handles and account-bound blocks/sanctions remain.
update public.community_profiles set status = 'withdrawn', is_searchable = false
where status = 'active' and (terms_version is distinct from '2026-09-30' or adult_declared_at is null or not public.community_eligible(user_id));

-- No account identity retained in the handle quarantine. Deadline checks deny
-- reuse for 90 days; expired entries are removed by subsequent profile writes.
create table public.community_handle_quarantine (
 handle text primary key,
 expires_at timestamptz not null
);
alter table public.community_handle_quarantine enable row level security;
revoke all on public.community_handle_quarantine from public, anon, authenticated;
grant all on public.community_handle_quarantine to service_role;
create function public.community_quarantine_deleted_handle() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 perform public.community_lock();
 insert into public.community_handle_quarantine(handle,expires_at) values(old.handle,now() + interval '90 days')
 on conflict(handle) do update set expires_at = greatest(community_handle_quarantine.expires_at,excluded.expires_at);
 return old;
end $$;
create trigger community_quarantine_deleted_handle before delete on public.community_profiles
for each row execute function public.community_quarantine_deleted_handle();

create function public.community_valid_handle(p_handle text) returns boolean
language sql immutable set search_path = '' as $$
 select coalesce(p_handle ~ '^[a-z0-9_]{3,24}$' and p_handle not in
 ('admin','administrator','api','app','auth','community','feed','friends','help','mizyun','moderator','official','privacy','root','security','staff','status','support','system','terms','www','null','undefined'),false)
$$;
-- Defense at both transports, not just the API schema. Full staffed moderation
-- and abusive-content filtering remain COMM-09; contacts/control text denied now.
create function public.community_valid_text(p_text text,p_bio boolean) returns boolean
language sql immutable set search_path = '' as $$
 select p_text is null or (p_text !~ '[[:cntrl:]]' and
 (not p_bio or p_text !~* '(https?://|www\.|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|[0-9][0-9 ()+.-]{6,}[0-9])'))
$$;

drop function public.community_save_profile(text,text,text,text,boolean);
create function public.community_save_profile(p_handle text,p_display_name text,p_avatar_symbol text,p_bio text,p_is_searchable boolean,p_adult_declaration boolean default null,p_terms_version text default null)
returns setof public.community_profiles language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); existing public.community_profiles;
begin
 perform public.community_lock();
 if caller is null or not public.community_eligible(caller) then raise exception 'community_unavailable'; end if;
 select * into existing from public.community_profiles where user_id = caller;
 if existing.status = 'suspended' then raise exception 'community_unavailable'; end if;
 if p_adult_declaration is not null or p_terms_version is not null then
   if p_adult_declaration is distinct from true or p_terms_version is distinct from '2026-09-30' then raise exception 'community_conflict'; end if;
 elsif not public.community_active(caller) then raise exception 'community_conflict';
 end if;
 p_handle := lower(btrim(p_handle));
 p_display_name := btrim(p_display_name);
 p_bio := nullif(btrim(p_bio),'');
 if existing.user_id is not null and existing.handle <> p_handle then raise exception 'community_conflict'; end if;
 if not public.community_valid_handle(p_handle) then raise exception 'community_handle_taken'; end if;
 if p_display_name is null or char_length(p_display_name) not between 1 and 32
   or not public.community_valid_text(p_display_name,false) or not public.community_valid_text(p_bio,true)
   or char_length(p_bio) > 160 or p_avatar_symbol is null or char_length(btrim(p_avatar_symbol)) not between 1 and 4
   or not public.community_valid_text(p_avatar_symbol,false) then raise exception 'community_invalid_profile'; end if;
 delete from public.community_handle_quarantine where expires_at <= now();
 if exists(select 1 from public.community_handle_quarantine where handle = p_handle and expires_at > now()) then raise exception 'community_handle_taken'; end if;
 return query insert into public.community_profiles(user_id,handle,display_name,avatar_symbol,bio,is_searchable,status,generation,terms_version,terms_accepted_at,adult_declared_at)
 values(caller,p_handle,p_display_name,btrim(p_avatar_symbol),p_bio,coalesce(p_is_searchable,false),'active',
 case when existing.status = 'withdrawn' then existing.generation + 1 else coalesce(existing.generation,1) end,'2026-09-30',now(),now())
 on conflict(user_id) do update set display_name = excluded.display_name,avatar_symbol = excluded.avatar_symbol,bio = excluded.bio,
 is_searchable = excluded.is_searchable,status = 'active',generation = excluded.generation,terms_version = excluded.terms_version,
 terms_accepted_at = case when existing.status = 'active' then existing.terms_accepted_at else now() end,
 adult_declared_at = case when existing.status = 'active' then existing.adult_declared_at else now() end,updated_at = now()
 returning *;
 exception when unique_violation then raise exception 'community_handle_taken';
end $$;
create or replace function public.community_handle_available(p_handle text) returns table(available boolean)
language sql stable security definer set search_path = '' as $$
 select public.community_valid_handle(lower(btrim(p_handle)))
 and not exists(select 1 from public.community_profiles where handle = lower(btrim(p_handle)) and user_id <> auth.uid())
 and not exists(select 1 from public.community_handle_quarantine where handle = lower(btrim(p_handle)) and expires_at > now())
 where auth.uid() is not null
$$;
-- Newly added receipt is never projected to another member.
create or replace function public.community_get_profile(p_user_id uuid) returns setof public.community_profiles
language plpgsql stable security definer set search_path = '' as $$
declare caller uuid := auth.uid(); result public.community_profiles; approved boolean; related boolean;
begin
 if caller is null then return; end if;
 select * into result from public.community_profiles where user_id = p_user_id;
 if result.user_id is null then return; end if;
 if caller = p_user_id then return next result; return; end if;
 if not public.community_active(caller) or not public.community_active(p_user_id) or public.community_blocked_between(caller,p_user_id) then return; end if;
 select exists(select 1 from public.community_relationships where status = 'approved' and follower_user_id = caller and target_user_id = p_user_id) into approved;
 select exists(select 1 from public.community_relationships where status in ('pending','approved') and ((follower_user_id = caller and target_user_id = p_user_id) or (follower_user_id = p_user_id and target_user_id = caller))) into related;
 if not result.is_searchable and not approved and not related then return; end if;
 if not approved then result.bio := null; end if;
 result.generation := 1;result.terms_version := null;result.terms_accepted_at := null;result.adult_declared_at := null;
 return next result;
end $$;
revoke all on function public.community_save_profile(text,text,text,text,boolean,boolean,text), public.community_valid_handle(text),public.community_valid_text(text,boolean),public.community_quarantine_deleted_handle() from public, anon, authenticated;
grant execute on function public.community_save_profile(text,text,text,text,boolean,boolean,text) to authenticated;
commit;
