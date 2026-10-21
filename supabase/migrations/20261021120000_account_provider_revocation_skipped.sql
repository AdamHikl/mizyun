-- APPLE-003 follow-up: account deletion proceeds when an Apple identity is linked
-- but the client sent no Sign in with Apple authorization code (Android, an
-- iPhone without Sign in with Apple, or installed builds up to 1.0.9 (9)).
-- The deletion worker records that truthful outcome instead of failing the job.
-- The row keeps no Apple subject, client id or token, and it is terminal.

alter table public.account_provider_revocations
  drop constraint account_provider_revocations_status_check;
alter table public.account_provider_revocations
  add constraint account_provider_revocations_status_check
  check (status in ('not_required', 'pending', 'revoked', 'skipped_no_authorization_code'));

alter table public.account_provider_revocations
  drop constraint account_provider_revocations_check;
alter table public.account_provider_revocations
  add constraint account_provider_revocations_check check (
    (status in ('not_required', 'skipped_no_authorization_code')
      and subject is null and client_id is null and encrypted_token is null)
    or (status = 'pending' and subject is not null and client_id is not null
      and length(subject) > 0 and length(client_id) > 0
      and encrypted_token is not null and length(encrypted_token) between 1 and 24000)
    or (status = 'revoked' and subject is not null and client_id is not null
      and length(subject) > 0 and length(client_id) > 0 and encrypted_token is null)
  );

-- Same body as 20261007190000, with the new status treated as terminal.
create or replace function public.account_save_provider_revocation(
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
      or existing.status in ('not_required', 'revoked', 'skipped_no_authorization_code') then
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
