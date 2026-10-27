-- Monday activation scorecard (GTM-04, docs/ACTIVATION_SCORECARD_2026-10-26.md).
-- Read-only and aggregate-only: user IDs stay inside this query and every row
-- that leaves it is a count. Only events from accounts whose current analytics
-- consent is granted, in the matching epoch, are counted.
-- Report date: `SET mizyun.scorecard_report_date = 'YYYY-MM-DD'` before running,
-- otherwise today (UTC). It snaps to the Monday of its ISO week, so the report
-- week is always the previous Monday-Sunday and week labels match cohorts.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL timezone = 'UTC';
WITH params AS (
  SELECT date_trunc('week', coalesce(nullif(current_setting('mizyun.scorecard_report_date', true), ''),
                  to_char(current_date, 'YYYY-MM-DD'))::date)::date AS d
), retained AS MATERIALIZED (
  SELECT e.user_id, e.event_name, e.properties, e.recorded_at
  FROM public.product_analytics_events e
  JOIN public.product_analytics_consents c ON c.user_id = e.user_id
    AND c.granted AND c.version = 'product-analytics-v2'
    AND c.epoch = e.epoch AND e.version = c.version
  CROSS JOIN params p
  WHERE e.recorded_at < p.d::timestamptz
), first_run AS (
  -- New accounts only: Auth signup within 7 days before the first run. Older
  -- accounts that see the card (no display name, new device) are excluded.
  SELECT r.user_id, min(r.recorded_at) AS at FROM retained r
  JOIN auth.users u ON u.id = r.user_id
  WHERE r.event_name = 'first_run_completed'
  GROUP BY r.user_id, u.created_at
  HAVING min(r.recorded_at) < u.created_at + interval '7 days'
), first_record AS (
  SELECT DISTINCT ON (r.user_id) r.user_id, r.recorded_at AS at, r.properties->>'recordKind' AS kind
  FROM retained r JOIN first_run f ON f.user_id = r.user_id
  WHERE r.event_name = 'first_confirmed_record'
  ORDER BY r.user_id, r.recorded_at
), activated AS (
  -- Return cohorts start at activation: a first record within 7 days of the first run.
  SELECT r.* FROM first_record r JOIN first_run f ON f.user_id = r.user_id
  WHERE r.at < f.at + interval '7 days'
), source AS (
  SELECT DISTINCT ON (user_id) user_id, properties->>'source' AS source
  FROM retained WHERE event_name = 'acquisition_source_selected'
  ORDER BY user_id, recorded_at
), weeks AS (
  SELECT
    p.d - 7 AS report_start,            -- installs and MAU end here
    p.d - 14 AS activation_start,       -- first runs whose 7 days have ended
    p.d - 14 AS day7_start,             -- first records whose days 1-7 have ended
    p.d - 35 AS week4_start,            -- first records whose days 22-28 have ended
    p.d - 30 AS mau_start,
    p.d
  FROM params p
), installs AS (
  SELECT 'installs'::text AS metric, w.report_start AS cohort_start, w.d - 1 AS cohort_end,
    CASE WHEN grouping(s.source) = 1 THEN 'all' ELSE coalesce(s.source, 'unanswered') END AS dimension,
    count(f.user_id)::bigint AS numerator, NULL::bigint AS denominator
  FROM weeks w
  LEFT JOIN first_run f ON f.at >= w.report_start::timestamptz AND f.at < w.d::timestamptz
  LEFT JOIN source s ON s.user_id = f.user_id
  GROUP BY GROUPING SETS ((w.report_start, w.d, s.source), (w.report_start, w.d))
  HAVING grouping(s.source) = 1 OR count(f.user_id) > 0
), activation AS (
  -- Activation: first run (onboarding) plus a first confirmed record within 7 days.
  SELECT 'activated'::text, w.activation_start, w.activation_start + 6,
    CASE WHEN grouping(s.source) = 1 THEN 'all' ELSE coalesce(s.source, 'unanswered') END,
    count(f.user_id) FILTER (WHERE r.at < f.at + interval '7 days')::bigint,
    count(f.user_id)::bigint
  FROM weeks w
  LEFT JOIN first_run f
    ON f.at >= w.activation_start::timestamptz AND f.at < (w.activation_start + 7)::timestamptz
  LEFT JOIN first_record r ON r.user_id = f.user_id
  LEFT JOIN source s ON s.user_id = f.user_id
  GROUP BY GROUPING SETS ((w.activation_start, s.source), (w.activation_start))
  HAVING grouping(s.source) = 1 OR count(f.user_id) > 0
), first_record_kinds AS (
  SELECT 'first_record_kind'::text, w.report_start, w.d - 1, r.kind, count(*)::bigint, NULL::bigint
  FROM first_record r JOIN weeks w ON r.at >= w.report_start::timestamptz AND r.at < w.d::timestamptz
  GROUP BY w.report_start, w.d, r.kind
), day7 AS (
  SELECT 'day_7_return'::text, w.day7_start, w.day7_start + 6, 'all'::text,
    count(r.user_id) FILTER (WHERE EXISTS (
      SELECT 1 FROM retained e WHERE e.user_id = r.user_id
        AND e.event_name = 'return_milestone_reached' AND e.properties->>'milestone' = 'day_7'))::bigint,
    count(r.user_id)::bigint
  FROM weeks w LEFT JOIN activated r
    ON r.at >= w.day7_start::timestamptz AND r.at < (w.day7_start + 7)::timestamptz
  GROUP BY w.day7_start
), week4 AS (
  -- Numerator from the cohort label; the cohort's first records are usually past
  -- the 30-day retention by now, so the denominator is the ledger value recorded
  -- as `first_record_cohort` four weeks earlier (NULL here, never a fake zero).
  SELECT 'week_4_return'::text, w.week4_start, w.week4_start + 6,
    to_char(w.week4_start, 'IYYY-"W"IW'),
    -- Activated in that week implies signup at most 14 days before it.
    (SELECT count(DISTINCT e.user_id) FROM retained e JOIN auth.users u ON u.id = e.user_id
      WHERE e.event_name = 'return_milestone_reached' AND e.properties->>'milestone' = 'day_28'
        AND e.properties->>'cohortWeek' = to_char(w.week4_start, 'IYYY-"W"IW')
        AND u.created_at >= (w.week4_start - 14)::timestamptz
        AND u.created_at < (w.week4_start + 7)::timestamptz)::bigint,
    NULL::bigint
  FROM weeks w
), cohort_ledger AS (
  -- Record this each Monday: it becomes the week-4 denominator in four weeks.
  SELECT 'first_record_cohort'::text, w.report_start, w.d - 1,
    to_char(w.report_start, 'IYYY-"W"IW'), count(r.user_id)::bigint, NULL::bigint
  FROM weeks w LEFT JOIN activated r
    ON r.at >= w.report_start::timestamptz AND r.at < w.d::timestamptz
  GROUP BY w.report_start, w.d
), mau AS (
  SELECT 'mau'::text, w.mau_start, w.d - 1, 'all'::text,
    count(DISTINCT e.user_id)::bigint,
    (SELECT count(*) FROM public.product_analytics_consents
      WHERE granted AND version = 'product-analytics-v2')::bigint
  FROM weeks w LEFT JOIN retained e
    ON e.recorded_at >= w.mau_start::timestamptz AND e.recorded_at < w.d::timestamptz
    AND e.event_name IN ('core_record_created', 'first_confirmed_record', 'return_milestone_reached')
  GROUP BY w.mau_start, w.d
), coverage AS (
  SELECT 'registrations'::text, w.report_start, w.d - 1, 'all'::text,
    (SELECT count(*) FROM auth.users u WHERE u.created_at >= w.report_start::timestamptz
      AND u.created_at < w.d::timestamptz)::bigint, NULL::bigint
  FROM weeks w
  UNION ALL
  SELECT 'registered_accounts'::text, NULL::date, w.d - 1, 'all'::text,
    (SELECT count(*) FROM auth.users u WHERE u.created_at < w.d::timestamptz)::bigint, NULL::bigint
  FROM weeks w
  UNION ALL
  SELECT 'consenting_accounts', NULL, w.d - 1, 'all',
    (SELECT count(*) FROM public.product_analytics_consents
      WHERE granted AND version = 'product-analytics-v2')::bigint, NULL
  FROM weeks w
), rows AS (
  SELECT * FROM installs UNION ALL SELECT * FROM activation
  UNION ALL SELECT * FROM first_record_kinds UNION ALL SELECT * FROM day7
  UNION ALL SELECT * FROM week4 UNION ALL SELECT * FROM cohort_ledger
  UNION ALL SELECT * FROM mau UNION ALL SELECT * FROM coverage
)
SELECT metric, to_char(cohort_start, 'YYYY-MM-DD') AS cohort_start,
  to_char(cohort_end, 'YYYY-MM-DD') AS cohort_end, dimension, numerator, denominator
FROM rows ORDER BY metric, dimension;
COMMIT;
