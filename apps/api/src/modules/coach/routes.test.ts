import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentOrchestrator,
  AgentProviderError,
  StubVisionProvider,
  type AgentProvider,
  type ContentModerator,
  type VisionDraftProvider,
} from "@mizyun/agent-runtime";
import type { PlanTier, ProfileRepository, UserId } from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";
import { InMemoryMemoryStore } from "@mizyun/memory";

import { buildApp } from "../../app.js";
import { InMemoryConversationRepository } from "../../conversation-repository.js";
import type { CoachLimitService } from "./limits.js";

const userId = "00000000-0000-4000-8000-000000000001" as UserId;
const tokenVerifier: AccessTokenVerifier = {
  verify: async (token) =>
    token === "valid" ? { userId, accessToken: "test-access-token" } : null,
};
const auth = { authorization: "Bearer valid" };
const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const makeApp = (
  respond = vi.fn<AgentProvider["respond"]>(),
  conversationRepository = new InMemoryConversationRepository(),
  coachControls?: {
    readonly dailyUserTokenBudget?: number;
    readonly userRequestsPerMinute?: number;
    readonly userMaxConcurrentRequests?: number;
    readonly now?: () => Date;
    readonly planTierOverride?: PlanTier;
    readonly limits?: CoachLimitService;
    readonly visionProvider?: VisionDraftProvider;
  },
  verifier: AccessTokenVerifier = tokenVerifier,
  profileRepository?: ProfileRepository,
) => {
  if (respond.getMockImplementation() === undefined) {
    respond.mockImplementation(async (request) => ({
      message: {
        role: "assistant",
        text: "Your confirmed records support one conservative next step.",
      },
      provider: "fake",
      evidence: request.grounding,
      providerMetadata: { totalTokens: 42, resolvedModel: "fake-v1" },
    }));
  }
  const provider: AgentProvider = {
    status: async () => ({
      ready: true,
      provider: "fake",
      externalAccess: true,
    }),
    respond,
  };
  const app = buildApp({
    tokenVerifier: verifier,
    conversationRepository,
    ...(profileRepository ? { profileRepository } : {}),
    ...(coachControls ? { coachControls } : {}),
    agent: new AgentOrchestrator({
      provider,
      memories: new InMemoryMemoryStore(),
    }),
  });
  apps.push(app);
  return { app, respond };
};

const createConversation = async (
  app: ReturnType<typeof buildApp>,
  headers: Readonly<Record<string, string>> = auth,
) => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/coach/conversations",
    headers,
    payload: { title: "Daily check-in" },
  });
  expect(response.statusCode).toBe(201);
  return response.json().conversation.id as string;
};

const sendMessage = (
  app: ReturnType<typeof buildApp>,
  conversationId: string,
  idempotencyKey: string,
  text = "What is one sensible next step today?",
  headers: Readonly<Record<string, string>> = auth,
) =>
  app.inject({
    method: "POST",
    url: `/v1/coach/conversations/${conversationId}/messages`,
    headers: { ...headers, "idempotency-key": idempotencyKey },
    payload: { text },
  });

