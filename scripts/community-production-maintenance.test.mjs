import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  communityAttentionReasons,
  runProductionCommunityAttention,
  runProductionCommunityMaintenance,
} from "./community-production-maintenance.mjs";

const target = {
  hostRole: "hetzner-primary-1d36b436-f4d5-4a29-b249-4153975563f3",
  env: {
    SUPABASE_URL: "http://127.0.0.1:8000",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
    MIZYUN_API_SERVICE: "mizyun-api",
    MIZYUN_LOCAL_API_URL: "http://127.0.0.1:4000",
    API_HOST: "127.0.0.1",
    API_PORT: "4000",
    MIZYUN_PRODUCTION_DB_URL:
      "postgresql://test:synthetic@127.0.0.1:5432/postgres",
    COMMUNITY_DELIVERY_ENABLED: "true",
  },
};

const quietCounts = {
  openReports: 0,
  unclaimedReports: 0,
  urgentUnclaimed: 0,
  overdueFirstResponse: 0,
  staleOpenReports: 0,
  newReports: 0,
  oldestUnclaimedSeconds: 0,
  pendingWithdrawals: 0,
  oldestWithdrawalSeconds: 0,
};

test("Production maintenance purges withdrawals, retention and media without push and reports counters", async () => {
  const calls = [];
  let batches = 0;
  const stats = await runProductionCommunityMaintenance({
    ...target,
    fetchImpl: async (input, options) => {
      const url = String(input);
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.apikey, "synthetic-service-key");
      if (!url.startsWith("http://127.0.0.1:8000/rest/v1/rpc/")) {
        assert.equal(
          url,
          "http://127.0.0.1:8000/storage/v1/object/community-media",
        );
        calls.push("storage-delete");
        return new Response("[]");
      }
      const name = url.split("/").at(-1);
      calls.push(name);
      if (name === "community_withdrawal_pending")
        return new Response(
          JSON.stringify([{ user_id: "fixture", generation: 1 }]),
        );
      if (name === "community_withdrawal_batch")
        return new Response(JSON.stringify([{ complete: ++batches === 2 }]));
      if (name === "community_retention_batch")
        return new Response(JSON.stringify([{ deleted_count: 7 }]));
      if (name === "community_media_cleanup") {
        const body = JSON.parse(options.body);
        if (body.p_operation === "claim") {
          const id = "11111111-1111-4111-8111-111111111111";
          return new Response(
            JSON.stringify([
              {
                id,
                imagePath: `quarantine/${id}/image.jpg`,
                thumbnailPath: `quarantine/${id}/thumbnail.jpg`,
              },
            ]),
          );
        }
        return new Response("");
      }
      assert.fail(`unexpected RPC ${name}`);
    },
  });
  assert.deepEqual(calls, [
    "community_withdrawal_pending",
    "community_withdrawal_batch",
    "community_withdrawal_batch",
    "community_retention_batch",
    "community_media_cleanup",
    "storage-delete",
    "community_media_cleanup",
  ]);
  assert.deepEqual(stats, {
    claims: 0,
    accepted: 0,
    suppressed: 0,
    retries: 0,
    withdrawalJobs: 1,
    cleanupBatches: 2,
    retentionRows: 7,
    mediaCleaned: 1,
    receipts: 0,
  });
});

test("wrong host, missing secret and every Dev or mixed marker fail before any network call", async () => {
  let requests = 0;
  const fetchImpl = async () => {
    requests++;
    throw new Error("Unexpected network request");
  };
  const invalid = [
    { ...target, hostRole: "frozen-pi" },
    { ...target, env: { ...target.env, MIZYUN_DEV_DB_URL: "x" } },
    ...Object.entries({
      SUPABASE_URL: "http://127.0.0.1:8100",
      SUPABASE_SERVICE_ROLE_KEY: "",
      MIZYUN_API_SERVICE: "mizyun-api-dev.service",
      MIZYUN_LOCAL_API_URL: "http://127.0.0.1:4100",
      API_HOST: "0.0.0.0",
      API_PORT: "4100",
      MIZYUN_PRODUCTION_DB_URL:
        "postgresql://test:synthetic@127.0.0.1:5433/postgres",
    }).map(([key, value]) => ({
      ...target,
      env: { ...target.env, [key]: value },
    })),
  ];
  for (const candidate of invalid) {
    for (const run of [
      runProductionCommunityMaintenance,
      runProductionCommunityAttention,
    ])
      await assert.rejects(run({ ...candidate, fetchImpl }), /target mismatch/);
  }
  assert.equal(requests, 0);
});

test("optional service markers may be absent from production.env", async () => {
  const env = { ...target.env };
  delete env.MIZYUN_API_SERVICE;
  delete env.MIZYUN_LOCAL_API_URL;
  const result = await runProductionCommunityAttention({
    ...target,
    env,
    fetchImpl: async (url, options) => {
      assert.ok(url.endsWith("/rest/v1/rpc/community_operations_alert_counts"));
      assert.deepEqual(JSON.parse(options.body), {
        p_new_window_seconds: 3900,
      });
      return new Response(JSON.stringify(quietCounts));
    },
  });
  assert.deepEqual(result, { counts: quietCounts, reasons: [] });
});

test("attention reasons cover urgent, overdue, new, missed and stale reports and stuck withdrawals", () => {
  const morning = new Date("2026-10-27T08:30:00Z");
  const noon = new Date("2026-10-27T12:30:00Z");
  assert.deepEqual(communityAttentionReasons(quietCounts, morning), []);
  // A claimed, in-time case is the moderator's work queue, not an alert.
  assert.deepEqual(
    communityAttentionReasons(
      {
        ...quietCounts,
        openReports: 2,
        unclaimedReports: 1,
        oldestUnclaimedSeconds: 43_200,
        staleOpenReports: 1,
        oldestWithdrawalSeconds: 86_400,
      },
      noon,
    ),
    [],
  );
  // A report whose new-report window was missed still alerts before its 24h clock.
  assert.deepEqual(
    communityAttentionReasons(
      { ...quietCounts, unclaimedReports: 1, oldestUnclaimedSeconds: 43_201 },
      noon,
    ),
    ["report unclaimed for over 12 hours"],
  );
  // Claimed cases left open past a week are reminded once a day.
  assert.deepEqual(
    communityAttentionReasons({ ...quietCounts, staleOpenReports: 1 }, morning),
    ["open case older than 7 days"],
  );
  assert.deepEqual(
    communityAttentionReasons(
      {
        ...quietCounts,
        urgentUnclaimed: 1,
        overdueFirstResponse: 1,
        newReports: 1,
        oldestUnclaimedSeconds: 90_000,
        staleOpenReports: 1,
        oldestWithdrawalSeconds: 86_401,
      },
      morning,
    ),
    [
      "urgent report unclaimed",
      "report past first-response clock",
      "new report received",
      "open case older than 7 days",
      "withdrawal purge older than 24 hours",
    ],
  );
});

test("attention rejects a malformed count payload", async () => {
  await assert.rejects(
    runProductionCommunityAttention({
      ...target,
      fetchImpl: async () => new Response("[]"),
    }),
    /Invalid Community alert counts/,
  );
});

test("CLI refuses an unknown mode without network or secrets in output", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/community-production-maintenance.mjs", "deliver"],
    {
      encoding: "utf8",
      env: { ...target.env, PATH: process.env.PATH },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Community Production deliver failed/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes("synthetic"));
});
