-- REC-03: content-free, non-conversation AI requests sharing existing AI budgets.
-- Full input/image/output upper bound is charged before dispatch. Ambiguous calls
-- stay charged; a terminal identity can never be silently retried after restart.
create table public.ai_recipe_requests (
  attempt_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  operation text not null check (operation in ('suggest', 'recognize')),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  consent_version text not null check (length(consent_version) between 1 and 100),
  budget_day date not null,
  tokens_estimated integer not null check (tokens_estimated between 1 and 2000000),
  tokens_charged integer not null check (tokens_charged >= 0),
  status text not null default 'attempting' check (status in ('attempting', 'succeeded', 'failed', 'expired')),
  created_at timestamptz not null default clock_timestamp(),
  lease_expires_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  unique (user_id, request_id, operation)
);
create index ai_recipe_requests_user_id_idx on public.ai_recipe_requests(user_id);
alter table public.ai_recipe_requests enable row level security;
-- Intentionally no end-user read policy: fingerprints and IDs are private
-- operational identity. Account export may include allowlisted aggregate counters.
revoke all on public.ai_recipe_requests from public, anon, authenticated;
grant select, insert, update, delete on public.ai_recipe_requests to service_role;

create function public.ai_recipe_requests_available()
returns table(available boolean) language sql security invoker set search_path = '' as $$
  select true where exists (select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'ai_recipe_requests');
$$;

create function public.ai_reserve_recipe_request(
  p_user_id uuid, p_request_id uuid, p_operation text, p_fingerprint text,
  p_consent_version text, p_tokens_estimated integer, p_token_budget integer,
  p_draft_budget integer, p_per_minute integer, p_max_concurrent integer,
  p_lease_ms integer
) returns table(outcome text, attempt_id uuid, budget_day date, lease_expires_at timestamptz, reason text, retry_after integer)
language plpgsql security definer set search_path = '' as $$
declare
  t timestamptz := clock_timestamp();
  d date := (t at time zone 'UTC')::date;
  ws timestamptz := date_trunc('minute', t at time zone 'UTC') at time zone 'UTC';
  prior public.ai_recipe_requests%rowtype;
  expired public.ai_recipe_requests%rowtype;
  flight public.ai_in_flight%rowtype;
  tokens public.ai_daily_token_ledger%rowtype;
  drafts public.ai_daily_draft_ledger%rowtype;
  window_count integer;
  new_id uuid;
  lease_until timestamptz;
