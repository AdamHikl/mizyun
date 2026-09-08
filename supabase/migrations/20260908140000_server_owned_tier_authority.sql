-- REL-AUD-006 / Finding R6: Server-Owned Tier Authority
-- Ensures plan_tier cannot be escalated through authenticated INSERT, UPDATE, UPSERT, or DELETE/re-insert.

-- 1. Grant service_role full authority on public.profiles
grant all on table public.profiles to service_role;

-- 2. Remove broad write grants from client roles and grant only explicitly editable columns
revoke insert, update, delete on table public.profiles from authenticated, anon;

grant insert (
  id,
  display_name,
  unit_system,
  timezone,
  birth_year,
  height_cm,
  activity_level,
  sex_at_birth,
  coaching_preferences,
  ai_provider
) on table public.profiles to authenticated;

grant update (
  display_name,
  unit_system,
  timezone,
  birth_year,
  height_cm,
  activity_level,
  sex_at_birth,
  coaching_preferences,
  ai_provider
) on table public.profiles to authenticated;

-- Direct profile DELETE by authenticated client is revoked; account deletion is managed server-side
drop policy if exists "profiles_delete_own" on public.profiles;

-- 3. Trigger defense-in-depth on INSERT and UPDATE
create or replace function public.protect_profile_plan_tier()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  is_trusted boolean;
begin
  -- Caller is trusted only if direct superuser/admin without client JWT or service_role JWT
  if (session_user in ('postgres', 'supabase_admin') and (auth.role() is null or auth.role() = ''))
     or (auth.role() = 'service_role') then
    is_trusted := true;
  else
    is_trusted := false;
  end if;

  if tg_op = 'INSERT' then
    if not is_trusted then
      if new.plan_tier is not null and new.plan_tier <> 'free' then
        raise exception 'Unauthorized: client users cannot set paid plan_tier on creation'
          using errcode = '42501';
      end if;
      new.plan_tier := 'free';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.plan_tier is distinct from old.plan_tier then
      if not is_trusted then
        raise exception 'Unauthorized: plan_tier cannot be updated directly by authenticated users'
          using errcode = '42501';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_profile_plan_tier on public.profiles;
create trigger trg_protect_profile_plan_tier
  before insert or update on public.profiles
  for each row
  execute function public.protect_profile_plan_tier();
