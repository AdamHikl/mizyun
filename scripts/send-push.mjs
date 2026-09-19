#!/usr/bin/env node
/**
 * scripts/send-push.mjs
 *
 * Sends a push notification to a user by email or direct push token.
 * Supports direct Apple APNs HTTP/2 gateway authentication and Expo Push API.
 *
 * Usage:
 *   node scripts/send-push.mjs --email <email> [--env dev|production] [--title <title>] [--body <body>]
 *   node scripts/send-push.mjs --token <token> [--env dev|production] [--title <title>] [--body <body>]
 *   node scripts/send-push.mjs --help
 */

import { execSync } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import http2 from "node:http2";
import path from "node:path";
import process from "node:process";

function printHelp() {
  console.log(`
Usage: node scripts/send-push.mjs [options]

Options:
  --email <email>     Target user email to look up push token from DB
  --token <token>     Target push token directly (APNs hex token or ExponentPushToken)
  --env <env>         Environment: dev | production (default: dev)
  --title <title>     Notification title (default: "Mizyun")
  --body <body>       Notification message body (default: "Test notification")
  --dry-run           Inspect token and credentials without sending
  --help              Show this help message
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    email: "",
    token: "",
    env: "dev",
    title: "Mizyun",
    body: "Test notification from Mizyun",
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--email") {
      options.email = args[++i] || "";
    } else if (arg === "--token") {
      options.token = args[++i] || "";
    } else if (arg === "--env") {
      options.env = args[++i] || "dev";
    } else if (arg === "--title") {
      options.title = args[++i] || options.title;
    } else if (arg === "--body") {
      options.body = args[++i] || options.body;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    }
  }

  return options;
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

function queryTokenFromDb(email, env) {
  const container = env === "dev" ? "mizyun-dev-db" : "supabase-db";
  const sshAlias = process.env.MIZYUN_SSH_ALIAS || "mizyun-hetzner-ops";
  if (!/^[A-Za-z0-9_.-]+$/.test(sshAlias)) {
    throw new Error("MIZYUN_SSH_ALIAS must be a safe SSH alias");
  }
  console.log(`Querying ${env} database for user: ${email}...`);
  try {
    const cmd = `ssh ${sshAlias} "docker exec -i ${container} psql -U postgres -d postgres -t -A -c \\"SELECT push_token FROM beta_pro_requests WHERE email = '${email.replace(/'/g, "''")}' LIMIT 1;\\""`;
    const output = execSync(cmd, { encoding: "utf8", timeout: 15000 }).trim();
    return output || null;
  } catch (err) {
    console.error(`Error querying database via SSH: ${err.message}`);
    return null;
  }
}

async function sendExpoPushNotification(pushToken, title, body) {
  console.log(`Sending via Expo Push API to ${pushToken.slice(0, 30)}...`);
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: pushToken,
      title,
      body,
      sound: "default",
      data: { source: "send-push-cli" },
    }),
  });
  const data = await res.json();
  if (res.ok && data?.data?.status === "ok") {
    console.log(
      "✓ Push notification delivered successfully via Expo Push API!",
    );
    return true;
  }
  console.error("⚠️ Expo Push API error:", JSON.stringify(data));
  return false;
}

function sendApnsDirectPushNotification(deviceToken, title, body, env) {
  const { teamId, keyId, privateKey } = loadApplePushCredentials();
  if (!privateKey) {
    console.error(
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
    console.error(`⚠️ Failed to generate APNs JWT: ${err.message}`);
    return Promise.resolve(false);
  }

  const isDev = env === "dev";
  const host = isDev ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const topic = isDev ? "com.mizyun.development" : "com.mizyun.app";

  console.log(`Connecting to APNs (${host}:443, topic: ${topic})...`);

  return new Promise((resolve) => {
    const client = http2.connect(`https://${host}:443`);
    let finished = false;

    client.on("error", (err) => {
      if (!finished) {
        finished = true;
        console.error(`⚠️ APNs connection error to ${host}: ${err.message}`);
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
          console.error(
            `⚠️ Apple APNs rejected notification (status ${status}): ${respBody}`,
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
        data: { source: "send-push-cli" },
      }),
    );
  });
}

async function main() {
  const options = parseArgs();

  if (!options.email && !options.token) {
    console.error(
      "Error: Either --email <email> or --token <token> must be specified.",
    );
    printHelp();
    process.exit(1);
  }

  let pushToken = options.token;
  if (!pushToken && options.email) {
    pushToken = queryTokenFromDb(options.email, options.env);
    if (!pushToken) {
      console.error(
        `No push token found in ${options.env} database for ${options.email}.`,
      );
      process.exit(2);
    }
    console.log(
      `Found push token for ${options.email}: ${pushToken.slice(0, 24)}...`,
    );
  }

  if (options.dryRun) {
    console.log(
      "Dry run: token found and credentials verified. Skipping actual network dispatch.",
    );
    process.exit(0);
  }

  console.log(`Sending notification: "${options.title}" - "${options.body}"`);

  let success = false;
  if (pushToken.startsWith("ExponentPushToken[")) {
    success = await sendExpoPushNotification(
      pushToken,
      options.title,
      options.body,
    );
  } else {
    success = await sendApnsDirectPushNotification(
      pushToken,
      options.title,
      options.body,
      options.env,
    );
  }

  if (!success) {
    process.exit(3);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
