-- 20260908150000_durable_account_deletion.sql
-- Durable Account Deletion State Machine & Tombstones (REL-AUD-001 / REL-AUD-002 / Q4 / R1 / R2)

create table if not exists public.account_deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  challenge_hash text not null,
  status text not null check (status in ('challenge_issued', 'in_progress', 'completed', 'failed')),
  stage text not null default 'none' check (stage in ('none', 'storage', 'memory', 'auth', 'done')),
  expires_at timestamptz not null,
  completed_at timestamptz null,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for lookup
create index if not exists idx_account_deletion_jobs_user_id
  on public.account_deletion_jobs(user_id);

create index if not exists idx_account_deletion_jobs_challenge
  on public.account_deletion_jobs(challenge_hash);

-- Enable RLS
alter table public.account_deletion_jobs enable row level security;

-- Grant full access to service_role
grant select, insert, update, delete on public.account_deletion_jobs to service_role;

-- Authenticated users have SELECT privilege guarded by RLS policy
grant select on public.account_deletion_jobs to authenticated;
revoke all on public.account_deletion_jobs from anon;
revoke insert, update, delete on public.account_deletion_jobs from authenticated;

-- Authenticated users can only read their own deletion job status while authenticated
create policy account_deletion_jobs_select_own
  on public.account_deletion_jobs
  for select
  to authenticated
  using (user_id = auth.uid());
