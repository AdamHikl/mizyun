begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(40);

select has_table(
  'public',
  table_name,
  format('public.%s exists', table_name)
)
from unnest(array[
  'profiles',
  'goals',
  'body_measurements',
  'food_entries',
  'exercises',
  'workouts',
  'workout_sets',
  'conversations',
  'messages',
  'memory_items',
  'memory_provider_refs',
  'media_assets'
]) as table_name;

select ok(
  class.relrowsecurity,
  format('RLS is enabled on public.%s', tables.table_name)
)
from unnest(array[
  'profiles',
  'goals',
  'body_measurements',
  'food_entries',
  'exercises',
  'workouts',
  'workout_sets',
  'conversations',
  'messages',
  'memory_items',
  'memory_provider_refs',
  'media_assets'
]) as tables(table_name)
join pg_namespace as namespace on namespace.nspname = 'public'
join pg_class as class
  on class.relnamespace = namespace.oid
  and class.relname = tables.table_name;

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = tables.table_name
      and 'authenticated' = any(roles)
  ),
  format('public.%s has an authenticated ownership policy', tables.table_name)
)
from unnest(array[
  'profiles',
  'goals',
  'body_measurements',
  'food_entries',
  'exercises',
  'workouts',
  'workout_sets',
  'conversations',
  'messages',
  'memory_items',
  'memory_provider_refs',
  'media_assets'
]) as tables(table_name);

select has_column(
  'public',
  'messages',
  'status',
  'messages has a delivery status'
);

select has_column(
  'public',
  'profiles',
  'coaching_preferences',
  'profiles store explicit Coach personalization'
);

select has_column(
  'public',
  'messages',
  'idempotency_key',
  'messages has a retry-safe idempotency key'
);

select has_index(
  'public',
  'messages',
  'messages_user_conversation_idempotency_idx',
  'messages enforce one user message per idempotency key'
);

select * from finish();
rollback;