begin
  if p_user_id is null or p_request_id is null or p_operation is null
    or p_operation not in ('suggest', 'recognize') or p_fingerprint is null
    or p_fingerprint !~ '^[0-9a-f]{64}$' or p_consent_version is null
    or length(p_consent_version) not between 1 and 100
    or p_tokens_estimated is null or p_tokens_estimated not between 1 and 2000000
    or p_token_budget is null or p_token_budget not between 1 and 2000000
    or p_draft_budget is null or p_draft_budget not between 1 and 2000000
    or p_per_minute is null or p_per_minute not between 1 and 2000000
    or p_max_concurrent is null or p_max_concurrent not between 1 and 2000000
    or p_lease_ms is null or p_lease_ms not between 1 and 90000 then
    raise sqlstate '22023' using message = 'Invalid recipe request reservation';
  end if;
  -- Same transaction fence as accepted account deletion operations.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 49));
  -- Admission starts after the lifecycle fence; never reuse a pre-wait day/window.
  t := clock_timestamp();
  d := (t at time zone 'UTC')::date;
  ws := date_trunc('minute', t at time zone 'UTC') at time zone 'UTC';
  if not exists (select 1 from auth.users where id = p_user_id)
    or exists (select 1 from public.account_deletion_jobs j where j.user_id = p_user_id
      and j.status in ('in_progress', 'failed', 'completed')) then
    return query select 'denied', null::uuid, null::date, null::timestamptz, 'deletion', 0; return;
  end if;
  -- Row lock also serializes consent revocation against admission.
  perform 1 from public.user_ai_consents c where c.user_id = p_user_id
    and c.granted and c.confirmed_adult and c.revoked_at is null
    and c.consent_version = p_consent_version for share;
  if not found then
    return query select 'denied', null::uuid, null::date, null::timestamptz, 'consent', 0; return;
  end if;
  select r.* into prior from public.ai_recipe_requests r
    where r.user_id = p_user_id and r.request_id = p_request_id and r.operation = p_operation for update;
  if found then
    if prior.fingerprint <> p_fingerprint then
      return query select 'conflict', null::uuid, null::date, null::timestamptz, null::text, 0; return;
    end if;
    if prior.status = 'attempting' and prior.lease_expires_at > t then
      return query select 'busy', null::uuid, null::date, null::timestamptz, null::text,
        greatest(1, ceil(extract(epoch from (prior.lease_expires_at - t))))::integer; return;
    end if;
    -- Expiry never reopens the identity or refunds the conservative charge.
    if prior.status = 'attempting' then
      update public.ai_recipe_requests r set status = 'expired', updated_at = t where r.attempt_id = prior.attempt_id;
      update public.ai_in_flight f set in_flight = greatest(0, f.in_flight - 1)
        where f.user_id = p_user_id and f.acquired_at <= prior.lease_expires_at;
    end if;
    return query select 'outcome_unavailable', null::uuid, null::date, null::timestamptz, null::text, 0; return;
  end if;
  -- Recover expired slots without touching token/draft charges. Recipes have a
  -- shorter lease than the existing two-minute shared in-flight recovery.
  for expired in select r.* from public.ai_recipe_requests r where r.user_id = p_user_id
    and r.status = 'attempting' and r.lease_expires_at <= t for update loop
    update public.ai_recipe_requests r set status = 'expired', updated_at = t where r.attempt_id = expired.attempt_id;
    update public.ai_in_flight f set in_flight = greatest(0, f.in_flight - 1)
      where f.user_id = p_user_id and f.acquired_at <= expired.lease_expires_at;
  end loop;
  insert into public.ai_in_flight(user_id, in_flight, acquired_at) values(p_user_id, 0, t) on conflict (user_id) do nothing;
  select f.* into flight from public.ai_in_flight f where f.user_id = p_user_id for update;
  if flight.acquired_at < t - interval '2 minutes' then
    flight.in_flight := 0;
  end if;
  if flight.in_flight >= p_max_concurrent then
    return query select 'denied', null::uuid, null::date, null::timestamptz, 'inflight', 1; return;
  end if;
  insert into public.ai_daily_token_ledger(user_id, day, tokens_used, reserved_tokens) values(p_user_id, d, 0, 0) on conflict(user_id, day) do nothing;
  select l.* into tokens from public.ai_daily_token_ledger l where l.user_id = p_user_id and l.day = d for update;
  if tokens.tokens_used::bigint + tokens.reserved_tokens + p_tokens_estimated > p_token_budget then
    return query select 'denied', null::uuid, null::date, null::timestamptz, 'tokens',
      greatest(1, ceil(extract(epoch from (((d + 1)::timestamp at time zone 'UTC') - t))))::integer; return;
  end if;
  insert into public.ai_daily_draft_ledger(user_id, day, drafts_used, reserved_drafts) values(p_user_id, d, 0, 0) on conflict(user_id, day) do nothing;
  select l.* into drafts from public.ai_daily_draft_ledger l where l.user_id = p_user_id and l.day = d for update;
  if drafts.drafts_used::bigint + drafts.reserved_drafts >= p_draft_budget then
    return query select 'denied', null::uuid, null::date, null::timestamptz, 'drafts',
      greatest(1, ceil(extract(epoch from (((d + 1)::timestamp at time zone 'UTC') - t))))::integer; return;
  end if;
  insert into public.ai_request_windows(user_id, window_start, request_count) values(p_user_id, ws, 0) on conflict(user_id, window_start) do nothing;
  select w.request_count into window_count from public.ai_request_windows w where w.user_id = p_user_id and w.window_start = ws for update;
  if window_count >= p_per_minute then
    return query select 'denied', null::uuid, null::date, null::timestamptz, 'minute',
      greatest(1, ceil(extract(epoch from (ws + interval '1 minute' - t))))::integer; return;
  end if;
  t := clock_timestamp();
  update public.ai_in_flight f set in_flight = flight.in_flight + 1, acquired_at = t where f.user_id = p_user_id;
  update public.ai_daily_token_ledger l set tokens_used = l.tokens_used + p_tokens_estimated, updated_at = t where l.user_id = p_user_id and l.day = d;
  update public.ai_daily_draft_ledger l set drafts_used = l.drafts_used + 1, updated_at = t where l.user_id = p_user_id and l.day = d;
  update public.ai_request_windows w set request_count = w.request_count + 1 where w.user_id = p_user_id and w.window_start = ws;
  lease_until := clock_timestamp() + p_lease_ms * interval '1 millisecond';
  insert into public.ai_recipe_requests(user_id, request_id, operation, fingerprint, consent_version, budget_day, tokens_estimated, tokens_charged, created_at, lease_expires_at)
    values(p_user_id, p_request_id, p_operation, p_fingerprint, p_consent_version, d, p_tokens_estimated, p_tokens_estimated, t, lease_until)
    returning ai_recipe_requests.attempt_id into new_id;
  return query select 'reserved', new_id, d, lease_until, null::text, 0;
