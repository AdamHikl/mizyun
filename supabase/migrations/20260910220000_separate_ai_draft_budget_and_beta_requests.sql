-- Separate AI photo draft daily quota from Coach text chat, and add Beta Pro request workflow.

-- ============================================================================
-- 1. Daily Draft Ledger (Dedicated quota for meal photo/text drafts)
-- ============================================================================

create table if not exists public.ai_daily_draft_ledger (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  drafts_used integer not null default 0 check (drafts_used >= 0),
  reserved_drafts integer not null default 0 check (reserved_drafts >= 0),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, day)
);

create index if not exists ai_daily_draft_ledger_user_day_idx
  on public.ai_daily_draft_ledger(user_id, day);

alter table public.ai_daily_draft_ledger enable row level security;

-- Atomic reservation RPC for meal photo drafts
create or replace function public.ai_reserve_draft(
  p_user_id uuid,
  p_day date,
  p_budget integer,
  p_needed integer
)
returns table(allowed boolean, drafts_used integer, retry_after integer)
language plpgsql security definer set search_path = '' as $$
declare
  cur integer;
  reserved integer;
begin
  if p_needed <= 0 or p_budget <= 0 then
    return query select false, 0, 60;
    return;
  end if;

  insert into public.ai_daily_draft_ledger(user_id, day, drafts_used, reserved_drafts)
  values (p_user_id, p_day, 0, 0)
  on conflict (user_id, day) do nothing;

  select ledger.drafts_used, ledger.reserved_drafts
    into cur, reserved
    from public.ai_daily_draft_ledger as ledger
   where ledger.user_id = p_user_id and ledger.day = p_day
   for update;

  if cur + reserved + p_needed > p_budget then
    return query select false, cur,
      greatest(1, ceil(extract(epoch from ((p_day + 1)::timestamp - now()))))::int;
    return;
  end if;

  update public.ai_daily_draft_ledger
     set reserved_drafts = reserved_drafts + p_needed,
         updated_at = now()
   where user_id = p_user_id and day = p_day;

  return query select true, cur, 0;
end;
$$;

-- Commit used draft
create or replace function public.ai_commit_draft(
  p_user_id uuid,
  p_day date,
  p_count integer
)
returns void language sql security definer set search_path = '' as $$
  update public.ai_daily_draft_ledger
     set drafts_used = drafts_used + greatest(0, p_count),
         reserved_drafts = greatest(0, reserved_drafts - greatest(0, p_count)),
         updated_at = now()
   where user_id = p_user_id and day = p_day;
$$;

-- Release reserved draft on failure
create or replace function public.ai_release_draft_reservation(
  p_user_id uuid,
  p_day date,
  p_count integer
)
returns void language sql security definer set search_path = '' as $$
  update public.ai_daily_draft_ledger
     set reserved_drafts = greatest(0, reserved_drafts - greatest(0, p_count)),
         updated_at = now()
   where user_id = p_user_id and day = p_day;
$$;

-- Query current draft usage for a day
create or replace function public.ai_get_daily_draft_usage(
  p_user_id uuid,
  p_day date
)
returns table(drafts_used integer, reserved_drafts integer)
language sql security definer set search_path = '' as $$
  select coalesce(drafts_used, 0), coalesce(reserved_drafts, 0)
    from public.ai_daily_draft_ledger
   where user_id = p_user_id and day = p_day
   union all
  select 0, 0
   limit 1;
$$;

-- Limit execution to service role
revoke execute on function public.ai_reserve_draft(uuid, date, integer, integer) from public, anon, authenticated;
grant execute on function public.ai_reserve_draft(uuid, date, integer, integer) to service_role;

revoke execute on function public.ai_commit_draft(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.ai_commit_draft(uuid, date, integer) to service_role;

revoke execute on function public.ai_release_draft_reservation(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.ai_release_draft_reservation(uuid, date, integer) to service_role;

revoke execute on function public.ai_get_daily_draft_usage(uuid, date) from public, anon, authenticated;
grant execute on function public.ai_get_daily_draft_usage(uuid, date) to service_role;


-- ============================================================================
-- 2. Beta Pro Requests & Automatic Approval Trigger
-- ============================================================================

create table if not exists public.beta_pro_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  email text not null,
  push_token text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  reviewed_at timestamptz
);

create index if not exists beta_pro_requests_user_id_idx on public.beta_pro_requests(user_id);
create index if not exists beta_pro_requests_status_idx on public.beta_pro_requests(status);

alter table public.beta_pro_requests enable row level security;

-- Row Level Security policies
drop policy if exists beta_pro_requests_select_own on public.beta_pro_requests;
create policy beta_pro_requests_select_own on public.beta_pro_requests
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists beta_pro_requests_insert_own on public.beta_pro_requests;
create policy beta_pro_requests_insert_own on public.beta_pro_requests
  for insert to authenticated
  with check (auth.uid() = user_id and status = 'pending');

grant select, insert on public.beta_pro_requests to authenticated;
grant all on public.beta_pro_requests to service_role;

-- Trigger function: when admin updates status in Supabase to 'approved', elevate profile plan_tier
create or replace function public.handle_beta_pro_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.reviewed_at := now();
    update public.profiles
       set plan_tier = 'paid',
           updated_at = now()
     where id = new.user_id;
  elsif new.status = 'rejected' and old.status = 'approved' then
    new.reviewed_at := now();
    update public.profiles
       set plan_tier = 'free',
           updated_at = now()
     where id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_beta_pro_approval on public.beta_pro_requests;
create trigger trg_beta_pro_approval
  before update of status on public.beta_pro_requests
  for each row
  execute function public.handle_beta_pro_approval();
