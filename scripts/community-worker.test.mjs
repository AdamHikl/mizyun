import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runCommunityTick,
  expoPush,
  createServiceRpc,
  assertWorkerTarget,
} from "./community-worker.mjs";
test("slow serial sends lease each job when ready without exhausting unsent retries", async () => {
  let now = 0;
  const jobs = Array.from({ length: 25 }, (_, id) => ({
    id: String(id),
    attempts: 0,
    expires: 0,
    sent: false,
  }));
  const rpc = async (name, args) => {
    if (name === "community_withdrawal_pending") return [];
    if (name === "community_notification_claim")
      return jobs
        .filter((job) => !job.sent && job.expires <= now)
        .slice(0, args.p_limit)
        .map((job) => {
          job.attempts++;
          job.expires = now + 30000;
          return { id: job.id, lease_id: String(job.attempts) };
        });
    if (name === "community_notification_prepare") {
      const job = jobs[Number(args.p_id)];
      return job.expires > now ? { eventId: job.id } : null;
    }
    if (name === "community_notification_finish") {
      const job = jobs[Number(args.p_id)];
      assert.ok(
        job.expires > now,
        "provider acknowledgement retains its lease",
      );
      job.sent = true;
    }
    return null;
  };
  const tick = () =>
    runCommunityTick({
      rpc,
      deliveryEnabled: true,
      push: async () => {
        now += 10000;
        return { status: "accepted" };
      },
    });
  const first = await tick();
  assert.equal(first.claims, 20, "each tick remains bounded");
  assert.equal(first.accepted, 20);
  assert.equal(jobs.filter((job) => job.attempts === 0).length, 5);
  const second = await tick();
  assert.equal(second.accepted, 5);
  assert.ok(jobs.every((job) => job.sent && job.attempts === 1));
});
test("disabled delivery still performs bounded privacy cleanup", async () => {
  const calls = [];
  let batches = 0;
  const rpc = async (name, args) => {
    calls.push([name, args]);
    if (name === "community_withdrawal_pending")
      return [{ user_id: "u", generation: 2 }];
    if (name === "community_withdrawal_batch")
      return [{ complete: ++batches === 2 }];
    return 0;
  };
  const stats = await runCommunityTick({
    rpc,
    push: () => assert.fail("delivery disabled"),
  });
  assert.equal(stats.cleanupBatches, 2);
  assert.ok(calls.some(([n]) => n === "community_retention_batch"));
  assert.ok(!calls.some(([n]) => n === "community_notification_claim"));
});
test("worker revalidates each claim, suppresses revoked work and retries failures without logging payloads", async () => {
  const calls = [];
  const pending = [
    { id: "a", lease_id: "x" },
    { id: "b", lease_id: "y" },
  ];
  const rpc = async (name, args) => {
    calls.push([name, args]);
    if (name === "community_withdrawal_pending") return [];
    if (name === "community_notification_claim")
      return pending.splice(0, args.p_limit);
    if (name === "community_notification_prepare")
      return args.p_id === "a" ? null : { token: "secret", eventId: "opaque" };
    return null;
  };
  const stats = await runCommunityTick({
    rpc,
    push: async () => {
      throw new Error("lost response");
    },
    deliveryEnabled: true,
  });
  assert.equal(stats.suppressed, 1);
  assert.equal(stats.retries, 1);
  assert.deepEqual(
    calls.find(([name]) => name === "community_notification_finish"),
    [
      "community_notification_finish",
      { p_id: "b", p_lease_id: "y", p_status: "retry" },
    ],
  );
  assert.ok(!JSON.stringify(stats).includes("secret"));
});
test("push lock screen uses only generic text and opaque event ID", async () => {
  let body;
  const result = await expoPush(
    { token: "secret", eventId: "opaque" },
    {
      fetchImpl: async (url, options) => {
        body = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({ data: { status: "ok", id: "receipt" } }),
        };
      },
    },
  );
  assert.equal(result.status, "accepted");
  assert.deepEqual(body.data, { communityEventId: "opaque" });
  assert.equal(body.body, "You have a Community update.");
  assert.equal(body.ttl, 300);
});
test("unregistered provider rejects token, transport errors retry", async () => {
  assert.equal(
    (
      await expoPush(
        { token: "x", eventId: "y" },
        {
          fetchImpl: async () => ({
            ok: true,
            json: async () => ({
              data: {
                status: "error",
                details: { error: "DeviceNotRegistered" },
              },
            }),
          }),
        },
      )
    ).status,
    "invalid",
  );
  assert.equal(
    (
      await expoPush(
        { token: "x", eventId: "y" },
        { fetchImpl: async () => ({ ok: false }) },
      )
    ).status,
    "retry",
  );
});
test("credentials required and provider failure response body is never echoed", async () => {
  assert.throws(() => createServiceRpc({}), /Explicit/);
  const rpc = createServiceRpc({
    url: "https://example.test",
    key: "secret",
    fetchImpl: async () => ({ ok: false }),
  });
  await assert.rejects(
    rpc("x", {}),
    (e) => e.message === "Community worker RPC failed",
  );
});

test("worker environment label cannot select another environment", () => {
  assert.throws(
    () => assertWorkerTarget("dev", "https://mizyun-supabase.phiskel.com"),
    /mismatch/,
  );
  assert.throws(
    () => assertWorkerTarget("production", "http://localhost:8000"),
    /mismatch/,
  );
  assertWorkerTarget("dev", "https://mizyun-supabase-dev.phiskel.com");
});
test("receipt polling distinguishes provider handoff from missing and invalid receipts", async () => {
  const { expoReceipts } = await import("./community-worker.mjs");
  const statuses = await expoReceipts(["accepted", "invalid", "missing"], {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        data: {
          accepted: { status: "ok" },
          invalid: {
            status: "error",
            details: { error: "DeviceNotRegistered" },
          },
        },
      }),
    }),
  });
  assert.deepEqual(statuses, {
    accepted: "ok",
    invalid: "invalid",
    missing: "retry",
  });
});
test("maintenance still polls receipts with delivery disabled and binds acknowledgement to exact receipt", async () => {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push([name, args]);
    if (name === "community_withdrawal_pending") return [];
    if (name === "community_notification_receipts")
      return [{ id: "job", receipt_id: "receipt" }];
    return null;
  };
  const stats = await runCommunityTick({
    rpc,
    push: () => assert.fail(),
    receipts: async () => ({ receipt: "invalid" }),
  });
  assert.equal(stats.receipts, 1);
  assert.ok(
    calls.some(
      ([name, args]) =>
        name === "community_notification_receipt_finish" &&
        args.p_id === "job" &&
        args.p_receipt_id === "receipt" &&
        args.p_status === "invalid",
    ),
  );
});
