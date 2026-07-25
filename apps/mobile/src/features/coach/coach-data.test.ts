import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import { err, ok } from "@mizyun/core";

import {
  isCoachPendingDraft,
  loadCoachWith,
  previewFor,
  relativeLabel,
  sendCoachMessageWith,
} from "./coach-data";

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

  it("validates the retry-stable pending draft shape", () => {
    expect(
      isCoachPendingDraft({
        conversationId: conversation.id,
        text: "How am I doing?",
        idempotencyKey: "stable-message-key",
      }),
    ).toBe(true);
    expect(
      isCoachPendingDraft({
        conversationId: conversation.id,
        text: "How am I doing?",
      }),
    ).toBe(false);
  });

  it("uses generic recovery copy for any 429 source", async () => {
    const client: ApiClient = {
      request: vi.fn(async () =>
        err({
          kind: "http_error" as const,
          status: 429,
          code: "RATE_LIMITED",
          message: "Try later.",
        }),
      ) as unknown as ApiClient["request"],
      status: () => ({ configured: true, baseUrl: "http://api.test" }),
    };

    const result = await sendCoachMessageWith(
      client,
      conversation.id,
      "How am I doing?",
      "stable-message-key",
    );

    expect(result).toEqual({
      ok: false,
      message:
        "Coach is busy or an AI limit was reached. Wait briefly and try again.",
    });
  });

  it("does not present configuration failures as retryable", async () => {
    const client: ApiClient = {
      request: vi.fn(async () =>
        err({
          kind: "http_error" as const,
          status: 503,
          code: "AI_CONFIGURATION_ERROR",
          message: "Provider configuration failed.",
        }),
      ) as unknown as ApiClient["request"],
      status: () => ({ configured: true, baseUrl: "http://api.test" }),
    };

    const result = await sendCoachMessageWith(
      client,
      conversation.id,
      "How am I doing?",
      "stable-message-key",
    );

    expect(result).toEqual({
      ok: false,
      message:
        "Coach needs server attention before this message can be retried.",
    });
  });
});

// =========================================================================
// AI-MOB-002 — preview + relative-time helpers.
// =========================================================================

describe("previewFor", () => {
  it("returns the conversation title when no messages are present", () => {
    expect(previewFor({ ...conversation, title: "Check-in" }, [])).toBe(
      "Check-in",
    );
  });

  it("returns the latest assistant message when present", () => {
    expect(
      previewFor(conversation, [
        userMessage,
        { ...assistantMessage, text: "Latest assistant reply." },
      ]),
    ).toBe("Latest assistant reply.");
  });

  it("truncates messages longer than the preview window with an ellipsis", () => {
    const long = "x".repeat(400);
    const preview = previewFor(conversation, [
      { ...assistantMessage, text: long },
    ]);
    expect(preview.length).toBeLessThanOrEqual(280);
    expect(preview.endsWith("…")).toBe(true);
  });
});

describe("relativeLabel", () => {
  const now = new Date("2026-07-25T12:00:00.000Z");
  it("returns 'just now' for timestamps within a minute", () => {
    expect(relativeLabel("2026-07-25T11:59:30.000Z", now)).toBe("just now");
  });
  it("returns Nm ago for minutes", () => {
    expect(relativeLabel("2026-07-25T11:55:00.000Z", now)).toBe("5m ago");
  });
  it("returns Nh ago for hours", () => {
    expect(relativeLabel("2026-07-25T09:00:00.000Z", now)).toBe("3h ago");
  });
  it("returns Nd ago for days", () => {
    expect(relativeLabel("2026-07-23T12:00:00.000Z", now)).toBe("2d ago");
  });
  it("returns the ISO date for older timestamps", () => {
    expect(relativeLabel("2026-07-01T12:00:00.000Z", now)).toBe("2026-07-01");
  });
});
