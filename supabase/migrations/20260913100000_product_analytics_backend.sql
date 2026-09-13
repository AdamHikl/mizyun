-- 20260913100000_product_analytics_backend.sql
-- Product Analytics Backend (OBS-002, ADR-0026)
-- Introduces public.product_analytics_consents and public.product_analytics_events
-- with RLS, foreign key cascades on auth.users(id), strict indexes,
-- and atomic SECURITY DEFINER RPCs restricted to service_role.

set check_function_bodies = off;

-- =========================================================================
-- 1. Consent State Table
-- =========================================================================

create table if not exists public.product_analytics_consents (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  version      text not null default 'product-analytics-v2',
  granted      boolean not null default false,
  revision     integer not null default 0,
  epoch        uuid not null default gen_random_uuid(),
  consented_at timestamptz null,
  revoked_at   timestamptz null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_product_analytics_consents_user_id
  on public.product_analytics_consents(user_id);

alter table public.product_analytics_consents enable row level security;

grant select on public.product_analytics_consents to authenticated;
grant all privileges on public.product_analytics_consents to service_role;
revoke all on public.product_analytics_consents from anon;
revoke insert, update, delete on public.product_analytics_consents from authenticated;

drop policy if exists product_analytics_consents_select_own on public.product_analytics_consents;
create policy product_analytics_consents_select_own on public.product_analytics_consents
  for select to authenticated using (auth.uid() = user_id);

-- =========================================================================
-- 2. Retained Events Table
-- =========================================================================

create table if not exists public.product_analytics_events (
  id          uuid not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  epoch       uuid not null,
  version     text not null default 'product-analytics-v2',
  event_name  text not null,
  session_id  uuid not null,
  sequence    integer not null check (sequence >= 0),
  flow_id     uuid null,
  platform    text not null check (platform in ('ios', 'android')),
  app_version text not null,
  build       text null,
  properties  jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null,
  received_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists idx_product_analytics_events_user_recorded
  on public.product_analytics_events(user_id, recorded_at desc);

create index if not exists idx_product_analytics_events_user_session_seq
  on public.product_analytics_events(user_id, session_id, sequence);

create index if not exists idx_product_analytics_events_recorded_at
  on public.product_analytics_events(recorded_at);

alter table public.product_analytics_events enable row level security;

grant select on public.product_analytics_events to authenticated;
grant all privileges on public.product_analytics_events to service_role;
revoke all on public.product_analytics_events from anon;
revoke insert, update, delete on public.product_analytics_events from authenticated;

drop policy if exists product_analytics_events_select_own on public.product_analytics_events;
create policy product_analytics_events_select_own on public.product_analytics_events
  for select to authenticated using (auth.uid() = user_id);

-- =========================================================================
-- 3. Atomic Ingestion RPC
-- =========================================================================

create or replace function public.record_product_analytics_events(
  p_user_id uuid,
  p_epoch uuid,
  p_version text,
  p_events jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_consent record;
  v_event jsonb;
  v_accepted_ids uuid[] := array[]::uuid[];
  v_rejected_count integer := 0;
  v_event_id uuid;
  v_rec_at timestamptz;
begin
  -- Serialize on user consent record
  select granted, epoch, version
  into v_consent
  from public.product_analytics_consents
  where user_id = p_user_id
  for update;

  if not found or v_consent.granted is not true or v_consent.epoch <> p_epoch or v_consent.version <> p_version then
    return jsonb_build_object(
      'success', false,
      'error', 'consent_or_epoch_mismatch',
      'accepted_ids', '[]'::jsonb,
      'rejected_count', jsonb_array_length(p_events)
    );
  end if;

  for v_event in select * from jsonb_array_elements(p_events)
  loop
    v_event_id := (v_event->>'id')::uuid;
    v_rec_at := (v_event->>'recordedAt')::timestamptz;

    insert into public.product_analytics_events (
      id,
      user_id,
      epoch,
      version,
      event_name,
      session_id,
      sequence,
      flow_id,
      platform,
      app_version,
      build,
      properties,
      recorded_at,
      received_at
    )
    values (
      v_event_id,
      p_user_id,
      p_epoch,
      p_version,
      v_event->>'name',
      (v_event->>'sessionId')::uuid,
      (v_event->>'sequence')::integer,
      case when v_event->>'flowId' is not null and v_event->>'flowId' <> '' then (v_event->>'flowId')::uuid else null end,
      v_event->>'platform',
      v_event->>'appVersion',
      v_event->>'build',
      coalesce(v_event->'properties', '{}'::jsonb),
      v_rec_at,
      now()
    )
    on conflict (user_id, id) do nothing;

    v_accepted_ids := array_append(v_accepted_ids, v_event_id);
  end loop;

  return jsonb_build_object(
    'success', true,
    'accepted_ids', to_jsonb(v_accepted_ids),
    'rejected_count', v_rejected_count
  );
end;
$$;

-- =========================================================================
-- 4. Atomic Consent Mutation RPC
-- =========================================================================

create or replace function public.update_product_analytics_consent(
  p_user_id uuid,
  p_version text,
  p_granted boolean,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current record;
  v_new_revision integer;
  v_new_epoch uuid;
  v_consented_at timestamptz;
  v_revoked_at timestamptz;
  v_now timestamptz := now();
begin
  select *
  into v_current
  from public.product_analytics_consents
  where user_id = p_user_id
  for update;

  if found then
    if v_current.revision <> p_expected_revision then
      return jsonb_build_object(
        'success', false,
        'error', 'revision_mismatch',
        'current', jsonb_build_object(
          'version', v_current.version,
          'granted', v_current.granted,
          'revision', v_current.revision,
          'epoch', v_current.epoch,
          'consentedAt', v_current.consented_at,
          'revokedAt', v_current.revoked_at,
          'updatedAt', v_current.updated_at
        )
      );
    end if;

    v_new_revision := v_current.revision + 1;
    if p_granted then
      v_new_epoch := v_current.epoch;
      v_consented_at := coalesce(v_current.consented_at, v_now);
      v_revoked_at := null;
    else
      v_new_epoch := gen_random_uuid();
      v_consented_at := v_current.consented_at;
      v_revoked_at := v_now;
      delete from public.product_analytics_events where user_id = p_user_id;
    end if;

    update public.product_analytics_consents
    set
      version = p_version,
      granted = p_granted,
      revision = v_new_revision,
      epoch = v_new_epoch,
      consented_at = v_consented_at,
      revoked_at = v_revoked_at,
      updated_at = v_now
    where user_id = p_user_id;

  else
    if p_expected_revision <> 0 then
      return jsonb_build_object(
        'success', false,
        'error', 'revision_mismatch',
        'current', null
      );
    end if;

    v_new_revision := 1;
    v_new_epoch := gen_random_uuid();
    if p_granted then
      v_consented_at := v_now;
      v_revoked_at := null;
    else
      v_consented_at := null;
      v_revoked_at := v_now;
    end if;

    insert into public.product_analytics_consents (
      user_id,
      version,
      granted,
      revision,
      epoch,
      consented_at,
      revoked_at,
      created_at,
      updated_at
    )
    values (
      p_user_id,
      p_version,
      p_granted,
      v_new_revision,
      v_new_epoch,
      v_consented_at,
      v_revoked_at,
      v_now,
      v_now
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'consent', jsonb_build_object(
      'version', p_version,
      'granted', p_granted,
      'revision', v_new_revision,
      'epoch', v_new_epoch,
      'consentedAt', v_consented_at,
      'revokedAt', v_revoked_at,
      'updatedAt', v_now
    )
  );
end;
$$;

-- =========================================================================
-- 5. Clear Events RPC (Atomic epoch rotation + delete)
-- =========================================================================

create or replace function public.clear_product_analytics_events(
  p_user_id uuid,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current record;
  v_new_revision integer;
  v_new_epoch uuid := gen_random_uuid();
  v_now timestamptz := now();
begin
  select *
  into v_current
  from public.product_analytics_consents
  where user_id = p_user_id
  for update;

  if not found or v_current.revision <> p_expected_revision then
    return jsonb_build_object(
      'success', false,
      'error', 'revision_mismatch',
      'current_revision', coalesce(v_current.revision, 0)
    );
  end if;

  v_new_revision := v_current.revision + 1;

  update public.product_analytics_consents
  set
    epoch = v_new_epoch,
    revision = v_new_revision,
    updated_at = v_now
  where user_id = p_user_id;

  delete from public.product_analytics_events where user_id = p_user_id;

  return jsonb_build_object(
    'success', true,
    'cleared', true,
    'new_epoch', v_new_epoch,
    'revision', v_new_revision
  );
end;
$$;

-- =========================================================================
-- 6. Retention Cleanup RPC (30 days default)
-- =========================================================================

create or replace function public.cleanup_expired_product_analytics(p_retention_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted_count integer := 0;
begin
  delete from public.product_analytics_events
  where recorded_at < now() - (coalesce(p_retention_days, 30) || ' days')::interval;

  get diagnostics v_deleted_count = row_count;
  return v_deleted_count;
end;
$$;

-- =========================================================================
-- 7. Secure Function Grants (service_role only)
-- =========================================================================

revoke execute on function public.record_product_analytics_events(uuid, uuid, text, jsonb) from public;
revoke execute on function public.record_product_analytics_events(uuid, uuid, text, jsonb) from anon;
revoke execute on function public.record_product_analytics_events(uuid, uuid, text, jsonb) from authenticated;
grant execute on function public.record_product_analytics_events(uuid, uuid, text, jsonb) to service_role;

revoke execute on function public.update_product_analytics_consent(uuid, text, boolean, integer) from public;
revoke execute on function public.update_product_analytics_consent(uuid, text, boolean, integer) from anon;
revoke execute on function public.update_product_analytics_consent(uuid, text, boolean, integer) from authenticated;
grant execute on function public.update_product_analytics_consent(uuid, text, boolean, integer) to service_role;

revoke execute on function public.clear_product_analytics_events(uuid, integer) from public;
revoke execute on function public.clear_product_analytics_events(uuid, integer) from anon;
revoke execute on function public.clear_product_analytics_events(uuid, integer) from authenticated;
grant execute on function public.clear_product_analytics_events(uuid, integer) to service_role;

revoke execute on function public.cleanup_expired_product_analytics(integer) from public;
revoke execute on function public.cleanup_expired_product_analytics(integer) from anon;
revoke execute on function public.cleanup_expired_product_analytics(integer) from authenticated;
grant execute on function public.cleanup_expired_product_analytics(integer) to service_role;
