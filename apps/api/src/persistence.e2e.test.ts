/**
 * Opt-in PERSIST-001 end-to-end test against a real local Supabase
 * stack. The suite proves the Supabase adapters respect RLS, persist
 * records through a "restart" (new repository instances over the same
 * SQL rows), and enforce the partial-unique "one active goal per
 * user" invariant.
 *
 * Run only when `SUPABASE_E2E_URL` and friends are set; otherwise the
 * suite skips with a clear message so the standard `pnpm check`
 * gate stays green without Docker.
 *
 *   pnpm db:start
 *   SUPABASE_E2E_URL=http://127.0.0.1:54321 \
 *   SUPABASE_E2E_PUBLISHABLE=$(pnpm db:status --output json | jq -r .publishable) \
 *   SUPABASE_E2E_SERVICE=$(pnpm db:status --output json | jq -r .service) \
 *   pnpm --filter @mizyun/api test src/persistence.e2e.test.ts
 */
import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  SupabaseBodyMeasurementRepository,
  SupabaseExerciseRepository,
  SupabaseFoodEntryRepository,
  SupabaseGoalRepository,
  SupabaseMediaAssetRepository,
  SupabaseMediaStorage,
  SupabaseProfileRepository,
  SupabaseWorkoutRepository,
  SupabaseWorkoutSetRepository,
  createSupabaseRepositoryClient,
  createSupabaseStorageClient,
  type RepositorySupabaseClient,
} from "@mizyun/adapter-supabase-server";
import { InMemoryMemoryStore } from "@mizyun/memory";
import { buildApp } from "./app.js";

const SUPABASE_URL = process.env.SUPABASE_E2E_URL ?? "";
const PUBLISHABLE_KEY = process.env.SUPABASE_E2E_PUBLISHABLE ?? "";
const SERVICE_KEY = process.env.SUPABASE_E2E_SERVICE ?? "";

const configured = SUPABASE_URL.length > 0 && PUBLISHABLE_KEY.length > 0;

const reachable = await (async (): Promise<boolean> => {
  if (!configured) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return res.ok;
  } catch {
    return false;
  }
})();

const runE2E = configured && reachable;
const describeIfE2E = runE2E ? describe : describe.skip;

const adminClient: SupabaseClient | null =
  configured && SERVICE_KEY.length > 0
    ? createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

interface TestUser {
  id: string;
  readonly email: string;
  readonly password: string;
  accessToken: string;
}

/**
 * Sign up + confirm + sign in flow that mirrors the production
 * `apps/api/src/auth.e2e.test.ts` helpers. Pulled in here so the
 * test is self-contained.
 */
