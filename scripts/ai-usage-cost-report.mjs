#!/usr/bin/env node

/**
 * AI usage and cost report (#336, ADR-0081).
 *
 * Median and p95 AI tokens and estimated USD per paying and per free user
 * over the last N days (default 30), read from the existing usage tables:
 * ai_daily_token_ledger (Coach and recipe tokens), ai_recipe_requests,
 * ai_daily_draft_ledger (draft and refine counts), meal_illustration_user_usage
 * and, from migration 20261026150000, ai_daily_cost_ledger: the estimated USD
 * the API charged against each user's allowance (ADR-0081). The token-based
 * low/high estimates use scripts/ai-cost-model.mjs and also cover days before
 * the cost ledger existed.
 *
 * Every query runs inside BEGIN READ ONLY and returns user ids and counts
 * only: no email, names, prompts or content.
 *
 *   pnpm ai:cost-report --env local            # local disposable database
 *   pnpm ai:cost-report --env dev [--json]     # Hetzner Dev, read-only
 *   pnpm ai:cost-report --env prod [--json]    # Hetzner Production, read-only
 *   pnpm ai:cost-report --verify-local         # synthetic rows, rolled back
 *   options: --days <1-90> --per-user --ssh <alias> --year <2026|2027>
 *            --no-cost-ledger  (database without migration 20261026150000)
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  COACH_OUTPUT_SHARE,
  PRICES,
  PRICES_CHECKED_ON,
  REQUEST_SIZES,
  coachTokenCostUsd,
  illustrationCostUsd,
  requestCostUsd,
  worstDraftSlotUsd,
} from "./ai-cost-model.mjs";

export const ENVIRONMENTS = {
  local: { container: "supabase_db_mizyun", remote: false },
  dev: { container: "mizyun-dev-db", remote: true },
  prod: { container: "supabase-db", remote: true },
};

export function parseArgs(argv) {
  const options = {
    env: "local",
    days: 30,
    json: false,
    perUser: false,
    year: new Date().getUTCFullYear(),
    sshAlias: process.env.MIZYUN_SSH_ALIAS || "mizyun-hetzner-ops",
    verifyLocal: false,
    costLedger: true,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[++i];
    };
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--per-user") options.perUser = true;
    else if (arg === "--verify-local") options.verifyLocal = true;
    else if (arg === "--no-cost-ledger") options.costLedger = false;
    else if (arg === "--env") options.env = next().toLowerCase();
    else if (arg === "--ssh") options.sshAlias = next();
    else if (arg === "--days") {
      const days = Number(next());
      if (!Number.isInteger(days) || days < 1 || days > 90) {
        throw new Error("--days must be an integer between 1 and 90.");
      }
      options.days = days;
    } else if (arg === "--year") {
      const year = Number(next());
      if (year !== 2026 && year !== 2027) {
        throw new Error("--year must be 2026 or 2027.");
      }
      options.year = year;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Object.hasOwn(ENVIRONMENTS, options.env)) {
    throw new Error(
      `--env must be one of: ${Object.keys(ENVIRONMENTS).join(", ")}`,
    );
  }
  if (options.verifyLocal && options.env !== "local") {
    throw new Error("--verify-local runs only against --env local.");
  }
  return options;
}

/**
 * One row per user with any AI usage in the window. Paid follows the
 * limiter: profiles.plan_tier = 'paid' or an approved Beta Pro pass.
 */
