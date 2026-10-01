#!/usr/bin/env node
import { createCommunityMediaCleaner } from "./community-media-cleanup.mjs";
import { pathToFileURL } from "node:url";
/** Bounded single tick. Environment service credentials never enter command arguments/logs. */
export async function runCommunityTick({
  rpc,
  push,
  deliveryEnabled = false,
  receipts,
  cleanupMedia,
}) {
  const stats = {
    claims: 0,
    accepted: 0,
    suppressed: 0,
    retries: 0,
    cleanupBatches: 0,
    receipts: 0,
  };
  // Service-only SQL cursor bounded to ten jobs per tick.
  const jobs = await rpc("community_withdrawal_pending", {});
  for (const job of jobs) {
    for (let batch = 0; batch < 20; batch++) {
      const result = await rpc("community_withdrawal_batch", {
        p_user_id: job.user_id,
        p_generation: job.generation,
        p_limit: 500,
      });
      stats.cleanupBatches++;
      if (result[0]?.complete) break;
    }
  }
  await rpc("community_retention_batch", { p_limit: 500 });
  if (cleanupMedia) await cleanupMedia();
  if (receipts) {
    const pendingReceipts = await rpc("community_notification_receipts", {
      p_limit: 20,
    });
    if (pendingReceipts.length) {
      const results = await receipts(
        pendingReceipts.map((item) => item.receipt_id),
      );
      for (const item of pendingReceipts) {
        await rpc("community_notification_receipt_finish", {
          p_id: item.id,
          p_receipt_id: item.receipt_id,
          p_status: results[item.receipt_id] ?? "retry",
        });
        stats.receipts++;
      }
    }
  }
  if (!deliveryEnabled) return stats;
  // Start each short lease immediately before dispatch, never behind earlier sends.
  for (let slot = 0; slot < 20; slot++) {
    const [claim] = await rpc("community_notification_claim", { p_limit: 1 });
    if (!claim) break;
    stats.claims++;
    const message = await rpc("community_notification_prepare", {
      p_id: claim.id,
      p_lease_id: claim.lease_id,
    });
    if (!message) {
      stats.suppressed++;
      continue;
    }
    let outcome;
    try {
      outcome = await push(message);
    } catch {
      outcome = { status: "retry" };
    }
    await rpc("community_notification_finish", {
      p_id: claim.id,
      p_lease_id: claim.lease_id,
      p_status: outcome.status,
      ...(outcome.receiptId ? { p_receipt_id: outcome.receiptId } : {}),
    });
    if (outcome.status === "accepted") stats.accepted++;
    else stats.retries++;
  }
  return stats;
}
export function assertWorkerTarget(target, url) {
  const expected = {
    dev: "https://mizyun-supabase-dev.phiskel.com",
    production: "https://mizyun-supabase.phiskel.com",
  }[target];
  if (!expected || url !== expected)
    throw new Error("Worker target URL mismatch");
}
export function createServiceRpc({ url, key, fetchImpl = fetch }) {
  if (!url || !key)
    throw new Error(
      "Explicit environment Supabase URL and service key required",
    );
  const parsed = new URL(url);
  if (!["https:", "http:"].includes(parsed.protocol))
    throw new Error("Invalid service URL");
  return async (name, args) => {
    const response = await fetchImpl(
      `${url.replace(/\/$/, "")}/rest/v1/rpc/${name}`,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) throw new Error("Community worker RPC failed");
    const raw = await response.text();
    return raw ? JSON.parse(raw) : null;
  };
}
export async function expoPush(
  message,
  { fetchImpl = fetch, accessToken } = {},
) {
  const response = await fetchImpl("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({
      to: message.token,
      title: "Mizyun",
      body: "You have a Community update.",
      data: { communityEventId: message.eventId },
      ttl: 300,
      channelId: "community",
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return { status: "retry" };
  const { data } = await response.json();
  if (data?.status === "ok" && typeof data.id === "string")
    return { status: "accepted", receiptId: data.id };
  return {
    status:
      data?.details?.error === "DeviceNotRegistered" ? "invalid" : "retry",
  };
}
export async function expoReceipts(
  ids,
  { fetchImpl = fetch, accessToken } = {},
) {
  const response = await fetchImpl(
    "https://exp.host/--/api/v2/push/getReceipts",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ ids: ids.slice(0, 20) }),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) throw new Error("Receipt lookup unavailable");
  const { data } = await response.json();
  const result = {};
  for (const id of ids) {
    const receipt = data?.[id];
    result[id] =
      receipt?.status === "ok"
        ? "ok"
        : receipt?.details?.error === "DeviceNotRegistered"
          ? "invalid"
          : receipt?.status === "error"
            ? "failed"
            : "retry";
  }
  return result;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (
    process.env.COMMUNITY_WORKER_TARGET !== "dev" &&
    process.env.COMMUNITY_WORKER_TARGET !== "production"
  )
    throw new Error("Explicit COMMUNITY_WORKER_TARGET required");
  try {
    assertWorkerTarget(
      process.env.COMMUNITY_WORKER_TARGET,
      process.env.COMMUNITY_WORKER_SUPABASE_URL,
    );
    const rpc = createServiceRpc({
      url: process.env.COMMUNITY_WORKER_SUPABASE_URL,
      key: process.env.COMMUNITY_WORKER_SERVICE_KEY,
    });
    const stats = await runCommunityTick({
      rpc,
      cleanupMedia: createCommunityMediaCleaner({
        rpc,
        url: process.env.COMMUNITY_WORKER_SUPABASE_URL,
        key: process.env.COMMUNITY_WORKER_SERVICE_KEY,
      }),
      push: (message) =>
        expoPush(message, { accessToken: process.env.EXPO_ACCESS_TOKEN }),
      deliveryEnabled: process.env.COMMUNITY_DELIVERY_ENABLED === "true",
      receipts: (ids) =>
        expoReceipts(ids, { accessToken: process.env.EXPO_ACCESS_TOKEN }),
    });
    console.log(JSON.stringify(stats));
  } catch {
    console.error(
      "Community worker tick failed; inspect aggregate monitoring.",
    );
    process.exitCode = 1;
  }
}
