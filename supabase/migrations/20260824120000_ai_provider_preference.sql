-- AI-PROV-001: multi-provider selection (Mistral & Gemini).
--
-- Adds the user-selected active AI model provider to public.profiles.
-- Defaults to 'mistral' for full backwards compatibility.
alter table public.profiles
  add column if not exists ai_provider text not null default 'mistral'
  check (ai_provider in ('mistral', 'gemini'));

comment on column public.profiles.ai_provider is
  'User-selected active AI model provider (mistral or gemini).';
