import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentOrchestrator,
  StubVisionProvider,
  type AgentProvider,
  type VisionDraftProvider,
} from "@mizyun/agent-runtime";
import type { UserId } from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";
import { InMemoryMemoryStore } from "@mizyun/memory";

import { buildApp } from "./app.js";
import { InMemoryProfileRepository } from "./profile-repository.js";
import { InMemoryFoodEntryRepository } from "./food-entry-repository.js";
import * as food from "./test-fixtures/build6-contracts/food-entry.mjs";
import * as workouts from "./test-fixtures/build6-contracts/workout.mjs";
import * as sets from "./test-fixtures/build6-contracts/workout-set.mjs";
import * as exercises from "./test-fixtures/build6-contracts/exercise.mjs";
import * as analytics from "./test-fixtures/build6-contracts/analytics.mjs";
import * as account from "./test-fixtures/build6-contracts/account.mjs";
import * as coach from "./test-fixtures/build6-contracts/coach.mjs";

const userId = "00000000-0000-4000-8000-000000000001" as UserId;
const auth = { authorization: "Bearer synthetic-build6-token" };
const tokenVerifier: AccessTokenVerifier = {
  verify: async (token) =>
    token === "synthetic-build6-token"
      ? { userId, accessToken: "synthetic-build6-token", role: "authenticated" }
      : null,
};
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function makeApp(visionProvider?: VisionDraftProvider) {
  const respond = vi.fn<AgentProvider["respond"]>(async (request) => ({
    message: { role: "assistant", text: "Take one conservative next step." },
    provider: "synthetic-provider",
    evidence: request.grounding,
    providerMetadata: { totalTokens: 42, resolvedModel: "synthetic-model" },
  }));
  const provider: AgentProvider = {
    status: async () => ({
      ready: true,
      provider: "synthetic-provider",
      externalAccess: true,
    }),
    respond,
  };
  const profileRepository = new InMemoryProfileRepository({
    defaultTimezone: "UTC",
    defaultUnitSystem: "metric",
    defaultBirthYear: 1990,
    defaultPlanTier: "paid",
  });
  const foodEntryRepository = new InMemoryFoodEntryRepository();
  const app = buildApp({
    tokenVerifier,
    profileRepository,
    foodEntryRepository,
    ...(visionProvider === undefined ? {} : { visionProvider }),
    agent: new AgentOrchestrator({
      provider,
      memories: new InMemoryMemoryStore(),
    }),
  });
  apps.push(app);
  async function request(
    method: "GET" | "POST" | "PUT",
    url: string,
    payload?: unknown,
    extraHeaders: Record<string, string> = {},
    statusCode = 200,
  ) {
    const response = await app.inject({
      method,
      url,
      headers: { ...auth, ...extraHeaders },
      ...(payload === undefined
        ? {}
        : { payload: payload as Record<string, unknown> }),
    });
    expect(response.statusCode, response.body).toBe(statusCode);
    return response.json();
  }
  return { app, request, respond };
}

