import { describe, expect, it } from "vitest";
import {
  HttpApiClient,
  type ApiClient,
  type RequestOptions,
} from "@mizyun/api-client";
import { DisabledAuthClient, type AuthClient } from "@mizyun/identity";
import type { Result } from "@mizyun/core";
import {
  clearLoggingDraft,
  loadLoggingDraft,
  saveLoggingDraft,
} from "../logging-draft-storage";
import { submitLogMealWith, type LogMealForm } from "./log-meal-data";
import {
  isRecoverableMealDraft,
  upgradeLegacyMealDraft,
  type RecoverableMealDraft,
} from "./meal-form";

// In-memory mock store for draft persistence tests
const createMemoryStore = () => {
  const store = new Map<string, string>();
  return {
    async getItemAsync(key: string): Promise<string | null> {
      return store.get(key) ?? null;
    },
    async setItemAsync(key: string, value: string): Promise<void> {
      store.set(key, value);
    },
    async deleteItemAsync(key: string): Promise<void> {
      store.delete(key);
    },
  };
};

const NOW = new Date("2026-09-08T12:00:00.000Z");

const dummyStatus = () => ({
  configured: true as const,
  baseUrl: "https://example.test",
  provider: "supabase" as const,
});

it("keeps the exact scoped HTTP body and operation identity through commit/drop and durable restart", async () => {
  const owner = "00000000-0000-4000-8000-000000000002";
  const operationId = "11111111-2222-4333-8444-555555555555";
  const frozen: LogMealForm = {
    clientOperationId: operationId,
    name: "Reviewed serving",
    caloriesKcal: 350,
    proteinG: 20,
    carbohydrateG: 0,
    fatG: null,
    consumedAt: NOW.toISOString(),
    details: { grams: 180, mealDescription: "Reviewed assumption" },
  };
  const store = createMemoryStore();
  await saveLoggingDraft(
    owner,
    "meal",
    {
      name: frozen.name,
      calories: "350",
      protein: "20",
      carbs: "0",
      fat: "",
      clientOperationId: operationId,
      consumedAt: frozen.consumedAt!,
      submittedMeal: frozen,
      submissionStatus: "outcome_unknown",
    },
    store,
  );
  const auth: AuthClient = new DisabledAuthClient();
  auth.getSession = async () => ({
    user: { id: owner as never },
    accessToken: "owner-token",
  });
  const bodies: string[] = [];
  const keys: string[] = [];
  const committed = new Map<string, object>();
  const client = new HttpApiClient({
    baseUrl: "https://example.test",
    authClient: auth,
    fetch: async (_url, init) => {
      expect((init?.headers as Record<string, string>).authorization).toBe(
        "Bearer owner-token",
      );
      const key = (init?.headers as Record<string, string>)["Idempotency-Key"]!;
      const body = init?.body as string;
      keys.push(key);
      bodies.push(body);
      const payload = JSON.parse(body);
      expect(payload).not.toHaveProperty("expectedUserId");
      expect(payload).not.toHaveProperty("isCurrent");
      if (!committed.has(key))
        committed.set(key, {
          ...payload,
          fatG: null,
          id: "00000000-0000-4000-8000-000000000001",
          userId: owner,
          source: "manual",
          confidence: null,
          confirmedByUser: true,
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        });
      if (bodies.length === 1) throw new Error("response lost after commit");
      return new Response(JSON.stringify({ foodEntry: committed.get(key) }), {
        status: 200,
      });
    },
  });
  const scope = { expectedUserId: owner, isCurrent: () => true };
  expect(
    (await submitLogMealWith(frozen, client, () => NOW, undefined, scope)).ok,
  ).toBe(false);
  const restored = await loadLoggingDraft(
    owner,
    "meal",
    isRecoverableMealDraft,
    store,
  );
  const nextDay = () => new Date("2026-09-10T12:00:00.000Z");
  const upgraded = upgradeLegacyMealDraft(restored!, nextDay);
  expect(upgraded.submittedMeal).toEqual(frozen);
  expect(
    await submitLogMealWith(
      upgraded.submittedMeal!,
      client,
      nextDay,
      undefined,
      scope,
    ),
  ).toEqual({
    ok: true,
    id: "00000000-0000-4000-8000-000000000001",
  });
  expect(bodies[1]).toBe(bodies[0]);
  expect(keys).toEqual([operationId, operationId]);
  expect(committed.size).toBe(1);
});

