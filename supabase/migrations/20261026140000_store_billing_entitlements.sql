-- GTM-01 / #332 / ADR-0080: Store subscription entitlements.
--
-- The API verifies a signed billing webhook, re-reads the user's current
-- entitlement from the billing service, and records it here with the service
-- role. `profiles.plan_tier` is then recomputed by a SECURITY DEFINER function:
-- paid while a subscription entitlement is active OR a Beta Pro request is
-- approved; free when a subscription that granted paid ends; otherwise left as
-- an operator set it. Clients can read their own row and never write it.

create table public.subscription_entitlements (
  -- One row per user; the primary key is the required user_id index.
  user_id uuid primary key references auth.users(id) on delete cascade,
  entitlement_id text not null check (length(entitlement_id) between 1 and 100),
  status text not null check (status in ('active', 'expired')),
  product_id text check (product_id is null or length(product_id) between 1 and 200),
  store text check (store is null or store in ('app_store', 'play_store', 'other')),
  environment text check (environment is null or environment in ('sandbox', 'production')),
  in_trial boolean not null default false,
  will_renew boolean not null default false,
  billing_issue boolean not null default false,
  expires_at timestamptz,
  -- Time of the billing-service snapshot this row reflects; writes only move forward.
  observed_at timestamptz not null,
  last_event_id text check (last_event_id is null or length(last_event_id) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'active' or (not in_trial and not will_renew and not billing_issue))
);

alter table public.subscription_entitlements enable row level security;
revoke all on public.subscription_entitlements from public, anon, authenticated;
grant select on public.subscription_entitlements to authenticated;
grant all on public.subscription_entitlements to service_role;
create policy subscription_entitlements_owner_select on public.subscription_entitlements
  for select to authenticated using (user_id = (select auth.uid()));
create trigger subscription_entitlements_set_updated_at before update on public.subscription_entitlements
  for each row execute function public.set_updated_at();

