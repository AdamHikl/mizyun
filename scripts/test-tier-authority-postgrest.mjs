#!/usr/bin/env node

// Automated integration test for Tier Authority across PostgREST (REL-AUD-006 / Q6).
// Runs against local or Dev Supabase PostgREST endpoint using real authenticated JWTs.

import { exit } from "node:process";

const supabaseUrl = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const anonKey =
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

let passed = 0;
let failed = 0;

const test = async (name, fn) => {
  try {
    await fn();
    // eslint-disable-next-line no-console
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`✗ ${name}:`, err.message);
    failed++;
  }
};

const assert = (condition, msg) => {
  if (!condition) throw new Error(msg || "Assertion failed");
};

// 1. Create a synthetic test user
const syntheticEmail = `tier-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@mizyun.test`;
const syntheticPassword = "SuperSecurePassword123!";

const signupRes = await fetch(`${supabaseUrl}/auth/v1/signup`, {
  method: "POST",
  headers: {
    apikey: anonKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    email: syntheticEmail,
    password: syntheticPassword,
  }),
});

if (!signupRes.ok) {
  const errText = await signupRes.text();
  throw new Error(`Synthetic signup failed (${signupRes.status}): ${errText}`);
}

const signupData = await signupRes.json();
let userId = signupData.id || signupData.user?.id;
let userToken = signupData.access_token;

// If email confirmation is required, autoconfirm via admin API or sign in
if (!userToken) {
  // Confirm user via admin API using service role
  const adminRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email_confirm: true }),
  });
  if (!adminRes.ok) {
    throw new Error(
      `Failed to confirm synthetic user: ${await adminRes.text()}`,
    );
  }

  // Sign in to get access token
  const signinRes = await fetch(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: syntheticEmail,
        password: syntheticPassword,
      }),
    },
  );
  if (!signinRes.ok) {
    throw new Error(
      `Failed to sign in synthetic user: ${await signinRes.text()}`,
    );
  }
  const signinData = await signinRes.json();
  userToken = signinData.access_token;
  userId = signinData.user.id;
}

