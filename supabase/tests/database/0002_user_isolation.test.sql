begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(19);

insert into auth.users (id, email)
values
  ('10000000-0000-4000-8000-000000000001', 'user-a@mizyun.test'),
  ('10000000-0000-4000-8000-000000000002', 'user-b@mizyun.test');

insert into public.goals (user_id, kind)
values
  ('10000000-0000-4000-8000-000000000001', 'strength'),
  ('10000000-0000-4000-8000-000000000002', 'strength');

insert into public.body_measurements (user_id, measured_at, weight_kg)
values
  ('10000000-0000-4000-8000-000000000001', now(), 80),
  ('10000000-0000-4000-8000-000000000002', now(), 70);

insert into public.food_entries (user_id, consumed_at, name, calories_kcal, confirmed_by_user)
values
  ('10000000-0000-4000-8000-000000000001', now(), 'A meal', 500, true),
  ('10000000-0000-4000-8000-000000000002', now(), 'B meal', 600, true);

insert into public.exercises (id, user_id, name)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'A squat'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'B squat');

insert into public.workouts (id, user_id, name, started_at)
values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'A workout', now()),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'B workout', now());

insert into public.workout_sets (user_id, workout_id, exercise_id, sequence, repetitions)
values
  ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 1, 5),
  ('10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 1, 5);

insert into public.conversations (id, user_id, title)
values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'A conversation'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'B conversation');

insert into public.messages (user_id, conversation_id, role, content)
values
  ('10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'user', '{"text":"A message"}'),
  ('10000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'user', '{"text":"B message"}');

insert into public.memory_items (id, user_id, kind, content, source, confidence, importance)
values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'goal', 'A goal', 'user', 1, 8),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'goal', 'B goal', 'user', 1, 8);

insert into public.memory_provider_refs (user_id, memory_id, provider, external_id)
values
  ('10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'test', 'a-memory'),
  ('10000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', 'test', 'b-memory');

insert into public.media_assets (user_id, object_path, purpose, mime_type)
values
  ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001/a.jpg', 'progress', 'image/jpeg'),
  ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002/b.jpg', 'progress', 'image/jpeg');

insert into storage.objects (bucket_id, name, owner_id)
values
  ('private-media', '10000000-0000-4000-8000-000000000001/a.jpg', '10000000-0000-4000-8000-000000000001'),
  ('private-media', '10000000-0000-4000-8000-000000000002/b.jpg', '10000000-0000-4000-8000-000000000002');

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
set local search_path = public, extensions;

select results_eq(
  format('select count(*) from public.%I', table_name),
  array[1::bigint],
  format('user A sees only their public.%s row', table_name)
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
  'media_assets'
]) as table_name;

select throws_ok(
  $$select * from public.memory_provider_refs$$,
  '42501',
  'permission denied for table memory_provider_refs',
  'authenticated clients cannot access internal memory provider references'
);

select results_eq(
  $$select count(*) from storage.objects where bucket_id = 'private-media'$$,
  array[1::bigint],
  'user A sees only their private media object'
);

select is_empty(
  $$update public.goals set status = 'archived' where user_id = '10000000-0000-4000-8000-000000000002' returning id$$,
  'user A cannot update user B records'
);

select is_empty(
  $$delete from public.goals where user_id = '10000000-0000-4000-8000-000000000002' returning id$$,
  'user A cannot delete user B records'
);

select throws_ok(
  $$insert into public.goals (user_id, kind) values ('10000000-0000-4000-8000-000000000002', 'cross-owner')$$,
  '42501',
  'new row violates row-level security policy for table "goals"',
  'user A cannot insert a record owned by user B'
);

select lives_ok(
  $$insert into public.goals (user_id, kind) values ('10000000-0000-4000-8000-000000000001', 'own-goal')$$,
  'user A can insert their own record'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('private-media', '10000000-0000-4000-8000-000000000002/cross-owner.jpg')$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'user A cannot insert into user B storage path'
);

select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('private-media', '10000000-0000-4000-8000-000000000001/own-object.jpg')$$,
  'user A can insert into their own storage path'
);

select * from finish();
rollback;
