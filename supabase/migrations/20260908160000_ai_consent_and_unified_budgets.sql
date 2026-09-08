-- Q8-B: Explicit versioned AI-sharing consent persistence and authorization (Finding R5 / REL-AUD-005)
-- Creates public.user_ai_consents with RLS and owner enforcement.

set check_function_bodies = off;

create table if not exists public.user_ai_consents (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  granted         boolean not null default false,
  confirmed_adult boolean not null default false,
  consent_version text not null,
  consented_at    timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists user_ai_consents_user_idx
  on public.user_ai_consents(user_id);

alter table public.user_ai_consents enable row level security;

drop policy if exists user_ai_consents_select on public.user_ai_consents;
create policy user_ai_consents_select on public.user_ai_consents
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists user_ai_consents_insert on public.user_ai_consents;
create policy user_ai_consents_insert on public.user_ai_consents
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists user_ai_consents_update on public.user_ai_consents;
create policy user_ai_consents_update on public.user_ai_consents
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant all privileges on table public.user_ai_consents to service_role;
grant select, insert, update on table public.user_ai_consents to authenticated;