describe("Q2: Mutation retry durability and idempotency (REL-AUD-007)", () => {
  it("survives a lost response on network retry without duplicate creation", async () => {
    // Simulated server database
    const serverDb = new Map<
      string,
      {
        id: string;
        userId: string;
        name: string;
        caloriesKcal: number | null;
        consumedAt: string;
        clientOperationId: string;
      }
    >();

    const clientOpId = "00000000-0000-4000-8000-000000000001";
    const mealPayload = {
      name: "Chicken breast and broccoli",
      caloriesKcal: 350,
      proteinG: 45,
      carbohydrateG: 10,
      fatG: 5,
      consumedAt: NOW.toISOString(),
      clientOperationId: clientOpId,
    };

    let serverCalls = 0;
    const mockApiClient: ApiClient = {
      status: dummyStatus,
      async request<T>(options: RequestOptions): Promise<Result<T, any>> {
        serverCalls++;
        const body = options.body as any;
        const opId =
          options.headers?.["Idempotency-Key"] || body.clientOperationId;

        // Server-side idempotency handling
        let existing = serverDb.get(opId);
        if (!existing) {
          existing = {
            id: `server-meal-${serverDb.size + 1}`,
            userId: "user-1",
            name: body.name,
            caloriesKcal: body.caloriesKcal,
            consumedAt: body.consumedAt,
            clientOperationId: opId,
          };
          serverDb.set(opId, existing);
        }

        // On attempt 1: Simulate network drop after server committed
        if (serverCalls === 1) {
          return {
            ok: false,
            error: {
              kind: "network_error",
              cause: new Error("connection dropped"),
            },
          };
        }

        // On attempt 2: Network succeeds, server returns the existing row
        return {
          ok: true,
          value: {
            foodEntry: {
              ...existing,
              proteinG: 45,
              carbohydrateG: 10,
              fatG: 5,
              source: "manual",
              confidence: null,
              confirmedByUser: true,
              details: {},
              createdAt: NOW.toISOString(),
              updatedAt: NOW.toISOString(),
            },
          } as T,
        };
      },
    };

    // Attempt 1: fails due to network drop
    const res1 = await submitLogMealWith(mealPayload, mockApiClient, () => NOW);
    expect(res1.ok).toBe(false);
    if (!res1.ok) {
      expect(res1.message).toContain("Network unavailable");
    }

    // Server committed 1 entry
    expect(serverDb.size).toBe(1);

    // Attempt 2: user taps Save again (same clientOperationId preserved on screen)
    const res2 = await submitLogMealWith(mealPayload, mockApiClient, () => NOW);
    expect(res2.ok).toBe(true);
    if (!res2.ok) return;

    expect(res2.id).toBe("server-meal-1");
    // Verifies NO duplicate row was created on server
    expect(serverDb.size).toBe(1);
  });

  it("restores stable operation identity and timestamp across process restart", async () => {
    const memStore = createMemoryStore();
    const userId = "user-test-q2";

    // 1. Initial draft save
    const initialOpId = "11111111-2222-4333-8444-555555555555";
    const initialConsumedAt = "2026-09-08T11:45:00.000Z";

    await saveLoggingDraft(
      userId,
      "meal",
      {
        name: "Avocado toast",
        calories: "280",
        protein: "8",
        carbs: "24",
        fat: "16",
        clientOperationId: initialOpId,
        consumedAt: initialConsumedAt,
        submissionVersion: 1,
      },
      memStore,
    );

    // 2. App killed and restarted: load draft from store
    const restored = await loadLoggingDraft(
      userId,
      "meal",
      isRecoverableMealDraft,
      memStore,
    );
    expect(restored).not.toBeNull();
    expect(restored?.clientOperationId).toBe(initialOpId);
    expect(restored?.consumedAt).toBe(initialConsumedAt);

    // 3. Upgrade legacy drafts lacking ID
    const legacyDraft: RecoverableMealDraft = {
      name: "Protein bar",
      calories: "200",
      protein: "20",
      carbs: "15",
      fat: "5",
    };
    const upgraded = upgradeLegacyMealDraft(legacyDraft, () => NOW);
    expect(upgraded.clientOperationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(upgraded.consumedAt).toBe(NOW.toISOString());

    // 4. Draft cleanup on successful submit
    await clearLoggingDraft(userId, "meal", memStore);
    const afterClear = await loadLoggingDraft(
      userId,
      "meal",
      isRecoverableMealDraft,
      memStore,
    );
    expect(afterClear).toBeNull();
  });

  it("rejects attempt when operation identity is missing", async () => {
    const invalidForm: LogMealForm = {
      name: "Steak",
      caloriesKcal: 500,
      proteinG: 50,
      carbohydrateG: 0,
      fatG: 30,
      consumedAt: NOW.toISOString(),
      // clientOperationId omitted
    };

    const dummyClient: ApiClient = {
      status: dummyStatus,
      async request() {
        throw new Error("Should not be called");
      },
    };

    const res = await submitLogMealWith(invalidForm, dummyClient, () => NOW);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toContain("Missing or invalid operation identity");
    }
  });

  it("prevents duplicate creation under identical intentional meals with different operation IDs", async () => {
    const createdIds: string[] = [];
    const mockApiClient: ApiClient = {
      status: dummyStatus,
      async request<T>(options: RequestOptions): Promise<Result<T, any>> {
        const id = `meal-${createdIds.length + 1}`;
        createdIds.push(id);
        return {
          ok: true,
          value: {
            foodEntry: {
              id,
              userId: "user-1",
              name: "Espresso",
              consumedAt: NOW.toISOString(),
              caloriesKcal: 5,
              proteinG: 0,
              carbohydrateG: 1,
              fatG: 0,
              source: "manual",
              confidence: null,
              confirmedByUser: true,
              details: {},
              createdAt: NOW.toISOString(),
              updatedAt: NOW.toISOString(),
            },
          } as T,
        };
      },
    };

    // First intentional espresso
    const res1 = await submitLogMealWith(
      {
        name: "Espresso",
        caloriesKcal: 5,
        proteinG: 0,
        carbohydrateG: 1,
        fatG: 0,
        consumedAt: NOW.toISOString(),
        clientOperationId: "22222222-3333-4444-8555-666666666661",
      },
      mockApiClient,
      () => NOW,
    );
    expect(res1.ok).toBe(true);

    // Second intentional espresso
    const res2 = await submitLogMealWith(
      {
        name: "Espresso",
        caloriesKcal: 5,
        proteinG: 0,
        carbohydrateG: 1,
        fatG: 0,
        consumedAt: NOW.toISOString(),
        clientOperationId: "22222222-3333-4444-8555-666666666662",
      },
      mockApiClient,
      () => NOW,
    );
    expect(res2.ok).toBe(true);

    expect(createdIds).toHaveLength(2);
    expect(createdIds[0]).not.toBe(createdIds[1]);
  });

  it("reconciles operation identity: reuses opId on retry and allows a deliberate edit after success (Q2)", async () => {
    const submittedPayloads: LogMealForm[] = [];
    const mockApiClient: ApiClient = {
      status: dummyStatus,
      async request<T>(options: RequestOptions): Promise<Result<T, any>> {
        const body = options.body as LogMealForm;
        submittedPayloads.push(body);
        if (submittedPayloads.length === 1) {
          // First attempt fails with network error
          return {
            ok: false,
            error: {
              kind: "network_error",
              cause: new Error("connection lost"),
            },
          };
        }
        return {
          ok: true,
          value: {
            foodEntry: {
              id: "server-meal-ok",
              userId: "user-1",
              name: body.name,
              consumedAt: body.consumedAt,
              caloriesKcal: body.caloriesKcal,
              proteinG: body.proteinG,
              carbohydrateG: body.carbohydrateG,
              fatG: body.fatG,
              source: "manual",
              confidence: null,
              confirmedByUser: true,
              details: {},
              createdAt: NOW.toISOString(),
              updatedAt: NOW.toISOString(),
            },
          } as T,
        };
      },
    };

    const initialOpId = "33333333-4444-4555-8666-777777777771";
    const baseMeal: LogMealForm = {
      name: "Oatmeal",
      caloriesKcal: 200,
      proteinG: 10,
      carbohydrateG: 35,
      fatG: 3,
      consumedAt: NOW.toISOString(),
      clientOperationId: initialOpId,
    };

    // Attempt 1: fails
    const res1 = await submitLogMealWith(baseMeal, mockApiClient, () => NOW);
    expect(res1.ok).toBe(false);

    // Attempt 2 (unmodified retry): reuses exact initialOpId
    const res2 = await submitLogMealWith(baseMeal, mockApiClient, () => NOW);
    expect(res2.ok).toBe(true);
    expect(submittedPayloads[0]?.clientOperationId).toBe(initialOpId);
    expect(submittedPayloads[1]?.clientOperationId).toBe(initialOpId);

    // The original operation has now succeeded. A deliberate edited entry is
    // allowed to use a fresh operation ID; the screen blocks this path while
    // the original retryable outcome is still unresolved.
    const editedOpId = "33333333-4444-4555-8666-777777777772";
    const editedMeal: LogMealForm = {
      ...baseMeal,
      caloriesKcal: 250,
      clientOperationId: editedOpId,
    };
    const res3 = await submitLogMealWith(editedMeal, mockApiClient, () => NOW);
    expect(res3.ok).toBe(true);
    expect(submittedPayloads[2]?.clientOperationId).toBe(editedOpId);
    expect(submittedPayloads[2]?.clientOperationId).not.toBe(initialOpId);
  });
});

