-- REL-AUD-006 & REL-AUD-007: Security & Retry Integrity
-- 1. Protect profiles.plan_tier from unauthorized client-side updates.
-- 2. Add client_operation_id to food_entries with a unique partial index to prevent duplicates on network retry.

-- =========================================================================
-- 1. Protect profiles.plan_tier (REL-AUD-006 / Finding R6)
-- =========================================================================

-- Revoke column-level update privilege on plan_tier from public data API roles
revoke update (plan_tier) on table public.profiles from authenticated, anon;

-- Defense-in-depth trigger: disallow direct authenticated updates to plan_tier
create or replace function public.protect_profile_plan_tier()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.plan_tier is distinct from old.plan_tier then
    if auth.role() = 'authenticated' or current_user = 'authenticated' then
      raise exception 'Unauthorized: plan_tier cannot be updated directly by authenticated users'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_plan_tier on public.profiles;
create trigger trg_protect_profile_plan_tier
  before update on public.profiles
  for each row
  execute function public.protect_profile_plan_tier();

-- =========================================================================
-- 2. Add client_operation_id to food_entries (REL-AUD-007 / Finding R7)
-- =========================================================================

alter table public.food_entries
  add column if not exists client_operation_id uuid null;

create unique index if not exists food_entries_user_client_op_idx
  on public.food_entries(user_id, client_operation_id)
  where client_operation_id is not null;
