-- 20260909150000_account_deletion_worker_leases.sql
-- Resumable worker leases for durable account deletion jobs (REL-AUD-001 / REL-AUD-002 / Q4 / R1 / R2)

alter table public.account_deletion_jobs
  add column if not exists worker_id text null,
  add column if not exists lease_expires_at timestamptz null;

create index if not exists idx_account_deletion_jobs_lease
  on public.account_deletion_jobs(status, lease_expires_at);
