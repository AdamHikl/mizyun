#!/usr/bin/env node

/**
 * CLI utility to check and triage Launch Pro Pass requests across Dev and Production.
 *
 * Checks public.beta_pro_requests in PostgreSQL on the Hetzner primary host
 * via SSH and Docker exec with safe stdin piping.
 *
 * Usage:
 *   node scripts/check-beta-pro-requests.mjs                      # Check pending requests on both Dev and Production
 *   node scripts/check-beta-pro-requests.mjs --all                # Check all requests (pending, approved, rejected)
 *   node scripts/check-beta-pro-requests.mjs --env dev            # Check only Dev
 *   node scripts/check-beta-pro-requests.mjs --env production     # Check only Production
 *   node scripts/check-beta-pro-requests.mjs --json               # Output machine-readable JSON
 *   node scripts/check-beta-pro-requests.mjs --approve <email|id> # Approve a request and dispatch Expo push notification
 *   node scripts/check-beta-pro-requests.mjs --reject <email|id>  # Reject a request
 */

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import http2 from "node:http2";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_SSH_ALIAS = process.env.MIZYUN_SSH_ALIAS || "mizyun-hetzner-ops";
const DEFAULT_TIMEOUT_MS = 30000;

const CONTAINERS = {
  dev: "mizyun-dev-db",
  production: "supabase-db",
};

function parseArgs(argv) {
  const options = {
    env: "both", // "both" | "dev" | "production"
    status: "pending", // "pending" | "approved" | "rejected" | "all"
    json: false,
    approveTarget: null,
    rejectTarget: null,
    note: "",
    sshAlias: DEFAULT_SSH_ALIAS,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--all" || arg === "-a") {
      options.status = "all";
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--status") {
      if (i + 1 >= argv.length) {
        throw new Error('Option "--status" requires an argument.');
      }
      const s = argv[++i].toLowerCase();
      if (!["pending", "approved", "rejected", "all"].includes(s)) {
        throw new Error(
          `Invalid --status "${s}". Expected: pending, approved, rejected, or all.`,
        );
      }
      options.status = s;
    } else if (arg === "--env") {
      if (i + 1 >= argv.length) {
        throw new Error('Option "--env" requires an argument.');
      }
      const e = argv[++i].toLowerCase();
      if (e === "prod") {
        options.env = "production";
      } else if (e === "dev" || e === "production" || e === "both") {
        options.env = e;
      } else {
        throw new Error(
          `Invalid --env "${e}". Expected: dev, production (or prod), or both.`,
        );
      }
    } else if (arg === "--approve") {
      if (i + 1 >= argv.length || argv[i + 1].startsWith("-")) {
        throw new Error('Option "--approve" requires an email or user ID.');
      }
      options.approveTarget = argv[++i];
    } else if (arg === "--reject") {
      if (i + 1 >= argv.length || argv[i + 1].startsWith("-")) {
        throw new Error('Option "--reject" requires an email or user ID.');
      }
      options.rejectTarget = argv[++i];
    } else if (arg === "--note") {
      if (i + 1 >= argv.length) {
        throw new Error('Option "--note" requires text.');
      }
      options.note = argv[++i];
    } else if (arg === "--ssh") {
      if (i + 1 >= argv.length) {
        throw new Error('Option "--ssh" requires a host alias.');
      }
      options.sshAlias = argv[++i];
    } else {
      throw new Error(`Unrecognized argument "${arg}". Use --help for usage.`);
    }
  }

  if (options.approveTarget && options.rejectTarget) {
    throw new Error(
      'Cannot specify both "--approve" and "--reject" at the same time.',
    );
  }

  return options;
}

