#!/usr/bin/env node

// Manage Launch Pro Pass Requests & Approvals.
// Connects directly to Supabase via Service Role Key.
// On approval, it sets status = 'approved' (which fires the DB trigger to upgrade profiles.plan_tier = 'paid'),
// and dispatches a push notification via Expo Push Notification API if a push_token is stored.

import { exit } from "node:process";

const supabaseUrl = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.MIZYUN_SERVICE_ROLE_KEY ||
  "";

function usage() {
  console.log(`
Usage:
  node scripts/manage-beta-pro.mjs --list
  node scripts/manage-beta-pro.mjs --approve <email-or-user-id>
  node scripts/manage-beta-pro.mjs --reject <email-or-user-id>

Options:
  SUPABASE_URL             Supabase URL (default: http://127.0.0.1:54321)
  SUPABASE_SERVICE_ROLE_KEY Supabase service role secret key
`);
  exit(1);
}

if (!serviceRoleKey) {
  console.error(
    "Error: SUPABASE_SERVICE_ROLE_KEY environment variable must be set.",
  );
  exit(1);
}

const args = process.argv.slice(2);
const command = args[0];
const target = args[1];

async function supabaseFetch(path, options = {}) {
  const url = `${supabaseUrl}/rest/v1${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Supabase request failed (${res.status}): ${errorText}`);
  }
  return res.json();
}

async function sendExpoPushNotification(pushToken, title, body) {
  if (!pushToken || !pushToken.startsWith("ExponentPushToken[")) {
    console.log(
      `Note: No valid Expo push token found (${pushToken ?? "none"}). Skipping push dispatch.`,
    );
    return;
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
    console.log(
      "Push notification dispatched via Expo:",
      JSON.stringify(result),
    );
  } catch (err) {
    console.warn("Failed to dispatch Expo push notification:", err.message);
  }
}

async function listRequests() {
  const requests = await supabaseFetch(
    "/beta_pro_requests?select=*&order=created_at.desc",
  );
  if (requests.length === 0) {
    console.log("No Launch Pro Pass requests found.");
    return;
  }

  console.log(`\nFound ${requests.length} Launch Pro Pass request(s):\n`);
  for (const req of requests) {
    console.log(`- ID:       ${req.id}`);
    console.log(`  User ID:  ${req.user_id}`);
    console.log(`  Email:    ${req.email}`);
    console.log(`  Status:   ${req.status.toUpperCase()}`);
    console.log(`  Created:  ${req.created_at}`);
    console.log(`  Reviewed: ${req.reviewed_at ?? "N/A"}`);
    console.log(
      `  Token:    ${req.push_token ? req.push_token.slice(0, 24) + "..." : "none"}`,
    );
    if (req.notes) console.log(`  Notes:    ${req.notes}`);
    console.log("");
  }
}

async function updateRequestStatus(identifier, status) {
  // Find request by email or user_id
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      identifier,
    );
  const filter = isUuid
    ? `user_id=eq.${identifier}`
    : `email=eq.${encodeURIComponent(identifier)}`;

  const existing = await supabaseFetch(`/beta_pro_requests?${filter}&select=*`);
  if (!existing || existing.length === 0) {
    console.error(`Error: No request found for "${identifier}".`);
    exit(1);
  }

  const req = existing[0];
  const now = new Date().toISOString();

  await supabaseFetch(`/beta_pro_requests?id=eq.${req.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status,
      reviewed_at: now,
    }),
  });

  console.log(
    `Successfully updated request for ${req.email} (${req.user_id}) to '${status}'.`,
  );

  // Verify profile tier trigger
  const profiles = await supabaseFetch(
    `/profiles?id=eq.${req.user_id}&select=id,plan_tier`,
  );
  if (profiles.length > 0) {
    console.log(`User profile plan_tier is now: "${profiles[0].plan_tier}".`);
  }

  if (status === "approved" && req.push_token) {
    console.log("Sending push notification to user...");
    await sendExpoPushNotification(
      req.push_token,
      "✨ Launch Pro Pass Activated!",
      "Your Launch Pro Pass request was approved. View your AI usage limits in Account.",
    );
  }
}

async function main() {
  switch (command) {
    case "--list":
      await listRequests();
      break;
    case "--approve":
      if (!target) {
        console.error("Error: --approve requires an email or user ID.");
        usage();
      }
      await updateRequestStatus(target, "approved");
      break;
    case "--reject":
      if (!target) {
        console.error("Error: --reject requires an email or user ID.");
        usage();
      }
      await updateRequestStatus(target, "rejected");
      break;
    default:
      usage();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  exit(1);
});
