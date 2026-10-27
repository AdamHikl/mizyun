#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createServiceRpc, runCommunityTick } from "./community-worker.mjs";
import { createCommunityMediaCleaner } from "./community-media-cleanup.mjs";

const PRODUCTION_URL = "http://127.0.0.1:8000";
const HETZNER_ROLE = "hetzner-primary-1d36b436-f4d5-4a29-b249-4153975563f3";
const DAY_SECONDS = 86_400;
// Daily reminder hour (UTC) for claimed cases left open past the weekly review.
const STALE_REVIEW_HOUR_UTC = 8;

/** Fail before any network use unless every marker names Hetzner Production. */
export function assertProductionTarget({ env, hostRole }) {
  if (
    hostRole !== HETZNER_ROLE ||
    env.SUPABASE_URL !== PRODUCTION_URL ||
    env.API_HOST !== "127.0.0.1" ||
    env.API_PORT !== "4000" ||
    !/^postgres(?:ql)?:\/\/[^/@]+:[^/@]+@127\.0\.0\.1:5432\/postgres(?:\?.*)?$/.test(
      env.MIZYUN_PRODUCTION_DB_URL ?? "",
    ) ||
    // Optional in production.env (promote-production.sh defaults them) but never Dev values.
    !["mizyun-api", "mizyun-api.service", undefined].includes(
      env.MIZYUN_API_SERVICE,
    ) ||
    !["http://127.0.0.1:4000", undefined].includes(env.MIZYUN_LOCAL_API_URL) ||
    env.MIZYUN_DEV_DB_URL !== undefined ||
    !env.SUPABASE_SERVICE_ROLE_KEY
  )
    throw new Error("Community Production maintenance target mismatch");
}

function productionRpc({ env, fetchImpl }) {
  const guardedFetch = (url, options) =>
    fetchImpl(url, { ...options, redirect: "error" });
  return {
    guardedFetch,
    rpc: createServiceRpc({
      url: PRODUCTION_URL,
      key: env.SUPABASE_SERVICE_ROLE_KEY,
      fetchImpl: guardedFetch,
    }),
  };
}

/**
 * Production privacy maintenance (withdrawal purge, retention windows, removed media).
 * Push stays off under ADR-0078, so it never claims delivery jobs or contacts a provider.
 */
export async function runProductionCommunityMaintenance({
  env,
  hostRole,
  fetchImpl = fetch,
}) {
  assertProductionTarget({ env, hostRole });
  const { rpc, guardedFetch } = productionRpc({ env, fetchImpl });
  return runCommunityTick({
    rpc,
    deliveryEnabled: false,
    cleanupMedia: createCommunityMediaCleaner({
      rpc,
      url: PRODUCTION_URL,
      key: env.SUPABASE_SERVICE_ROLE_KEY,
      fetchImpl: guardedFetch,
    }),
  });
}

/** Aggregate reasons a human must look now; empty means nothing to do. */
export function communityAttentionReasons(counts, now = new Date()) {
  const reasons = [];
  if (counts.urgentUnclaimed > 0) reasons.push("urgent report unclaimed");
  if (counts.overdueFirstResponse > 0)
    reasons.push("report past first-response clock");
  if (counts.newReports > 0) reasons.push("new report received");
  // Catches reports whose new-report window passed while checks were down.
  else if (counts.oldestUnclaimedSeconds > DAY_SECONDS / 2)
    reasons.push("report unclaimed for over 12 hours");
  if (
    counts.staleOpenReports > 0 &&
    now.getUTCHours() === STALE_REVIEW_HOUR_UTC
  )
    reasons.push("open case older than 7 days");
  if (counts.oldestWithdrawalSeconds > DAY_SECONDS)
    reasons.push("withdrawal purge older than 24 hours");
  return reasons;
}

/** Hourly moderation/privacy attention check: counts only, never report content. */
export async function runProductionCommunityAttention({
  env,
  hostRole,
  fetchImpl = fetch,
  now = new Date(),
}) {
  assertProductionTarget({ env, hostRole });
  const { rpc } = productionRpc({ env, fetchImpl });
  // 65-minute window so an hourly timer with jitter never skips a new report.
  const counts = await rpc("community_operations_alert_counts", {
    p_new_window_seconds: 3900,
  });
  if (!counts || typeof counts !== "object" || Array.isArray(counts))
    throw new Error("Invalid Community alert counts");
  return { counts, reasons: communityAttentionReasons(counts, now) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const mode = process.argv[2];
  try {
    if (mode !== "maintenance" && mode !== "attention")
      throw new Error("Mode must be maintenance or attention");
    const target = {
      env: process.env,
      hostRole: readFileSync("/etc/mizyun/host-role", "utf8").trim(),
    };
    if (mode === "maintenance") {
      console.log(
        JSON.stringify(await runProductionCommunityMaintenance(target)),
      );
    } else {
      const { counts, reasons } = await runProductionCommunityAttention(target);
      console.log(JSON.stringify(counts));
      if (reasons.length) {
        // Nonzero exit triggers the OnFailure alert; the journal keeps these counts.
        console.error(`Community needs attention: ${reasons.join("; ")}.`);
        process.exitCode = 3;
      }
    }
  } catch {
    console.error(
      `Community Production ${mode ?? "unknown"} failed; inspect unit status.`,
    );
    process.exitCode = 1;
  }
}