const authHeaders = {
  apikey: anonKey,
  Authorization: `Bearer ${userToken}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const serviceHeaders = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

// --- Test Matrix ---

// Test 1: Authenticated user cannot insert profile with plan_tier = paid
await test("PostgREST: Authenticated user cannot insert profile with plan_tier = paid", async () => {
  // Create a second user specifically to test fresh INSERT
  const u2Email = `tier-insert-${Date.now()}@mizyun.test`;
  const u2Pass = "TestPass123!";
  const u2Res = await fetch(`${supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: u2Email, password: u2Pass }),
  });
  const u2Data = await u2Res.json();
  const u2Id = u2Data.id || u2Data.user?.id;

  // Delete the profile row created by auth trigger via service_role
  await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${u2Id}`, {
    method: "DELETE",
    headers: serviceHeaders,
  });

  // Get token for u2
  let u2Token = u2Data.access_token;
  if (!u2Token) {
    await fetch(`${supabaseUrl}/auth/v1/admin/users/${u2Id}`, {
      method: "PUT",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email_confirm: true }),
    });
    const sRes = await fetch(
      `${supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: { apikey: anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email: u2Email, password: u2Pass }),
      },
    );
    const sData = await sRes.json();
    u2Token = sData.access_token;
  }

  const u2AuthHeaders = {
    apikey: anonKey,
    Authorization: `Bearer ${u2Token}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  // Attempt INSERT with plan_tier = 'paid' -> MUST FAIL
  const failInsert = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
    method: "POST",
    headers: u2AuthHeaders,
    body: JSON.stringify({ id: u2Id, plan_tier: "paid" }),
  });
  assert(!failInsert.ok, `expected non-2xx response, got ${failInsert.status}`);
  const failText = await failInsert.text();
  assert(
    failText.includes("permission denied") ||
      failText.includes("Unauthorized") ||
      failText.includes("42501"),
    `expected permission denied or 42501, got: ${failText}`,
  );

  // Attempt INSERT without plan_tier -> MUST SUCCEED with free tier
  const okInsert = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
    method: "POST",
    headers: u2AuthHeaders,
    body: JSON.stringify({ id: u2Id, display_name: "Fresh User" }),
  });
  if (!okInsert.ok) {
    throw new Error(
      `expected 2xx, got ${okInsert.status}: ${await okInsert.text()}`,
    );
  }
  const okData = await okInsert.json();
  assert(okData[0].plan_tier === "free", "plan_tier must default to free");

  // Cleanup u2
  await fetch(`${supabaseUrl}/auth/v1/admin/users/${u2Id}`, {
    method: "DELETE",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
});

// Test 2: Authenticated user cannot update plan_tier to paid
await test("PostgREST: Authenticated user cannot update plan_tier to paid", async () => {
  const res = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH",
    headers: authHeaders,
    body: JSON.stringify({ plan_tier: "paid" }),
  });
  assert(!res.ok, `expected non-2xx response, got ${res.status}`);
  const text = await res.text();
  assert(
    text.includes("permission denied") ||
      text.includes("Unauthorized") ||
      text.includes("42501"),
    `expected permission denied or 42501 error, got: ${text}`,
  );
});

// Test 3: Authenticated user cannot delete own profile row
await test("PostgREST: Authenticated user cannot delete profile", async () => {
  const res = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
    method: "DELETE",
    headers: authHeaders,
  });
  assert(!res.ok, `expected non-2xx response, got ${res.status}`);
  const text = await res.text();
  assert(
    text.includes("permission denied") || text.includes("42501"),
    `expected permission denied error, got: ${text}`,
  );
});

// Test 3: Authenticated user can update ordinary profile fields
await test("PostgREST: Authenticated user can update ordinary fields", async () => {
  const res = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH",
    headers: authHeaders,
    body: JSON.stringify({
      display_name: "Verified Tester",
      timezone: "Europe/London",
    }),
  });
  if (!res.ok) {
    throw new Error(`expected ok, got ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  assert(
    data[0].display_name === "Verified Tester",
    "display_name should update",
  );
  assert(data[0].plan_tier === "free", "plan_tier must remain free");
});

// Test 4: Service-role can promote user to paid tier
await test("PostgREST: Service-role can update plan_tier to paid", async () => {
  const res = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH",
    headers: serviceHeaders,
    body: JSON.stringify({ plan_tier: "paid" }),
  });
  if (!res.ok) {
    throw new Error(`expected ok, got ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  assert(data[0].plan_tier === "paid", "plan_tier should be updated to paid");
});

// Test 5: Paid user preserves paid tier after subsequent ordinary profile edits
await test("PostgREST: Paid user preserves paid tier after ordinary edit", async () => {
  const res = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH",
    headers: authHeaders,
    body: JSON.stringify({ display_name: "Paid User Renamed" }),
  });
  if (!res.ok) {
    throw new Error(`expected ok, got ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  assert(
    data[0].display_name === "Paid User Renamed",
    "display_name should update",
  );
  assert(data[0].plan_tier === "paid", "plan_tier must remain paid");
});

// Test 6: Authenticated user still cannot downgrade/tamper with plan_tier
await test("PostgREST: Paid user cannot tamper with own plan_tier", async () => {
  const res = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH",
    headers: authHeaders,
    body: JSON.stringify({ plan_tier: "free" }),
  });
  assert(!res.ok, `expected non-2xx response, got ${res.status}`);
  const text = await res.text();
  assert(
    text.includes("permission denied") ||
      text.includes("Unauthorized") ||
      text.includes("42501"),
    `expected permission denied error, got: ${text}`,
  );
});

