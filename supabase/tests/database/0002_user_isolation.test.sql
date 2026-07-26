begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(30);

insert into auth.users (id, email)
values
  ('10000000-0000-4000-8000-000000000001', 'user-a@mizyun.test'),
  ('10000000-0000-4000-8000-000000000002', 'user-b@mizyun.test');

-- The auth-profile trigger creates the row on user insert; we just
-- flip the plan_tier. AI-OPS-001 §1 locks free to 5k tokens/day and
-- paid to 100k tokens/day.
update public.profiles set plan_tier = 'free'
  where id = '10000000-0000-4000-8000-000000000001';
update public.profiles set plan_tier = 'paid'
  where id = '10000000-0000-4000-8000-000000000002';

select lives_ok(
  $$update public.profiles
    set coaching_preferences = '{
      "experienceLevel": "intermediate",
      "trainingDaysPerWeek": 4,
      "sessionDurationMinutes": 60,
      "trainingFocus": "strength",
      "availableEquipment": ["barbell", "rack"],
      "dietaryPreferences": ["omnivore"],
      "trainingLimitations": []
    }'::jsonb
    where id = '10000000-0000-4000-8000-000000000001'$$,
  'normalized Coach preferences satisfy the database constraint'
);

select throws_ok(
  $$update public.profiles
    set coaching_preferences = '{
      "experienceLevel": "expert",
      "trainingDaysPerWeek": 9,
      "sessionDurationMinutes": 5,
      "trainingFocus": "unsafe",
      "availableEquipment": ["unknown"],
      "dietaryPreferences": [],
      "trainingLimitations": []
    }'::jsonb
    where id = '10000000-0000-4000-8000-000000000001'$$,
  '23514',
  'new row for relation "profiles" violates check constraint "profiles_coaching_preferences_object"',
  'invalid Coach preferences fail closed at the database boundary'
);

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
  $$insert into public.goals (user_id, kind, status) values ('10000000-0000-4000-8000-000000000001', 'own-goal', 'archived')$$,
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

-- =========================================================================
-- AI-OPS-001: per-tier limiter pgTAP cases (AI-003 plan §6).
-- Run as service_role so the SECURITY DEFINER RPCs are accessible.
-- =========================================================================

reset role;
set local role service_role;

-- Free-tier user (A) is blocked at the 5_000-token cap. The
-- reserve call uses `p_needed = 5_001` so the check
-- `cur + p_needed > budget` actually fires.
select is(
  (
    select (allowed)::text
    from public.ai_reserve_tokens(
      '10000000-0000-4000-8000-000000000001',
      current_date,
      5_000,
      5_001
    )
    limit 1
  ),
  'false',
  'free tier rejects a request that would push past the 5k token cap'
);

-- A free-tier commit with zero tokens is a no-op (no row error).
select lives_ok(
  $$select public.ai_commit_tokens('10000000-0000-4000-8000-000000000001', current_date, 0)$$,
  'free-tier commit_tokens is a no-op for zero tokens'
);

-- Paid-tier user (B) passes a 100_000-token budget reserve.
select is(
  (
    select (allowed)::text
    from public.ai_reserve_tokens(
      '10000000-0000-4000-8000-000000000002',
      current_date,
      100_000,
      1_200
    )
    limit 1
  ),
  'true',
  'paid tier passes a 1_200-token reserve under the 100k cap'
);

-- Cross-replica replay: same (user, conversation, key) returns the
-- same provider_call_id without double-incrementing tokens. We
-- reuse the user-B conversation that already exists in this test.
select is(
  (
    select outcome::text from public.ai_reserve_provider_call(
      '10000000-0000-4000-8000-000000000002',
      '40000000-0000-4000-8000-000000000002',
      'replay-key-001'
    )
    limit 1
  ),
  'reserved',
  'first reserve creates a provider-call row with outcome=reserved'
);

select is(
  (
    select outcome::text from public.ai_reserve_provider_call(
      '10000000-0000-4000-8000-000000000002',
      '40000000-0000-4000-8000-000000000002',
      'replay-key-001'
    )
    limit 1
  ),
  'replayed',
  'second reserve with the same key returns outcome=replayed'
);

-- =========================================================================
-- AI-OPS-002: RPC EXECUTE is restricted to service_role (ADR-0017).
-- =========================================================================

-- anon role has no grant on the limiter RPCs.
reset role;
set local role anon;
set local search_path = public, extensions;

select throws_ok(
  $$select public.ai_reserve_tokens('10000000-0000-4000-8000-000000000001', current_date, 5000, 1)$$,
  '42501',
  'permission denied for function ai_reserve_tokens',
  'anon role cannot execute ai_reserve_tokens'
);

select throws_ok(
  $$select public.ai_reserve_provider_call('10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'anon-key')$$,
  '42501',
  'permission denied for function ai_reserve_provider_call',
  'anon role cannot execute ai_reserve_provider_call'
);

-- The authenticated role has no grant on the limiter RPCs either;
-- only service_role (used by the API composition root) writes
-- through this surface.
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
set local search_path = public, extensions;

select throws_ok(
  $$select public.ai_commit_tokens('10000000-0000-4000-8000-000000000001', current_date, 1)$$,
  '42501',
  'permission denied for function ai_commit_tokens',
  'authenticated role cannot execute ai_commit_tokens'
);

select throws_ok(
  $$select public.ai_acquire_in_flight('10000000-0000-4000-8000-000000000001', 1)$$,
  '42501',
  'permission denied for function ai_acquire_in_flight',
  'authenticated role cannot execute ai_acquire_in_flight'
);

select * from finish();
rollback;
