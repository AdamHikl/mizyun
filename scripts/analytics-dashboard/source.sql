BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL timezone = 'UTC';
WITH retained AS MATERIALIZED (
  SELECT e.* FROM public.product_analytics_events e
  JOIN public.product_analytics_consents c ON c.user_id=e.user_id
    AND c.granted AND c.version='product-analytics-v2' AND c.epoch=e.epoch AND e.version=c.version
  WHERE e.recorded_at >= (current_date-29)::timestamptz AND e.recorded_at <= now()
), daily AS (
  SELECT recorded_at::date AS day, CASE WHEN grouping(platform)=1 THEN 'all' ELSE platform END platform, metric, dimension, count(*) AS value
  FROM retained e CROSS JOIN LATERAL (
    SELECT 'events'::text AS metric, 'all'::text AS dimension
    UNION ALL SELECT 'screen_views', properties->>'screen' WHERE event_name='screen_viewed'
    UNION ALL SELECT 'dashboard_clicks', properties->>'control' WHERE event_name='dashboard_control_clicked'
    UNION ALL SELECT 'settings_searches', properties->>'resultCount' WHERE event_name='settings_search_used'
    UNION ALL SELECT 'settings_selections', properties->>'destination' WHERE event_name='settings_search_selected'
    UNION ALL SELECT 'meals_logged', 'all' WHERE event_name='core_record_created' AND properties->>'recordKind'='meal'
    UNION ALL SELECT 'workouts_logged', 'all' WHERE event_name='core_record_created' AND properties->>'recordKind'='workout'
    UNION ALL SELECT 'body_records_logged', 'all' WHERE event_name='core_record_created' AND properties->>'recordKind'='body_measurement'
    UNION ALL SELECT 'onboarding_started', 'all' WHERE event_name='onboarding_started'
    UNION ALL SELECT 'onboarding_completed', 'all' WHERE event_name='onboarding_completed'
    UNION ALL SELECT 'onboarding_steps', properties->>'step' WHERE event_name='onboarding_step_completed'
    UNION ALL SELECT 'onboarding_failures', properties->>'step' WHERE event_name='onboarding_failed'
    UNION ALL SELECT 'onboarding_exits', properties->>'step' WHERE event_name='onboarding_exited'
    UNION ALL SELECT 'flow_started', properties->>'flow' WHERE event_name='logging_flow_started'
    UNION ALL SELECT 'flow_completed', properties->>'flow' WHERE event_name='logging_flow_completed'
    UNION ALL SELECT 'flow_failed', properties->>'flow' WHERE event_name='logging_flow_failed'
    UNION ALL SELECT 'flow_exited', properties->>'flow' WHERE event_name='logging_flow_exited'
    UNION ALL SELECT 'duration_bucket', (properties->>'flow')||'>'||(properties->>'duration') WHERE event_name='logging_flow_completed'
    UNION ALL SELECT 'failures', (properties->>'flow')||'>'||(properties->>'reason') WHERE event_name='logging_flow_failed'
    UNION ALL SELECT 'feature_actions', (properties->>'action')||'>'||(properties->>'outcome') WHERE event_name='feature_action_result'
    UNION ALL SELECT 'releases', CASE WHEN app_version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'
      THEN app_version||'/'||CASE WHEN build ~ '^[0-9]{1,6}$' THEN build ELSE 'unknown' END ELSE 'unknown' END
  ) m WHERE dimension IS NOT NULL
  GROUP BY GROUPING SETS ((recorded_at::date,platform,metric,dimension),(recorded_at::date,metric,dimension))
), starts AS (
  -- IDs stay in this read-only source query; only cohort counts leave it.
  SELECT DISTINCT ON (user_id,flow_id,kind) user_id,flow_id,kind,platform,recorded_at,sequence,id
  FROM retained CROSS JOIN LATERAL (
    SELECT properties->>'flow' AS kind WHERE event_name='logging_flow_started'
    UNION ALL SELECT 'onboarding' WHERE event_name='onboarding_started'
  ) k WHERE flow_id IS NOT NULL AND kind IN ('meal','workout','body_measurement','onboarding')
  ORDER BY user_id,flow_id,kind,recorded_at,sequence,id
), attempts AS (
  SELECT s.*, terminal.event_name AS terminal,
    EXISTS (SELECT 1 FROM retained e WHERE e.user_id=s.user_id AND e.flow_id=s.flow_id
      AND (e.recorded_at,e.sequence,e.id) > (s.recorded_at,s.sequence,s.id)
      AND (terminal.id IS NULL OR (e.recorded_at,e.sequence,e.id) < (terminal.recorded_at,terminal.sequence,terminal.id))
      AND ((s.kind='onboarding' AND e.event_name='onboarding_failed')
        OR (e.event_name='logging_flow_failed' AND e.properties->>'flow'=s.kind))) AS failed
  FROM starts s LEFT JOIN LATERAL (
    SELECT e.event_name,e.recorded_at,e.sequence,e.id FROM retained e
    WHERE e.user_id=s.user_id AND e.flow_id=s.flow_id
      AND (e.recorded_at,e.sequence,e.id) > (s.recorded_at,s.sequence,s.id)
      AND ((s.kind='onboarding' AND e.event_name IN ('onboarding_completed','onboarding_exited'))
        OR (e.event_name IN ('logging_flow_completed','logging_flow_exited') AND e.properties->>'flow'=s.kind))
    ORDER BY e.recorded_at,e.sequence,e.id LIMIT 1
  ) terminal ON true
), cohorts AS (
  SELECT recorded_at::date AS day, CASE WHEN grouping(platform)=1 THEN 'all' ELSE platform END platform,
    metric,kind AS dimension,count(*) AS value FROM attempts CROSS JOIN LATERAL (
      SELECT 'attempts_started'::text AS metric
      UNION ALL SELECT 'attempts_completed' WHERE terminal IN ('logging_flow_completed','onboarding_completed')
      UNION ALL SELECT 'attempts_exited' WHERE terminal IN ('logging_flow_exited','onboarding_exited')
      UNION ALL SELECT 'attempts_open' WHERE terminal IS NULL
      UNION ALL SELECT 'attempts_failed' WHERE failed
    ) m GROUP BY GROUPING SETS ((recorded_at::date,platform,metric,kind),(recorded_at::date,metric,kind))
), active AS (
  SELECT recorded_at::date AS day, CASE WHEN grouping(platform)=1 THEN 'all' ELSE platform END platform, 'active_accounts'::text metric, 'all'::text dimension, count(DISTINCT user_id) value
  FROM retained GROUP BY GROUPING SETS ((recorded_at::date,platform),(recorded_at::date))
  UNION ALL
  SELECT recorded_at::date,CASE WHEN grouping(platform)=1 THEN 'all' ELSE platform END,'sessions','all',count(DISTINCT (user_id,session_id))
  FROM retained WHERE event_name='app_session_started' GROUP BY GROUPING SETS ((recorded_at::date,platform),(recorded_at::date))
), registrations AS (
  SELECT created_at::date AS day,'all'::text platform,'registrations'::text metric,'all'::text dimension,count(*) value
  FROM auth.users WHERE created_at >= (current_date-29)::timestamptz AND created_at <= now() GROUP BY 1
), ordered AS (
  SELECT recorded_at::date AS day, platform, properties->>'screen' from_screen,
    lead(properties->>'screen') OVER (PARTITION BY user_id,session_id ORDER BY sequence,recorded_at,id) to_screen
  FROM retained WHERE event_name='screen_viewed'
), navigation AS (
  SELECT day,CASE WHEN grouping(platform)=1 THEN 'all' ELSE platform END platform,'navigation'::text metric,from_screen||'>'||to_screen dimension,count(*) value
  FROM ordered WHERE to_screen IS NOT NULL AND from_screen<>to_screen
  GROUP BY GROUPING SETS ((day,platform,from_screen,to_screen),(day,from_screen,to_screen))
), observed AS (
  SELECT user_id, min(recorded_at) first_seen, count(DISTINCT recorded_at::date) active_days FROM retained GROUP BY user_id
), distribution AS (
  SELECT current_date AS day,'all'::text platform,'active_days'::text metric,active_days::text dimension,count(*) value
  FROM observed GROUP BY active_days
), returns AS (
  SELECT first_seen::date AS day,'all'::text platform,'d'||n||'_'||kind metric,'all'::text dimension,
    count(*) FILTER (WHERE kind='eligible' OR EXISTS (
      SELECT 1 FROM retained e WHERE e.user_id=o.user_id
        AND e.recorded_at >= first_seen+make_interval(days=>n)
        AND e.recorded_at < first_seen+make_interval(days=>n+1)
    )) value
  FROM observed o CROSS JOIN (VALUES(1),(7)) d(n) CROSS JOIN (VALUES('eligible'),('returned')) k(kind)
  WHERE first_seen+make_interval(days=>n+1)<=now()
    -- Boundary cohorts may have an earlier first observation beyond retention.
    AND first_seen::date > current_date-29
  GROUP BY 1,3
), rows AS (
  SELECT * FROM daily UNION ALL SELECT * FROM active UNION ALL SELECT * FROM registrations
  UNION ALL SELECT * FROM navigation UNION ALL SELECT * FROM distribution UNION ALL SELECT * FROM returns
  UNION ALL SELECT * FROM cohorts
)
SELECT json_build_object(
  'generatedAt', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'totalAccounts', (SELECT count(*) FROM auth.users),
  'consentingAccounts', (SELECT count(*) FROM public.product_analytics_consents WHERE granted AND version='product-analytics-v2'),
  'metrics', coalesce((SELECT json_agg(json_build_object(
    'day',to_char(day,'YYYY-MM-DD'),'platform',platform,'metric',metric,'dimension',dimension,'value',value
  ) ORDER BY day,platform,metric,dimension) FROM rows WHERE /*ALLOWED_DIMENSIONS*/), '[]'::json)
);
COMMIT;
