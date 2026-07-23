import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import { ok } from "@mizyun/core";

import { loadCoachWith, sendCoachMessageWith } from "./coach-data";

const conversation = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Check-in",
  status: "active" as const,
  createdAt: "2026-07-23T10:00:00.000Z",
  updatedAt: "2026-07-23T10:00:00.000Z",
};
const userMessage = {
  id: "00000000-0000-4000-8000-000000000002",
  conversationId: conversation.id,
  role: "user" as const,
  text: "How am I doing?",
  status: "complete" as const,
  provider: null,
  evidenceKinds: [],
  createdAt: "2026-07-23T10:01:00.000Z",
};
const assistantMessage = {
  ...userMessage,
  id: "00000000-0000-4000-8000-000000000003",
  role: "assistant" as const,
  text: "One conservative next step.",
  provider: "mistral",
  evidenceKinds: ["nutrition" as const],
  createdAt: "2026-07-23T10:01:02.000Z",
};

describe("coach data boundary", () => {
  it("does not request private conversations when AI access is disabled", async () => {
    const request = vi.fn(async () =>
      ok({
        ready: false as const,
        provider: "mistral",
        model: "mistral-medium-latest",
        externalAccess: false as const,
        reason: "External access is disabled.",
      }),
    );
    const client: ApiClient = {
      request: request as unknown as ApiClient["request"],
      status: () => ({ configured: true, baseUrl: "http://api.test" }),
    };
    const result = await loadCoachWith(client);
    expect(result).toMatchObject({
      ok: true,
      conversations: [],
      status: { ready: false },
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("sends a retry-stable idempotency key and validates the response", async () => {
    const request = vi.fn(async () =>
      ok({ conversation, userMessage, assistantMessage }),
    );
    const client: ApiClient = {
      request: request as unknown as ApiClient["request"],
      status: () => ({ configured: true, baseUrl: "http://api.test" }),
    };
    const result = await sendCoachMessageWith(
      client,
      conversation.id,
      "How am I doing?",
      "stable-message-key",
    );
    expect(result).toMatchObject({ ok: true });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { "idempotency-key": "stable-message-key" },
      }),
    );
  });
});
