import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import {
  createSupabaseRepositoryClient,
  createSupabaseServiceRoleClient,
  createSupabaseStorageClient,
  SupabaseMediaStorage,
  type RepositorySupabaseClient,
} from "@mizyun/adapter-supabase-server";
import { InMemoryMemoryStore } from "@mizyun/memory";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

const SUPABASE_URL = process.env.SUPABASE_E2E_URL ?? "";
const PUBLISHABLE_KEY = process.env.SUPABASE_E2E_PUBLISHABLE ?? "";
const SERVICE_KEY = process.env.SUPABASE_E2E_SERVICE ?? "";

const stackUp =
  SUPABASE_URL.length > 0 &&
  PUBLISHABLE_KEY.length > 0 &&
  SERVICE_KEY.length > 0;

const reachable = await (async (): Promise<boolean> => {
  if (!stackUp) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return res.ok;
  } catch {
    return false;
  }
})();

const runE2E = stackUp && reachable;
const describeIfE2E = runE2E ? describe : describe.skip;

const adminClient: SupabaseClient | null = runE2E
  ? createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

interface TestUser {
  id: string;
  email: string;
  password: string;
  accessToken: string;
}

describeIfE2E("Q4 Account Deletion two-user lifecycle (e2e)", () => {
  const timestamp = Date.now();
  const userA: TestUser = {
    id: "",
    email: `del-user-a-${timestamp}@mizyun.test`,
    password: "Password-A123!",
    accessToken: "",
  };
  const userB: TestUser = {
    id: "",
    email: `del-user-b-${timestamp}@mizyun.test`,
    password: "Password-B123!",
    accessToken: "",
  };

  let serviceClient: RepositorySupabaseClient;
  let mediaStorage: SupabaseMediaStorage;
  let app: ReturnType<typeof buildApp>;

  const clientFor = (accessToken: string): RepositorySupabaseClient =>
    createSupabaseRepositoryClient(
      { url: SUPABASE_URL, publishableKey: PUBLISHABLE_KEY },
      accessToken,
    );

  beforeAll(async () => {
    if (!adminClient) return;

    serviceClient = createSupabaseServiceRoleClient({
      url: SUPABASE_URL,
      publishableKey: PUBLISHABLE_KEY,
      serviceRoleKey: SERVICE_KEY,
    });

    mediaStorage = new SupabaseMediaStorage({
      clientFor: (token) =>
        createSupabaseStorageClient(
          { url: SUPABASE_URL, publishableKey: PUBLISHABLE_KEY },
          token,
        ),
    });

    // 1. Create User A
    const { data: createdA, error: errA } =
      await adminClient.auth.admin.createUser({
        email: userA.email,
        password: userA.password,
        email_confirm: true,
      });
    if (errA || !createdA.user) {
      throw new Error(`Failed to create User A: ${errA?.message}`);
    }
    userA.id = createdA.user.id;

    // 2. Create User B
    const { data: createdB, error: errB } =
      await adminClient.auth.admin.createUser({
        email: userB.email,
        password: userB.password,
        email_confirm: true,
      });
    if (errB || !createdB.user) {
      throw new Error(`Failed to create User B: ${errB?.message}`);
    }
    userB.id = createdB.user.id;

    // 3. Obtain access tokens
    const { data: signinA, error: signinErrA } =
      await adminClient.auth.signInWithPassword({
        email: userA.email,
        password: userA.password,
      });
    if (signinErrA || !signinA.session) {
      throw new Error(`User A signin failed: ${signinErrA?.message}`);
    }
    userA.accessToken = signinA.session.access_token;

    const { data: signinB, error: signinErrB } =
      await adminClient.auth.signInWithPassword({
        email: userB.email,
        password: userB.password,
      });
    if (signinErrB || !signinB.session) {
      throw new Error(`User B signin failed: ${signinErrB?.message}`);
    }
    userB.accessToken = signinB.session.access_token;

    // 4. Build API app wired with real Supabase persistence & service role
    app = buildApp({
      supabasePersistence: {
        clientFor,
        storageClientFor: (token) =>
          createSupabaseStorageClient(
            { url: SUPABASE_URL, publishableKey: PUBLISHABLE_KEY },
            token,
          ),
        serviceRoleClient: serviceClient,
      },
      tokenVerifier: {
        verify: async (token) => {
          const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: {
              apikey: PUBLISHABLE_KEY,
              authorization: `Bearer ${token}`,
            },
          });
          if (!response.ok) return null;
          const user = (await response.json()) as {
            id: string;
            email?: string;
            role?: string;
          };
          return {
            userId: user.id as never,
            ...(user.email !== undefined ? { email: user.email } : {}),
            ...(user.role !== undefined ? { role: user.role } : {}),
            accessToken: token,
          };
        },
      },
      agent: new AgentOrchestrator({
        provider: new DisabledAgentProvider(),
        memories: new InMemoryMemoryStore(),
      }),
    });
  });

  afterAll(async () => {
    if (adminClient && userB.id) {
      await adminClient.auth.admin.deleteUser(userB.id).catch(() => {});
    }
    if (adminClient && userA.id) {
      await adminClient.auth.admin.deleteUser(userA.id).catch(() => {});
    }
  });

  it("seeds records and private storage objects for both users", async () => {
    if (!adminClient) return;

    // Seed User A & B in all durable tables using their authenticated clients
    for (const user of [userA, userB]) {
      const userClient = clientFor(user.accessToken);

      // 1. Profile (upserted via adminClient due to server-owned tier authority grants)
      const { error: profErr } = await adminClient.from("profiles").upsert({
        id: user.id,
        display_name: `User ${user.id.slice(0, 4)}`,
        birth_year: 1992,
        unit_system: "metric",
        timezone: "UTC",
      });
      expect(profErr).toBeNull();

      // 2. Goal
      const { error: goalErr } = await userClient.from("goals").insert({
        user_id: user.id,
        kind: "cut",
        status: "active",
        pace: "steady",
        target: { weightKg: 75.0 },
        starts_on: "2026-09-01",
        target_date: "2026-12-01",
      });
      expect(goalErr).toBeNull();

      // 3. Food Entry
      const { error: foodErr } = await userClient.from("food_entries").insert({
        user_id: user.id,
        name: "Morning Oatmeal",
        consumed_at: new Date().toISOString(),
        calories_kcal: 350,
        protein_g: 12,
        carbohydrate_g: 55,
        fat_g: 6,
        source: "manual",
        confirmed_by_user: true,
      });
      expect(foodErr).toBeNull();

      // 4. Exercise
      const { data: exData, error: exErr } = await userClient
        .from("exercises")
        .insert({
          user_id: user.id,
          name: "Barbell Bench Press",
          instructions: "Keep back flat",
          metadata: {},
        })
        .select()
        .single();
      expect(exErr).toBeNull();
      const exerciseId = (exData as { id: string })?.id;

      // 5. Workout & Workout Set
      const { data: woData, error: woErr } = await userClient
        .from("workouts")
        .insert({
          user_id: user.id,
          name: "Upper Body Day",
          started_at: new Date().toISOString(),
          source: "manual",
        })
        .select()
        .single();
      expect(woErr).toBeNull();
      const workoutId = (woData as { id: string })?.id;

      if (exerciseId && workoutId) {
        const { error: setErr } = await userClient.from("workout_sets").insert({
          user_id: user.id,
          workout_id: workoutId,
          exercise_id: exerciseId,
          sequence: 1,
          repetitions: 10,
          load_kg: 80,
          completed_at: new Date().toISOString(),
        });
        expect(setErr).toBeNull();
      }

      // 6. Body measurement
      const { error: bmErr } = await userClient
        .from("body_measurements")
        .insert({
          user_id: user.id,
          measured_at: new Date().toISOString(),
          weight_kg: 78.5,
          measurements: {},
          source: "manual",
        });
      expect(bmErr).toBeNull();

      // 7. Conversation & Message
      const { data: convData, error: convErr } = await userClient
        .from("conversations")
        .insert({
          user_id: user.id,
          title: "Weekly Check-in",
          status: "active",
          provider_metadata: {},
        })
        .select()
        .single();
      expect(convErr).toBeNull();
      const convId = (convData as { id: string })?.id;

      if (convId) {
        const { error: msgErr } = await userClient.from("messages").insert({
          user_id: user.id,
          conversation_id: convId,
          role: "user",
          content: { text: "How am I progressing towards my goals?" },
          status: "complete",
        });
        expect(msgErr).toBeNull();
      }

      // 8. Feedback
      const { error: fbErr } = await userClient.from("user_feedback").insert({
        user_id: user.id,
        category: "general",
        rating: 5,
        message: "Great app!",
        context: {},
      });
      expect(fbErr).toBeNull();

      // 9. Storage file in private-media bucket & media_assets record
      const storagePath = `${user.id}/synthetic-photo-${timestamp}.jpg`;
      const fileBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

      const uploadUrl = await mediaStorage.signUploadUrl(
        "private-media",
        storagePath,
        {
          ttlSeconds: 300,
          now: new Date(),
          accessToken: user.accessToken,
        },
      );
      const uploadRes = await fetch(uploadUrl.url, {
        method: "PUT",
        headers: {
          "content-type": "image/jpeg",
          "cache-control": "max-age=0",
          "x-upsert": "false",
        },
        body: fileBytes,
      });
      const uploadText = await uploadRes.text();
      console.log(
        `${user.id} upload status:`,
        uploadRes.status,
        "body:",
        uploadText,
      );
      expect(uploadRes.status).toBeLessThan(300);

      const { error: mediaErr } = await userClient.from("media_assets").insert({
        user_id: user.id,
        bucket_id: "private-media",
        object_path: storagePath,
        purpose: "progress",
        mime_type: "image/jpeg",
        byte_size: fileBytes.length,
        metadata: {},
      });
      expect(mediaErr).toBeNull();
    }

    // Verify pre-deletion counts for both users
    for (const [name, user] of [
      ["User A", userA],
      ["User B", userB],
    ] as const) {
      const userClient = clientFor(user.accessToken);

      const { data: profiles, error: pErr } = await userClient
        .from("profiles")
        .select("id")
        .eq("id", user.id);
      expect(pErr).toBeNull();
      expect(profiles?.length, `${name} profile count`).toBe(1);

      const { data: goals, error: gErr } = await userClient
        .from("goals")
        .select("id")
        .eq("user_id", user.id);
      expect(gErr).toBeNull();
      expect(goals?.length, `${name} goal count`).toBe(1);

      const { data: foods, error: fErr } = await userClient
        .from("food_entries")
        .select("id")
        .eq("user_id", user.id);
      expect(fErr).toBeNull();
      expect(foods?.length, `${name} food count`).toBe(1);

      const { data: media, error: mErr } = await userClient
        .from("media_assets")
        .select("id")
        .eq("user_id", user.id);
      expect(mErr).toBeNull();
      expect(media?.length, `${name} media asset count`).toBe(1);

      const rootList = await adminClient.storage.from("private-media").list();
      console.log("rootList:", rootList.data);

      const storageList = await adminClient.storage
        .from("private-media")
        .list(user.id);
      console.log(`storageList for ${user.id}:`, storageList.data);

      expect(
        storageList.data?.length,
        `${name} storage files`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("deletes User A through the exact API flow while preserving User B completely", async () => {
    if (!adminClient) return;

    // 1. User A requests deletion challenge
    const requestRes = await app.inject({
      method: "POST",
      url: "/v1/account/delete/request",
      headers: {
        authorization: `Bearer ${userA.accessToken}`,
      },
    });
    expect(requestRes.statusCode).toBe(200);
    const challengeBody = requestRes.json() as {
      confirmationToken: string;
      expiresAt: string;
    };
    expect(typeof challengeBody.confirmationToken).toBe("string");
    expect(challengeBody.confirmationToken.length).toBeGreaterThan(10);

    // Verify job was created in database with challenge_issued status
    const { data: jobRow } = await serviceClient
      .from("account_deletion_jobs")
      .select("*")
      .eq("user_id", userA.id)
      .single();
    expect((jobRow as { status: string })?.status).toBe("challenge_issued");

    // 2. User A confirms deletion with the token
    const confirmRes = await app.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: {
        authorization: `Bearer ${userA.accessToken}`,
      },
      payload: {
        confirmationToken: challengeBody.confirmationToken,
      },
    });
    expect(confirmRes.statusCode).toBe(200);
    expect(confirmRes.json()).toEqual({ deleted: true });

    // 3. Verify User A post-deletion assertions
    // A) Auth user deleted
    const { error: getUserErr } = await adminClient.auth.admin.getUserById(
      userA.id,
    );
    expect(getUserErr).not.toBeNull();

    // B) Job tombstone completed
    const { data: completedJob } = await serviceClient
      .from("account_deletion_jobs")
      .select("*")
      .eq("user_id", userA.id)
      .single();
    expect((completedJob as { status: string })?.status).toBe("completed");
    expect(
      (completedJob as { completed_at: string | null })?.completed_at,
    ).not.toBeNull();

    // C) Active database records for User A strictly 0 across all tables
    // Checking via serviceClient for profiles (which has service_role grant)
    const { data: profA } = await serviceClient
      .from("profiles")
      .select("id")
      .eq("id", userA.id);
    expect(profA?.length, "User A profiles count").toBe(0);

    // D) Storage files for User A erased
    const storageListA = await adminClient.storage
      .from("private-media")
      .list(userA.id);
    expect(storageListA.data?.length ?? 0).toBe(0);

    // E) Token revocation: requests with userA token fail with 401
    const postDeletionRes = await app.inject({
      method: "GET",
      url: "/v1/profile",
      headers: {
        authorization: `Bearer ${userA.accessToken}`,
      },
    });
    expect(postDeletionRes.statusCode).toBe(401);

    // 4. Verify User B post-deletion assertions (ISOLATION)
    // A) User B Auth user is healthy
    const { data: userBAuth, error: userBErr } =
      await adminClient.auth.admin.getUserById(userB.id);
    expect(userBErr).toBeNull();
    expect(userBAuth.user?.id).toBe(userB.id);

    // B) User B records in all tables are completely untouched
    const clientB = clientFor(userB.accessToken);

    const { data: profB, error: profErrB } = await clientB
      .from("profiles")
      .select("id")
      .eq("id", userB.id);
    expect(profErrB).toBeNull();
    expect(profB?.length, "User B profiles count").toBe(1);

    const tables = [
      "goals",
      "food_entries",
      "exercises",
      "workouts",
      "body_measurements",
      "conversations",
      "media_assets",
      "user_feedback",
    ];
    for (const table of tables) {
      const { data, error } = await clientB
        .from(table)
        .select("id")
        .eq("user_id", userB.id);
      expect(error).toBeNull();
      expect(data?.length, `User B ${table} count`).toBe(1);
    }

    // C) User B storage files remain intact
    const storageListB = await adminClient.storage
      .from("private-media")
      .list(userB.id);
    expect(storageListB.data?.length).toBeGreaterThanOrEqual(1);

    // D) User B can still make authenticated API calls successfully
    const userBProfileRes = await app.inject({
      method: "GET",
      url: "/v1/profile",
      headers: {
        authorization: `Bearer ${userB.accessToken}`,
      },
    });
    expect(userBProfileRes.statusCode).toBe(200);
    const userBProfile = userBProfileRes.json() as {
      profile: { displayName: string };
    };
    expect(userBProfile.profile.displayName).toBe(
      `User ${userB.id.slice(0, 4)}`,
    );
  });
});
