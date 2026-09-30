#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createServiceRpc, runCommunityTick } from "./community-worker.mjs";

const DEV_URL = "http://127.0.0.1:8100";
const HETZNER_ROLE = "hetzner-primary-1d36b436-f4d5-4a29-b249-4153975563f3";

/** Dev privacy maintenance never claims push jobs or contacts a provider. */
export async function runDevCommunityMaintenance({
  env,
  hostRole,
  fetchImpl = fetch,
}) {
  if (
    hostRole !== HETZNER_ROLE ||
    env.SUPABASE_URL !== DEV_URL ||
    env.MIZYUN_API_SERVICE !== "mizyun-api-dev.service" ||
    env.MIZYUN_LOCAL_API_URL !== "http://127.0.0.1:4100" ||
    env.API_HOST !== "127.0.0.1" ||
    env.API_PORT !== "4100" ||
    !/^postgres(?:ql)?:\/\/[^/@]+:[^/@]+@127\.0\.0\.1:5433\/postgres(?:\?.*)?$/.test(
      env.MIZYUN_DEV_DB_URL ?? "",
    ) ||
    !env.SUPABASE_SERVICE_ROLE_KEY
  )
    throw new Error("Community Dev maintenance target mismatch");

  const rpc = createServiceRpc({
    url: DEV_URL,
    key: env.SUPABASE_SERVICE_ROLE_KEY,
    fetchImpl: (url, options) =>
      fetchImpl(url, { ...options, redirect: "error" }),
  });
  return runCommunityTick({ rpc, deliveryEnabled: false });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const stats = await runDevCommunityMaintenance({
      env: process.env,
      hostRole: readFileSync("/etc/mizyun/host-role", "utf8").trim(),
    });
    console.log(JSON.stringify(stats));
  } catch {
    console.error("Community Dev maintenance failed; inspect unit status.");
    process.exitCode = 1;
  }
}
