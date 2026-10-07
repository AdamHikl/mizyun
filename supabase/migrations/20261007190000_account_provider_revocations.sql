-- APPLE-003: private, durable revocation state owned by an accepted deletion worker.
create table public.account_provider_revocations (
  job_id uuid not null references public.account_deletion_jobs(id) on delete cascade,
  user_id uuid not null,
  provider text not null check (provider = 'apple'),
  status text not null check (status in ('not_required', 'pending', 'revoked')),
  subject text,
  client_id text,
  encrypted_token text,
  updated_at timestamptz not null default now(),
  primary key (job_id, provider),
  check (
    (status = 'not_required' and subject is null and client_id is null and encrypted_token is null)
    or (status = 'pending' and subject is not null and client_id is not null
      and length(subject) > 0 and length(client_id) > 0
      and encrypted_token is not null and length(encrypted_token) between 1 and 24000)
    or (status = 'revoked' and subject is not null and client_id is not null
      and length(subject) > 0 and length(client_id) > 0 and encrypted_token is null)
  )
);
create index account_provider_revocations_user_id on public.account_provider_revocations(user_id);
alter table public.account_provider_revocations enable row level security;
revoke all on public.account_provider_revocations from public, anon, authenticated;
grant select, insert, update, delete on public.account_provider_revocations to service_role;

create function public.account_save_provider_revocation(
  p_job_id uuid, p_user_id uuid, p_provider text, p_worker_id text,
  p_status text, p_subject text, p_client_id text, p_encrypted_token text
) returns table(saved boolean)
language plpgsql security invoker set search_path = '' as $$
declare
  existing public.account_provider_revocations%rowtype;
  owning_job public.account_deletion_jobs%rowtype;
begin
  -- Lock the owning operation while testing its worker fence. No Auth FK is needed.
  select * into owning_job from public.account_deletion_jobs where id = p_job_id for update;
  if not found or owning_job.user_id <> p_user_id or owning_job.status <> 'in_progress'
    or owning_job.worker_id is distinct from p_worker_id
    or owning_job.lease_expires_at is null or owning_job.lease_expires_at <= clock_timestamp() then
    raise sqlstate 'PT409' using message = 'Deletion worker lease is unavailable';
  end if;

  select * into existing from public.account_provider_revocations
    where job_id = p_job_id and provider = p_provider;
  if found then
    if existing.user_id <> p_user_id
      or existing.subject is distinct from p_subject
      or existing.client_id is distinct from p_client_id
      or existing.status in ('not_required', 'revoked') then
      raise sqlstate 'PT409' using message = 'Provider cleanup transition is unavailable';
    end if;
  elsif p_status = 'revoked' then
    raise sqlstate 'PT409' using message = 'Provider cleanup transition is unavailable';
  end if;

  insert into public.account_provider_revocations(job_id, user_id, provider, status, subject, client_id, encrypted_token)
    values (p_job_id, p_user_id, p_provider, p_status, p_subject, p_client_id, p_encrypted_token)
    on conflict (job_id, provider) do update set
      status = excluded.status, encrypted_token = excluded.encrypted_token, updated_at = now();
  return query select true;
end;
$$;
revoke all on function public.account_save_provider_revocation(uuid, uuid, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.account_save_provider_revocation(uuid, uuid, text, text, text, text, text, text)
  to service_role;

-- Challenge issuance and acceptance share a per-account transaction fence.
-- Existing accepted operations cannot be stranded by a concurrently inserted challenge.
create function public.account_deletion_preserve_accepted_operation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 49));
  if tg_op = 'UPDATE' then
    if old.status = 'challenge_issued' and new.status = 'in_progress'
      and old.expires_at <= clock_timestamp() then
      raise sqlstate 'PT410' using message = 'Deletion confirmation expired';
    end if;
  end if;
  if exists (select 1 from public.account_deletion_jobs j
    where j.user_id = new.user_id and j.id <> new.id
      and j.status in ('in_progress', 'failed', 'completed')) then
    raise sqlstate 'PT409' using message = 'Resume the accepted deletion operation';
  end if;
  return new;
end;
$$;
revoke all on function public.account_deletion_preserve_accepted_operation()
  from public, anon, authenticated;
grant execute on function public.account_deletion_preserve_accepted_operation() to service_role;
create trigger account_deletion_preserve_accepted_operation
  before insert or update of status on public.account_deletion_jobs
  for each row execute function public.account_deletion_preserve_accepted_operation();
