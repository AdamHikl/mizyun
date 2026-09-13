import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  parseArgs,
  buildSql,
  processFixture,
  formatHumanOutput,
  ALLOWED_COMMANDS,
} from "./product-analytics.mjs";

describe("product-analytics CLI", () => {
  it("parses valid command arguments", () => {
    const opts = parseArgs(["summary", "--env", "dev", "--days", "14"]);
    assert.equal(opts.command, "summary");
    assert.equal(opts.env, "dev");
    assert.equal(opts.days, 14);
    assert.equal(opts.json, false);
  });

  it("handles --json and platform flags", () => {
    const opts = parseArgs([
      "features",
      "--env",
      "prod",
      "--platform",
      "ios",
      "--json",
    ]);
    assert.equal(opts.command, "features");
    assert.equal(opts.env, "prod");
    assert.equal(opts.platform, "ios");
    assert.equal(opts.json, true);
  });

  it("rejects invalid days", () => {
    assert.throws(
      () => parseArgs(["summary", "--days", "0"]),
      /Invalid --days/,
    );
    assert.throws(
      () => parseArgs(["summary", "--days", "45"]),
      /Invalid --days/,
    );
  });

  it("rejects unknown command", () => {
    assert.throws(() => parseArgs(["unknown-command"]), /Invalid command/);
  });

  it("rejects invalid environment", () => {
    assert.throws(
      () => parseArgs(["summary", "--env", "staging"]),
      /Invalid --env/,
    );
  });

  it("rejects invalid platform", () => {
    assert.throws(
      () => parseArgs(["summary", "--platform", "windows"]),
      /Invalid --platform/,
    );
  });

  it("builds read-only safe SQL for all allowed commands", () => {
    for (const cmd of ALLOWED_COMMANDS) {
      const sql = buildSql(cmd, { days: 7, platform: null, limit: 50 });
      assert.ok(
        sql.includes("BEGIN READ ONLY;"),
        `SQL for ${cmd} must begin with READ ONLY`,
      );
      assert.ok(sql.includes("COMMIT;"), `SQL for ${cmd} must end with COMMIT`);
      assert.ok(
        sql.includes("public.product_analytics_events"),
        `SQL for ${cmd} must query product_analytics_events`,
      );
    }
  });

  it("incorporates platform filter into SQL when specified", () => {
    const sql = buildSql("summary", { days: 7, platform: "ios", limit: 50 });
    assert.ok(sql.includes("AND platform = 'ios'"));
  });

  it("processes synthetic JSON fixtures accurately", () => {
    const tempFile = join(
      tmpdir(),
      `test-analytics-fixture-${Date.now()}.json`,
    );
    const events = [
      {
        userId: "user-1",
        sessionId: "sess-1",
        name: "screen_viewed",
        recordedAt: new Date().toISOString(),
        properties: { screen: "dashboard" },
      },
      {
        userId: "user-1",
        sessionId: "sess-1",
        name: "screen_viewed",
        recordedAt: new Date().toISOString(),
        properties: { screen: "settings" },
      },
      {
        userId: "user-2",
        sessionId: "sess-2",
        name: "feature_action_result",
        recordedAt: new Date().toISOString(),
        properties: { action: "feedback_submit", outcome: "success" },
      },
    ];
    writeFileSync(tempFile, JSON.stringify(events), "utf8");

    try {
      const summary = processFixture("summary", tempFile, { days: 7 });
      assert.equal(summary.unique_accounts, 2);
      assert.equal(summary.total_events, 3);
      assert.equal(summary.total_sessions, 2);
      assert.equal(summary.events_by_name.screen_viewed, 2);
      assert.equal(summary.events_by_name.feature_action_result, 1);

      const features = processFixture("features", tempFile, { days: 7 });
      assert.equal(features.screens.length, 2);
      assert.equal(features.actions.length, 1);
      assert.equal(features.actions[0].action, "feedback_submit");
      assert.equal(features.actions[0].outcome, "success");
    } finally {
      unlinkSync(tempFile);
    }
  });

  it("formats human output without crashing", () => {
    const summaryData = {
      command: "summary",
      days: 7,
      unique_accounts: 3,
      total_sessions: 5,
      total_events: 42,
      events_by_name: { screen_viewed: 30, feature_action_result: 12 },
    };
    const human = formatHumanOutput(summaryData, "dev");
    assert.ok(human.includes("DEV"));
    assert.ok(human.includes("Consenting Accounts : 3"));
    assert.ok(human.includes("Total Events        : 42"));
  });
});
