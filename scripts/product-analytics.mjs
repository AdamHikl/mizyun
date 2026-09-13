#!/usr/bin/env node

/**
 * Product Analytics Operator CLI (OBS-002).
 *
 * Provides non-identifying aggregate reports over product analytics events
 * in Dev and Production environments, or from synthetic local fixtures.
 *
 * Commands:
 *   pnpm analytics summary [--env <dev|prod|both>] [--days <N>] [--json]
 *   pnpm analytics features [--env <dev|prod|both>] [--days <N>] [--platform <ios|android>] [--json]
 *   pnpm analytics navigation [--env <dev|prod|both>] [--days <N>] [--json]
 *   pnpm analytics flows [--env <dev|prod|both>] [--days <N>] [--json]
 *   pnpm analytics retention [--env <dev|prod|both>] [--days <N>] [--json]
 */

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

export const ALLOWED_COMMANDS = [
  "summary",
  "features",
  "navigation",
  "flows",
  "retention",
];

export const ALLOWED_ENVIRONMENTS = ["dev", "prod", "both"];
export const ALLOWED_PLATFORMS = ["ios", "android"];

const CONTAINERS = {
  dev: "mizyun-dev-db",
  prod: "supabase-db",
};

export function parseArgs(argv) {
  const options = {
    command: null,
    env: "dev",
    days: 7,
    platform: null,
    json: false,
    fixture: null,
    limit: 50,
    sshAlias: process.env.MIZYUN_SSH_ALIAS || "rpserver",
    help: false,
  };

  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--env" && i + 1 < argv.length) {
      options.env = argv[++i].toLowerCase();
    } else if (arg === "--days" && i + 1 < argv.length) {
      const parsedDays = Number.parseInt(argv[++i], 10);
      if (Number.isNaN(parsedDays) || parsedDays < 1 || parsedDays > 30) {
        throw new Error(
          "Invalid --days argument. Must be an integer between 1 and 30.",
        );
      }
      options.days = parsedDays;
    } else if (arg === "--platform" && i + 1 < argv.length) {
      const plat = argv[++i].toLowerCase();
      if (!ALLOWED_PLATFORMS.includes(plat)) {
        throw new Error(
          `Invalid --platform argument. Must be one of: ${ALLOWED_PLATFORMS.join(", ")}`,
        );
      }
      options.platform = plat;
    } else if (arg === "--fixture" && i + 1 < argv.length) {
      options.fixture = argv[++i];
    } else if (arg === "--limit" && i + 1 < argv.length) {
      const parsedLimit = Number.parseInt(argv[++i], 10);
      if (Number.isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 500) {
        throw new Error(
          "Invalid --limit argument. Must be an integer between 1 and 500.",
        );
      }
      options.limit = parsedLimit;
    } else if (arg === "--ssh" && i + 1 < argv.length) {
      options.sshAlias = argv[++i];
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 0) {
    options.command = positional[0].toLowerCase();
  }

  if (options.help) {
    return options;
  }

  if (!options.command || !ALLOWED_COMMANDS.includes(options.command)) {
    throw new Error(
      `Invalid command: "${options.command}". Must be one of: ${ALLOWED_COMMANDS.join(", ")}`,
    );
  }

  if (!ALLOWED_ENVIRONMENTS.includes(options.env)) {
    throw new Error(
      `Invalid --env argument: "${options.env}". Must be one of: ${ALLOWED_ENVIRONMENTS.join(", ")}`,
    );
  }

  return options;
}

export function printUsage() {
  console.log(`
Mizyun Product Analytics CLI (OBS-002)

USAGE:
  pnpm analytics <command> [options]

COMMANDS:
  summary       Overview: active accounts, events, sessions, top screens
  features      Screen views and feature actions with distinct accounts & sessions
  navigation    Aggregated sequential screen transitions within sessions
  flows         Logging flows started, completed, failed, duration/tap buckets
  retention     Daily return counts and D1/D7 cohort return rates

OPTIONS:
  --env <dev|prod|both>     Target environment (default: dev)
  --days <1-30>             Time window in days (default: 7)
  --platform <ios|android>  Filter by client platform
  --json                    Machine-readable JSON output
  --fixture <path>          Query local synthetic JSON fixture without SSH
  --limit <1-500>           Max rows in detailed reports (default: 50)
  --ssh <alias>             SSH host alias for Raspberry Pi (default: rpserver)
  --help, -h                Show this help message

EXAMPLES:
  pnpm analytics summary --env dev --days 7
  pnpm analytics features --env dev --days 7 --json
  pnpm analytics navigation --env prod --days 14
  pnpm analytics flows --env both --days 7 --json
  pnpm analytics summary --fixture ./synthetic-events.json --json
`);
}