function printUsage() {
  console.log(`
Check & Manage Launch Pro Pass Requests

Inspects pending requests for the "Launch Pro Pass" across Production and Dev
databases hosted on the Hetzner primary host.

USAGE:
  node scripts/check-beta-pro-requests.mjs [options]

OPTIONS:
  --env <dev|prod|both>     Target environment (default: both)
  --all, -a                 Show all requests (pending, approved, rejected)
  --status <status>         Filter by status: pending (default), approved, rejected, or all
  --approve <email|id>      Approve request, trigger paid tier, and send push notification
  --reject <email|id>       Reject request (reverts profile to free tier if previously approved)
  --note "<text>"           Optional review note to attach during approval/rejection
  --ssh <alias>             SSH host alias (default: mizyun-hetzner-ops or MIZYUN_SSH_ALIAS)
  --json                    Output structured JSON
  --help, -h                Show this help message

EXAMPLES:
  # Check pending requests on both Dev and Production:
  node scripts/check-beta-pro-requests.mjs

  # Check only Production:
  node scripts/check-beta-pro-requests.mjs --env production

  # Show all requests including previously approved/rejected:
  node scripts/check-beta-pro-requests.mjs --all

  # Approve a pending request on Dev:
  node scripts/check-beta-pro-requests.mjs --approve user@example.com --env dev

  # Approve and add an internal note:
  node scripts/check-beta-pro-requests.mjs --approve user@example.com --note "Early beta tester"
`);
}

/**
 * Execute SQL query via SSH and docker exec with stdin piping.
 * Passing SQL via stdin prevents remote shell expansion ($VAR, command substitution)
 * and quote escaping issues.
 */
