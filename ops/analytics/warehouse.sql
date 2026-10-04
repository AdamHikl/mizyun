-- Dedicated aggregate warehouse. Never install in a Mizyun/Supabase database.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA reporting;
REVOKE ALL ON SCHEMA reporting FROM PUBLIC;
GRANT USAGE ON SCHEMA reporting TO reporting_reader, reporting_writer;

CREATE TABLE reporting.refreshes (
  environment text PRIMARY KEY CHECK (environment IN ('dev','prod','synthetic')),
  generated_at timestamptz NOT NULL,
  source_sha text NOT NULL CHECK (source_sha ~ '^[a-f0-9]{40}$'),
  total_accounts bigint NOT NULL CHECK (total_accounts >= 0),
  consenting_accounts bigint NOT NULL CHECK (consenting_accounts BETWEEN 0 AND total_accounts)
);
CREATE TABLE reporting.metric_data (
  environment text NOT NULL REFERENCES reporting.refreshes(environment) ON DELETE CASCADE,
  day date NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios','android','all')),
  metric text NOT NULL,
  dimension text NOT NULL,
  value bigint NOT NULL CHECK (value >= 0),
  PRIMARY KEY (environment,day,platform,metric,dimension)
);
-- Failed refreshes never make an old report look current. Read access expires.
CREATE VIEW reporting.metrics AS
SELECT m.* FROM reporting.metric_data m JOIN reporting.refreshes r USING (environment)
WHERE r.generated_at > now() - interval '2 hours'
  AND r.generated_at <= now() + interval '5 minutes'
  AND m.day >= (now() AT TIME ZONE 'UTC')::date - 29;

CREATE TABLE reporting.store_metrics (
  platform text NOT NULL CHECK (platform IN ('ios','android')),
  day date NOT NULL,
  metric text NOT NULL CHECK (metric IN ('first_time_downloads','redownloads','user_acquisitions','device_installs','listing_visitors','install_clicks')),
  value bigint NOT NULL CHECK (value >= 0),
  source text NOT NULL CHECK (source IN ('apple_app_store_connect','google_play_console')),
  imported_at timestamptz NOT NULL,
  PRIMARY KEY (platform,day,metric)
);
GRANT SELECT ON reporting.refreshes, reporting.metrics, reporting.store_metrics TO reporting_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA reporting TO reporting_writer;
ALTER ROLE reporting_reader SET default_transaction_read_only = on;
ALTER ROLE reporting_reader SET statement_timeout = '15s';
ALTER ROLE reporting_writer SET statement_timeout = '15s';