export function buildReportSelect(days, { costLedger = true } = {}) {
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new Error("days must be an integer between 1 and 90");
  }
  return `
WITH win AS (
  SELECT (timezone('utc', now())::date - ${days - 1}) AS since
),
ledger AS (
  SELECT user_id, sum(tokens_used)::bigint AS ledger_tokens,
         count(DISTINCT day)::int AS token_days
  FROM public.ai_daily_token_ledger, win
  WHERE day >= win.since GROUP BY user_id
),
recipes AS (
  SELECT user_id, sum(tokens_charged)::bigint AS recipe_tokens,
         count(*)::int AS recipe_calls
  FROM public.ai_recipe_requests, win
  WHERE budget_day >= win.since AND status = 'succeeded' GROUP BY user_id
),
drafts AS (
  SELECT user_id, sum(drafts_used)::bigint AS drafts_used,
         ${costLedger ? "sum(refines_used)::bigint" : "0::bigint"} AS refines_used,
         count(DISTINCT day)::int AS draft_days
  FROM public.ai_daily_draft_ledger, win
  WHERE day >= win.since GROUP BY user_id
),
costs AS (
  ${
    costLedger
      ? `SELECT user_id, sum(used_micros)::bigint AS cost_micros
  FROM public.ai_daily_cost_ledger, win
  WHERE day >= win.since GROUP BY user_id`
      : "SELECT NULL::uuid AS user_id, 0::bigint AS cost_micros WHERE false"
  }
),
illustrations AS (
  SELECT user_id, sum(attempts)::bigint AS illustrations
  FROM public.meal_illustration_user_usage, win
  WHERE day >= win.since GROUP BY user_id
),
users AS (
  SELECT user_id FROM ledger UNION SELECT user_id FROM recipes
  UNION SELECT user_id FROM drafts UNION SELECT user_id FROM illustrations
  UNION SELECT user_id FROM costs
),
tiers AS (
  SELECT p.id AS user_id,
         CASE WHEN p.plan_tier = 'paid' OR b.status = 'approved'
              THEN 'paid' ELSE 'free' END AS tier
  FROM public.profiles p
  LEFT JOIN public.beta_pro_requests b ON b.user_id = p.id
)
SELECT json_build_object(
  'days', ${days},
  'since', (SELECT since FROM win),
  'tier_members', (SELECT json_object_agg(tier, n) FROM
    (SELECT tier, count(*)::int AS n FROM tiers GROUP BY tier) t),
  'users', (SELECT coalesce(json_agg(json_build_object(
      'user_id', u.user_id,
      'tier', coalesce(t.tier, 'free'),
      'ledger_tokens', coalesce(l.ledger_tokens, 0),
      'recipe_tokens', coalesce(r.recipe_tokens, 0),
      'recipe_calls', coalesce(r.recipe_calls, 0),
      'drafts_used', coalesce(d.drafts_used, 0),
      'refines_used', coalesce(d.refines_used, 0),
      'cost_micros', coalesce(c.cost_micros, 0),
      'illustrations', coalesce(i.illustrations, 0),
      'active_days', greatest(coalesce(l.token_days, 0), coalesce(d.draft_days, 0))
    ) ORDER BY u.user_id), '[]'::json)
    FROM users u
    LEFT JOIN tiers t ON t.user_id = u.user_id
    LEFT JOIN ledger l ON l.user_id = u.user_id
    LEFT JOIN recipes r ON r.user_id = u.user_id
    LEFT JOIN drafts d ON d.user_id = u.user_id
    LEFT JOIN illustrations i ON i.user_id = u.user_id
    LEFT JOIN costs c ON c.user_id = u.user_id)
);`.trim();
}

export const buildSql = (days, options) =>
  `BEGIN READ ONLY;\n${buildReportSelect(days, options)}\nCOMMIT;\n`;

const SEED_IDS = ["a1", "a2", "a3"].map(
  (suffix) => `00000000-0000-4000-8000-0000000000${suffix}`,
);

export const COST_LEDGER_MIGRATION = new URL(
  "../supabase/migrations/20261026150000_ai_cost_allowance.sql",
  import.meta.url,
);

/**
 * Local-only self-check: applies the (idempotent) cost-ledger migration,
 * inserts three synthetic users and usage rows, runs the report query, then
 * rolls everything back, so it works on a database with or without that
 * migration and leaves no trace. Never used against Hetzner.
 */
export const buildLocalVerificationSql = (
  days,
  migrationSql = readFileSync(COST_LEDGER_MIGRATION, "utf8"),
) => `BEGIN;
${migrationSql}
INSERT INTO auth.users (id, aud, role, email) VALUES
  ${SEED_IDS.map((id, n) => `('${id}', 'authenticated', 'authenticated', 'ai-cost-${n}@example.test')`).join(",\n  ")};
INSERT INTO public.profiles (id) SELECT id FROM auth.users
  WHERE id IN (${SEED_IDS.map((id) => `'${id}'`).join(", ")}) ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET plan_tier = 'paid' WHERE id = '${SEED_IDS[0]}';
INSERT INTO public.ai_daily_token_ledger (user_id, day, tokens_used) VALUES
  ('${SEED_IDS[0]}', timezone('utc', now())::date, 60000),
  ('${SEED_IDS[0]}', timezone('utc', now())::date - 1, 40000),
  ('${SEED_IDS[0]}', timezone('utc', now())::date - ${days + 5}, 99999),
  ('${SEED_IDS[1]}', timezone('utc', now())::date, 8000);
INSERT INTO public.ai_daily_draft_ledger (user_id, day, drafts_used, refines_used) VALUES
  ('${SEED_IDS[0]}', timezone('utc', now())::date, 12, 4),
  ('${SEED_IDS[2]}', timezone('utc', now())::date, 3, 0);
INSERT INTO public.ai_daily_cost_ledger (user_id, day, used_micros) VALUES
  ('${SEED_IDS[0]}', timezone('utc', now())::date, 125000),
  ('${SEED_IDS[0]}', timezone('utc', now())::date - ${days + 5}, 999999);
${buildReportSelect(days)}
ROLLBACK;
`;