describe("current API compatibility with the pinned original build6 client contracts", () => {
  it("pins the provenance and original schema snapshots without runtime Git access", () => {
    const fixtureRoot = new URL(
      "./test-fixtures/build6-contracts/",
      import.meta.url,
    );
    const manifestBytes = readFileSync(new URL("provenance.json", fixtureRoot));
    // Pinning the manifest also pins each schema checksum and source commit.
    expect(createHash("sha256").update(manifestBytes).digest("hex")).toBe(
      "618ae9772f6d2ed0524748fe6f0c279147b1a5f12ac057e5bdbf54195c47c0d4",
    );
    const provenance = JSON.parse(manifestBytes.toString()) as {
      androidSourceCommit: string;
      iosSourceCommit: string;
      modules: Record<string, { snapshotSha256: string }>;
    };
    expect(provenance.androidSourceCommit).toBe(
      "3c20835953737604bdb03567e519b13c0823df5b",
    );
    expect(provenance.iosSourceCommit).toBe(
      "9d50538471447880b6088be03f64db90db7a07fb",
    );
    for (const [name, module] of Object.entries(provenance.modules)) {
      expect(
        createHash("sha256")
          .update(readFileSync(new URL(`${name}.mjs`, fixtureRoot)))
          .digest("hex"),
        name,
      ).toBe(module.snapshotSha256);
    }
    expect(
      createHash("sha256")
        .update(readFileSync(new URL("zod-runtime.mjs", fixtureRoot)))
        .digest("hex"),
    ).toBe(
      (JSON.parse(manifestBytes.toString()) as { zodRuntimeSha256: string })
        .zodRuntimeSha256,
    );
  });

  it("creates, lists, edits and reopens an old meal, preserving its historical date and summaries", async () => {
    const { request } = makeApp();
    const body = food.foodEntryCreateSchema.parse({
      name: "Synthetic oats",
      consumedAt: "2026-10-02T08:00:00.000Z",
      caloriesKcal: 200,
      proteinG: 8,
      carbohydrateG: 30,
      fatG: 4,
      details: { grams: 100 },
    });
    const created = food.foodEntryResponseSchema.parse(
      await request("POST", "/v1/food-entries", body),
    );
    const id = created.foodEntry.id;
    const listed = food.foodEntryListResponseSchema.parse(
      await request("GET", "/v1/food-entries?from=2026-10-02&to=2026-10-02"),
    );
    expect(listed.foodEntries).toHaveLength(1);
    const patch = food.foodEntryPatchSchema.parse({
      name: "Edited synthetic oats",
      caloriesKcal: 225,
    });
    food.foodEntryResponseSchema.parse(
      await request("PUT", `/v1/food-entries/${id}`, patch),
    );
    const reopened = food.foodEntryResponseSchema.parse(
      await request("GET", `/v1/food-entries/${id}`),
    );
    expect(reopened.foodEntry).toMatchObject({
      name: patch.name,
      caloriesKcal: 225,
      consumedAt: body.consumedAt,
      proteinG: 8,
    });
    const daily = food.dailyFoodSummaryResponseSchema.parse(
      await request("GET", "/v1/food-entries/summary?date=2026-10-02"),
    );
    expect(daily.summary).toMatchObject({
      entryCount: 1,
      caloriesKcal: 225,
      proteinG: 8,
      carbohydrateG: 30,
      fatG: 4,
    });
    const range = food.dailyFoodSummaryListResponseSchema.parse(
      await request(
        "GET",
        "/v1/food-entries/summary?from=2026-10-02&to=2026-10-03",
      ),
    );
    expect(range.summaries).toHaveLength(1);
  });

  it.each([
    {
      patch: { fatG: 2 },
      cleared: "saturatedFatG",
      preserved: "totalSugarsG",
      value: 20,
    },
    {
      patch: { carbohydrateG: 10 },
      cleared: "totalSugarsG",
      preserved: "saturatedFatG",
      value: 3,
    },
  ])(
    "lets a build6 macro edit clear an incompatible omitted $cleared on a richer build7 meal",
    async ({ patch, cleared, preserved, value }) => {
      const { request } = makeApp();
      const richer = await request("POST", "/v1/food-entries", {
        name: "Synthetic richer meal",
        consumedAt: "2026-10-02T09:00:00.000Z",
        caloriesKcal: 200,
        proteinG: 8,
        carbohydrateG: 30,
        fatG: 4,
        fibreG: 5,
        saturatedFatG: 3,
        totalSugarsG: 20,
        sodiumMg: 12,
        cholesterolMg: 0,
      });
      expect(richer.foodEntry[cleared]).not.toBeNull();
      const originalClient = food.foodEntryResponseSchema.parse(richer);
      expect(originalClient.foodEntry).not.toHaveProperty(cleared);
      expect(originalClient.foodEntry).not.toHaveProperty("fibreG");
      const id = originalClient.foodEntry.id;
      const renamed = await request(
        "PUT",
        `/v1/food-entries/${id}`,
        food.foodEntryPatchSchema.parse({ name: "Renamed richer meal" }),
      );
      expect(renamed.foodEntry).toMatchObject({
        saturatedFatG: 3,
        totalSugarsG: 20,
        fibreG: 5,
      });
      const updated = await request(
        "PUT",
        `/v1/food-entries/${id}`,
        food.foodEntryPatchSchema.parse(patch),
      );
      expect(updated.foodEntry[cleared]).toBeNull();
      expect(updated.foodEntry[preserved]).toBe(value);
      expect(updated.foodEntry.fibreG).toBe(5);
      food.foodEntryResponseSchema.parse(updated);
      const reopened = await request("GET", `/v1/food-entries/${id}`);
      expect(reopened.foodEntry[cleared]).toBeNull();
      expect(
        food.foodEntryResponseSchema.parse(reopened).foodEntry,
      ).toMatchObject(patch);
      const explicitInvalid =
        cleared === "saturatedFatG"
          ? { fatG: 1, saturatedFatG: 2 }
          : { carbohydrateG: 1, totalSugarsG: 2 };
      await request("PUT", `/v1/food-entries/${id}`, explicitInvalid, {}, 422);
    },
  );

  it("accepts original exercise, session and omitted-setType writes, then parses finish and history", async () => {
    const { request } = makeApp();
    const catalog = exercises.exerciseCatalogResponseSchema.parse(
      await request("GET", "/v1/exercises/catalog?query=bench+press"),
    );
    expect(catalog.exercises.length).toBeGreaterThan(0);
    const exercise = exercises.exerciseResponseSchema.parse(
      await request(
        "POST",
        "/v1/exercises",
        exercises.exerciseCreateSchema.parse({ name: "Synthetic squat" }),
      ),
    );
    expect(
      exercises.exerciseListResponseSchema.parse(
        await request("GET", "/v1/exercises"),
      ).exercises,
    ).toHaveLength(1);
    const started = workouts.workoutResponseSchema.parse(
      await request(
        "POST",
        "/v1/workouts",
        workouts.workoutCreateSchema.parse({
          name: "Synthetic session",
          startedAt: "2026-10-02T10:00:00.000Z",
          details: { workoutLifecycle: { kind: "session" } },
        }),
      ),
    );
    const id = started.workout.id;
    const originalSetBody = sets.workoutSetCreateSchema.parse({
      exerciseId: exercise.exercise.id,
      repetitions: 8,
      loadKg: 60,
      completedAt: "2026-10-02T10:10:00.000Z",
    });
    expect(originalSetBody).not.toHaveProperty("setType");
    const setWire = await request(
      "POST",
      `/v1/workouts/${id}/sets`,
      originalSetBody,
    );
    expect(setWire.workoutSet.setType).toBe("normal");
    const oldSet = sets.workoutSetResponseSchema.parse(setWire);
    expect(oldSet.workoutSet).not.toHaveProperty("setType");
    expect(oldSet.workoutSet).toMatchObject({
      sequence: 1,
      repetitions: 8,
      loadKg: 60,
      durationSeconds: null,
      distanceMeters: null,
      perceivedExertion: null,
    });
    expect(
      sets.workoutSetListResponseSchema.parse(
        await request("GET", `/v1/workouts/${id}/sets`),
      ).workoutSets,
    ).toHaveLength(1);
    const finished = workouts.workoutResponseSchema.parse(
      await request(
        "PUT",
        `/v1/workouts/${id}`,
        workouts.workoutPatchSchema.parse({
          completedAt: "2026-10-02T10:30:00.000Z",
        }),
      ),
    );
    expect(finished.workout.completedAt).toBe("2026-10-02T10:30:00.000Z");
    expect(
      workouts.workoutListResponseSchema.parse(
        await request("GET", "/v1/workouts"),
      ).workouts,
    ).toHaveLength(1);
    const reopened = workouts.workoutResponseSchema.parse(
      await request("GET", `/v1/workouts/${id}`),
    );
    expect(reopened.workout.id).toBe(id);
    const history = sets.exerciseRecentSetsResponseSchema.parse(
      await request("GET", `/v1/exercises/${exercise.exercise.id}/recent-sets`),
    );
    expect(history.sets).toHaveLength(1);
    expect(history.summary).toMatchObject({
      bestLoadKg: 60,
      lastSessionVolumeKg: 480,
      totalSetCount: 1,
    });
  });

  it("projects new analytics out of unversioned responses while keeping old exports parseable and truthful", async () => {
    const { request } = makeApp();
    const meal = food.foodEntryResponseSchema.parse(
      await request(
        "POST",
        "/v1/food-entries",
        food.foodEntryCreateSchema.parse({
          name: "Synthetic export meal",
          caloriesKcal: 100,
        }),
      ),
    );
    const consent = analytics.analyticsConsentResponseSchema.parse(
      await request(
        "PUT",
        "/v1/analytics/consent",
        analytics.analyticsConsentRequestSchema.parse({
          version: analytics.CURRENT_ANALYTICS_CONSENT_VERSION,
          granted: true,
          expectedRevision: 0,
          operationId: "11111111-1111-4111-8111-111111111111",
        }),
      ),
    );
    const base = {
      schemaVersion: 2,
      recordedAt: new Date().toISOString(),
      sessionId: "22222222-2222-4222-8222-222222222222",
      sequence: 0,
      platform: "ios",
      appVersion: "1.0.6",
    };
    const oldEvent = {
      ...base,
      id: "33333333-3333-4333-8333-333333333333",
      name: "onboarding_step_completed",
      properties: { step: "welcome" },
    };
    const oldBatch = analytics.analyticsBatchIngestRequestSchema.parse({
      consentVersion: consent.version,
      epoch: consent.epoch,
      events: [oldEvent],
    });
    expect(
      analytics.analyticsBatchIngestResponseSchema.parse(
        await request("POST", "/v1/analytics/events", oldBatch),
      ).acceptedIds,
    ).toEqual([oldEvent.id]);
    await request("POST", "/v1/analytics/events", {
      consentVersion: consent.version,
      epoch: consent.epoch,
      events: [
        {
          ...base,
          appVersion: "1.0.7",
          id: "44444444-4444-4444-8444-444444444444",
          sequence: 1,
          name: "dashboard_control_clicked",
          properties: { control: "nutrition_card" },
        },
        {
          ...base,
          appVersion: "1.0.7",
          id: "55555555-5555-4555-8555-555555555555",
          sequence: 2,
          name: "onboarding_step_completed",
          properties: { step: "baseline_weight" },
        },
      ],
    });
    const oldList = analytics.analyticsEventsListResponseSchema.parse(
      await request("GET", "/v1/analytics/events"),
    );
    expect(oldList.events.map((event: { id: string }) => event.id)).toEqual([
      oldEvent.id,
    ]);
    const upgradedList = await request(
      "GET",
      "/v1/analytics/events?catalog=dashboard-v1",
    );
    expect(
      analytics.analyticsEventsListResponseSchema.safeParse(upgradedList)
        .success,
    ).toBe(false);
    expect(upgradedList.events).toHaveLength(3);
    const wire = await request("GET", "/v1/account/export");
    const exported = account.accountExportResponseSchema.parse(wire).export;
    expect(exported.foodEntries).toEqual([
      expect.objectContaining({
        id: meal.foodEntry.id,
        name: "Synthetic export meal",
      }),
    ]);
    expect(
      exported.productAnalytics.events.map((event: { id: string }) => event.id),
    ).toEqual([oldEvent.id]);
    expect(exported.manifest).toMatchObject({
      completeness: "partial",
      counts: { foodEntries: 1, productAnalyticsEvents: 1 },
    });
    expect(wire.export.productAnalytics.omittedEventCount).toBe(2);
    const upgradedExport = await request(
      "GET",
      "/v1/account/export?catalog=dashboard-v1",
    );
    expect(
      account.accountExportResponseSchema.safeParse(upgradedExport).success,
    ).toBe(false);
    expect(upgradedExport.export.manifest.completeness).toBe("complete");
    expect(upgradedExport.export.productAnalytics.events).toHaveLength(3);
  });

  it("parses original Coach status, thread, send and idempotent replay using only a fake provider", async () => {
    const { request, respond } = makeApp();
    account.aiConsentResponseSchema.parse(
      await request(
        "PUT",
        "/v1/account/ai-consent",
        account.updateAiConsentSchema.parse({
          granted: true,
          confirmedAdult: true,
          consentVersion: account.CURRENT_AI_CONSENT_VERSION,
        }),
      ),
    );
    expect(
      coach.coachProviderStatusSchema.parse(
        await request("GET", "/v1/coach/status"),
      ).ready,
    ).toBe(true);
    const created = coach.coachConversationResponseSchema.parse(
      await request(
        "POST",
        "/v1/coach/conversations",
        coach.coachConversationCreateSchema.parse({
          title: "Synthetic build6 check-in",
        }),
        {},
        201,
      ),
    );
    const id = created.conversation.id;
    expect(
      coach.coachConversationListResponseSchema.parse(
        await request("GET", "/v1/coach/conversations"),
      ).conversations,
    ).toHaveLength(1);
    const empty = coach.coachThreadResponseSchema.parse(
      await request("GET", `/v1/coach/conversations/${id}`),
    );
    expect(empty.messages).toEqual([]);
    const body = coach.coachMessageCreateSchema.parse({
      text: "What is one sensible next step today?",
    });
    const headers = { "idempotency-key": "synthetic-build6-send" };
    const sent = coach.coachMessageResponseSchema.parse(
      await request(
        "POST",
        `/v1/coach/conversations/${id}/messages`,
        body,
        headers,
      ),
    );
    expect(sent.assistantMessage.text).toBe("Take one conservative next step.");
    expect(respond).toHaveBeenCalledTimes(1);
    const replayed = coach.coachMessageResponseSchema.parse(
      await request(
        "POST",
        `/v1/coach/conversations/${id}/messages`,
        body,
        headers,
      ),
    );
    expect(replayed.assistantMessage.id).toBe(sent.assistantMessage.id);
    expect(respond).toHaveBeenCalledTimes(1);
    const populated = coach.coachThreadResponseSchema.parse(
      await request("GET", `/v1/coach/conversations/${id}`),
    );
    expect(populated.messages).toHaveLength(2);
    expect(
      populated.messages.map((message: { role: string }) => message.role),
    ).toEqual(["user", "assistant"]);
  });

  it.each(["meal_log", "workout_start"])(
    "parses a real current-handler %s proposal with the original send, replay and thread contracts",
    async (kind) => {
      const stub = new StubVisionProvider();
      const extras = {
        fibreG: 2,
        saturatedFatG: 1,
        totalSugarsG: 2,
        sodiumMg: 120,
        cholesterolMg: 5,
      };
      const generateTextDraft = vi.fn<
        NonNullable<VisionDraftProvider["generateTextDraft"]>
      >(async (request) => ({
        ...(await stub.generateTextDraft(request)),
        ...extras,
      }));
      const { request, respond } = makeApp({
        status: () => stub.status(),
        generateDraft: (draft) => stub.generateDraft(draft),
        generateTextDraft,
      });
      if (kind === "workout_start") {
        await request("PUT", "/v1/profile", {
          coachingPreferences: {
            experienceLevel: "intermediate",
            trainingDaysPerWeek: 3,
            sessionDurationMinutes: 45,
            trainingFocus: "strength",
            availableEquipment: ["dumbbells", "bench"],
            dietaryPreferences: ["omnivore"],
            trainingLimitations: [],
          },
        });
        await request("POST", "/v1/goals", {
          kind: "recomp",
          pace: "gradual",
          target: { weightKg: 80 },
          startsOn: "2026-07-01",
          targetDate: "2026-12-31",
        });
      }
      const created = coach.coachConversationResponseSchema.parse(
        await request(
          "POST",
          "/v1/coach/conversations",
          coach.coachConversationCreateSchema.parse({
            title: "Synthetic action compatibility",
          }),
          {},
          201,
        ),
      );
      const id = created.conversation.id;
      const body = coach.coachMessageCreateSchema.parse({
        text:
          kind === "meal_log"
            ? "I had 250g of tuna for dinner"
            : "Build today's workout",
      });
      const headers = { "idempotency-key": `synthetic-build6-${kind}` };
      const sentWire = await request(
        "POST",
        `/v1/coach/conversations/${id}/messages`,
        body,
        headers,
      );
      const sent = coach.coachMessageResponseSchema.parse(sentWire);
      const proposal = sent.assistantMessage.actionProposal;
      expect(proposal.kind).toBe(kind);
      if (kind === "meal_log") {
        expect(
          sentWire.assistantMessage.actionProposal.candidate,
        ).toMatchObject(extras);
        expect(proposal.candidate).not.toHaveProperty("fibreG");
        expect(proposal.candidate).not.toHaveProperty("saturatedFatG");
        expect(proposal.candidate).toMatchObject({
          caloriesKcal: 350,
          carbohydrateG: 40,
          fatG: 14,
        });
        expect(generateTextDraft).toHaveBeenCalledTimes(1);
        expect(respond).not.toHaveBeenCalled();
      } else {
        expect(proposal.session.exercises.length).toBeGreaterThan(0);
        expect(proposal.session.estimatedMinutes).toBe(45);
        expect(respond).toHaveBeenCalledTimes(1);
        expect(generateTextDraft).not.toHaveBeenCalled();
      }
      const replay = coach.coachMessageResponseSchema.parse(
        await request(
          "POST",
          `/v1/coach/conversations/${id}/messages`,
          body,
          headers,
        ),
      );
      expect(replay.assistantMessage).toEqual(sent.assistantMessage);
      expect(respond).toHaveBeenCalledTimes(kind === "meal_log" ? 0 : 1);
      expect(generateTextDraft).toHaveBeenCalledTimes(
        kind === "meal_log" ? 1 : 0,
      );
      const thread = coach.coachThreadResponseSchema.parse(
        await request("GET", `/v1/coach/conversations/${id}`),
      );
      expect(thread.messages).toHaveLength(2);
      expect(thread.messages[1].actionProposal).toEqual(proposal);
      // A proposal remains advisory: opening/replaying it creates no meal or workout.
      expect(
        food.foodEntryListResponseSchema.parse(
          await request("GET", "/v1/food-entries"),
        ).foodEntries,
      ).toEqual([]);
      expect(
        workouts.workoutListResponseSchema.parse(
          await request("GET", "/v1/workouts"),
        ).workouts,
      ).toEqual([]);
    },
  );
});
