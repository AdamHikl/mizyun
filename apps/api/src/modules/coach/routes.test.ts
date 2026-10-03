import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentOrchestrator,
  AgentProviderError,
  AgentToolBudgetExceededError,
  StubVisionProvider,
  type AgentGroundingItem,
  type AgentProvider,
  type ContentModerator,
  type VisionDraftProvider,
} from "@mizyun/agent-runtime";
import {
  DEFAULT_TIMEZONE,
  DEFAULT_UNIT_SYSTEM,
  type ConversationId,
  type PlanTier,
  type ProfileRepository,
  type UserId,
  type WorkoutRepository,
} from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";
import { InMemoryMemoryStore } from "@mizyun/memory";

import { buildApp } from "../../app.js";
import { InMemoryConversationRepository } from "../../conversation-repository.js";
import { InMemoryGoalRepository } from "../../goal-repository.js";
import { InMemoryProfileRepository } from "../../profile-repository.js";
import { InMemoryWorkoutRepository } from "../../workout-repository.js";
import { InMemoryWorkoutSetRepository } from "../../workout-set-repository.js";
import { InMemoryFoodEntryRepository } from "../../food-entry-repository.js";
import { InMemoryBodyMeasurementRepository } from "../../body-measurement-repository.js";
import { buildCoachToolRegistry } from "./tools.js";
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
    readonly capOverrides?: {
      readonly minuteCapForTier?: (tier: PlanTier) => number;
    };
  },
  verifier = tokenVerifier,
  profileRepository?: ProfileRepository,
  workoutRepository?: WorkoutRepository,
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
  const resolvedProfileRepo =
    profileRepository ??
    new InMemoryProfileRepository({
      defaultTimezone: DEFAULT_TIMEZONE,
      defaultUnitSystem: DEFAULT_UNIT_SYSTEM,
      defaultBirthYear: 1990,
      clock: { now: () => new Date() },
    });
  const resolvedWorkoutRepo =
    workoutRepository ?? new InMemoryWorkoutRepository();
  const tools = buildCoachToolRegistry({
    profileRepository: resolvedProfileRepo,
    goalRepository: new InMemoryGoalRepository(),
    workoutRepository: resolvedWorkoutRepo,
    workoutSetRepository: new InMemoryWorkoutSetRepository(),
    foodEntryRepository: new InMemoryFoodEntryRepository(),
    bodyMeasurementRepository: new InMemoryBodyMeasurementRepository(),
  });
  const app = buildApp({
    tokenVerifier: verifier,
    conversationRepository,
    profileRepository: resolvedProfileRepo,
    workoutRepository: resolvedWorkoutRepo,
    ...(coachControls ? { coachControls } : {}),
    agent: new AgentOrchestrator({
      provider,
      memories: new InMemoryMemoryStore(),
      tools,
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
      provider: "fake",
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
    expect(respond).toHaveBeenCalled();

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

  it("persists a multi-session plan from the deterministic prescription when the user asks for a multi-day split", async () => {
    const { app, respond } = makeApp(
      vi.fn<AgentProvider["respond"]>(),
      new InMemoryConversationRepository(),
      { now: () => new Date("2026-07-25T22:30:00.000Z") },
    );
    const profile = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: { ...auth, "content-type": "application/json" },
      payload: {
        coachingPreferences: {
          experienceLevel: "intermediate",
          trainingDaysPerWeek: 3,
          sessionDurationMinutes: 60,
          trainingFocus: "hypertrophy",
          availableEquipment: ["dumbbells", "bench", "barbell", "rack"],
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

    const id = await createConversation(app);
    const response = await sendMessage(
      app,
      id,
      "multi-workout-action-key-0001",
      "Help me create a 3 day gym plan to build a V-shape with each session about 2 hours long",
    );
    expect(response.statusCode).toBe(200);
    expect(respond).toHaveBeenCalled();
    const proposal = response.json().assistantMessage.actionProposal;
    expect(proposal).toMatchObject({
      kind: "multi_workout_plan",
      volumeAction: expect.stringMatching(/^(build|hold|reduce)$/),
      requestedSessions: 3,
      sessionMinutes: 120,
      sessions: expect.any(Array),
    });
    expect(proposal.sessions).toHaveLength(3);
    expect(proposal.sessions[0]).toMatchObject({
      index: expect.any(Number),
      label: expect.any(String),
      estimatedMinutes: expect.any(Number),
      targetDay: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      exercises: expect.any(Array),
    });
    expect(proposal.sessions[0].exercises.length).toBeGreaterThan(0);
    // The auto-schedule lands each session on a distinct day within
    // the next 7 days.
    const days = new Set(
      proposal.sessions.map((s: { targetDay: string }) => s.targetDay),
    );
    expect(days.size).toBe(3);
  });

  it("sanitizes assistant text when provider returns raw workout plan JSON", async () => {
    const rawJsonText = JSON.stringify({
      response: {
        workout_plan: {
          focus: "hypertrophy",
          goal: "V-shape (upper body emphasis with back and shoulder development)",
          equipment: ["dumbbells", "barbell", "cable_machine"],
          session_duration_minutes: 150,
          sessions: [{ day: "Upper Body 1" }],
        },
      },
    });
    const { app, respond } = makeApp(
      vi.fn<AgentProvider["respond"]>().mockImplementation(async (request) => ({
        message: { role: "assistant", text: rawJsonText },
        provider: "gemini",
        evidence: request.grounding,
        providerMetadata: {
          totalTokens: 42,
          resolvedModel: "gemini-3.7-flash",
        },
      })),
    );
    const id = await createConversation(app);
    const response = await sendMessage(
      app,
      id,
      "raw-json-sanitize-test-key",
      "Can you help me create a 3 day split workout. I want two upper body and one lower body day. I want to target a V shape.",
    );
    expect(response.statusCode).toBe(200);
    const assistantMessage = response.json().assistantMessage;
    expect(assistantMessage.text).not.toContain('{"response":');
    expect(assistantMessage.text).not.toContain('"workout_plan":');
    expect(assistantMessage.text).toContain("V-shape");
  });

  it.each([
    '{answer: "Keep logging your meals."}',
    '{"answer":"Keep logging your meals.',
    JSON.stringify({ answer: "Keep logging your meals." }),
  ])(
    "normalizes historical assistant text on read and replay: %s",
    async (rawText) => {
      const repository = new InMemoryConversationRepository();
      const { app, respond } = makeApp(undefined, repository);
      const id = await createConversation(app);
      const conversationId = id as ConversationId;
      const options = { accessToken: "test-access-token", now: new Date() };
      const userText = '{answer: "How do I log a meal?"}';
      const userMessage = await repository.addMessage(
        userId,
        {
          id: crypto.randomUUID(),
          conversationId,
          role: "user",
          text: userText,
          status: "complete",
          idempotencyKey: "historical-response-key",
        },
        options,
      );
      const assistant = await repository.addMessage(
        userId,
        {
          id: crypto.randomUUID(),
          conversationId,
          role: "assistant",
          text: rawText,
          status: "complete",
          idempotencyKey: null,
          providerMetadata: { provider: "gemini", replyTo: userMessage.id },
        },
        options,
      );
      const expected =
        rawText.startsWith('{"answer":') && rawText.endsWith("}")
          ? "Keep logging your meals."
          : "I couldn't read that Coach response. Please send your message again.";
      const thread = await app.inject({
        method: "GET",
        url: `/v1/coach/conversations/${id}`,
        headers: auth,
      });
      expect(thread.statusCode).toBe(200);
      expect(thread.json().messages).toMatchObject([
        { id: userMessage.id, text: userText },
        { id: assistant.id, text: expected },
      ]);
      const replay = await sendMessage(
        app,
        id,
        "historical-response-key",
        userText,
      );
      expect(replay.statusCode).toBe(200);
      expect(replay.json().assistantMessage.text).toBe(expected);
      expect(replay.json().userMessage.text).toBe(userText);
      expect(respond).not.toHaveBeenCalled();
      const stored = await repository.listMessages(userId, conversationId, {
        ...options,
        limit: 10,
      });
      expect(stored[1]?.text).toBe(rawText);
    },
  );

  it("never persists malformed structured assistant text from a provider", async () => {
    const { app } = makeApp(
      vi.fn<AgentProvider["respond"]>().mockImplementation(async (request) => ({
        message: {
          role: "assistant",
          text: '{answer: "Keep logging your meals."}',
        },
        provider: "fake",
        evidence: request.grounding,
      })),
    );
    const id = await createConversation(app);
    const response = await sendMessage(app, id, "malformed-response-key");
    expect(response.statusCode).toBe(200);
    expect(response.json().assistantMessage.text).toBe(
      "I couldn't read that Coach response. Please send your message again.",
    );
    const thread = await app.inject({
      method: "GET",
      url: `/v1/coach/conversations/${id}`,
      headers: auth,
    });
    expect(thread.json().messages[1].text).toBe(
      response.json().assistantMessage.text,
    );
  });

  it("handles custom workout plan proposed directly by LLM via propose_workout_plan tool", async () => {
    let callCount = 0;
    const { app } = makeApp(
      vi.fn<AgentProvider["respond"]>().mockImplementation(async (request) => {
        callCount += 1;
        if (callCount === 1) {
          return {
            message: { role: "assistant", text: "" },
            provider: "gemini",
            evidence: request.grounding,
            toolCalls: [
              {
                name: "propose_workout_plan",
                args: {
                  rationale:
                    "Chest and back hypertrophy routine with specific compound and isolation exercises.",
                  sessions: [
                    {
                      label: "Chest & Shoulders",
                      focus: "push",
                      estimated_minutes: 60,
                      exercises: [
                        {
                          name: "Incline dumbbell press",
                          sets: 4,
                          reps_min: 8,
                          reps_max: 10,
                        },
                        {
                          name: "Cable crossover",
                          sets: 3,
                          reps_min: 12,
                          reps_max: 15,
                        },
                        {
                          name: "Side lateral raise",
                          sets: 4,
                          reps_min: 12,
                          reps_max: 15,
                        },
                      ],
                    },
                    {
                      label: "Back & Arms",
                      focus: "pull",
                      estimated_minutes: 60,
                      exercises: [
                        { name: "Pullups", sets: 3, reps_min: 6, reps_max: 8 },
                        {
                          name: "Hammer curls",
                          sets: 3,
                          reps_min: 10,
                          reps_max: 12,
                        },
                        {
                          name: "Triceps pushdown",
                          sets: 3,
                          reps_min: 10,
                          reps_max: 12,
                        },
                      ],
                    },
                  ],
                },
              },
            ],
            providerMetadata: {
              totalTokens: 50,
              resolvedModel: "gemini-3.7-flash",
            },
          };
        }

        return {
          message: {
            role: "assistant",
            text: "I have designed a custom 2-day Chest/Shoulders and Back/Arms routine tailored with your requested cable and dumbbell exercises. Review the plan below!",
          },
          provider: "gemini",
          evidence: request.grounding,
          providerMetadata: {
            totalTokens: 100,
            resolvedModel: "gemini-3.7-flash",
          },
        };
      }),
    );

    const id = await createConversation(app);
    const response = await sendMessage(
      app,
      id,
      "custom-llm-plan-key-001",
      "Give me a 2-day routine with incline dumbbell press, cable crossovers, and lateral raises on day 1, and pullups, hammer curls, and tricep pushdowns on day 2.",
    );

    expect(response.statusCode).toBe(200);
    const assistantMessage = response.json().assistantMessage;
    expect(assistantMessage.actionProposal).toBeDefined();
    expect(assistantMessage.actionProposal.kind).toBe("multi_workout_plan");
    expect(assistantMessage.actionProposal.sessions).toHaveLength(2);
    expect(
      assistantMessage.actionProposal.sessions[0].exercises[0].name.toLowerCase(),
    ).toContain("incline");
    expect(
      assistantMessage.actionProposal.sessions[0].exercises[0].catalogId,
    ).toBe("incline-dumbbell-press");
    expect(
      assistantMessage.actionProposal.sessions[1].exercises[1].name.toLowerCase(),
    ).toContain("curl");
    expect(
      assistantMessage.actionProposal.sessions[1].exercises[2].name.toLowerCase(),
    ).toContain("triceps");
  });

  it("persists a deterministic daily plan when requested", async () => {
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
      provider: "fake",
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
    expect(respond).toHaveBeenCalled();

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
    expect(respond).toHaveBeenCalled();

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

  it.each(["free", "paid"] as const)(
    "%s text meal proposals preserve only authorized additional nutrients",
    async (tier) => {
      const stub = new StubVisionProvider();
      let enabled: boolean | undefined;
      const extras = {
        fibreG: 3,
        saturatedFatG: 0,
        totalSugarsG: null,
        sodiumMg: 410,
        cholesterolMg: 50,
      };
      const provider: VisionDraftProvider = {
        status: () => stub.status(),
        generateDraft: (request) => stub.generateDraft(request),
        generateTextDraft: async (request) => {
          enabled = request.includeAdvancedNutrition;
          return { ...(await stub.generateTextDraft(request)), ...extras };
        },
      };
      const { app, respond } = makeApp(
        undefined,
        undefined,
        {
          visionProvider: provider,
          planTierOverride: "paid",
        },
        tokenVerifier,
        new InMemoryProfileRepository({
          defaultTimezone: "UTC",
          defaultUnitSystem: "metric",
          defaultBirthYear: 1990,
          defaultPlanTier: tier,
        }),
      );
      const id = await createConversation(app);
      const response = await app.inject({
        method: "POST",
        url: `/v1/coach/conversations/${id}/messages`,
        headers: { ...auth, "idempotency-key": "extra-nutrients-text-0001" },
        payload: { text: "I had 250g of tuna for dinner" },
      });
      expect(response.statusCode).toBe(200);
      expect(enabled).toBe(tier === "paid");
      const candidate =
        response.json().assistantMessage.actionProposal.candidate;
      if (tier === "paid") expect(candidate).toMatchObject(extras);
      else
        for (const key of Object.keys(extras))
          expect(candidate).not.toHaveProperty(key);
      expect(respond).not.toHaveBeenCalled();
      const meals = await app.inject({
        method: "GET",
        url: "/v1/food-entries",
        headers: auth,
      });
      expect(meals.json().foodEntries).toEqual([]);
    },
  );

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

  it("maps AgentToolBudgetExceededError to 503 AI_UNAVAILABLE", async () => {
    const respond = vi.fn().mockImplementationOnce(async () => {
      throw new AgentToolBudgetExceededError(3);
    });
    const { app } = makeApp(respond);
    const id = await createConversation(app);
    const response = await sendMessage(app, id, "exceeded-budget-key");
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: {
        code: "AI_UNAVAILABLE",
        message:
          "Coach took too many steps to complete that request. Try again.",
      },
    });
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
        birthYear: 1990,
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
        aiProvider: "gemini",
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

  it("attaches a workout_edit action proposal when user asks to edit or substitute an exercise in a planned workout", async () => {
    const workoutRepository: WorkoutRepository = {
      list: async () => [
        {
          id: "00000000-0000-4000-8000-000000000055",
          userId,
          source: "manual",
          name: "Full body",
          startedAt: new Date("2026-08-27T12:00:00.000Z"),
          completedAt: null,
          notes: "Coach plan",
          details: {
            coachPlan: {
              sessionIndex: 2,
              targetDay: "2026-08-27",
              exercises: [
                {
                  catalogId: "barbell-bench-press",
                  name: "Barbell bench press",
                  movementPattern: "horizontal_push",
                  sets: 3,
                  repsMin: 8,
                  repsMax: 12,
                  durationMinutes: null,
                  restSeconds: 90,
                },
              ],
            },
          },
          createdAt: new Date("2026-08-25T10:00:00.000Z"),
          updatedAt: new Date("2026-08-25T10:00:00.000Z"),
        },
      ],
      getById: async () => null,
      create: async () => {
        throw new Error("not implemented");
      },
      update: async () => {
        throw new Error("not implemented");
      },
      delete: async () => true,
    };

    const { app } = makeApp(
      undefined,
      undefined,
      undefined,
      tokenVerifier,
      undefined,
      workoutRepository,
    );

    const id = await createConversation(app);
    const response = await sendMessage(
      app,
      id,
      "workout-edit-key-0001",
      "Replace Barbell bench press with Incline dumbbell press in my Full body workout",
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().assistantMessage.actionProposal).toMatchObject({
      kind: "workout_edit",
      workoutId: "00000000-0000-4000-8000-000000000055",
      targetName: "Full body",
      exercises: [
        {
          name: "Incline dumbbell press",
          movementPattern: "horizontal_push",
        },
      ],
    });
  });

  it("blocks AI coach access with 403 AI_AGE_RESTRICTED when user is under 18", async () => {
    const profileRepo = new InMemoryProfileRepository({
      defaultTimezone: DEFAULT_TIMEZONE,
      defaultUnitSystem: DEFAULT_UNIT_SYSTEM,
    });
    const defaultProfile = await profileRepo.getOrCreate(userId, {
      now: new Date("2026-09-08T12:00:00Z"),
      accessToken: "test-token",
    });
    profileRepo.__seedForTest({
      ...defaultProfile,
      birthYear: 2012, // 2026 - 2012 = 14 (< 18)
    });

    const { app } = makeApp(
      undefined,
      undefined,
      { now: () => new Date("2026-09-08T12:00:00Z") },
      tokenVerifier,
      profileRepo,
    );

    const id = await createConversation(app);
    const response = await sendMessage(
      app,
      id,
      "age-restricted-key-1",
      "Can you give me a workout plan?",
    );
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("AI_AGE_RESTRICTED");
  });

  it("supplies saved available routines in grounding when user asks about a routine", async () => {
    let capturedGrounding: readonly AgentGroundingItem[] = [];
    const workoutRepository = new InMemoryWorkoutRepository();
    const respond = vi
      .fn<AgentProvider["respond"]>()
      .mockImplementation(async (req) => {
        capturedGrounding = req.grounding;
        return {
          message: {
            role: "assistant",
            text: "Your Push 1 routine has good exercise variety and balance.",
          },
          provider: "fake",
          evidence: req.grounding,
          providerMetadata: { totalTokens: 100, resolvedModel: "fake-v1" },
        };
      });

    const { app } = makeApp(
      respond,
      undefined,
      undefined,
      undefined,
      undefined,
      workoutRepository,
    );

    workoutRepository.__seedForTest({
      id: "w-push-1",
      userId,
      name: "Push 1",
      startedAt: new Date("2026-07-20T10:00:00.000Z"),
      completedAt: null,
      notes: null,
      source: "manual",
      details: {
        coachPlan: {
          exercises: [
            {
              name: "Standing Barbell Press Behind Neck",
              sets: 4,
              repsMin: 4,
              repsMax: 6,
              targetLoad: "50kg",
              restSeconds: 90,
              movementPattern: "vertical_push",
            },
            {
              name: "Dips - Chest Version",
              sets: 3,
              repsMin: 5,
              repsMax: 8,
              targetLoad: "25kg",
              restSeconds: 90,
              movementPattern: "horizontal_push",
            },
          ],
        },
      },
      createdAt: new Date("2026-07-20T10:00:00.000Z"),
      updatedAt: new Date("2026-07-20T10:00:00.000Z"),
    });

    const id = await createConversation(app);
    const response = await sendMessage(
      app,
      id,
      "routine-check-001",
      "what do you think about my push 1 workout routine?",
    );

    expect(response.statusCode).toBe(200);
    const trainingGrounding = capturedGrounding.find(
      (g) => g.kind === "training",
    );
    expect(trainingGrounding).toBeDefined();
    const data = trainingGrounding!.data as {
      availableRoutines: Array<{
        name: string;
        exercises: Array<{
          name: string;
          targetSets?: number;
          targetLoad?: string;
        }>;
      }>;
    };
    expect(data.availableRoutines).toHaveLength(1);
    expect(data.availableRoutines[0]?.name).toBe("Push 1");
    expect(data.availableRoutines[0]?.exercises).toHaveLength(2);
    expect(data.availableRoutines[0]?.exercises[0]?.name).toBe(
      "Standing Barbell Press Behind Neck",
    );
    expect(data.availableRoutines[0]?.exercises[0]?.targetLoad).toBe("50kg");
  });
});