/** Expected per-user totals for buildLocalVerificationSql. */
export const LOCAL_VERIFICATION_EXPECTED = {
  [SEED_IDS[0]]: {
    tier: "paid",
    ledger_tokens: 100000,
    drafts_used: 12,
    refines_used: 4,
    cost_micros: 125000,
  },
  [SEED_IDS[1]]: { tier: "free", ledger_tokens: 8000, drafts_used: 0 },
  [SEED_IDS[2]]: { tier: "free", ledger_tokens: 0, drafts_used: 3 },
};

export function checkLocalVerification(raw) {
  const failures = [];
  for (const [id, expected] of Object.entries(LOCAL_VERIFICATION_EXPECTED)) {
    const row = (raw.users ?? []).find((user) => user.user_id === id);
    if (!row) {
      failures.push(`${id} missing`);
      continue;
    }
    for (const [key, value] of Object.entries(expected)) {
      if (row[key] !== value)
        failures.push(`${id} ${key}=${row[key]}, expected ${value}`);
    }
  }
  return failures;
}

/**
 * Estimated USD for one user row. `low` prices Coach tokens on Haiku and
 * other drafts as a photo draft (ADR-0078 routing); `high` prices Coach on
 * Gemini and every other draft as the most expensive draft. The tables do not
 * record the provider, so the truth lies in between.
 */
export function estimateUserCost(row, year) {
  const recipeTokens = Number(row.recipe_tokens);
  const coachTokens = Math.max(0, Number(row.ledger_tokens) - recipeTokens);
  const otherDrafts = Math.max(
    0,
    Number(row.drafts_used) - Number(row.recipe_calls),
  );
  const cooking = REQUEST_SIZES.cookingAssistant;
  const recipeUsdPerToken =
    requestCostUsd(cooking, year) / (cooking.input + cooking.output);
  const shared =
    recipeTokens * recipeUsdPerToken +
    Number(row.illustrations) * illustrationCostUsd();
  return {
    tokens: Number(row.ledger_tokens),
    ledgerUsd: Number(row.cost_micros ?? 0) / 1_000_000,
    low:
      shared +
      coachTokens * coachTokenCostUsd("haiku", year) +
      otherDrafts * requestCostUsd(REQUEST_SIZES.photoDraft, year),
    high:
      shared +
      coachTokens * coachTokenCostUsd("gemini", year) +
      otherDrafts * worstDraftSlotUsd(year),
  };
}

/** Nearest-rank quantile; 0 for an empty list. */
export function quantile(values, q) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(q * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1];
}

export function summarise(raw, { year, perUser = false } = {}) {
  const tiers = {};
  const users = [];
  for (const row of raw.users ?? []) {
    const cost = estimateUserCost(row, year);
    users.push({ userId: row.user_id, tier: row.tier, ...cost });
    (tiers[row.tier] ??= []).push({
      ...cost,
      drafts: Number(row.drafts_used),
      refines: Number(row.refines_used ?? 0),
    });
  }
  const byTier = {};
  for (const tier of ["paid", "free"]) {
    const rows = tiers[tier] ?? [];
    const pick = (key) => rows.map((r) => r[key]);
    byTier[tier] = {
      members: raw.tier_members?.[tier] ?? 0,
      activeAiUsers: rows.length,
      tokens: {
        median: quantile(pick("tokens"), 0.5),
        p95: quantile(pick("tokens"), 0.95),
      },
      drafts: {
        median: quantile(pick("drafts"), 0.5),
        p95: quantile(pick("drafts"), 0.95),
      },
      refines: {
        median: quantile(pick("refines"), 0.5),
        p95: quantile(pick("refines"), 0.95),
      },
      usdCharged: {
        median: quantile(pick("ledgerUsd"), 0.5),
        p95: quantile(pick("ledgerUsd"), 0.95),
      },
      usdLow: {
        median: quantile(pick("low"), 0.5),
        p95: quantile(pick("low"), 0.95),
      },
      usdHigh: {
        median: quantile(pick("high"), 0.5),
        p95: quantile(pick("high"), 0.95),
      },
    };
  }
  return {
    days: raw.days,
    since: raw.since,
    priceYear: year,
    pricesCheckedOn: PRICES_CHECKED_ON,
    assumptions: {
      coachOutputShare: COACH_OUTPUT_SHARE,
      haikuUsdPerMTok: PRICES.haiku,
      geminiUsdPerMTok: year >= 2027 ? PRICES.gemini2027 : PRICES.gemini2026,
      usdChargedFrom: "ai_daily_cost_ledger (migration 20261026150000)",
    },
    byTier,
    ...(perUser ? { users } : {}),
  };
}

