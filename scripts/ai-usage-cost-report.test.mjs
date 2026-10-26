import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildLocalVerificationSql,
  buildSql,
  checkLocalVerification,
  estimateUserCost,
  parseArgs,
  quantile,
  summarise,
} from "./ai-usage-cost-report.mjs";
import {
  PLANS,
  PRICES,
  PRICES_CHECKED_ON,
  REQUEST_SIZES,
  netMonthlyEur,
  requestCostUsd,
} from "./ai-cost-model.mjs";
import {
  AI_PRICES_CHECKED_ON,
  ANTHROPIC_WEB_SEARCH_MICROS,
  GEMINI_GROUNDING_MICROS,
  GEMINI_PRICE_2026,
  GEMINI_PRICE_2027,
  HAIKU_PRICE,
} from "../packages/config/src/ai-cost.ts";

describe("ai-usage-cost-report", () => {
  it("defaults to the local database and 30 days", () => {
    const options = parseArgs([]);
    assert.equal(options.env, "local");
    assert.equal(options.days, 30);
  });

  it("rejects unknown environments, bad windows and remote self-checks", () => {
    assert.throws(() => parseArgs(["--env", "staging"]), /--env/);
    assert.throws(() => parseArgs(["--days", "0"]), /--days/);
    assert.throws(() => parseArgs(["--days", "1; drop table x"]), /--days/);
    assert.throws(
      () => parseArgs(["--env", "prod", "--verify-local"]),
      /only against --env local/,
    );
  });

  it("wraps the report in a read-only transaction and selects no personal fields", () => {
    const sql = buildSql(30);
    assert.match(sql, /^BEGIN READ ONLY;/);
    assert.match(sql, /COMMIT;\s*$/);
    assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|truncate)\b/i);
    assert.doesNotMatch(sql, /email|display_name|push_token|notes/i);
  });

  it("rolls back the local self-check", () => {
    const sql = buildLocalVerificationSql(30);
    assert.match(sql, /^BEGIN;/);
    assert.match(sql, /ROLLBACK;\s*$/);
    assert.doesNotMatch(sql, /COMMIT/);
  });

  it("can omit the cost ledger for databases without its migration", () => {
    const sql = buildSql(30, { costLedger: false });
    assert.doesNotMatch(sql, /ai_daily_cost_ledger|refines_used\)/);
    assert.equal(parseArgs(["--no-cost-ledger"]).costLedger, false);
  });

  it("reports self-check mismatches", () => {
    assert.equal(checkLocalVerification({ users: [] }).length, 3);
  });

  it("uses nearest-rank quantiles", () => {
    const values = Array.from({ length: 20 }, (_, n) => n + 1);
    assert.equal(quantile(values, 0.5), 10);
    assert.equal(quantile(values, 0.95), 19);
    assert.equal(quantile([], 0.95), 0);
  });

  it("separates recipe tokens from Coach tokens and bounds the estimate", () => {
    const row = {
      ledger_tokens: 100_000,
      recipe_tokens: 10_000,
      recipe_calls: 4,
      drafts_used: 14,
      illustrations: 0,
    };
    const cost = estimateUserCost(row, 2026);
    assert.ok(cost.low > 0);
    assert.ok(cost.high > cost.low);
    // Ten non-recipe drafts priced as photo drafts are part of the low estimate.
    assert.ok(cost.low >= 10 * requestCostUsd(REQUEST_SIZES.photoDraft, 2026));
  });

  it("summarises paid and free tiers separately", () => {
    const report = summarise(
      {
        days: 30,
        since: "2026-09-27",
        tier_members: { paid: 2, free: 5 },
        users: [
          {
            user_id: "u1",
            tier: "paid",
            ledger_tokens: 50_000,
            recipe_tokens: 0,
            recipe_calls: 0,
            drafts_used: 6,
            illustrations: 1,
          },
          {
            user_id: "u2",
            tier: "free",
            ledger_tokens: 9_000,
            recipe_tokens: 0,
            recipe_calls: 0,
            drafts_used: 2,
            illustrations: 0,
          },
        ],
      },
      { year: 2027 },
    );
    assert.equal(report.byTier.paid.activeAiUsers, 1);
    assert.equal(report.byTier.paid.members, 2);
    assert.equal(report.byTier.free.tokens.p95, 9_000);
    assert.equal(report.users, undefined);
  });
});

describe("ai-cost-model", () => {
  it("uses the same list prices as the API cost allowance", () => {
    assert.equal(PRICES_CHECKED_ON, AI_PRICES_CHECKED_ON);
    assert.deepEqual(PRICES.haiku, HAIKU_PRICE);
    assert.deepEqual(PRICES.gemini2026, GEMINI_PRICE_2026);
    assert.deepEqual(PRICES.gemini2027, GEMINI_PRICE_2027);
    assert.equal(
      PRICES.anthropicWebSearch * 1_000_000,
      ANTHROPIC_WEB_SEARCH_MICROS,
    );
    assert.equal(PRICES.geminiGrounding * 1_000_000, GEMINI_GROUNDING_MICROS);
  });

  it("nets the Store fee out of each plan", () => {
    assert.equal(netMonthlyEur(PLANS.monthly).toFixed(3), "6.792");
    assert.equal(netMonthlyEur(PLANS.annual).toFixed(3), "3.541");
    assert.equal(netMonthlyEur(PLANS.foundingAnnual).toFixed(3), "2.478");
  });

  it("doubles Gemini token cost in 2027 and keeps Haiku unchanged", () => {
    const photo2026 = requestCostUsd(REQUEST_SIZES.photoDraft, 2026);
    const photo2027 = requestCostUsd(REQUEST_SIZES.photoDraft, 2027);
    assert.ok(Math.abs(photo2027 - 2 * photo2026) < 1e-12);
    assert.equal(
      requestCostUsd(REQUEST_SIZES.activity, 2026),
      requestCostUsd(REQUEST_SIZES.activity, 2027),
    );
  });

  it("includes web-search fees in typed meal drafts", () => {
    assert.ok(requestCostUsd(REQUEST_SIZES.typedMealSearch) >= 0.03);
  });
});
