import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import { err, ok } from "@mizyun/core";

import {
  acceptWeeklyAdaptationWith,
  isCoachPendingDraft,
  mergeCoachSendResult,
  optimisticCoachMessageId,
  loadCoachWith,
  previewFor,
  relativeLabel,
  sendCoachMealPhotoWith,
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
  actionProposal: null,
  createdAt: "2026-07-23T10:01:00.000Z",
};
const assistantMessage = {
  ...userMessage,
  id: "00000000-0000-4000-8000-000000000003",
  role: "assistant" as const,
  text: "One conservative next step.",
  provider: "gemini",
  evidenceKinds: ["nutrition" as const],
  createdAt: "2026-07-23T10:01:02.000Z",
};

describe("coach data boundary", () => {
  it("loads owned conversation history when the provider is disabled without granting generation", async () => {
    const request = vi.fn(async (options: { path: string }) =>
      options.path === "/v1/coach/status"
        ? ok({
            ready: false as const,
            provider: "gemini",
            model: "gemini-3.8-flash",
            externalAccess: false as const,
            reason: "External access is disabled.",
          })
        : ok({ conversations: [conversation] }),
    );
    const client: ApiClient = {
      request: request as unknown as ApiClient["request"],
      status: () => ({ configured: true, baseUrl: "http://api.test" }),
    };
    const result = await loadCoachWith(client);
    expect(result).toMatchObject({
      ok: true,
      conversations: [conversation],
      status: { ready: false },
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("returns cached history when live provider status is offline", async () => {
    const request = vi.fn(async (options: { path: string }) =>
      options.path === "/v1/coach/status"
        ? err({ kind: "network_error" as const, message: "offline" })
        : ok({ conversations: [conversation] }),
    );
    const client: ApiClient = {
      request: request as unknown as ApiClient["request"],
      status: () => ({ configured: true, baseUrl: "http://api.test" }),
    };
    expect(await loadCoachWith(client)).toMatchObject({
      ok: true,
      status: null,
      conversations: [conversation],
      readinessMessage: expect.stringContaining("offline"),
    });
  });

  it("publishes owned history before the live readiness response settles", async () => {
    let finishStatus!: (value: unknown) => void;
    const pendingStatus = new Promise((resolve) => {
      finishStatus = resolve;
    });
    const request = vi.fn(async (options: { path: string }) =>
      options.path === "/v1/coach/status"
        ? pendingStatus
        : ok({ conversations: [conversation] }),
    );
    const client: ApiClient = {
      request: request as unknown as ApiClient["request"],
      status: () => ({ configured: true, baseUrl: "http://api.test" }),
    };
    const publish = vi.fn(async () => undefined);
    const result = loadCoachWith(client, publish);
    await vi.waitFor(() =>
      expect(publish).toHaveBeenCalledWith([conversation]),
    );
    finishStatus(ok({ ready: false, reason: "Provider disabled" }));
    expect(await result).toMatchObject({ ok: true, status: { ready: false } });
  });

  it("does not turn denied history into an empty successful chat", async () => {
    const request = vi.fn(async (options: { path: string }) =>
      options.path === "/v1/coach/status"
        ? ok({ ready: true })
        : err({
            kind: "http_error" as const,
            status: 403,
            code: "FORBIDDEN",
            message: "denied",
          }),
    );
    const client: ApiClient = {
      request: request as unknown as ApiClient["request"],
      status: () => ({ configured: true, baseUrl: "http://api.test" }),
    };
    const publish = vi.fn(async () => undefined);
    expect(await loadCoachWith(client, publish)).toMatchObject({ ok: false });
    expect(publish).not.toHaveBeenCalled();
  });
  it.each([
    { kind: "no_session" },
    { kind: "session_expired" },
    {
      kind: "http_error",
      status: 401,
      code: "UNAUTHORIZED",
      message: "denied",
    },
    { kind: "http_error", status: 403, code: "FORBIDDEN", message: "denied" },
  ])(
    "returns rejected history %j without waiting for provider status",
    async (error) => {
      const request = vi.fn((options: { path: string }) =>
        options.path === "/v1/coach/status"
          ? new Promise(() => {})
          : Promise.resolve(err(error)),
      );
      const publish = vi.fn(async () => undefined);
      let finished: any;
      void loadCoachWith({ request } as unknown as ApiClient, publish).then(
        (result) => {
          finished = result;
        },
      );
      for (let tick = 0; tick < 12; tick++) await Promise.resolve();
      expect(finished).toMatchObject({ ok: false });
      expect(publish).not.toHaveBeenCalled();
    },
  );
  it("consumes a late provider rejection after returning denied history", async () => {
    let rejectStatus!: (error: Error) => void;
    const status = new Promise((_, reject) => {
      rejectStatus = reject;
    });
    const request = vi.fn((options: { path: string }) =>
      options.path === "/v1/coach/status"
        ? status
        : Promise.resolve(err({ kind: "no_session" as const })),
    );
    expect(
      await loadCoachWith({ request } as unknown as ApiClient),
    ).toMatchObject({ ok: false });
    rejectStatus(new Error("late provider failure"));
    for (let tick = 0; tick < 4; tick++) await Promise.resolve();
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

  it("accepts a weekly adaptation through the authenticated API boundary", async () => {
    const request = vi.fn(async () =>
      ok({
        applied: true,
        pace: "steady" as const,
        assistantMessage: {
          ...assistantMessage,
          provider: "mizyun-planner",
          text: "Accepted.",
        },
      }),
    );
    const client: ApiClient = {
      request: request as unknown as ApiClient["request"],
      status: () => ({ configured: true, baseUrl: "http://api.test" }),
    };
    const result = await acceptWeeklyAdaptationWith(
      client,
      conversation.id,
      "00000000-0000-4000-8000-000000000099",
    );
    expect(result).toMatchObject({ ok: true, value: { pace: "steady" } });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: expect.stringContaining("/weekly-adaptations/"),
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

  it("derives a stable optimistic message id from the retry key", () => {
    expect(optimisticCoachMessageId("stable-message-key")).toBe(
      "optimistic-stable-message-key",
    );
  });

  it("merges a retry result without duplicating a persisted user message", () => {
    expect(
      mergeCoachSendResult([userMessage], "optimistic-stable-message-key", [
        userMessage,
        assistantMessage,
      ]),
    ).toEqual([userMessage, assistantMessage]);
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
      message: "Coach is busy — try again in a moment.",
    });
  });

  it("uses daily limit copy when daily_budget_exhausted is received", async () => {
    const client: ApiClient = {
      request: vi.fn(async () =>
        err({
          kind: "http_error" as const,
          status: 429,
          code: "RATE_LIMITED",
          message: "Daily token limit reached.",
          reason: "daily_budget_exhausted",
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
      message: "Daily Coach limit reached. Resets at midnight UTC.",
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

describe("Coach meal photo data boundary", () => {
  it("returns the persisted user and proposal messages", async () => {
    const request = vi.fn(async () =>
      ok({ conversation, userMessage, assistantMessage }),
    );
    const client: ApiClient = {
      request: vi.fn() as unknown as ApiClient["request"],
      draftCoachMealPhoto: request,
      status: () => ({ configured: true, baseUrl: "http://api.test" }),
    };
    const result = await sendCoachMealPhotoWith(
      client,
      conversation.id,
      new Blob(),
      "coach-photo-key-0001",
      [{ photo: new Blob(), mimeType: "image/png" }],
      "dinner",
    );
    expect(result).toEqual({
      ok: true,
      conversation,
      messages: [userMessage, assistantMessage],
    });
    expect(request).toHaveBeenCalledWith({
      conversationId: conversation.id,
      idempotencyKey: "coach-photo-key-0001",
      photo: expect.any(Blob),
      mimeType: "image/jpeg",
      additionalPhotos: [{ photo: expect.any(Blob), mimeType: "image/png" }],
      textHint: "dinner",
    });
  });
});

describe("synchronous owned Coach history", () => {
  const session = {
    user: { id: "owner" },
    accessToken: "token",
  } as import("@mizyun/identity").AuthSession;
  it("requires the cached selected thread and never peeks provider authority", async () => {
    const { peekCoachHistory } = await import("./coach-data");
    const read = vi.fn((options, owner) => {
      expect(owner).toBe(session);
      return options.path === "/v1/coach/conversations"
        ? { ok: true, value: { conversations: [conversation] } }
        : { ok: true, value: { conversation, messages: [assistantMessage] } };
    });
    expect(peekCoachHistory(session, read as any)).toEqual({
      conversations: [conversation],
      conversation,
      messages: [assistantMessage],
    });
    expect(read.mock.calls.map(([options]) => options.path)).toEqual([
      "/v1/coach/conversations",
      `/v1/coach/conversations/${conversation.id}`,
    ]);
  });
  it("accepts a complete cached empty list without requesting a thread", async () => {
    const { peekCoachHistory } = await import("./coach-data");
    const read = vi.fn(() => ({ ok: true, value: { conversations: [] } }));
    expect(peekCoachHistory(session, read as any)).toEqual({
      conversations: [],
      conversation: null,
      messages: [],
    });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("keeps loading when the list exists but the selected thread is missing", async () => {
    const { peekCoachHistory } = await import("./coach-data");
    const read = vi.fn((options) =>
      options.path === "/v1/coach/conversations"
        ? { ok: true, value: { conversations: [conversation] } }
        : null,
    );
    expect(peekCoachHistory(session, read as any)).toBeNull();
  });
});