export function runPsql(env, sql, sshAlias) {
  const { container, remote } = ENVIRONMENTS[env];
  const psql = [
    "docker",
    "exec",
    "-i",
    container,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-t",
    "-A",
    "-q",
  ];
  const res = remote
    ? spawnSync("ssh", ["-o", "ConnectTimeout=10", sshAlias, psql.join(" ")], {
        input: sql,
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 20 * 1024 * 1024,
      })
    : spawnSync(psql[0], psql.slice(1), {
        input: sql,
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 20 * 1024 * 1024,
      });
  if (res.error) throw new Error(`psql failed: ${res.error.message}`);
  if (res.status !== 0) {
    throw new Error(
      `psql failed on ${env} (${container}): ${res.stderr.trim()}`,
    );
  }
  const line = res.stdout
    .trim()
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .pop();
  if (!line) throw new Error(`No report row from ${env}`);
  return JSON.parse(line);
}

const usd = (value) => `$${value.toFixed(4)}`;

export function formatText(report, env) {
  const lines = [
    `AI usage and cost per user, ${env}, last ${report.days} days (since ${report.since})`,
    `Prices checked ${report.pricesCheckedOn}, priced as ${report.priceYear}. low = Coach on Haiku; high = Coach on Gemini and every draft at the worst draft.`,
    "charged = estimated USD the API recorded in ai_daily_cost_ledger (ADR-0081); low/high = token-based estimate, also for days before that ledger.",
    "",
  ];
  for (const [tier, s] of Object.entries(report.byTier)) {
    lines.push(
      `${tier}: ${s.activeAiUsers} with AI use of ${s.members} accounts`,
      `  tokens  median ${s.tokens.median}  p95 ${s.tokens.p95}`,
      `  drafts  median ${s.drafts.median}  p95 ${s.drafts.p95}`,
      `  refines median ${s.refines.median}  p95 ${s.refines.p95}`,
      `  USD charged median ${usd(s.usdCharged.median)}  p95 ${usd(s.usdCharged.p95)}`,
      `  USD low  median ${usd(s.usdLow.median)}  p95 ${usd(s.usdLow.p95)}`,
      `  USD high median ${usd(s.usdHigh.median)}  p95 ${usd(s.usdHigh.p95)}`,
    );
  }
  for (const user of report.users ?? []) {
    lines.push(
      `${user.userId} ${user.tier} tokens=${user.tokens} charged=${usd(user.ledgerUsd)} low=${usd(user.low)} high=${usd(user.high)}`,
    );
  }
  return lines.join("\n");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      "Usage: pnpm ai:cost-report [--env local|dev|prod] [--days 30] [--year 2026|2027] [--per-user] [--json] [--ssh alias] [--no-cost-ledger] [--verify-local]",
    );
    return;
  }
  if (options.verifyLocal) {
    const raw = runPsql("local", buildLocalVerificationSql(options.days));
    const failures = checkLocalVerification(raw);
    if (failures.length > 0)
      throw new Error(`Local verification failed: ${failures.join("; ")}`);
    console.log(
      formatText(
        summarise(raw, { ...options, perUser: true }),
        "local synthetic (rolled back)",
      ),
    );
    console.log("Local verification passed; synthetic rows rolled back.");
    return;
  }
  const raw = runPsql(
    options.env,
    buildSql(options.days, { costLedger: options.costLedger }),
    options.sshAlias,
  );
  const report = summarise(raw, options);
  console.log(
    options.json
      ? JSON.stringify({ env: options.env, ...report }, null, 2)
      : formatText(report, options.env),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