end;
$$;

create function public.ai_finalize_recipe_request(p_user_id uuid, p_attempt_id uuid, p_status text, p_tokens_used integer default null)
returns table(publish_allowed boolean) language plpgsql security definer set search_path = '' as $$
declare
  t timestamptz := clock_timestamp();
  r public.ai_recipe_requests%rowtype;
  allowed boolean := false;
  charged integer;
begin
  if p_status is null or p_status not in ('succeeded', 'failed') or
    (p_tokens_used is not null and (p_tokens_used < 0 or p_tokens_used > 2000000)) then
    raise sqlstate '22023' using message = 'Invalid recipe request settlement';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 49));
  select q.* into r from public.ai_recipe_requests q where q.user_id = p_user_id and q.attempt_id = p_attempt_id for update;
  if not found or r.status <> 'attempting' then return query select false; return; end if;
  t := clock_timestamp();
  if r.lease_expires_at <= t then
    update public.ai_recipe_requests q set status = 'expired', updated_at = t where q.attempt_id = r.attempt_id;
    update public.ai_in_flight f set in_flight = greatest(0, f.in_flight - 1) where f.user_id = p_user_id and f.acquired_at <= r.lease_expires_at;
    return query select false; return;
  end if;
  perform 1 from public.user_ai_consents c where c.user_id = p_user_id and c.granted and c.confirmed_adult
    and c.revoked_at is null and c.consent_version = r.consent_version for share;
  allowed := found and r.lease_expires_at > clock_timestamp() and not exists(select 1 from public.account_deletion_jobs j where j.user_id = p_user_id and j.status in ('in_progress', 'failed', 'completed'));
  charged := case when p_status = 'succeeded' and p_tokens_used is not null then p_tokens_used else r.tokens_estimated end;
  -- Original admission day, even if the provider response crosses midnight.
  update public.ai_daily_token_ledger l set tokens_used = greatest(0, l.tokens_used + charged - r.tokens_charged), updated_at = t
    where l.user_id = p_user_id and l.day = r.budget_day;
  update public.ai_recipe_requests q set status = p_status, tokens_charged = charged, updated_at = t where q.attempt_id = r.attempt_id;
  update public.ai_in_flight f set in_flight = greatest(0, f.in_flight - 1) where f.user_id = p_user_id and f.acquired_at <= r.lease_expires_at;
  return query select allowed and p_status = 'succeeded';
end;
$$;

revoke all on function public.ai_recipe_requests_available(),
  public.ai_reserve_recipe_request(uuid,uuid,text,text,text,integer,integer,integer,integer,integer,integer),
  public.ai_finalize_recipe_request(uuid,uuid,text,integer) from public, anon, authenticated;
grant execute on function public.ai_recipe_requests_available(),
  public.ai_reserve_recipe_request(uuid,uuid,text,text,text,integer,integer,integer,integer,integer,integer),
  public.ai_finalize_recipe_request(uuid,uuid,text,integer) to service_role;