export function buildSql(command, { days, platform, limit }) {
  const platformClause = platform ? `AND platform = '${platform}'` : "";

  // All queries run inside BEGIN READ ONLY; and return a single JSON object.
  if (command === "summary") {
    return `
BEGIN READ ONLY;
WITH filtered AS (
  SELECT * FROM public.product_analytics_events
  WHERE recorded_at >= (now() - interval '${days} days')
  ${platformClause}
),
activation_stats AS (
  SELECT
    count(DISTINCT ob.user_id) AS onboarding_completed_users,
    count(DISTINCT cr.user_id) AS activated_users
  FROM filtered ob
  LEFT JOIN filtered cr
    ON ob.user_id = cr.user_id
   AND cr.event_name = 'core_record_created'
   AND cr.recorded_at >= ob.recorded_at
   AND cr.recorded_at <= ob.recorded_at + interval '24 hours'
  WHERE ob.event_name = 'onboarding_completed'
    AND ob.recorded_at <= now() - interval '24 hours'
)
SELECT json_build_object(
  'command', 'summary',
  'days', ${days},
  'unique_accounts', (SELECT count(DISTINCT user_id) FROM filtered),
  'total_events', (SELECT count(*) FROM filtered),
  'total_sessions', (SELECT count(DISTINCT session_id) FROM filtered),
  'ordered_activation_24h', (SELECT row_to_json(act) FROM activation_stats act),
  'events_by_name', (
    SELECT coalesce(json_object_agg(event_name, cnt), '{}'::json)
    FROM (
      SELECT event_name, count(*) AS cnt
      FROM filtered
      GROUP BY event_name
      ORDER BY cnt DESC
    ) s
  )
);
COMMIT;
`.trim();
  }

  if (command === "features") {
    return `
BEGIN READ ONLY;
WITH filtered AS (
  SELECT * FROM public.product_analytics_events
  WHERE recorded_at >= (now() - interval '${days} days')
  ${platformClause}
),
screen_views AS (
  SELECT
    properties->>'screen' AS screen,
    count(*) AS total_views,
    count(DISTINCT user_id) AS unique_users,
    count(DISTINCT session_id) AS unique_sessions
  FROM filtered
  WHERE event_name = 'screen_viewed' AND properties->>'screen' IS NOT NULL
  GROUP BY properties->>'screen'
  ORDER BY total_views DESC
  LIMIT ${limit}
),
actions AS (
  SELECT
    properties->>'action' AS action,
    properties->>'outcome' AS outcome,
    count(*) AS total_actions,
    count(DISTINCT user_id) AS unique_users
  FROM filtered
  WHERE event_name = 'feature_action_result' AND properties->>'action' IS NOT NULL
  GROUP BY properties->>'action', properties->>'outcome'
  ORDER BY total_actions DESC
  LIMIT ${limit}
)
SELECT json_build_object(
  'command', 'features',
  'days', ${days},
  'screens', (SELECT coalesce(json_agg(row_to_json(s)), '[]'::json) FROM screen_views s),
  'actions', (SELECT coalesce(json_agg(row_to_json(a)), '[]'::json) FROM actions a)
);
COMMIT;
`.trim();
  }

  if (command === "navigation") {
    return `
BEGIN READ ONLY;
WITH screen_events AS (
  SELECT
    user_id,
    session_id,
    sequence,
    properties->>'screen' AS screen,
    recorded_at
  FROM public.product_analytics_events
  WHERE recorded_at >= (now() - interval '${days} days')
    AND event_name = 'screen_viewed'
    AND properties->>'screen' IS NOT NULL
  ${platformClause}
),
transitions AS (
  SELECT
    screen AS from_screen,
    lead(screen) OVER (
      PARTITION BY user_id, session_id
      ORDER BY sequence ASC, recorded_at ASC
    ) AS to_screen
  FROM screen_events
),
valid_transitions AS (
  SELECT from_screen, to_screen, count(*) AS transition_count
  FROM transitions
  WHERE to_screen IS NOT NULL AND to_screen <> from_screen
  GROUP BY from_screen, to_screen
  ORDER BY transition_count DESC
  LIMIT ${limit}
)
SELECT json_build_object(
  'command', 'navigation',
  'days', ${days},
  'transitions', (SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM valid_transitions t)
);
COMMIT;
`.trim();
  }

  if (command === "flows") {
    return `
BEGIN READ ONLY;
WITH filtered AS (
  SELECT * FROM public.product_analytics_events
  WHERE recorded_at >= (now() - interval '${days} days')
  ${platformClause}
),
flows_summary AS (
  SELECT
    properties->>'flow' AS flow,
    count(*) FILTER (WHERE event_name = 'logging_flow_started') AS started,
    count(*) FILTER (WHERE event_name = 'logging_flow_completed') AS completed,
    count(*) FILTER (WHERE event_name = 'logging_flow_failed') AS failed,
    count(*) FILTER (WHERE event_name = 'logging_flow_exited') AS exited
  FROM filtered
  WHERE properties->>'flow' IS NOT NULL
  GROUP BY properties->>'flow'
),
durations AS (
  SELECT
    properties->>'flow' AS flow,
    properties->>'duration' AS duration_bucket,
    count(*) AS count
  FROM filtered
  WHERE event_name = 'logging_flow_completed' AND properties->>'duration' IS NOT NULL
  GROUP BY properties->>'flow', properties->>'duration'
),
failures AS (
  SELECT
    properties->>'flow' AS flow,
    properties->>'stage' AS stage,
    properties->>'reason' AS reason,
    count(*) AS count,
    count(DISTINCT user_id) AS affected_users
  FROM filtered
  WHERE event_name = 'logging_flow_failed' AND properties->>'stage' IS NOT NULL
  GROUP BY properties->>'flow', properties->>'stage', properties->>'reason'
  ORDER BY count DESC
  LIMIT ${limit}
)
SELECT json_build_object(
  'command', 'flows',
  'days', ${days},
  'flows', (SELECT coalesce(json_agg(row_to_json(f)), '[]'::json) FROM flows_summary f),
  'durations', (SELECT coalesce(json_agg(row_to_json(d)), '[]'::json) FROM durations d),
  'failures', (SELECT coalesce(json_agg(row_to_json(fl)), '[]'::json) FROM failures fl)
);
COMMIT;
`.trim();
  }

  if (command === "retention") {
    return `
BEGIN READ ONLY;
WITH filtered AS (
  SELECT
    user_id,
    date_trunc('day', recorded_at) AS active_date,
    recorded_at
  FROM public.product_analytics_events
  WHERE recorded_at >= (now() - interval '${days} days')
  ${platformClause}
),
active_days_per_user AS (
  SELECT user_id, count(DISTINCT active_date) AS active_days
  FROM filtered
  GROUP BY user_id
),
distribution AS (
  SELECT active_days, count(*) AS user_count
  FROM active_days_per_user
  GROUP BY active_days
  ORDER BY active_days ASC
),
first_seen AS (
  SELECT user_id, min(recorded_at) AS first_event_at
  FROM filtered
  GROUP BY user_id
),
d1_cohort AS (
  SELECT
    count(DISTINCT fs.user_id) AS eligible_users,
    count(DISTINCT ev.user_id) AS returned_users
  FROM first_seen fs
  LEFT JOIN filtered ev
    ON ev.user_id = fs.user_id
   AND ev.recorded_at >= fs.first_event_at + interval '1 day'
   AND ev.recorded_at < fs.first_event_at + interval '2 days'
  WHERE fs.first_event_at <= now() - interval '2 days'
),
d7_cohort AS (
  SELECT
    count(DISTINCT fs.user_id) AS eligible_users,
    count(DISTINCT ev.user_id) AS returned_users
  FROM first_seen fs
  LEFT JOIN filtered ev
    ON ev.user_id = fs.user_id
   AND ev.recorded_at >= fs.first_event_at + interval '7 days'
   AND ev.recorded_at < fs.first_event_at + interval '8 days'
  WHERE fs.first_event_at <= now() - interval '8 days'
)
SELECT json_build_object(
  'command', 'retention',
  'days', ${days},
  'matured_cohorts', json_build_object(
    'd1', (SELECT row_to_json(d1) FROM d1_cohort d1),
    'd7', (SELECT row_to_json(d7) FROM d7_cohort d7)
  ),
  'active_days_distribution', (SELECT coalesce(json_agg(row_to_json(d)), '[]'::json) FROM distribution d)
);
COMMIT;
`.trim();
  }

  throw new Error(`Unsupported SQL command: ${command}`);
}

