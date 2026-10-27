-- Synthetic scorecard fixture (no real accounts). Minimal copies of the Auth
-- users table and the two analytics tables from
-- supabase/migrations/20260913100000_product_analytics_backend.sql.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, created_at timestamptz NOT NULL);
CREATE TABLE public.product_analytics_consents (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  version text NOT NULL DEFAULT 'product-analytics-v2',
  granted boolean NOT NULL DEFAULT false,
  epoch uuid NOT NULL
);
CREATE TABLE public.product_analytics_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  epoch uuid NOT NULL,
  version text NOT NULL DEFAULT 'product-analytics-v2',
  event_name text NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, id)
);

-- Signup dates: u7 joined in the W44 cohort; u8 and u9 are older accounts.
INSERT INTO auth.users (id, created_at)
SELECT ('00000000-0000-4000-8000-00000000000' || n)::uuid, at::timestamptz
FROM (VALUES (1, '2026-11-16T09:55Z'), (2, '2026-11-17T07:00Z'), (3, '2026-11-19T08:00Z'),
  (4, '2026-11-18T07:00Z'), (5, '2026-11-18T07:00Z'), (6, '2026-11-24T07:30Z'),
  (7, '2026-10-25T08:00Z'), (8, '2026-10-01T08:00Z'), (9, '2026-10-01T08:00Z')) AS v(n, at);

-- u5 revoked; u4 re-granted under a new epoch (its old events no longer count).
INSERT INTO public.product_analytics_consents (user_id, granted, epoch)
SELECT ('00000000-0000-4000-8000-00000000000' || n)::uuid, n <> 5,
  CASE WHEN n = 4 THEN 'eeeeeeee-0000-4000-8000-000000000002'::uuid
       ELSE 'eeeeeeee-0000-4000-8000-000000000001'::uuid END
FROM generate_series(1, 9) n;

INSERT INTO public.product_analytics_events (user_id, epoch, event_name, properties, recorded_at)
SELECT ('00000000-0000-4000-8000-00000000000' || u)::uuid,
  'eeeeeeee-0000-4000-8000-000000000001'::uuid, name, props::jsonb, at::timestamptz
FROM (VALUES
  -- u1: activated climber with a day-7 return.
  (1, 'first_run_completed', '{"choice":"climb","duration":"under_30_seconds"}', '2026-11-16T10:00Z'),
  (1, 'acquisition_source_selected', '{"source":"climbing_gym_or_club"}', '2026-11-16T10:00Z'),
  (1, 'first_confirmed_record', '{"recordKind":"bouldering_session"}', '2026-11-16T11:30Z'),
  (1, 'core_record_created', '{"recordKind":"bouldering_session"}', '2026-11-16T11:30Z'),
  (1, 'return_milestone_reached', '{"milestone":"day_7","cohortWeek":"2026-W47"}', '2026-11-18T09:00Z'),
  -- u2: first record nine days after the first run: not activated.
  (2, 'first_run_completed', '{"choice":"meal","duration":"under_30_seconds"}', '2026-11-17T08:00Z'),
  (2, 'acquisition_source_selected', '{"source":"instagram"}', '2026-11-17T08:00Z'),
  (2, 'first_confirmed_record', '{"recordKind":"meal"}', '2026-11-26T08:00Z'),
  -- u3: "Just look around", never logged: still in the activation denominator.
  (3, 'first_run_completed', '{"choice":"explore","duration":"30_to_59_seconds"}', '2026-11-20T08:00Z'),
  -- u4 and u5: excluded by epoch and revocation.
  (4, 'first_run_completed', '{"choice":"climb","duration":"under_30_seconds"}', '2026-11-18T08:00Z'),
  (4, 'first_confirmed_record', '{"recordKind":"bouldering_session"}', '2026-11-18T09:00Z'),
  (5, 'first_run_completed', '{"choice":"climb","duration":"under_30_seconds"}', '2026-11-18T08:00Z'),
  (5, 'first_confirmed_record', '{"recordKind":"bouldering_session"}', '2026-11-18T09:00Z'),
  -- u6: installed in the report week.
  (6, 'first_run_completed', '{"choice":"workout","duration":"under_30_seconds"}', '2026-11-24T08:00Z'),
  (6, 'acquisition_source_selected', '{"source":"friend_or_family"}', '2026-11-24T08:00Z'),
  (6, 'first_confirmed_record', '{"recordKind":"workout"}', '2026-11-24T09:00Z'),
  -- u7: week-4 return for the W44 cohort; a W43 return must not count.
  (7, 'return_milestone_reached', '{"milestone":"day_28","cohortWeek":"2026-W44"}', '2026-11-20T09:00Z'),
  (7, 'return_milestone_reached', '{"milestone":"day_28","cohortWeek":"2026-W43"}', '2026-11-13T09:00Z'),
  (7, 'core_record_created', '{"recordKind":"meal"}', '2026-11-20T09:00Z'),
  -- u8: active only before the MAU window and on the report date itself.
  (8, 'core_record_created', '{"recordKind":"meal"}', '2026-10-20T09:00Z'),
  (8, 'core_record_created', '{"recordKind":"meal"}', '2026-11-30T09:00Z'),
  -- u8: an old account's W44 label must not count as a new-user return.
  (8, 'return_milestone_reached', '{"milestone":"day_28","cohortWeek":"2026-W44"}', '2026-11-20T09:00Z'),
  -- u9: an old account that saw the first-run card on a new device.
  (9, 'first_run_completed', '{"choice":"meal","duration":"under_30_seconds"}', '2026-11-25T08:00Z'),
  (9, 'acquisition_source_selected', '{"source":"reddit"}', '2026-11-25T08:00Z'),
  (9, 'first_confirmed_record', '{"recordKind":"meal"}', '2026-11-25T08:05Z')
) AS v(u, name, props, at);

-- u4's re-granted epoch: no events.
UPDATE public.product_analytics_events SET epoch = 'eeeeeeee-0000-4000-8000-000000000001'::uuid
WHERE user_id = '00000000-0000-4000-8000-000000000004'::uuid;
