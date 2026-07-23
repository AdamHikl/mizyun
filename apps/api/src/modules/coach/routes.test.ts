import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentOrchestrator, type AgentProvider } from "@mizyun/agent-runtime";
import type { UserId } from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";
import { InMemoryMemoryStore } from "@mizyun/memory";

import { buildApp } from "../../app.js";
import { InMemoryConversationRepository } from "../../conversation-repository.js";

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
) => {
  respond.mockImplementation(async (request) => ({
    message: {
      role: "assistant",
      text: "Your confirmed records support one conservative next step.",
    },
    provider: "fake",
    evidence: request.grounding,
    providerMetadata: { totalTokens: 42, resolvedModel: "fake-v1" },
  }));
  const provider: AgentProvider = {
    status: async () => ({
      ready: true,
      provider: "fake",
      externalAccess: true,
    }),
    respond,
  };
  const app = buildApp({
    tokenVerifier,
    conversationRepository,
    agent: new AgentOrchestrator({
      provider,
      memories: new InMemoryMemoryStore(),
    }),
  });
  apps.push(app);
  return { app, respond };
};

const createConversation = async (app: ReturnType<typeof buildApp>) => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/coach/conversations",
    headers: auth,
    payload: { title: "Daily check-in" },
  });
  expect(response.statusCode).toBe(201);
  return response.json().conversation.id as string;
};

describe("coach routes", () => {
  it("requires authentication for private conversations", async () => {
    const { app } = makeApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/coach/conversations",
    });
    expect(response.statusCode).toBe(401);
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

  it("persists a fixed medical refusal without calling the provider", async () => {
    const { app, respond } = makeApp();
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
