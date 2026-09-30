import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import {
  parseArgs,
  calculateClock,
  runMockDrill,
  staffRequestHeaders,
  validateApiUrl,
  SLA_TARGETS,
  ALLOWED_ACTIONS,
  ALLOWED_APPEAL_DECISIONS,
} from "./community-moderation.mjs";

describe("community-moderation CLI (COMM-09)", () => {
  it("requires a named session and exports SLA targets", () => {
    assert.throws(() => staffRequestHeaders({}), /required/);
    assert.deepEqual(staffRequestHeaders({ accessToken: "verified" }), {
      Authorization: "Bearer verified",
      "Content-Type": "application/json",
    });
    assert.equal(SLA_TARGETS.urgentHours, 4);
    assert.equal(SLA_TARGETS.normalHours, 24);
  });

  it("parses queue command arguments by default", () => {
    const opts = parseArgs([]);
    assert.equal(opts.command, "queue");
    assert.equal(opts.json, false);
  });

  it("parses inspect command with report id", () => {
    const opts = parseArgs(["--inspect", "rep-123"]);
    assert.equal(opts.command, "inspect");
    assert.equal(opts.reportId, "rep-123");
  });

  it("rejects inspect without report id", () => {
    assert.throws(
      () => parseArgs(["--inspect"]),
      /--inspect requires a report ID/,
    );
  });

  it("parses action command with required flags", () => {
    const opts = parseArgs([
      "--action",
      "remove",
      "--report",
      "rep-123",
      "--reason",
      "Spam link",
      "--notes",
      "Confirmed commercial link",
    ]);
    assert.equal(opts.command, "action");
    assert.equal(opts.action, "remove");
    assert.equal(opts.reportId, "rep-123");
    assert.equal(opts.reason, "Spam link");
    assert.equal(opts.notes, "Confirmed commercial link");
  });

  it("rejects action with invalid action type", () => {
    assert.throws(
      () =>
        parseArgs([
          "--action",
          "nuke",
          "--report",
          "rep-123",
          "--reason",
          "test",
        ]),
      /Invalid --action/,
    );
  });

  it("parses appeal review command", () => {
    const opts = parseArgs([
      "--review-appeal",
      "app-123",
      "--decision",
      "approved",
      "--notes",
      "Sanction lifted",
    ]);
    assert.equal(opts.command, "review-appeal");
    assert.equal(opts.appealId, "app-123");
    assert.equal(opts.decision, "approved");
  });

  it("rejects review appeal with invalid decision", () => {
    assert.throws(
      () => parseArgs(["--review-appeal", "app-123", "--decision", "maybe"]),
      /--decision must be one of/,
    );
  });

  it("rejects shared secrets, caller-selected operators and unsafe API endpoints", () => {
    for (const flag of ["--secret", "--operator"])
      assert.throws(() => parseArgs([flag, "spoofed"]), /unsupported/);
    for (const url of [
      "http://mizyun-api.phiskel.com",
      "https://user:password@example.com",
      "https://example.com?token=x",
      "ftp://localhost",
    ])
      assert.throws(() => validateApiUrl(url));
    assert.equal(
      validateApiUrl("https://mizyun-api-dev.phiskel.com/"),
      "https://mizyun-api-dev.phiskel.com",
    );
    assert.equal(
      validateApiUrl("http://127.0.0.1:4100"),
      "http://127.0.0.1:4100",
    );
    assert.throws(() => parseArgs(["--env", "bogus"]), /must be/);
    assert.throws(() => parseArgs(["--suspension-days", "2oops"]), /Invalid/);
  });

  it("never substitutes an offline simulation for a requested live drill", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/community-moderation.mjs", "--drill"],
      {
        encoding: "utf8",
        env: { ...process.env, COMMUNITY_STAFF_ACCESS_TOKEN: "" },
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Live drills require provisioned cases/);
    assert.doesNotMatch(result.stdout, /SIMULATION COMPLETED/);
  });

  it("fails closed before live network requests when no named session exists", () => {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/community-moderation.mjs",
        "--queue",
        "--api-url",
        "http://127.0.0.1:1",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          COMMUNITY_STAFF_ACCESS_TOKEN: "",
          COMMUNITY_MODERATION_SECRET: "dev_staff_secret",
        },
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /COMMUNITY_STAFF_ACCESS_TOKEN is required/);
  });

  it("supports authenticated case claiming and pending appeal inspection", () => {
    assert.equal(parseArgs(["--claim", "case-id"]).command, "claim");
    assert.equal(parseArgs(["--claim", "case-id"]).reportId, "case-id");
    assert.equal(parseArgs(["--appeals"]).command, "appeals");
    assert.throws(() => parseArgs(["--claim"]), /--claim requires a report ID/);
  });

  it("requires an explicit permitted suspension duration", () => {
    assert.throws(
      () =>
        parseArgs([
          "--action",
          "suspend",
          "--report",
          "case",
          "--reason",
          "Policy",
        ]),
      /requires --suspension-days/,
    );
    assert.equal(
      parseArgs([
        "--action",
        "suspend",
        "--report",
        "case",
        "--reason",
        "Policy",
        "--suspension-days",
        "7",
      ]).suspensionDays,
      7,
    );
    assert.throws(
      () => parseArgs(["--suspension-days", "365"]),
      /7, 14, or 30/,
    );
  });

  it("bounds queue and appeal pages", () => {
    const page = parseArgs(["--appeals", "--limit", "20", "--offset", "40"]);
    assert.equal(page.limit, 20);
    assert.equal(page.offset, 40);
    for (const args of [
      ["--limit", "101"],
      ["--limit", "0"],
      ["--offset", "-1"],
      ["--offset", "10001"],
    ])
      assert.throws(() => parseArgs(args), /--limit/);
  });

  it("renders attacker-controlled report notes without terminal commands or forged lines", () => {
    const notes =
      "Report\u001b[2J\u001b]52;c;YXR0YWNr\u0007\nFORGED QUEUE LINE\u009b31m";
    for (const outputArguments of [[], ["--json"]]) {
      const result = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `process.argv = [process.execPath, "scripts/community-moderation.mjs", "--queue", "--api-url", "http://127.0.0.1:1", ...${JSON.stringify(outputArguments)}];
         globalThis.fetch = async () => ({ok: true, json: async () => [{id: "case", targetType: "profile", targetId: "subject", reason: "spam", status: "submitted", priority: "normal", createdAt: new Date().toISOString(), notes: ${JSON.stringify(notes)}}]});
         await import("./scripts/community-moderation.mjs");`,
        ],
        {
          encoding: "utf8",
          env: { ...process.env, COMMUNITY_STAFF_ACCESS_TOKEN: "synthetic" },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stdout, /[\u001b\u0007\u009b]/);
      assert.doesNotMatch(result.stdout, /^FORGED QUEUE LINE/m);
      assert.match(result.stdout, /Report\\u001b\[2J/);
      assert.match(result.stdout, /\\nFORGED QUEUE LINE\\u009b31m/);
    }
  });

  it("calculates SLA clock for urgent and normal priorities", () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

    const urgentClock = calculateClock(oneHourAgo, "urgent");
    assert.equal(urgentClock.limitHours, 4);
    assert.equal(urgentClock.isOverdue, false);

    const normalClock = calculateClock(oneHourAgo, "normal");
    assert.equal(normalClock.limitHours, 24);
    assert.equal(normalClock.isOverdue, false);

    const fiveHoursAgo = new Date(
      now.getTime() - 5 * 60 * 60 * 1000,
    ).toISOString();
    const overdueUrgentClock = calculateClock(fiveHoursAgo, "urgent");
    assert.equal(overdueUrgentClock.isOverdue, true);
  });

  it("runs synthetic report-to-resolution drill successfully", async () => {
    const result = await runMockDrill();
    assert.equal(result.success, true);
    assert.equal(result.evidenceTier, "offline_simulation");
    assert.equal(result.report.decision, "remove");
    assert.equal(result.appeal.status, "approved");
    assert.notEqual(result.report.assignedTo, result.appeal.reviewedBy);
  });
});