export function executePsql(env, sql, sshAlias) {
  const container = CONTAINERS[env];
  if (!container) {
    throw new Error(`Unknown container for environment: "${env}"`);
  }

  const remoteCommand = `docker exec -i ${container} psql -U postgres -d postgres -v ON_ERROR_STOP=1 -t -A`;

  const res = spawnSync(
    "ssh",
    ["-o", "ConnectTimeout=10", sshAlias, remoteCommand],
    {
      input: sql,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  if (res.error) {
    throw new Error(`SSH execution failed: ${res.error.message}`);
  }

  if (res.status !== 0) {
    const errorMsg =
      res.stderr?.trim() || res.stdout?.trim() || "psql command failed";
    throw new Error(`Database error on ${env} (${container}): ${errorMsg}`);
  }

  const lines = res.stdout
    .trim()
    .split("\n")
    .filter((l) => l.trim() !== "BEGIN" && l.trim() !== "COMMIT");
  const jsonStr = lines[lines.length - 1] || "{}";

  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(
      `Failed to parse SQL JSON output from ${env}: ${err.message}. Raw: ${jsonStr}`,
    );
  }
}

export function processFixture(command, fixturePath, { days }) {
  if (!existsSync(fixturePath)) {
    throw new Error(`Fixture file not found: ${fixturePath}`);
  }

  const raw = readFileSync(fixturePath, "utf8");
  const events = JSON.parse(raw);
  if (!Array.isArray(events)) {
    throw new Error("Fixture must contain an array of analytics events");
  }

  const now = Date.now();
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const filtered = events.filter((e) => {
    const time = new Date(e.recordedAt || e.recorded_at).getTime();
    return !Number.isNaN(time) && time >= cutoff;
  });

  if (command === "summary") {
    const accounts = new Set();
    const sessions = new Set();
    const eventsByName = {};

    for (const e of filtered) {
      if (e.userId || e.user_id) accounts.add(e.userId || e.user_id);
      if (e.sessionId || e.session_id)
        sessions.add(e.sessionId || e.session_id);
      const name = e.name || e.event_name;
      eventsByName[name] = (eventsByName[name] || 0) + 1;
    }

    return {
      command: "summary",
      days,
      unique_accounts: accounts.size,
      total_events: filtered.length,
      total_sessions: sessions.size,
      events_by_name: eventsByName,
    };
  }

  if (command === "features") {
    const screens = {};
    const actions = {};

    for (const e of filtered) {
      const name = e.name || e.event_name;
      const props = e.properties || {};
      if (name === "screen_viewed" && props.screen) {
        if (!screens[props.screen]) {
          screens[props.screen] = {
            screen: props.screen,
            total_views: 0,
            users: new Set(),
            sessions: new Set(),
          };
        }
        screens[props.screen].total_views++;
        if (e.userId || e.user_id)
          screens[props.screen].users.add(e.userId || e.user_id);
        if (e.sessionId || e.session_id)
          screens[props.screen].sessions.add(e.sessionId || e.session_id);
      }
      if (name === "feature_action_result" && props.action) {
        const key = `${props.action}:${props.outcome}`;
        if (!actions[key]) {
          actions[key] = {
            action: props.action,
            outcome: props.outcome,
            total_actions: 0,
            users: new Set(),
          };
        }
        actions[key].total_actions++;
        if (e.userId || e.user_id)
          actions[key].users.add(e.userId || e.user_id);
      }
    }

    return {
      command: "features",
      days,
      screens: Object.values(screens).map((s) => ({
        screen: s.screen,
        total_views: s.total_views,
        unique_users: s.users.size,
        unique_sessions: s.sessions.size,
      })),
      actions: Object.values(actions).map((a) => ({
        action: a.action,
        outcome: a.outcome,
        total_actions: a.total_actions,
        unique_users: a.users.size,
      })),
    };
  }

  return {
    command,
    days,
    total_events: filtered.length,
    note: "Fixture simulation",
  };
}

export function formatHumanOutput(result, env) {
  const lines = [];
  lines.push(`=======================================================`);
  lines.push(
    `  Mizyun Product Analytics — ${env.toUpperCase()} (${result.days} days)`,
  );
  lines.push(`=======================================================`);

  if (result.command === "summary") {
    lines.push(`  Consenting Accounts : ${result.unique_accounts}`);
    lines.push(`  Observed Sessions   : ${result.total_sessions}`);
    lines.push(`  Total Events        : ${result.total_events}`);
    lines.push(`\n  Events Breakdown:`);
    for (const [name, count] of Object.entries(result.events_by_name || {})) {
      lines.push(`    - ${name.padEnd(28)} : ${count}`);
    }
  } else if (result.command === "features") {
    lines.push(`\n  Screen Views:`);
    for (const s of result.screens || []) {
      lines.push(
        `    - ${s.screen.padEnd(24)} : ${s.total_views} views (${s.unique_users} users, ${s.unique_sessions} sessions)`,
      );
    }
    lines.push(`\n  Actions:`);
    for (const a of result.actions || []) {
      lines.push(
        `    - ${a.action} [${a.outcome}] : ${a.total_actions} (${a.unique_users} users)`,
      );
    }
  } else if (result.command === "navigation") {
    lines.push(`\n  Screen Transitions:`);
    for (const t of result.transitions || []) {
      lines.push(
        `    - ${t.from_screen} -> ${t.to_screen} : ${t.transition_count}`,
      );
    }
  } else if (result.command === "flows") {
    lines.push(`\n  Flow Overview:`);
    for (const f of result.flows || []) {
      lines.push(
        `    - ${f.flow}: ${f.started} started, ${f.completed} completed, ${f.failed} failed, ${f.exited} exited`,
      );
    }
  } else if (result.command === "retention") {
    lines.push(`\n  Active Days Distribution:`);
    for (const d of result.active_days_distribution || []) {
      lines.push(
        `    - Active on ${d.active_days} day(s): ${d.user_count} account(s)`,
      );
    }
  }

  lines.push(`=======================================================\n`);
  return lines.join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(2);
  }

  if (options.help) {
    printUsage();
    process.exit(0);
  }

  const generatedAt = new Date().toISOString();
  const windowObj = {
    days: options.days,
    timezone: "UTC",
  };

  if (options.fixture) {
    try {
      const data = processFixture(options.command, options.fixture, options);
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              schemaVersion: 1,
              generatedAt,
              window: windowObj,
              environment: "fixture",
              data,
            },
            null,
            2,
          ),
        );
      } else {
        console.log(formatHumanOutput(data, "fixture"));
      }
      process.exit(0);
    } catch (err) {
      console.error(`Fixture error: ${err.message}`);
      process.exit(1);
    }
  }

  const targets = options.env === "both" ? ["dev", "prod"] : [options.env];
  const results = {};
  let hasError = false;

  for (const env of targets) {
    try {
      const sql = buildSql(options.command, options);
      const data = executePsql(env, sql, options.sshAlias);
      results[env] = { ok: true, data };
    } catch (err) {
      hasError = true;
      results[env] = { ok: false, error: err.message };
    }
  }

  if (options.json) {
    const output = {
      schemaVersion: 1,
      generatedAt,
      window: windowObj,
      command: options.command,
      environments: results,
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    for (const [env, res] of Object.entries(results)) {
      if (res.ok) {
        console.log(formatHumanOutput(res.data, env));
      } else {
        console.error(`[${env.toUpperCase()} ERROR]: ${res.error}`);
      }
    }
  }

  process.exit(hasError ? 1 : 0);
}

// Run CLI when invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Unexpected CLI error:", err);
    process.exit(1);
  });
}