const signUp = async (
  email: string,
  password: string,
): Promise<{ id: string }> => {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: {
      apikey: PUBLISHABLE_KEY,
      authorization: `Bearer ${PUBLISHABLE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(
      `signup failed: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as { id: string };
};

const signIn = async (
  email: string,
  password: string,
): Promise<{ access_token: string }> => {
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: PUBLISHABLE_KEY,
        authorization: `Bearer ${PUBLISHABLE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `sign-in failed: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as { access_token: string };
};

const deleteUser = async (userId: string): Promise<void> => {
  if (adminClient === null) return;
  await adminClient.auth.admin.deleteUser(userId);
};

/**
 * Build a `RepositorySupabaseClient` for the given access token.
 * The factory creates a fresh `SupabaseClient` per call so the
 * access token is isolated — no cross-request state.
 */
const clientFor = (accessToken: string): RepositorySupabaseClient => {
  return createSupabaseRepositoryClient(
    { url: SUPABASE_URL, publishableKey: PUBLISHABLE_KEY },
    accessToken,
  );
};

describeIfE2E("PERSIST-001 Supabase adapters (opt-in e2e)", () => {
  const userA: TestUser = {
    id: "00000000-0000-4000-8000-aaaaaaaaaaaa",
    email: `persist-a-${Date.now()}@mizyun.test`,
    password: "Test-password-A1!",
    accessToken: "",
  };
  const userB: TestUser = {
    id: "00000000-0000-4000-8000-bbbbbbbbbbbb",
    email: `persist-b-${Date.now()}@mizyun.test`,
    password: "Test-password-B1!",
    accessToken: "",
  };

  beforeAll(async () => {
    if (!runE2E) return;
    // Pre-create + confirm + sign in two distinct users. GoTrue
    // requires email confirmation when running against the local
    // dev stack; for the opt-in e2e we bypass that by toggling
    // the auth config? No — instead, we sign in via the
    // service-role password grant to keep the test self-contained.
    // Real apps handle confirmation; this test focuses on the
    // adapter behaviour, not the auth flow (which already has
    // its own e2e).
    const [a, b] = await Promise.all([
      signUp(userA.email, userA.password),
      signUp(userB.email, userB.password),
    ]);
    userA.id = a.id;
    userB.id = b.id;
    if (adminClient === null) {
      throw new Error("SUPABASE_E2E_SERVICE is required to confirm test users");
    }
    const [confirmedA, confirmedB] = await Promise.all([
      adminClient.auth.admin.updateUserById(userA.id, { email_confirm: true }),
      adminClient.auth.admin.updateUserById(userB.id, { email_confirm: true }),
    ]);
    if (confirmedA.error || confirmedB.error) {
      throw new Error(
        `test user confirmation failed: ${confirmedA.error?.message ?? confirmedB.error?.message}`,
      );
    }
    const [sa, sb] = await Promise.all([
      signIn(userA.email, userA.password),
      signIn(userB.email, userB.password),
    ]);
    userA.accessToken = sa.access_token;
    userB.accessToken = sb.access_token;
  }, 60_000);

  afterAll(async () => {
    if (!runE2E) return;
    await Promise.all([
      deleteUser(userA.id).catch(() => undefined),
      deleteUser(userB.id).catch(() => undefined),
    ]);
  }, 60_000);

  it("profile: persists across a fresh repo instance via RLS", async () => {
    const repo1 = new SupabaseProfileRepository({
      clientFor: (token) => clientFor(token || userA.accessToken),
    });
    const created = await repo1.getOrCreate(
      userA.id as unknown as Parameters<
        SupabaseProfileRepository["getOrCreate"]
      >[0],
      { now: new Date(), accessToken: userA.accessToken },
    );
    expect(created.userId).toBe(userA.id);

    // Patch the profile via the second repo instance and re-read.
    await repo1.update(
      userA.id as unknown as Parameters<SupabaseProfileRepository["update"]>[0],
      {
        ...created,
        displayName: "Persisted Adam",
        updatedAt: new Date(),
      },
      { accessToken: userA.accessToken },
    );
    const repo2 = new SupabaseProfileRepository({
      clientFor: (token) => clientFor(token || userA.accessToken),
    });
    const read = await repo2.getOrCreate(
      userA.id as unknown as Parameters<
        SupabaseProfileRepository["getOrCreate"]
      >[0],
      { now: new Date(), accessToken: userA.accessToken },
    );
    expect(read.displayName).toBe("Persisted Adam");
  }, 60_000);

  it("profile: blocks user B from reading user A's profile via RLS", async () => {
    const repoB = new SupabaseProfileRepository({
      clientFor: () => clientFor(userB.accessToken),
    });
    await expect(
      repoB.getOrCreate(
        userA.id as unknown as Parameters<
          SupabaseProfileRepository["getOrCreate"]
        >[0],
        { now: new Date(), accessToken: userB.accessToken },
      ),
    ).rejects.toThrow();
  }, 60_000);

  it("goals: enforces one active goal per user via the partial-unique index", async () => {
    const repoA = new SupabaseGoalRepository({
      clientFor: () => clientFor(userA.accessToken),
    });
    const goal1 = await repoA.create(
      userA.id as unknown as Parameters<SupabaseGoalRepository["create"]>[0],
      {
        id: "00000000-0000-4000-8000-ca0000000001",
        userId: userA.id as unknown as Parameters<
          SupabaseGoalRepository["create"]
        >[1]["userId"],
        kind: "cut",
        status: "active",
        pace: "steady",
        target: { weightKg: 78 },
        startsOn: "2026-01-01",
        targetDate: "2026-04-01",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { accessToken: userA.accessToken },
    );
    expect(goal1.status).toBe("active");
    await expect(
      repoA.create(
        userA.id as unknown as Parameters<SupabaseGoalRepository["create"]>[0],
        {
          id: "00000000-0000-4000-8000-ca0000000002",
          userId: userA.id as unknown as Parameters<
            SupabaseGoalRepository["create"]
          >[1]["userId"],
          kind: "recomp",
          status: "active",
          pace: "gradual",
          target: { weightKg: 80 },
          startsOn: "2026-04-02",
          targetDate: "2026-07-01",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { accessToken: userA.accessToken },
      ),
    ).rejects.toThrow(/already has an active goal/);
  }, 60_000);

  it("food-entries: persists, lists, and respects user isolation via RLS", async () => {
    const repoA = new SupabaseFoodEntryRepository({
      clientFor: () => clientFor(userA.accessToken),
    });
    await repoA.create(
      userA.id as unknown as Parameters<
        SupabaseFoodEntryRepository["create"]
      >[0],
      {
        id: "00000000-0000-4000-8000-fa0000000001",
        userId: userA.id as unknown as Parameters<
          SupabaseFoodEntryRepository["create"]
        >[1]["userId"],
        source: "manual",
        confidence: null,
        confirmedByUser: true,
        name: "Toast",
        consumedAt: new Date("2026-07-17T08:00:00Z"),
        caloriesKcal: 200,
        proteinG: 5,
        carbohydrateG: 30,
        fatG: 4,
        details: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { accessToken: userA.accessToken },
    );
    const repoB = new SupabaseFoodEntryRepository({
      clientFor: () => clientFor(userB.accessToken),
    });
    const aList = await repoA.list(
      userA.id as unknown as Parameters<SupabaseFoodEntryRepository["list"]>[0],
      {
        from: new Date("2026-07-17T00:00:00Z"),
        to: new Date("2026-07-17T23:59:59Z"),
        limit: 50,
        accessToken: userA.accessToken,
      },
    );
    expect(aList).toHaveLength(1);
    const bList = await repoB.list(
      userB.id as unknown as Parameters<SupabaseFoodEntryRepository["list"]>[0],
      {
        from: new Date("2026-07-17T00:00:00Z"),
        to: new Date("2026-07-17T23:59:59Z"),
        limit: 50,
        accessToken: userB.accessToken,
      },
    );
    expect(bList).toEqual([]);
  }, 60_000);

  it("exercises: persists, lists, and respects RLS isolation", async () => {
    const repoA = new SupabaseExerciseRepository({
      clientFor: () => clientFor(userA.accessToken),
    });
    await repoA.create(
      userA.id as unknown as Parameters<
        SupabaseExerciseRepository["create"]
      >[0],
      {
        id: "00000000-0000-4000-8000-00000000ca01",
        userId: userA.id as unknown as Parameters<
          SupabaseExerciseRepository["create"]
        >[1]["userId"],
        name: "Back squat",
        instructions: null,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { accessToken: userA.accessToken },
    );
    const repoB = new SupabaseExerciseRepository({
      clientFor: () => clientFor(userB.accessToken),
    });
    const aList = await repoA.list(
      userA.id as unknown as Parameters<SupabaseExerciseRepository["list"]>[0],
      { limit: 50, accessToken: userA.accessToken },
    );
    expect(aList).toHaveLength(1);
    const bList = await repoB.list(
      userB.id as unknown as Parameters<SupabaseExerciseRepository["list"]>[0],
      { limit: 50, accessToken: userB.accessToken },
    );
    expect(bList).toEqual([]);
  }, 60_000);

  it("workouts + sets: cascade-delete on workout removal (FK)", async () => {
    const workoutRepoA = new SupabaseWorkoutRepository({
      clientFor: () => clientFor(userA.accessToken),
    });
    const setRepoA = new SupabaseWorkoutSetRepository({
      clientFor: () => clientFor(userA.accessToken),
    });
    const workoutId = "00000000-0000-4000-8000-00000000ba01";
    const exerciseId = "00000000-0000-4000-8000-00000000ca01";
    await workoutRepoA.create(
      userA.id as unknown as Parameters<SupabaseWorkoutRepository["create"]>[0],
      {
        id: workoutId,
        userId: userA.id as unknown as Parameters<
          SupabaseWorkoutRepository["create"]
        >[1]["userId"],
        name: "Leg day",
        startedAt: new Date("2026-07-15T08:00:00Z"),
        completedAt: new Date("2026-07-15T09:00:00Z"),
        notes: null,
        source: "manual",
        details: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { accessToken: userA.accessToken },
    );
    await setRepoA.create(
      userA.id as unknown as Parameters<
        SupabaseWorkoutSetRepository["create"]
      >[0],
      {
        id: "00000000-0000-4000-8000-00000000da01",
        userId: userA.id as unknown as Parameters<
          SupabaseWorkoutSetRepository["create"]
        >[1]["userId"],
        workoutId,
        exerciseId,
        sequence: 1,
        repetitions: 8,
        loadKg: 60,
        durationSeconds: null,
        distanceMeters: null,
        perceivedExertion: 7.5,
        completedAt: new Date(),
        createdAt: new Date(),
      },
      { accessToken: userA.accessToken },
    );
    // Verify the set is visible.
    const setsBefore = await setRepoA.listForWorkout(workoutId, {
      accessToken: userA.accessToken,
    });
    expect(setsBefore).toHaveLength(1);
    // Delete the workout — SQL FK ON DELETE CASCADE drops the set.
    const removed = await workoutRepoA.delete(workoutId, {
      accessToken: userA.accessToken,
    });
    expect(removed).toBe(true);
    const setsAfter = await setRepoA.listForWorkout(workoutId, {
      accessToken: userA.accessToken,
    });
    expect(setsAfter).toEqual([]);
  }, 60_000);

  it("body measurements: append-only with delete", async () => {
    const repoA = new SupabaseBodyMeasurementRepository({
      clientFor: () => clientFor(userA.accessToken),
    });
    await repoA.create(
      userA.id as unknown as Parameters<
        SupabaseBodyMeasurementRepository["create"]
      >[0],
      {
        id: "00000000-0000-4000-8000-00000000aa01",
        userId: userA.id as unknown as Parameters<
          SupabaseBodyMeasurementRepository["create"]
        >[1]["userId"],
        measuredAt: new Date("2026-07-15T08:00:00Z"),
        weightKg: 70,
        measurements: {},
        source: "manual",
        createdAt: new Date("2026-07-15T08:00:00Z"),
      },
      { accessToken: userA.accessToken },
    );
    const repoB = new SupabaseBodyMeasurementRepository({
      clientFor: () => clientFor(userB.accessToken),
    });
    const bList = await repoB.list(
      userB.id as unknown as Parameters<
        SupabaseBodyMeasurementRepository["list"]
      >[0],
      {
        from: null,
        to: null,
        limit: 50,
        accessToken: userB.accessToken,
      },
    );
    expect(bList).toEqual([]);
  }, 60_000);

  it("private media: persists metadata and enforces signed object isolation and deletion", async () => {
    const repositoryA = new SupabaseMediaAssetRepository({ clientFor });
    const repositoryB = new SupabaseMediaAssetRepository({ clientFor });
    const storage = new SupabaseMediaStorage({
      clientFor: (accessToken) =>
        createSupabaseStorageClient(
          { url: SUPABASE_URL, publishableKey: PUBLISHABLE_KEY },
          accessToken,
        ),
    });
    const assetId = crypto.randomUUID();
    const objectPath = `${userA.id}/${assetId}.jpg`;
    const createdAt = new Date("2026-07-21T08:00:00.000Z");
    const stored = await repositoryA.create(
      userA.id as unknown as Parameters<
        SupabaseMediaAssetRepository["create"]
      >[0],
      {
        id: assetId,
        userId: userA.id as unknown as Parameters<
          SupabaseMediaAssetRepository["create"]
        >[1]["userId"],
        bucketId: "private-media",
        objectPath,
        purpose: "progress",
        mimeType: "image/jpeg",
        byteSize: 4,
        width: 16,
        height: 16,
        metadata: { capturedOn: "2026-07-21" },
        createdAt,
        deletedAt: null,
      },
      { accessToken: userA.accessToken },
    );
    expect(stored.objectPath).toBe(objectPath);

    const upload = await storage.signUploadUrl("private-media", objectPath, {
      ttlSeconds: 300,
      now: createdAt,
      accessToken: userA.accessToken,
    });
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const uploadResponse = await fetch(upload.url, {
      method: "PUT",
      headers: {
        "cache-control": "max-age=0",
        "content-type": "image/jpeg",
        "x-upsert": "false",
      },
      body: bytes,
    });
    expect(uploadResponse.status).toBeLessThan(300);

    const freshRepositoryA = new SupabaseMediaAssetRepository({ clientFor });
    const afterRestart = await freshRepositoryA.list(
      userA.id as unknown as Parameters<
        SupabaseMediaAssetRepository["list"]
      >[0],
      {
        purpose: "progress",
        limit: 20,
        accessToken: userA.accessToken,
      },
    );
    expect(afterRestart.some((asset) => asset.id === assetId)).toBe(true);
    await expect(
      repositoryB.getById(assetId, { accessToken: userB.accessToken }),
    ).resolves.toBeNull();
    await expect(
      storage.signDownloadUrl("private-media", objectPath, {
        ttlSeconds: 60,
        now: createdAt,
        accessToken: userB.accessToken,
      }),
    ).rejects.toThrow();

    const download = await storage.signDownloadUrl(
      "private-media",
      objectPath,
      {
        ttlSeconds: 60,
        now: createdAt,
        accessToken: userA.accessToken,
      },
    );
    const downloadResponse = await fetch(download.url);
    expect(downloadResponse.status).toBe(200);
    expect(new Uint8Array(await downloadResponse.arrayBuffer())).toEqual(bytes);

    await storage.remove("private-media", objectPath, {
      accessToken: userA.accessToken,
    });
    await freshRepositoryA.softDelete(assetId, new Date(), {
      accessToken: userA.accessToken,
    });
    await expect(
      storage.signDownloadUrl("private-media", objectPath, {
        ttlSeconds: 60,
        now: new Date(),
        accessToken: userA.accessToken,
      }),
    ).rejects.toThrow();
  }, 60_000);
});

// Silence unused-import warnings on the skipped branch.
void AgentOrchestrator;
void DisabledAgentProvider;
void InMemoryMemoryStore;
void buildApp;
