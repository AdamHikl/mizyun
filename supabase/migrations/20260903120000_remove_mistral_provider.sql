-- AI-PROV-002: Standardize on Gemini as sole AI model provider.
--
-- Updates existing profiles with 'mistral' to 'gemini', sets default to 'gemini',
-- and updates the check constraint to only allow 'gemini'.

update public.profiles
  set ai_provider = 'gemini'
  where ai_provider = 'mistral';

alter table public.profiles
  alter column ai_provider set default 'gemini';

alter table public.profiles
  drop constraint if exists profiles_ai_provider_check;

alter table public.profiles
  add constraint profiles_ai_provider_check check (ai_provider in ('gemini'));

comment on column public.profiles.ai_provider is
  'Active AI model provider (gemini).';