it("reconciles one server entry with the exact durable body after commit/drop and a next-day restart", async () => {
  const store = createMemoryStore();
  const operationId = "11111111-2222-4333-8444-555555555555";
  const frozen: LogMealForm = {
    name: "Reviewed serving",
    clientOperationId: operationId,
    consumedAt: NOW.toISOString(),
    caloriesKcal: 350,
    proteinG: 20,
    carbohydrateG: 0,
    fatG: null,
    details: { grams: 180, mealDescription: "Reviewed assumption" },
  };
  const draft: RecoverableMealDraft = {
    name: frozen.name,
    calories: "350",
    protein: "20",
    carbs: "0",
    fat: "",
    clientOperationId: operationId,
    consumedAt: frozen.consumedAt!,
    submittedMeal: frozen,
    submissionStatus: "outcome_unknown",
  };
  expect(await saveLoggingDraft("owner", "meal", draft, store)).toBe(true);
  const bodies: unknown[] = [];
  const committed = new Map<string, unknown>();
  const client: ApiClient = {
    status: dummyStatus,
    async request<T>(options: RequestOptions): Promise<Result<T, any>> {
      bodies.push(options.body);
      const key = options.headers!["Idempotency-Key"]!;
      if (!committed.has(key)) committed.set(key, options.body);
      if (bodies.length === 1)
        return {
          ok: false,
          error: { kind: "network_error", cause: Error("response lost") },
        };
      return {
        ok: true,
        value: {
          foodEntry: {
            id: "one-entry",
            userId: "owner",
            ...(committed.get(key) as object),
            source: "manual",
            confidence: null,
            confirmedByUser: true,
            createdAt: NOW.toISOString(),
            updatedAt: NOW.toISOString(),
          },
        } as T,
      };
    },
  };
  expect((await submitLogMealWith(frozen, client, () => NOW)).ok).toBe(false);
  // Autosave edits cannot change the body associated with the submitted identity.
  await saveLoggingDraft(
    "owner",
    "meal",
    {
      ...draft,
      name: "Edited",
      calories: "999",
      submittedMeal: undefined,
      submissionStatus: undefined,
    },
    store,
  );
  expect(await clearLoggingDraft("owner", "meal", store)).toBe(false);
  const restored = await loadLoggingDraft(
    "owner",
    "meal",
    isRecoverableMealDraft,
    store,
  );
  expect(restored).not.toBeNull();
  const upgraded = upgradeLegacyMealDraft(
    restored!,
    () => new Date("2026-09-10T12:00:00.000Z"),
  );
  expect(upgraded.clientOperationId).toBe(operationId);
  expect(upgraded.submittedMeal).toEqual(frozen);
  expect(
    (
      await submitLogMealWith(
        upgraded.submittedMeal!,
        client,
        () => new Date("2026-09-10T12:00:00.000Z"),
      )
    ).ok,
  ).toBe(true);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(committed.size).toBe(1);
  expect(
    await clearLoggingDraft("owner", "meal", store, {
      resolvedOperationId: operationId,
    }),
  ).toBe(true);
});
