import { afterEach, describe, expect, it } from "vitest";

import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import type { UserFeedback, UserId } from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";
import { InMemoryMemoryStore } from "@mizyun/memory";

import { buildApp } from "../../app.js";
import { InMemoryFeedbackRepository } from "../../feedback-repository.js";

const userA: UserId = "00000000-0000-4000-8000-000000000001" as UserId;
const userB: UserId = "00000000-0000-4000-8000-000000000002" as UserId;

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const tokenVerifierFor = (
  principal: { readonly userId: UserId } | null,
): AccessTokenVerifier => ({
  verify: async (token) =>
    token === "valid"
      ? {
          userId: principal!.userId,
          role: "authenticated",
          accessToken: "test-token",
        }
      : null,
});

const build = (verifier: AccessTokenVerifier) => {
  const feedbackRepository = new InMemoryFeedbackRepository();
  const app = buildApp({
    tokenVerifier: verifier,
    agent: new AgentOrchestrator({
      provider: new DisabledAgentProvider(),
      memories: new InMemoryMemoryStore(),
    }),
    feedbackRepository,
  });
  apps.push(app);
  return { app, feedbackRepository };
};

const seedFeedback = (
  repo: InMemoryFeedbackRepository,
  overrides: Partial<UserFeedback> = {},
): UserFeedback => {
  const item: UserFeedback = {
    id: "00000000-0000-4000-8000-00000000f001",
    userId: userA,
    category: "like",
    rating: 5,
    message: "Great work on the app!",
    context: { platform: "ios" },
    createdAt: new Date("2026-08-24T10:00:00Z"),
    ...overrides,
  };
  repo.__seedForTest(item);
  return item;
};

describe("POST /v1/feedback", () => {
  it("creates a feedback submission with 201 Created", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        category: "like",
        rating: 5,
        message: "The meal logging is so fast!",
        context: { platform: "ios", version: "1.0.0" },
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.feedback.userId).toBe(userA);
    expect(body.feedback.category).toBe("like");
    expect(body.feedback.rating).toBe(5);
    expect(body.feedback.message).toBe("The meal logging is so fast!");
    expect(body.feedback.context).toEqual({
      platform: "ios",
      version: "1.0.0",
    });
  });

  it("creates feedback without rating", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        category: "change",
        message: "Please add a rest timer during workouts.",
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.feedback.rating).toBeNull();
    expect(body.feedback.category).toBe("change");
  });

  it("returns 401 without bearer token", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: { "content-type": "application/json" },
      payload: {
        category: "bug",
        message: "Button did not respond",
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it("returns 422 for invalid category", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        category: "not_a_category",
        message: "Test message",
      },
    });
    expect(response.statusCode).toBe(422);
  });

  it("returns 422 for empty message", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        category: "general",
        message: "   ",
      },
    });
    expect(response.statusCode).toBe(422);
  });

  it("returns 422 for out-of-bounds rating", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        category: "dislike",
        rating: 6,
        message: "Too high rating",
      },
    });
    expect(response.statusCode).toBe(422);
  });
});

describe("GET /v1/feedback", () => {
  it("returns empty list for fresh user", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/feedback",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ feedback: [] });
  });

  it("returns 401 without bearer token", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/feedback",
    });
    expect(response.statusCode).toBe(401);
  });

  it("returns user's feedback ordered newest-first", async () => {
    const { app, feedbackRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedFeedback(feedbackRepository, {
      id: "00000000-0000-4000-8000-00000000f001",
      createdAt: new Date("2026-08-20T10:00:00Z"),
      message: "First feedback",
    });
    seedFeedback(feedbackRepository, {
      id: "00000000-0000-4000-8000-00000000f002",
      createdAt: new Date("2026-08-22T10:00:00Z"),
      message: "Second feedback",
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/feedback",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.feedback).toHaveLength(2);
    expect(body.feedback[0].id).toBe("00000000-0000-4000-8000-00000000f002");
    expect(body.feedback[1].id).toBe("00000000-0000-4000-8000-00000000f001");
  });

  it("never returns another user's feedback", async () => {
    const { app, feedbackRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedFeedback(feedbackRepository, { userId: userA });

    const { app: appB } = build(tokenVerifierFor({ userId: userB }));
    const response = await appB.inject({
      method: "GET",
      url: "/v1/feedback",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ feedback: [] });
  });
});