// Test 7: Anonymous request cannot update profile or escalate tier
await test("PostgREST: Anonymous request cannot update profile or escalate tier", async () => {
  const anonHeaders = {
    apikey: anonKey,
    "Content-Type": "application/json",
  };
  const res = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH",
    headers: anonHeaders,
    body: JSON.stringify({ display_name: "Hacked" }),
  });
  assert(
    !res.ok || res.status === 401 || res.status === 403,
    "Anonymous PATCH must fail",
  );
});

// Test 8: Cross-user write rejection (User B cannot modify User A's profile)
await test("PostgREST: Cross-user write is rejected", async () => {
  const victimRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`,
    {
      method: "GET",
      headers: serviceHeaders,
    },
  );
  const victimBefore = (await victimRes.json())[0];

  // User B signup
  const uBEmail = `tier-b-${Date.now()}@mizyun.test`;
  const uBPass = "TestPassB123!";
  const uBRes = await fetch(`${supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: uBEmail, password: uBPass }),
  });
  const uBData = await uBRes.json();
  const uBId = uBData.id || uBData.user?.id;
  let uBToken = uBData.access_token;
  if (!uBToken) {
    await fetch(`${supabaseUrl}/auth/v1/admin/users/${uBId}`, {
      method: "PUT",
      headers: serviceHeaders,
      body: JSON.stringify({ email_confirm: true }),
    });
    const sRes = await fetch(
      `${supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: { apikey: anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email: uBEmail, password: uBPass }),
      },
    );
    uBToken = (await sRes.json()).access_token;
  }

  const uBAuthHeaders = {
    apikey: anonKey,
    Authorization: `Bearer ${uBToken}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  // User B tries to update User A's profile
  const crossRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`,
    {
      method: "PATCH",
      headers: uBAuthHeaders,
      body: JSON.stringify({ display_name: "Compromised by User B" }),
    },
  );
  const crossData = crossRes.ok ? await crossRes.json() : [];
  assert(
    crossData.length === 0,
    "Cross-user update must return 0 modified rows",
  );

  // Verify User A profile is unchanged
  const victimCheck = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`,
    {
      method: "GET",
      headers: serviceHeaders,
    },
  );
  const victimAfter = (await victimCheck.json())[0];
  assert(
    victimAfter.display_name === victimBefore.display_name,
    "User A display_name must remain unchanged",
  );

  // Cleanup User B
  await fetch(`${supabaseUrl}/auth/v1/admin/users/${uBId}`, {
    method: "DELETE",
    headers: serviceHeaders,
  });
});

// Test 9: Authenticated user cannot UPSERT profile with plan_tier = paid
await test("PostgREST: Authenticated user cannot UPSERT profile with plan_tier = paid", async () => {
  const upsertHeaders = {
    ...authHeaders,
    Prefer: "resolution=merge-duplicates,return=representation",
  };
  const res = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
    method: "POST",
    headers: upsertHeaders,
    body: JSON.stringify({ id: userId, plan_tier: "paid" }),
  });
  assert(
    !res.ok,
    `expected non-2xx response on paid upsert, got ${res.status}`,
  );
  const text = await res.text();
  assert(
    text.includes("permission denied") ||
      text.includes("Unauthorized") ||
      text.includes("42501"),
    `expected permission denied or 42501 error, got: ${text}`,
  );
});

// Test 10: Missing/invalid claims token cannot mutate profiles
await test("PostgREST: Missing/invalid claims token cannot mutate profiles", async () => {
  const invalidHeaders = {
    apikey: anonKey,
    Authorization: "Bearer invalid.jwt.token",
    "Content-Type": "application/json",
  };
  const res = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH",
    headers: invalidHeaders,
    body: JSON.stringify({ display_name: "Spoofed" }),
  });
  assert(
    !res.ok,
    `expected non-2xx for invalid claims token, got ${res.status}`,
  );
});

// Cleanup synthetic user
await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
  method: "DELETE",
  headers: {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  },
});

// eslint-disable-next-line no-console
console.log(
  `\nPostgREST tier authority matrix: ${passed} passed, ${failed} failed.`,
);
if (failed > 0) exit(1);