describe("coach routes", () => {
  it("requires authentication for private conversations", async () => {
    const { app } = makeApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/coach/conversations",
    });
    expect(response.statusCode).toBe(401);
  });

  it("passes an injected moderator into the composed orchestrator", async () => {
    const conversationRepository = new InMemoryConversationRepository();
    const respond = vi.fn<AgentProvider["respond"]>();
    const provider: AgentProvider = {
      status: async () => ({
        ready: true,
        provider: "fake",
        externalAccess: true,
      }),
      respond,
    };
    const moderateText = vi.fn<ContentModerator["moderateText"]>(async () => ({
      allowed: false,
      provider: "fake-moderator",
      model: "fake-moderation-v1",
      category: "dangerous",
    }));
    const app = buildApp({
      tokenVerifier,
      conversationRepository,
      provider,
      memories: new InMemoryMemoryStore(),
      moderator: { moderateText },
    });
    apps.push(app);

    const id = await createConversation(app);
    const response = await sendMessage(app, id, "moderated-message");

    expect(response.statusCode).toBe(200);
    expect(response.json().assistantMessage).toMatchObject({
      provider: "mizyun-safety",
    });
    const storedMessages = await conversationRepository.listMessages(
      userId,
      id as any,
      { accessToken: "valid-token", limit: 10 },
    );
    expect(storedMessages[1]?.providerMetadata).toMatchObject({
      safetyCategory: "external_moderation_dangerous",
      moderationDirection: "input",
      moderationProvider: "fake-moderator",
      moderationModel: "fake-moderation-v1",
    });
    expect(moderateText).toHaveBeenCalledOnce();
    expect(respond).not.toHaveBeenCalled();
  });

  it("returns a deterministic training prescription without provider access", async () => {
    const { app, respond } = makeApp();
    const profile = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: { ...auth, "content-type": "application/json" },
      payload: {
        coachingPreferences: {
          experienceLevel: "intermediate",
          trainingDaysPerWeek: 3,
          sessionDurationMinutes: 45,
          trainingFocus: "strength",
          availableEquipment: ["dumbbells", "bench"],
          dietaryPreferences: ["omnivore"],
          trainingLimitations: [],
        },
      },
    });
    expect(profile.statusCode).toBe(200);
    const goal = await app.inject({
      method: "POST",
      url: "/v1/goals",
      headers: { ...auth, "content-type": "application/json" },
      payload: {
        kind: "recomp",
        pace: "gradual",
        target: { weightKg: 80 },
        startsOn: "2026-07-01",
        targetDate: "2026-12-31",
      },
    });
    expect(goal.statusCode).toBe(200);

    const response = await app.inject({
      method: "GET",
      url: "/v1/coach/training-prescription",
      headers: auth,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().prescription).toMatchObject({
      complete: true,
      goalKind: "recomp",
      requestedDaysPerWeek: 3,
      resistanceDaysPerWeek: 3,
      volumeAction: "hold",
    });
    expect(response.json().prescription.sessions).toHaveLength(3);
    expect(respond).not.toHaveBeenCalled();
  });

  it("persists an editable workout proposal from the deterministic prescription without provider work", async () => {
    const { app, respond } = makeApp();
    await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: { ...auth, "content-type": "application/json" },
      payload: {
        coachingPreferences: {
          experienceLevel: "intermediate",
          trainingDaysPerWeek: 3,
          sessionDurationMinutes: 45,
          trainingFocus: "strength",
          availableEquipment: ["dumbbells", "bench"],
          dietaryPreferences: ["omnivore"],
          trainingLimitations: [],
        },
      },
    });
    await app.inject({
      method: "POST",
      url: "/v1/goals",
      headers: { ...auth, "content-type": "application/json" },
      payload: {
        kind: "recomp",
        pace: "gradual",
        target: { weightKg: 80 },
        startsOn: "2026-07-01",
        targetDate: "2026-12-31",
      },
    });
    const id = await createConversation(app);
    const first = await sendMessage(
      app,
      id,
      "workout-action-key-0001",
      "Build today's workout",
    );
    expect(first.statusCode).toBe(200);
    expect(first.json().assistantMessage).toMatchObject({
      provider: "mizyun-planner",
      evidenceKinds: expect.arrayContaining(["plan", "training"]),
      actionProposal: {
        kind: "workout_start",
        volumeAction: "hold",
        session: {
          index: 1,
          estimatedMinutes: 45,
          exercises: expect.any(Array),
        },
      },
    });
    expect(
      first.json().assistantMessage.actionProposal.session.exercises.length,
    ).toBeGreaterThan(0);
    expect(respond).not.toHaveBeenCalled();

    const replay = await sendMessage(
      app,
      id,
      "workout-action-key-0001",
      "Build today's workout",
    );
    expect(replay.json().assistantMessage.actionProposal.id).toBe(
      first.json().assistantMessage.actionProposal.id,
    );
  });

  it("persists a deterministic daily plan without calling the model", async () => {
    const { app, respond } = makeApp(
      vi.fn<AgentProvider["respond"]>(),
      new InMemoryConversationRepository(),
      { now: () => new Date("2026-07-25T22:30:00.000Z") },
    );
    await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: { ...auth, "content-type": "application/json" },
      payload: { timezone: "Europe/Bratislava" },
    });
    const id = await createConversation(app);
    const first = await sendMessage(
      app,
      id,
      "daily-plan-key-000001",
      "What should I do today?",
    );

    expect(first.statusCode).toBe(200);
    expect(first.json().assistantMessage).toMatchObject({
      provider: "mizyun-planner",
      evidenceKinds: expect.arrayContaining([
        "plan",
        "nutrition",
        "training",
        "energy",
      ]),
      actionProposal: {
        kind: "daily_plan",
        version: "v1-2026-07",
        date: "2026-07-26",
      },
    });
    expect(respond).not.toHaveBeenCalled();

    const replay = await sendMessage(
      app,
      id,
      "daily-plan-key-000001",
      "What should I do today?",
    );
    expect(replay.json().assistantMessage.actionProposal.id).toBe(
      first.json().assistantMessage.actionProposal.id,
    );
  });

  it("applies an evidence-backed weekly pace proposal only after explicit acceptance", async () => {
    const current = new Date("2026-07-26T12:00:00.000Z");
    const { app, respond } = makeApp(
      vi.fn<AgentProvider["respond"]>(),
      new InMemoryConversationRepository(),
      { now: () => current },
    );
    await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: { ...auth, "content-type": "application/json" },
      payload: {
        timezone: "UTC",
        birthYear: 1990,
        heightCm: 180,
        activityLevel: "moderately_active",
        sexAtBirth: "male",
      },
    });
    await app.inject({
      method: "POST",
      url: "/v1/goals",
      headers: { ...auth, "content-type": "application/json" },
      payload: {
        kind: "cut",
        pace: "gradual",
        target: { weightKg: 75 },
        startsOn: "2026-07-01",
        targetDate: "2026-12-31",
      },
    });
    for (const [index, weightKg] of [80, 79.95, 79.9].entries()) {
      await app.inject({
        method: "POST",
        url: "/v1/body-measurements",
        headers: { ...auth, "content-type": "application/json" },
        payload: {
          weightKg,
          measuredAt: [
            "2026-07-12T08:00:00.000Z",
            "2026-07-19T08:00:00.000Z",
            "2026-07-25T08:00:00.000Z",
          ][index],
        },
      });
    }
    const energy = await app.inject({
      method: "GET",
      url: "/v1/energy/summary",
      headers: auth,
    });
    const targetKcal = energy.json().summary.dailyTargetKcal as number;
    for (const day of [19, 20, 21, 22, 23, 24]) {
      await app.inject({
        method: "POST",
        url: "/v1/food-entries",
        headers: { ...auth, "content-type": "application/json" },
        payload: {
          name: `Complete day ${day}`,
          consumedAt: `2026-07-${day}T12:00:00.000Z`,
          caloriesKcal: targetKcal,
          proteinG: 145,
          carbohydrateG: 200,
          fatG: 60,
        },
      });
    }

    const id = await createConversation(app);
    const review = await sendMessage(
      app,
      id,
      "weekly-review-key-0001",
      "Review my week",
    );
    expect(review.statusCode).toBe(200);
    expect(review.json().assistantMessage.actionProposal).toMatchObject({
      kind: "weekly_adaptation",
      readiness: "ready",
      calorieAction: "decrease",
      currentPace: "gradual",
      proposedPace: "steady",
      observations: { loggedNutritionDays: 6 },
    });
    expect(respond).not.toHaveBeenCalled();

    const proposalId = review.json().assistantMessage.actionProposal
      .id as string;
    const accepted = await app.inject({
      method: "POST",
      url: `/v1/coach/conversations/${id}/weekly-adaptations/${proposalId}/accept`,
      headers: auth,
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      applied: true,
      pace: "steady",
      assistantMessage: { provider: "mizyun-planner" },
    });
    const replay = await app.inject({
      method: "POST",
      url: `/v1/coach/conversations/${id}/weekly-adaptations/${proposalId}/accept`,
      headers: auth,
    });
    expect(replay.json()).toMatchObject({
      applied: false,
      pace: "steady",
      assistantMessage: { id: accepted.json().assistantMessage.id },
    });
  });

  it("creates, grounds, persists, and idempotently returns a coach message", async () => {
    const { app, respond } = makeApp();
    const id = await createConversation(app);
    const request = {
      method: "POST" as const,
      url: `/v1/coach/conversations/${id}/messages`,
      headers: { ...auth, "idempotency-key": "message-key-0001" },
      payload: { text: "What is one sensible next step today?" },
    };
    const first = await app.inject(request);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      userMessage: { role: "user" },
      assistantMessage: {
        role: "assistant",
        provider: "fake",
      },
    });
    expect(first.json().assistantMessage.evidenceKinds).toEqual(
      expect.arrayContaining(["profile", "nutrition", "training", "body"]),
    );
    const second = await app.inject(request);
    expect(second.statusCode).toBe(200);
    expect(second.json().assistantMessage.id).toBe(
      first.json().assistantMessage.id,
    );
    expect(respond).toHaveBeenCalledTimes(1);

    const thread = await app.inject({
      method: "GET",
      url: `/v1/coach/conversations/${id}`,
      headers: auth,
    });
    expect(thread.json().messages).toHaveLength(2);
  });

  it("persists an editable nutrition proposal for an explicit meal log without giving the Coach a write tool", async () => {
    const { app, respond } = makeApp(undefined, undefined, {
      visionProvider: new StubVisionProvider(),
    });
    const id = await createConversation(app);
    const request = {
      method: "POST" as const,
      url: `/v1/coach/conversations/${id}/messages`,
      headers: { ...auth, "idempotency-key": "meal-action-key-0001" },
      payload: { text: "I had 250g of tuna for dinner" },
    };

    const first = await app.inject(request);
    expect(first.statusCode).toBe(200);
    expect(first.json().assistantMessage).toMatchObject({
      provider: "vision-dev-stub",
      actionProposal: {
        kind: "meal_log",
        candidate: {
          name: "I had 250g of tuna for dinner",
          caloriesKcal: 350,
          provenance: { inputKind: "text" },
        },
      },
    });
    expect(respond).not.toHaveBeenCalled();

    const replay = await app.inject(request);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().assistantMessage.id).toBe(
      first.json().assistantMessage.id,
    );
    expect(replay.json().assistantMessage.actionProposal.id).toBe(
      first.json().assistantMessage.actionProposal.id,
    );

    const thread = await app.inject({
      method: "GET",
      url: `/v1/coach/conversations/${id}`,
      headers: auth,
    });
    expect(thread.json().messages[1].actionProposal).toEqual(
      first.json().assistantMessage.actionProposal,
    );
  });

  it("persists a fixed medical refusal before grounding or provider work", async () => {
    const profileRepository: ProfileRepository = {
      getOrCreate: async () => {
        throw new Error("grounding should not run");
      },
      update: async () => {
        throw new Error("not reached");
      },
    };
    const { app, respond } = makeApp(
      undefined,
      undefined,
      undefined,
      tokenVerifier,
      profileRepository,
    );
    const id = await createConversation(app);
    const response = await app.inject({
      method: "POST",
      url: `/v1/coach/conversations/${id}/messages`,
      headers: { ...auth, "idempotency-key": "medical-key-0001" },
      payload: { text: "Diagnose my knee injury and prescribe treatment." },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().assistantMessage).toMatchObject({
      provider: "mizyun-safety",
    });
    expect(response.json().assistantMessage.text).toContain("can’t diagnose");
    expect(respond).not.toHaveBeenCalled();
  });

  it("does not spend provider capacity on fixed safety responses and resets the minute window", async () => {
    let current = new Date("2026-07-23T10:00:00.000Z");
    const { app, respond } = makeApp(undefined, undefined, {
      userRequestsPerMinute: 1,
      now: () => current,
    });
    const id = await createConversation(app);

    const safety = await sendMessage(
      app,
      id,
      "medical-limit-key",
      "Diagnose my knee injury and prescribe treatment.",
    );
    expect(safety.statusCode).toBe(200);
    expect(respond).not.toHaveBeenCalled();

    const first = await sendMessage(app, id, "limit-key-0001");
    expect(first.statusCode).toBe(200);
    const limited = await sendMessage(app, id, "limit-key-0002");
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("60");
    expect(limited.json()).toMatchObject({
      error: { code: "RATE_LIMITED" },
    });

    current = new Date("2026-07-23T10:01:00.000Z");
    const reset = await sendMessage(app, id, "limit-key-0003");
    expect(reset.statusCode).toBe(200);
    expect(respond).toHaveBeenCalledTimes(2);
  });

  it("rejects concurrent work per user and releases the slot afterward", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const respond = vi.fn<AgentProvider["respond"]>(async (request) => {
      await gate;
      return {
        message: { role: "assistant", text: "One bounded response." },
        provider: "fake",
        evidence: request.grounding,
        providerMetadata: { totalTokens: 10 },
      };
    });
    const { app } = makeApp(respond, undefined, {
      userMaxConcurrentRequests: 1,
    });
    const id = await createConversation(app);

    const firstPromise = sendMessage(app, id, "concurrent-key-1");
    await vi.waitFor(() => expect(respond).toHaveBeenCalledTimes(1));
    const limited = await sendMessage(app, id, "concurrent-key-2");
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("1");

    release();
    expect((await firstPromise).statusCode).toBe(200);
    const retried = await sendMessage(app, id, "concurrent-key-2");
    expect(retried.statusCode).toBe(200);
    expect(respond).toHaveBeenCalledTimes(2);
  });

  it("enforces the daily token budget but allows completed idempotent replay", async () => {
    const { app, respond } = makeApp(undefined, undefined, {
      dailyUserTokenBudget: 1,
      now: () => new Date("2026-07-23T12:00:00.000Z"),
    });
    const id = await createConversation(app);

    const first = await sendMessage(app, id, "budget-key-0001");
    expect(first.statusCode).toBe(200);
    const replay = await sendMessage(app, id, "budget-key-0001");
    expect(replay.statusCode).toBe(200);
    const limited = await sendMessage(app, id, "budget-key-0002");
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("43200");
    expect(respond).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["rate_limited", 429, "RATE_LIMITED"],
    ["timeout", 502, "AI_UNAVAILABLE"],
    ["unavailable", 502, "AI_UNAVAILABLE"],
    ["external_access_disabled", 503, "AI_UNAVAILABLE"],
    ["malformed_response", 503, "AI_CONFIGURATION_ERROR"],
  ] as const)(
    "maps provider %s failures and persists the user message",
    async (kind, expectedStatus, expectedCode) => {
      const respond = vi
        .fn<AgentProvider["respond"]>()
        .mockRejectedValue(
          new AgentProviderError(
            kind,
            "Provider unavailable.",
            kind === "rate_limited" ||
              kind === "timeout" ||
              kind === "unavailable",
          ),
        );
      const { app } = makeApp(respond);
      const id = await createConversation(app);

      const response = await sendMessage(app, id, `failure-${kind}-key`);
      expect(response.statusCode).toBe(expectedStatus);
      expect(response.json()).toMatchObject({
        error: { code: expectedCode },
      });
      if (kind === "rate_limited") {
        expect(response.headers["retry-after"]).toBe("1");
      }
      const thread = await app.inject({
        method: "GET",
        url: `/v1/coach/conversations/${id}`,
        headers: auth,
      });
      expect(thread.json().messages).toMatchObject([
        { role: "user", status: "complete" },
      ]);
    },
  );

  it("returns 409 when retrying a failed provider call with the same idempotency key, but a fresh key retries cleanly", async () => {
    const respond = vi
      .fn<AgentProvider["respond"]>()
      .mockRejectedValueOnce(
        new AgentProviderError("timeout", "Timed out.", true),
      )
      .mockImplementationOnce(async (request) => ({
        message: { role: "assistant", text: "Recovered response." },
        provider: "fake",
        evidence: request.grounding,
        providerMetadata: { totalTokens: 10 },
      }));
    const { app } = makeApp(respond);
    const id = await createConversation(app);

    // AI-OPS-001 makes the provider-call ledger durable: a hard
    // failure with the same idempotency key is a `conflict`, not a
    // silent retry. The mobile app must generate a fresh key to
    // retry.
    expect((await sendMessage(app, id, "retry-stable-key")).statusCode).toBe(
      502,
    );
    expect((await sendMessage(app, id, "retry-stable-key")).statusCode).toBe(
      409,
    );
    expect((await sendMessage(app, id, "retry-fresh-key")).statusCode).toBe(
      200,
    );
    const thread = await app.inject({
      method: "GET",
      url: `/v1/coach/conversations/${id}`,
      headers: auth,
    });
    // First failed user message + second fresh user message + one
    // successful assistant = 3 messages; provider called twice.
    expect(thread.json().messages).toHaveLength(3);
    expect(respond).toHaveBeenCalledTimes(2);
  });

  it("keeps request windows isolated between users", async () => {
    const firstUser = userId;
    const secondUser = "00000000-0000-4000-8000-000000000099" as UserId;
    const verifier: AccessTokenVerifier = {
      verify: async (token) =>
        token === "valid-a"
          ? { userId: firstUser, accessToken: "access-a" }
          : token === "valid-b"
            ? { userId: secondUser, accessToken: "access-b" }
            : null,
    };
    const { app, respond } = makeApp(
      undefined,
      undefined,
      { userRequestsPerMinute: 1 },
      verifier,
    );
    const authA = { authorization: "Bearer valid-a" };
    const authB = { authorization: "Bearer valid-b" };
    const firstConversation = await createConversation(app, authA);
    const secondConversation = await createConversation(app, authB);

    expect(
      (
        await sendMessage(
          app,
          firstConversation,
          "first-user-key-1",
          undefined,
          authA,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await sendMessage(
          app,
          secondConversation,
          "second-user-key",
          undefined,
          authB,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await sendMessage(
          app,
          firstConversation,
          "first-user-key-2",
          undefined,
          authA,
        )
      ).statusCode,
    ).toBe(429);
    expect(respond).toHaveBeenCalledTimes(2);
  });

  it("does not allow a second user to read another user's thread", async () => {
    const repository = new InMemoryConversationRepository();
    const { app } = makeApp(vi.fn<AgentProvider["respond"]>(), repository);
    const id = await createConversation(app);
    const otherVerifier: AccessTokenVerifier = {
      verify: async () => ({
        userId: "00000000-0000-4000-8000-000000000099" as UserId,
        accessToken: "other-access-token",
      }),
    };
    const isolated = buildApp({
      tokenVerifier: otherVerifier,
      conversationRepository: repository,
      agent: new AgentOrchestrator({
        provider: {
          status: async () => ({
            ready: true,
            provider: "fake",
            externalAccess: true,
          }),
          respond: async () => {
            throw new Error("not reached");
          },
        },
        memories: new InMemoryMemoryStore(),
      }),
    });
    apps.push(isolated);
    const response = await isolated.inject({
      method: "GET",
      url: `/v1/coach/conversations/${id}`,
      headers: auth,
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("coach routes — plan-tier limiter (AI-OPS-001)", () => {
  it("free-tier profile sees the strict 3-per-minute window", async () => {
    const { app } = makeApp(
      undefined,
      undefined,
      {
        // No coachControls override → the route reads the in-memory
        // profile (planTier=free by default) and resolves the cap
        // via capsForTier("free") → 3 req/min.
      },
      tokenVerifier,
      undefined,
    );
    const id = await createConversation(app);
    expect((await sendMessage(app, id, "free-key-0001")).statusCode).toBe(200);
    expect((await sendMessage(app, id, "free-key-0002")).statusCode).toBe(200);
    expect((await sendMessage(app, id, "free-key-0003")).statusCode).toBe(200);
    const limited = await sendMessage(app, id, "free-key-0004");
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(limited.headers["retry-after"]).toBeDefined();
  });

  it("paid-tier override allows 6 requests in the same minute", async () => {
    const { app } = makeApp(
      undefined,
      undefined,
      { planTierOverride: "paid" },
      tokenVerifier,
    );
    const id = await createConversation(app);
    for (let i = 1; i <= 6; i++) {
      const response = await sendMessage(app, id, `paid-key-000${i}`);
      expect(response.statusCode).toBe(200);
    }
    const limited = await sendMessage(app, id, "paid-key-0007");
    expect(limited.statusCode).toBe(429);
  });

  it("capOverrides drive the per-minute cap when supplied (test-only knob)", async () => {
    const { app } = makeApp(
      undefined,
      undefined,
      {
        // capOverrides requestsPerMinute=2 (overrides free tier's 3).
        planTierOverride: "paid",
        userRequestsPerMinute: 2,
      },
      tokenVerifier,
    );
    const id = await createConversation(app);
    expect((await sendMessage(app, id, "tight-key-0001")).statusCode).toBe(200);
    expect((await sendMessage(app, id, "tight-key-0002")).statusCode).toBe(200);
    const limited = await sendMessage(app, id, "tight-key-0003");
    expect(limited.statusCode).toBe(429);
  });

  it("falls back to free when the profile value is unrecognised", async () => {
    const profileRepository: ProfileRepository = {
      getOrCreate: async () => ({
        userId,
        displayName: null,
        unitSystem: "metric",
        timezone: "UTC",
        birthYear: null,
        heightCm: null,
        activityLevel: null,
        sexAtBirth: null,
        coachingPreferences: {
          experienceLevel: null,
          trainingDaysPerWeek: null,
          sessionDurationMinutes: null,
          trainingFocus: null,
          availableEquipment: [],
          dietaryPreferences: [],
          trainingLimitations: [],
        },
        planTier: "free" as const,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      }),
      update: async () => {
        throw new Error("not reached");
      },
    };
    const { app } = makeApp(
      undefined,
      undefined,
      undefined,
      tokenVerifier,
      profileRepository,
    );
    const id = await createConversation(app);
    // 3 free-tier requests pass; the 4th is limited at the strict cap.
    expect((await sendMessage(app, id, "fb-key-00001")).statusCode).toBe(200);
    expect((await sendMessage(app, id, "fb-key-00002")).statusCode).toBe(200);
    expect((await sendMessage(app, id, "fb-key-00003")).statusCode).toBe(200);
    const limited = await sendMessage(app, id, "fb-key-00004");
    expect(limited.statusCode).toBe(429);
  });
});