function queryDatabasePsql(env, sql, sshAlias) {
  const container = CONTAINERS[env];
  if (!container) {
    throw new Error(`Unknown environment "${env}".`);
  }

  const remoteCommand = `docker exec -i ${container} psql -U postgres -d postgres -v ON_ERROR_STOP=1 -t -A`;

  const res = spawnSync(
    "ssh",
    ["-o", "ConnectTimeout=10", sshAlias, remoteCommand],
    {
      input: sql,
      encoding: "utf8",
      timeout: DEFAULT_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  if (res.error) {
    throw new Error(
      `SSH command error on ${sshAlias} (${container}): ${res.error.message}`,
    );
  }

  if (res.status !== 0) {
    const errorMsg =
      res.stderr?.trim() || res.stdout?.trim() || "Unknown error";
    throw new Error(
      `Database command failed on ${sshAlias} (${container}): ${errorMsg}`,
    );
  }

  return res.stdout.trim();
}

function queryDatabaseJson(env, sql, sshAlias) {
  const raw = queryDatabasePsql(env, sql, sshAlias);
  if (!raw) return [];

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse JSON output from ${CONTAINERS[env]}: ${err.message}\nRaw output: ${raw}`,
    );
  }
}

function fetchRequests(env, statusFilter, sshAlias) {
  let whereClause = "";
  if (statusFilter !== "all") {
    // Validated in parseArgs
    whereClause = `WHERE r.status = '${statusFilter}'`;
  }

  const sql = `
SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (
  SELECT
    r.id,
    r.user_id,
    r.email,
    r.status,
    r.push_token,
    r.notes,
    r.created_at,
    r.reviewed_at,
    p.plan_tier,
    u.last_sign_in_at
  FROM public.beta_pro_requests r
  LEFT JOIN public.profiles p ON r.user_id = p.id
  LEFT JOIN auth.users u ON r.user_id = u.id
  ${whereClause}
  ORDER BY r.created_at DESC
) t;`.trim();

  return queryDatabaseJson(env, sql, sshAlias);
}

function fetchCounts(env, sshAlias) {
  const sql = `
SELECT json_build_object(
  'total', count(*),
  'pending', count(*) FILTER (WHERE status = 'pending'),
  'approved', count(*) FILTER (WHERE status = 'approved'),
  'rejected', count(*) FILTER (WHERE status = 'rejected')
) FROM public.beta_pro_requests;`.trim();

  try {
    const result = queryDatabaseJson(env, sql, sshAlias);
    if (result && typeof result === "object" && !Array.isArray(result)) {
      return {
        total: Number(result.total ?? 0),
        pending: Number(result.pending ?? 0),
        approved: Number(result.approved ?? 0),
        rejected: Number(result.rejected ?? 0),
      };
    }
    return { total: 0, pending: 0, approved: 0, rejected: 0 };
  } catch {
    return { total: 0, pending: 0, approved: 0, rejected: 0 };
  }
}

async function sendExpoPushNotification(pushToken, title, body) {
  if (!pushToken || !pushToken.startsWith("ExponentPushToken[")) {
    console.log(
      `Note: User has no valid Expo push token (${pushToken ?? "none"}). Push dispatch skipped.`,
    );
    return false;
  }

  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: pushToken,
        sound: "default",
        title,
        body,
        data: { screen: "/settings", feature: "beta_pro" },
      }),
    });
    const result = await res.json();
    if (result?.data?.[0]?.status === "error") {
      console.warn(
        `⚠️ Expo push service rejected notification: ${result.data[0].message || "unknown error"}`,
      );
      return false;
    }
    console.log(
      `✓ Push notification dispatched via Expo:`,
      JSON.stringify(result),
    );
    return true;
  } catch (err) {
    console.warn(
      `⚠️ Failed to dispatch Expo push notification: ${err.message}`,
    );
    return false;
  }
}

function loadApplePushCredentials() {
  let teamId = process.env.APPLE_TEAM_ID || "LQJNDVBL43";
  let keyId =
    process.env.APPLE_PUSH_KEY_ID ||
    process.env.APPLE_KEY_ID_PUSH_NOTIFICATIONS ||
    "HJX42YKP78";
  let privateKey = process.env.APPLE_PRIVATE_KEY_PUSH_NOTIFICATIONS || "";

  if (!privateKey) {
    try {
      const envPath = path.resolve(process.cwd(), ".env");
      if (existsSync(envPath)) {
        const content = readFileSync(envPath, "utf8");
        const keyMatch = content.match(
          /APPLE_PRIVATE_KEY_PUSH_NOTIFICATIONS=([^\n\r]+)/,
        );
        if (keyMatch) privateKey = keyMatch[1].trim();
        const keyIdMatch = content.match(/APPLE_PUSH_KEY_ID=([^\n\r]+)/);
        if (keyIdMatch) keyId = keyIdMatch[1].trim();
        const teamMatch = content.match(/APPLE_TEAM_ID=([^\n\r]+)/);
        if (teamMatch) teamId = teamMatch[1].trim();
      }
    } catch {}
  }

  return { teamId, keyId, privateKey };
}

function sendApnsDirectPushNotification(deviceToken, title, body, env) {
  const { teamId, keyId, privateKey } = loadApplePushCredentials();
  if (!privateKey) {
    console.warn(
      "⚠️ No APPLE_PRIVATE_KEY_PUSH_NOTIFICATIONS found. Direct APNs skipped.",
    );
    return Promise.resolve(false);
  }

  const raw = privateKey
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .trim();
  const pem = `-----BEGIN PRIVATE KEY-----\n${raw}\n-----END PRIVATE KEY-----`;

  let jwt;
  try {
    const header = Buffer.from(
      JSON.stringify({ alg: "ES256", kid: keyId }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }),
    ).toString("base64url");
    const data = `${header}.${payload}`;
    const sig = crypto.sign("sha256", Buffer.from(data), {
      key: pem,
      dsaEncoding: "ieee-p1363",
    });
    jwt = `${data}.${sig.toString("base64url")}`;
  } catch (err) {
    console.warn(`⚠️ Failed to generate APNs JWT: ${err.message}`);
    return Promise.resolve(false);
  }

  const isDev = env === "dev";
  const host = isDev ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const topic = isDev ? "com.mizyun.development" : "com.mizyun.app";

  return new Promise((resolve) => {
    const client = http2.connect(`https://${host}:443`);
    let finished = false;

    client.on("error", (err) => {
      if (!finished) {
        finished = true;
        console.warn(`⚠️ APNs connection error to ${host}: ${err.message}`);
        resolve(false);
      }
    });

    const cleanToken = deviceToken.replace(/[^0-9a-fA-F]/g, "");
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${cleanToken}`,
      authorization: `bearer ${jwt}`,
      "apns-topic": topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
    });

    let status = 0;
    let respBody = "";
    req.on("response", (headers) => {
      status = Number(headers[":status"] || 0);
    });
    req.on("data", (chunk) => {
      respBody += chunk;
    });
    req.on("end", () => {
      client.close();
      if (!finished) {
        finished = true;
        if (status === 200) {
          console.log(
            `✓ Push notification delivered directly to Apple APNs (${host}, topic: ${topic})!`,
          );
          resolve(true);
        } else {
          console.warn(
            `⚠️ Apple APNs rejected notification (${status}): ${respBody}`,
          );
          resolve(false);
        }
      }
    });

    req.end(
      JSON.stringify({
        aps: {
          alert: { title, body },
          sound: "default",
        },
        data: { screen: "/settings", feature: "beta_pro" },
      }),
    );
  });
}

async function sendPushNotification(pushToken, title, body, env) {
  if (!pushToken) {
    console.log("Note: User has no push token stored. Push dispatch skipped.");
    return false;
  }
  if (pushToken.startsWith("ExponentPushToken[")) {
    return sendExpoPushNotification(pushToken, title, body);
  }
  return sendApnsDirectPushNotification(pushToken, title, body, env);
}

async function handleUpdateStatus(
  targetIdentifier,
  newStatus,
  targetEnv,
  note,
  sshAlias,
) {
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      targetIdentifier,
    );

  // If env is "both", detect where the request exists
  let envToUse = targetEnv;
  if (envToUse === "both") {
    let devReqs = [];
    let prodReqs = [];

    try {
      devReqs = fetchRequests("dev", "all", sshAlias).filter(
        (r) =>
          (isUuid &&
            (r.id === targetIdentifier || r.user_id === targetIdentifier)) ||
          (!isUuid && r.email.toLowerCase() === targetIdentifier.toLowerCase()),
      );
    } catch (err) {
      console.warn(`[DEV] Check skipped: ${err.message}`);
    }

    try {
      prodReqs = fetchRequests("production", "all", sshAlias).filter(
        (r) =>
          (isUuid &&
            (r.id === targetIdentifier || r.user_id === targetIdentifier)) ||
          (!isUuid && r.email.toLowerCase() === targetIdentifier.toLowerCase()),
      );
    } catch (err) {
      console.warn(`[PRODUCTION] Check skipped: ${err.message}`);
    }

    if (devReqs.length > 0 && prodReqs.length === 0) {
      envToUse = "dev";
    } else if (prodReqs.length > 0 && devReqs.length === 0) {
      envToUse = "production";
    } else if (devReqs.length > 0 && prodReqs.length > 0) {
      console.error(
        `Error: Found matching request in BOTH Dev and Production. Please specify --env dev or --env production explicitly.`,
      );
      process.exit(1);
    } else {
      console.error(
        `Error: No request found for "${targetIdentifier}" in accessible environments.`,
      );
      process.exit(1);
    }
  }

  const safeTarget = targetIdentifier.replace(/'/g, "''");
  const filterCondition = isUuid
    ? `(id = '${safeTarget}' OR user_id = '${safeTarget}')`
    : `lower(email) = lower('${safeTarget}')`;

  const safeNote = note ? note.replace(/'/g, "''") : null;
  const noteAssignment = safeNote ? `, notes = '${safeNote}'` : "";

  const updateSql = `
WITH updated AS (
  UPDATE public.beta_pro_requests
  SET status = '${newStatus}', reviewed_at = timezone('utc', now())${noteAssignment}
  WHERE ${filterCondition}
  RETURNING id, user_id, email, status, push_token, notes, reviewed_at
)
SELECT coalesce(json_agg(row_to_json(updated)), '[]'::json) FROM updated;
`.trim();

  let updatedRows;
  try {
    updatedRows = queryDatabaseJson(envToUse, updateSql, sshAlias);
  } catch (err) {
    console.error(`Database update failed: ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
    console.error(
      `Error: No request updated for "${targetIdentifier}" in ${envToUse.toUpperCase()}.`,
    );
    process.exit(1);
  }

  const row = updatedRows[0];
  console.log(`\n========================================================`);
  console.log(`✓ Successfully updated request in [${envToUse.toUpperCase()}]`);
  console.log(`========================================================`);
  console.log(`Email:       ${row.email}`);
  console.log(`User ID:     ${row.user_id}`);
  console.log(`Request ID:  ${row.id}`);
  console.log(`New Status:  ${row.status.toUpperCase()}`);
  console.log(`Reviewed At: ${row.reviewed_at}`);
  if (row.notes) console.log(`Notes:       ${row.notes}`);

  // Check updated profile plan_tier triggered by trigger trg_beta_pro_approval
  const profileSql = `SELECT plan_tier FROM public.profiles WHERE id = '${row.user_id}';`;
  try {
    const planTier = queryDatabasePsql(envToUse, profileSql, sshAlias);
    console.log(
      `Profile Tier: "${planTier || "unknown"}" (updated by trigger trg_beta_pro_approval)`,
    );
  } catch (err) {
    console.warn(`Could not verify profile tier: ${err.message}`);
  }

  // Dispatch push notification if approved
  if (newStatus === "approved") {
    if (row.push_token) {
      console.log(`\nDispatching push notification...`);
      await sendPushNotification(
        row.push_token,
        "✨ Launch Pro Pass Activated!",
        "Your Launch Pro Pass request was approved. View your AI usage limits in Account.",
        envToUse,
      );
    } else {
      console.log(
        `\nUser has no push token stored. Push notification skipped.`,
      );
    }
  }

  console.log("========================================================\n");
}

function formatDate(isoString) {
  if (!isoString) return "N/A";
  const date = new Date(isoString);
  const utcStr = date
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
  const localStr = date.toLocaleString();
  return `${utcStr}  (Local: ${localStr})`;
}

function formatRelativeTime(isoString) {
  if (!isoString) return "";
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

const STATUS_ICONS = {
  pending: "⏳ [PENDING]",
  approved: "✅ [APPROVED]",
  rejected: "❌ [REJECTED]",
};

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`\nError: ${err.message}\n`);
    printUsage();
    process.exit(1);
  }

  if (options.help) {
    printUsage();
    process.exit(0);
  }

  // Handle Approve
  if (options.approveTarget) {
    await handleUpdateStatus(
      options.approveTarget,
      "approved",
      options.env,
      options.note,
      options.sshAlias,
    );
    process.exit(0);
  }

  // Handle Reject
  if (options.rejectTarget) {
    await handleUpdateStatus(
      options.rejectTarget,
      "rejected",
      options.env,
      options.note,
      options.sshAlias,
    );
    process.exit(0);
  }

  const envsToQuery =
    options.env === "both" ? ["dev", "production"] : [options.env];

  const results = {};
  const counts = {};
  const errors = {};

  for (const env of envsToQuery) {
    try {
      results[env] = fetchRequests(env, options.status, options.sshAlias);
      counts[env] = fetchCounts(env, options.sshAlias);
    } catch (err) {
      errors[env] = err.message;
      results[env] = [];
      counts[env] = { total: 0, pending: 0, approved: 0, rejected: 0 };
    }
  }

  // If every requested environment failed, fail closed with exit code 1
  const failedEnvs = envsToQuery.filter((e) => errors[e]);
  if (failedEnvs.length === envsToQuery.length) {
    if (options.json) {
      console.error(JSON.stringify({ errors }, null, 2));
    } else {
      console.error(
        "\n❌ Failed to query database on all targeted environments:",
      );
      for (const env of failedEnvs) {
        console.error(`  [${env.toUpperCase()}]: ${errors[env]}`);
      }
      console.error(
        `\nTip: Verify Tailscale connectivity and SSH access: ssh ${options.sshAlias} echo OK\n`,
      );
    }
    process.exit(1);
  }

  if (options.json) {
    const output = {
      query: {
        environment: options.env,
        statusFilter: options.status,
      },
      counts,
      errors: Object.keys(errors).length > 0 ? errors : null,
      requests: results,
    };
    console.log(JSON.stringify(output, null, 2));
    process.exit(0);
  }

  // Print Human-Readable Summary
  console.log("\n========================================================");
  console.log(` Mizyun Launch Pro Pass Requests`);
  console.log("========================================================");
  for (const env of envsToQuery) {
    const label = env.toUpperCase().padEnd(10);
    if (errors[env]) {
      console.log(`[${label}] ERROR: ${errors[env]}`);
    } else {
      const c = counts[env];
      const pendingStr = `${c.pending} pending`.padEnd(12);
      console.log(
        `[${label}] ${pendingStr} (${c.approved} approved, ${c.rejected} rejected, ${c.total} total)`,
      );
    }
  }
  console.log("========================================================\n");

  let totalPendingShown = 0;

  for (const env of envsToQuery) {
    const reqs = results[env] || [];
    const envLabel = env.toUpperCase();

    if (errors[env]) {
      console.log(`❌ [${envLabel}] Query Failed:`);
      console.log(`   ${errors[env]}\n`);
      continue;
    }

    const pendingInEnv = reqs.filter((r) => r.status === "pending").length;
    totalPendingShown += pendingInEnv;

    if (reqs.length === 0) {
      if (options.status === "pending") {
        console.log(`🎉 No pending requests in ${envLabel}.\n`);
      } else {
        console.log(
          `No requests matching status "${options.status}" in ${envLabel}.\n`,
        );
      }
      continue;
    }

    console.log(`--------------------------------------------------------`);
    console.log(
      ` [${envLabel}] ${reqs.length} request(s) matching "${options.status}":`,
    );
    console.log(`--------------------------------------------------------`);

    for (let i = 0; i < reqs.length; i++) {
      const r = reqs[i];
      const icon = STATUS_ICONS[r.status] || `[${r.status.toUpperCase()}]`;
      const relTime = formatRelativeTime(r.created_at);

      console.log(`\n#${i + 1} ${icon}`);
      console.log(`  User Email:   ${r.email}`);
      console.log(`  User ID:      ${r.user_id}`);
      console.log(`  Request ID:   ${r.id}`);
      console.log(`  Plan Tier:    ${r.plan_tier ?? "free"}`);
      console.log(
        `  Push Token:   ${
          r.push_token
            ? `Present (${r.push_token.slice(0, 24)}...)`
            : "None (Push notification won't be sent)"
        }`,
      );
      console.log(`  Submitted:    ${formatDate(r.created_at)} (${relTime})`);
      if (r.reviewed_at) {
        console.log(`  Reviewed At:  ${formatDate(r.reviewed_at)}`);
      }
      if (r.last_sign_in_at) {
        console.log(`  Last Sign In: ${formatDate(r.last_sign_in_at)}`);
      }
      if (r.notes) {
        console.log(`  Notes:        "${r.notes}"`);
      }
    }
    console.log();
  }

  // Helpful next steps footer
  if (totalPendingShown > 0) {
    console.log("--------------------------------------------------------");
    console.log("💡 ACTIONS:");
    console.log("  To approve a pending request:");
    console.log(
      "    node scripts/check-beta-pro-requests.mjs --approve <email-or-id> [--env dev|prod]",
    );
    console.log("  To reject a pending request:");
    console.log(
      "    node scripts/check-beta-pro-requests.mjs --reject <email-or-id> [--env dev|prod]",
    );
    console.log("--------------------------------------------------------\n");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