-- Webhook idempotency ledger. Service role only; holds no user identifier, so it
-- is not personal data and is not exported. Rows older than 90 days are pruned.
create table public.billing_webhook_events (
  event_id text primary key check (length(event_id) between 1 and 200),
  event_type text not null check (length(event_type) between 1 and 64),
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index billing_webhook_events_received_idx on public.billing_webhook_events(received_at);
alter table public.billing_webhook_events enable row level security;
revoke all on public.billing_webhook_events from public, anon, authenticated;
grant all on public.billing_webhook_events to service_role;

-- Returns true when the event was already processed (a replay); otherwise
-- records it (or keeps an earlier unfinished attempt) and returns false.
create or replace function public.billing_claim_webhook_event(p_event_id text, p_event_type text)
returns table(already_processed boolean)
language plpgsql security invoker set search_path = '' as $$
declare
  done timestamptz;
begin
  delete from public.billing_webhook_events where received_at < now() - interval '90 days';
  insert into public.billing_webhook_events(event_id, event_type)
    values (p_event_id, p_event_type)
    on conflict (event_id) do nothing;
  select processed_at into done from public.billing_webhook_events where event_id = p_event_id;
  return query select done is not null;
end;
$$;

create or replace function public.billing_complete_webhook_event(p_event_id text)
returns void
language sql security invoker set search_path = '' as $$
  update public.billing_webhook_events set processed_at = coalesce(processed_at, now())
   where event_id = p_event_id;
$$;

-- The only path that changes plan_tier for billing; execution is limited to
-- service_role. Paid while a subscription is active or Beta Pro is approved.
-- It clears paid only when a subscription that granted it has ended, so a paid
-- tier granted directly by an operator survives syncs that find no purchase.
-- Callers hold the profile row lock.
create or replace function public.billing_recompute_plan_tier(
  p_user_id uuid, p_subscription_was_active boolean
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  current_tier text;
  next_tier text;
begin
  select p.plan_tier into current_tier from public.profiles p where p.id = p_user_id;
  if not found then
    return null;
  end if;
  if exists (select 1 from public.subscription_entitlements e
              where e.user_id = p_user_id and e.status = 'active'
                and (e.expires_at is null or e.expires_at > now()))
     or exists (select 1 from public.beta_pro_requests b
                 where b.user_id = p_user_id and b.status = 'approved') then
    next_tier := 'paid';
  elsif p_subscription_was_active then
    next_tier := 'free';
  else
    next_tier := current_tier;
  end if;
  if next_tier is distinct from current_tier then
    update public.profiles set plan_tier = next_tier, updated_at = now()
     where id = p_user_id;
  end if;
  return next_tier;
end;
$$;

create or replace function public.billing_apply_entitlement(
  p_user_id uuid, p_entitlement_id text, p_status text, p_product_id text,
  p_store text, p_environment text, p_in_trial boolean, p_will_renew boolean,
  p_billing_issue boolean, p_expires_at timestamptz, p_observed_at timestamptz,
  p_event_id text
) returns table(applied boolean, plan_tier text)
language plpgsql security definer set search_path = '' as $$
declare
  wrote boolean := false;
  was_active boolean;
begin
  -- Serialize concurrent applies for one user on the profile row.
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then
    return query select false, null::text;
    return;
  end if;
  -- Any stored active row counts, even one whose period has passed: it is the
  -- grant that an expired snapshot now ends.
  select coalesce(bool_or(e.status = 'active'), false) into was_active
    from public.subscription_entitlements e where e.user_id = p_user_id;
  insert into public.subscription_entitlements as e(
      user_id, entitlement_id, status, product_id, store, environment, in_trial,
      will_renew, billing_issue, expires_at, observed_at, last_event_id)
    values (p_user_id, p_entitlement_id, p_status, p_product_id, p_store, p_environment,
      p_in_trial, p_will_renew, p_billing_issue, p_expires_at, p_observed_at, p_event_id)
    on conflict (user_id) do update set
      entitlement_id = excluded.entitlement_id, status = excluded.status,
      product_id = excluded.product_id, store = excluded.store,
      environment = excluded.environment, in_trial = excluded.in_trial,
      will_renew = excluded.will_renew, billing_issue = excluded.billing_issue,
      expires_at = excluded.expires_at, observed_at = excluded.observed_at,
      last_event_id = coalesce(excluded.last_event_id, e.last_event_id)
    -- An older snapshot (slow request, reordered retry) never overwrites a newer one.
    where e.observed_at <= excluded.observed_at
    returning true into wrote;
  return query select coalesce(wrote, false), public.billing_recompute_plan_tier(p_user_id, was_active);
end;
$$;

-- Beta Pro rejection no longer clears a paid subscription (and approval is unchanged).
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
    -- Lock first so a concurrent billing apply commits before the check below
    -- takes its snapshot (READ COMMITTED gives each statement a new one).
    perform 1 from public.profiles where id = new.user_id for update;
    update public.profiles
       set plan_tier = case when exists (
             select 1 from public.subscription_entitlements e
              where e.user_id = new.user_id and e.status = 'active'
                and (e.expires_at is null or e.expires_at > now()))
           then 'paid' else 'free' end,
           updated_at = now()
     where id = new.user_id;
  end if;
  return new;
end;
$$;

revoke all on function public.billing_claim_webhook_event(text, text) from public, anon, authenticated;
revoke all on function public.billing_complete_webhook_event(text) from public, anon, authenticated;
revoke all on function public.billing_recompute_plan_tier(uuid, boolean) from public, anon, authenticated;
revoke all on function public.billing_apply_entitlement(uuid, text, text, text, text, text, boolean, boolean, boolean, timestamptz, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.billing_claim_webhook_event(text, text) to service_role;
grant execute on function public.billing_complete_webhook_event(text) to service_role;
grant execute on function public.billing_recompute_plan_tier(uuid, boolean) to service_role;
grant execute on function public.billing_apply_entitlement(uuid, text, text, text, text, text, boolean, boolean, boolean, timestamptz, timestamptz, text)
  to service_role;
