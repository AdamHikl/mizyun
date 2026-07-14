create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  status text not null default 'active' check (status in ('active', 'archived')),
  provider_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id)
);

create index conversations_user_time_idx
on public.conversations(user_id, updated_at desc);
create trigger conversations_set_updated_at before update on public.conversations
for each row execute function public.set_updated_at();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content jsonb not null,
  provider_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (conversation_id, user_id)
    references public.conversations(id, user_id) on delete cascade
);

create index messages_user_conversation_time_idx
on public.messages(user_id, conversation_id, created_at);

create table public.memory_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  content text not null,
  source text not null,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  importance smallint not null check (importance between 0 and 10),
  status text not null default 'active' check (status in ('candidate', 'active', 'superseded', 'deleted')),
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id)
);

create index memory_items_user_status_idx
on public.memory_items(user_id, status, updated_at desc);
create trigger memory_items_set_updated_at before update on public.memory_items
for each row execute function public.set_updated_at();

create table public.memory_provider_refs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  memory_id uuid not null,
  provider text not null,
  external_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (provider, external_id),
  foreign key (memory_id, user_id)
    references public.memory_items(id, user_id) on delete cascade
);

create index memory_provider_refs_user_memory_idx
on public.memory_provider_refs(user_id, memory_id);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.memory_items enable row level security;
alter table public.memory_provider_refs enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'conversations', 'messages', 'memory_items', 'memory_provider_refs'
  ] loop
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      table_name || '_own_all',
      table_name
    );
  end loop;
end;
$$;
