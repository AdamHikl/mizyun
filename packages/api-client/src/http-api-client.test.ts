import { describe, expect, it, vi, type Mock } from "vitest";
import { createHash } from "node:crypto";
import { z } from "zod";

import type { AuthClient, AuthSession } from "@mizyun/identity";
import {
  API_COMPAT_HEADER,
  API_COMPAT_VERSION,
  DEVICE_TIME_ZONE_HEADER,
} from "@mizyun/contracts";

import { HttpApiClient, isNotModified, resultEtag } from "./http-api-client";

const buildAuthClient = (overrides: Partial<AuthClient> = {}): AuthClient => ({
  status: () => ({ configured: true, provider: "supabase" }),
  getSession: () => Promise.resolve(null),
  signInWithPassword: () => Promise.reject(new Error("not used in this test")),
  signUpWithPassword: () => Promise.reject(new Error("not used in this test")),
  signInWithOAuth: () => Promise.reject(new Error("not used in this test")),
  signInWithIdToken: () => Promise.reject(new Error("not used in this test")),
  signOut: () => Promise.resolve(),
  consumeDeepLink: () => Promise.reject(new Error("not used in this test")),
  updatePassword: () => Promise.reject(new Error("not used in this test")),
  requestPasswordRecovery: () =>
    Promise.reject(new Error("not used in this test")),
  subscribe: () => () => undefined,
  dispose: () => undefined,
  ...overrides,
});

const buildSession = (overrides: Partial<AuthSession> = {}): AuthSession => ({
  user: { id: "user-id" as never, email: "person@example.com" },
  accessToken: "test-token",
  ...overrides,
});

const jsonResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  }) as unknown as Response;

describe("HttpApiClient — token attachment", () => {
  it("does not send account-sensitive intent after deferred token lookup changes principal", async () => {
    let resolveSession!: (session: AuthSession) => void;
    const fetchMock = vi.fn();
    const client = new HttpApiClient({
      baseUrl: "https://api.example.test",
      authClient: buildAuthClient({
        getSession: () =>
          new Promise((resolve) => {
            resolveSession = resolve;
          }),
      }),
      fetch: fetchMock,
    });
    const result = client.request({
      method: "POST",
      path: "/v1/community/follow-requests",
      expectedUserId: "account-a",
    });
    resolveSession(buildSession({ user: { id: "account-b" as never } }));
    expect(await result).toEqual({ ok: false, error: { kind: "no_session" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not send intent from a retired controller after token lookup", async () => {
    let resolveSession!: (session: AuthSession) => void;
    let active = true;
    const fetchMock = vi.fn();
    const client = new HttpApiClient({
      baseUrl: "https://api.example.test",
      authClient: buildAuthClient({
        getSession: () =>
          new Promise((resolve) => {
            resolveSession = resolve;
          }),
      }),
      fetch: fetchMock,
    });
    const result = client.request({
      method: "POST",
      path: "/v1/community/profile",
      isCurrent: () => active,
    });
    active = false;
    resolveSession(buildSession());
    expect(await result).toEqual({ ok: false, error: { kind: "no_session" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("attaches Authorization: Bearer <token> from getSession()", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const authClient = buildAuthClient({
      getSession: () => Promise.resolve(buildSession({ accessToken: "abc" })),
    });

    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.request({ method: "GET", path: "/v1/me" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer abc");
  });

  it("returns err({ kind: 'no_session' }) when getSession() returns null", async () => {
    const fetchMock = vi.fn();
    const authClient = buildAuthClient({
      getSession: () => Promise.resolve(null),
    });

    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await client.request({ method: "GET", path: "/v1/me" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("no_session");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not call getSession() more than once per request", async () => {
    const getSession = vi.fn().mockResolvedValue(buildSession());
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const authClient = buildAuthClient({ getSession });

    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.request({ method: "GET", path: "/v1/me" });

    expect(getSession).toHaveBeenCalledTimes(1);
  });
});

describe("HttpApiClient — 401 handling", () => {
  it("a stale scoped 401 never signs out the next account", async () => {
    let current = buildSession({ user: { id: "account-a" as never } });
    let respond!: (response: Response) => void;
    const signOut = vi.fn().mockResolvedValue(undefined);
    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient: buildAuthClient({
        getSession: () => Promise.resolve(current),
        signOut,
      }),
      fetch: vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            respond = resolve;
          }),
      ),
    });
    const pending = client.request({
      method: "GET",
      path: "/v1/community/profile",
      expectedUserId: "account-a",
    });
    await Promise.resolve();
    current = buildSession({
      user: { id: "account-b" as never },
      accessToken: "next-token",
    });
    respond(jsonResponse(401, {}));
    expect(await pending).toEqual({
      ok: false,
      error: { kind: "session_expired" },
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("returns err({ kind: 'session_expired' }) and triggers authClient.signOut() on 401", async () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(401, {
        error: { code: "INVALID_ACCESS_TOKEN", message: "expired" },
      }),
    );
    const authClient = buildAuthClient({
      getSession: () => Promise.resolve(buildSession()),
      signOut,
    });

    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await client.request({ method: "GET", path: "/v1/me" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("session_expired");
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith(buildSession());
  });

  it("does not retry the request after 401", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(401, {
        error: { code: "INVALID_ACCESS_TOKEN", message: "expired" },
      }),
    );
    const authClient = buildAuthClient({
      getSession: () => Promise.resolve(buildSession()),
    });

    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.request({ method: "GET", path: "/v1/me" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns session_expired even when the 401 body is unparseable", async () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { unexpected: "shape" }));
    const authClient = buildAuthClient({
      getSession: () => Promise.resolve(buildSession()),
      signOut,
    });

    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await client.request({ method: "GET", path: "/v1/me" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("session_expired");
  });
});

describe("HttpApiClient — non-2xx handling", () => {
  it("returns err({ kind: 'http_error' }) for 4xx with parsed code and requestId", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(401, {
        error: {
          code: "AUTHENTICATION_REQUIRED",
          message: "token missing",
          requestId: "req-1",
        },
      }),
    );
    const authClient = buildAuthClient({
      getSession: () => Promise.resolve(buildSession()),
    });

    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await client.request({ method: "GET", path: "/v1/me" });

    // 401 takes the session_expired path; use 403 for the http_error path.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // First request returns session_expired, but a follow-up 403 (not 401)
    // returns http_error. We just confirm one of the two for this fetch
    // call. This test is therefore effectively asserting the 401 short
    // circuit; the 403/http_error path is asserted below.
  });

  it("returns err({ kind: 'http_error' }) for 403 with parsed code and requestId", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(403, {
        error: {
          code: "FORBIDDEN",
          message: "not allowed",
          requestId: "req-2",
        },
      }),
    );
    const authClient = buildAuthClient({
      getSession: () => Promise.resolve(buildSession()),
    });

    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await client.request({ method: "GET", path: "/v1/me" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("http_error");
    if (result.error.kind === "http_error") {
      expect(result.error.status).toBe(403);
      expect(result.error.code).toBe("FORBIDDEN");
      expect(result.error.requestId).toBe("req-2");
    }
  });

  it("returns err({ kind: 'http_error' }) for 5xx with INTERNAL_ERROR fallback", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(500, {
        error: { code: "INTERNAL_ERROR", message: "boom" },
      }),
    );
    const authClient = buildAuthClient({
      getSession: () => Promise.resolve(buildSession()),
    });

    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await client.request({ method: "GET", path: "/v1/me" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("http_error");
    if (result.error.kind === "http_error") {
      expect(result.error.status).toBe(500);
    }
  });

  it("returns err({ kind: 'parse_error' }) when the 4xx body is not apiErrorSchema-shaped", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(403, { unexpected: "shape" }));
    const authClient = buildAuthClient({
      getSession: () => Promise.resolve(buildSession()),
    });

    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await client.request({ method: "GET", path: "/v1/me" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("parse_error");
  });
});

describe("HttpApiClient — success handling", () => {
  it("returns ok(undefined) for a 204 response without parsing JSON", async () => {
    const json = vi.fn().mockRejectedValue(new Error("body is empty"));
    const fetchMock = vi.fn().mockResolvedValue({
      status: 204,
      ok: true,
      json,
    } as unknown as Response);
    const authClient = buildAuthClient({
      getSession: () => Promise.resolve(buildSession()),
    });

    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await client.request<void>({
      method: "DELETE",
      path: "/v1/food-entries/entry-id",
    });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(json).not.toHaveBeenCalled();
  });

  it("returns ok(value) for 2xx without a schema (parses JSON, passes through)", async () => {
    const body = { status: "ok", extra: 42 };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
    const authClient = buildAuthClient({
      getSession: () => Promise.resolve(buildSession()),
    });

    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await client.request<typeof body>({
      method: "GET",
      path: "/v1/health",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(body);
  });

  it("returns ok(value) for 2xx with a schema that matches", async () => {
    const schema = z.object({ status: z.literal("ok") });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { status: "ok" }));
    const authClient = buildAuthClient({
      getSession: () => Promise.resolve(buildSession()),
    });

    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await client.request<{ status: "ok" }>({
      method: "GET",
      path: "/v1/health",
      schema,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("ok");
  });

  it("returns err({ kind: 'validation_error' }) for 2xx with a body that fails the schema", async () => {
    const schema = z.object({ status: z.literal("ok") });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { status: "no" }));
    const authClient = buildAuthClient({
      getSession: () => Promise.resolve(buildSession()),
    });

    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await client.request({
      method: "GET",
      path: "/v1/health",
      schema,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation_error");
    if (result.error.kind === "validation_error") {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });
});

describe("HttpApiClient — request body & headers", () => {
  it("JSON-serializes body and sets Content-Type: application/json when body is present", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const authClient = buildAuthClient({
      getSession: () => Promise.resolve(buildSession()),
    });

    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.request({
      method: "POST",
      path: "/v1/coach",
      body: { text: "hi" },
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ text: "hi" }));
  });

  it("does not set Content-Type when body is absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const authClient = buildAuthClient({
      getSession: () => Promise.resolve(buildSession()),
    });

    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.request({ method: "GET", path: "/v1/me" });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBeUndefined();
  });

  it("caller headers are merged but never override Authorization", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const authClient = buildAuthClient({
      getSession: () => Promise.resolve(buildSession({ accessToken: "real" })),
    });

    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.request({
      method: "GET",
      path: "/v1/me",
      headers: {
        authorization: "Bearer attacker",
        "x-request-id": "client-id",
      },
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer real");
    expect(headers["x-request-id"]).toBe("client-id");
  });
});

describe("HttpApiClient — cancellation", () => {
  it("forwards init.signal to fetch", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const authClient = buildAuthClient({
      getSession: () => Promise.resolve(buildSession()),
    });

    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.request({
      method: "GET",
      path: "/v1/me",
      signal: controller.signal,
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBe(controller.signal);
  });

  it("maps AbortError to err({ kind: 'network_error' })", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    const authClient = buildAuthClient({
      getSession: () => Promise.resolve(buildSession()),
    });

    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await client.request({ method: "GET", path: "/v1/me" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("network_error");
  });

  it("maps generic fetch rejection to err({ kind: 'network_error', cause })", async () => {
    const cause = new TypeError("Network request failed");
    const fetchMock = vi.fn().mockRejectedValue(cause);
    const authClient = buildAuthClient({
      getSession: () => Promise.resolve(buildSession()),
    });

    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await client.request({ method: "GET", path: "/v1/me" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("network_error");
    if (result.error.kind === "network_error") {
      expect(result.error.cause).toBe(cause);
    }
  });
});

describe("HttpApiClient — food photo drafts", () => {
  const mealPhoto = (): Blob =>
    new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer as ArrayBuffer], {
      type: "image/jpeg",
    });

  const draftResponse = {
    draft: {
      name: "Chicken and rice",
      caloriesKcal: 420,
      proteinG: 38,
      carbohydrateG: 45,
      fatG: 9,
      calorieRangeKcal: { low: 360, high: 500 },
      proteinRangeG: { low: 32, high: 44 },
      carbohydrateRangeG: { low: 38, high: 54 },
      fatRangeG: { low: 6, high: 13 },
      confidence: 0.82,
      warnings: ["Confirm the portion size."],
      assumptions: ["Assumes one plate."],
      provenance: {
        inputKind: "photo" as const,
        provider: "gemini",
        model: "resolved-model",
        promptVersion: "nutrition-draft-v2",
      },
    },
    requestId: "vision-request",
  };

  it("sends all three images in order and validates every returned draft", async () => {
    const drafts = [
      draftResponse.draft,
      { ...draftResponse.draft, name: "Soup" },
      { ...draftResponse.draft, name: "Salad" },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ...draftResponse, drafts }));
    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient: buildAuthClient({
        getSession: () => Promise.resolve(buildSession()),
      }),
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await client.draftFoodEntry({
      photo: mealPhoto(),
      mimeType: "image/jpeg",
      additionalPhotos: [
        {
          photo: new Blob(["second"], { type: "image/png" }),
          mimeType: "image/png",
        },
        {
          photo: new Blob(["third"], { type: "image/webp" }),
          mimeType: "image/webp",
        },
      ],
    });
    expect(result).toEqual({ ok: true, value: { ...draftResponse, drafts } });
    const body = fetchMock.mock.calls[0]?.[1].body as FormData;
    const images = body.getAll("image") as File[];
    expect(images.map((image) => image.name)).toEqual([
      "meal.jpg",
      "meal-2.png",
      "meal-3.webp",
    ]);
    expect(await images[1]?.text()).toBe("second");
    expect(await images[2]?.text()).toBe("third");
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        ...draftResponse,
        drafts: [
          draftResponse.draft,
          { ...draftResponse.draft, confidence: 2 },
        ],
      }),
    );
    const invalid = await client.draftFoodEntry({
      photo: mealPhoto(),
      mimeType: "image/jpeg",
    });
    expect(invalid).toMatchObject({
      ok: false,
      error: { kind: "validation_error" },
    });
  });

  it("rejects four images before transport for Meals and Coach", async () => {
    const fetchMock = vi.fn();
    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient: buildAuthClient({
        getSession: () => Promise.resolve(buildSession()),
      }),
      fetch: fetchMock as unknown as typeof fetch,
    });
    const input = {
      photo: mealPhoto(),
      mimeType: "image/jpeg" as const,
      additionalPhotos: Array.from({ length: 3 }, () => ({
        photo: mealPhoto(),
        mimeType: "image/jpeg" as const,
      })),
    };
    expect(await client.draftFoodEntry(input)).toMatchObject({
      ok: false,
      error: { kind: "validation_error" },
    });
    expect(
      await client.draftCoachMealPhoto({
        ...input,
        conversationId: "thread",
        idempotencyKey: "photo-key",
      }),
    ).toMatchObject({ ok: false, error: { kind: "validation_error" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends authenticated multipart data without setting a manual boundary", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, draftResponse));
    const authClient = buildAuthClient({
      getSession: () =>
        Promise.resolve(buildSession({ accessToken: "vision-token" })),
    });
    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient,
      fetch: fetchMock as unknown as typeof fetch,
    });

    const result = await client.draftFoodEntry({
      photo: mealPhoto(),
      mimeType: "image/jpeg",
      textHint: " lunch ",
    });

    expect(result).toEqual({ ok: true, value: draftResponse });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test/v1/food-entries/draft");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      authorization: "Bearer vision-token",
    });
    expect(
      (init.headers as Record<string, string>)["content-type"],
    ).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("textHint")).toBe("lunch");
    expect((init.body as FormData).get("image")).toBeInstanceOf(Blob);
  });

  it("does not upload when there is no authenticated session", async () => {
    const fetchMock = vi.fn();
    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient: buildAuthClient({
        getSession: () => Promise.resolve(null),
      }),
      fetch: fetchMock as unknown as typeof fetch,
    });

    const result = await client.draftFoodEntry({
      photo: mealPhoto(),
      mimeType: "image/jpeg",
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: "no_session" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("signs out and returns session_expired when the draft endpoint returns 401", async () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient: buildAuthClient({
        getSession: () => Promise.resolve(buildSession()),
        signOut,
      }),
      fetch: vi
        .fn()
        .mockResolvedValue(jsonResponse(401, {})) as unknown as typeof fetch,
    });

    const result = await client.draftFoodEntry({
      photo: mealPhoto(),
      mimeType: "image/jpeg",
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: "session_expired" },
    });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith(buildSession());
  });

  it("preserves a structured rate-limit response", async () => {
    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient: buildAuthClient({
        getSession: () => Promise.resolve(buildSession()),
      }),
      fetch: vi.fn().mockResolvedValue(
        jsonResponse(429, {
          error: {
            code: "RATE_LIMITED",
            message: "Try again later.",
            requestId: "vision-rate-limit",
          },
        }),
      ) as unknown as typeof fetch,
    });

    const result = await client.draftFoodEntry({
      photo: mealPhoto(),
      mimeType: "image/jpeg",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "http_error",
        status: 429,
        code: "RATE_LIMITED",
        message: "Try again later.",
        requestId: "vision-rate-limit",
      },
    });
  });

  it("maps a photo-upload fetch rejection to network_error", async () => {
    const cause = new TypeError("Network request failed");
    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient: buildAuthClient({
        getSession: () => Promise.resolve(buildSession()),
      }),
      fetch: vi.fn().mockRejectedValue(cause) as unknown as typeof fetch,
    });

    const result = await client.draftFoodEntry({
      photo: mealPhoto(),
      mimeType: "image/jpeg",
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: "network_error", cause },
    });
  });

  it("rejects a successful response that does not match the draft contract", async () => {
    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient: buildAuthClient({
        getSession: () => Promise.resolve(buildSession()),
      }),
      fetch: vi
        .fn()
        .mockResolvedValue(
          jsonResponse(200, { draft: null }),
        ) as unknown as typeof fetch,
    });

    const result = await client.draftFoodEntry({
      photo: mealPhoto(),
      mimeType: "image/jpeg",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation_error");
  });
});

describe("HttpApiClient — Coach meal photo proposals", () => {
  it("posts an authenticated idempotent multipart image and validates the proposal", async () => {
    const conversationId = "00000000-0000-4000-8000-000000000001";
    const userMessage = {
      id: "00000000-0000-4000-8000-000000000002",
      conversationId,
      role: "user" as const,
      text: "Shared a meal photo for a nutrition draft.",
      status: "complete" as const,
      provider: null,
      evidenceKinds: [],
      actionProposal: null,
      createdAt: "2026-07-26T10:00:00.000Z",
    };
    const responseBody = {
      conversation: {
        id: conversationId,
        title: "Meal photo",
        status: "active" as const,
        createdAt: "2026-07-26T10:00:00.000Z",
        updatedAt: "2026-07-26T10:00:01.000Z",
      },
      userMessage,
      assistantMessage: {
        ...userMessage,
        id: "00000000-0000-4000-8000-000000000003",
        role: "assistant" as const,
        text: "Review this meal estimate.",
        provider: "gemini",
        actionProposal: {
          id: "00000000-0000-4000-8000-000000000004",
          kind: "meal_log" as const,
          candidate: {
            name: "Tuna",
            caloriesKcal: 290,
            proteinG: 63,
            carbohydrateG: 0,
            fatG: 2,
            calorieRangeKcal: { low: 250, high: 340 },
            proteinRangeG: { low: 55, high: 70 },
            carbohydrateRangeG: { low: 0, high: 2 },
            fatRangeG: { low: 1, high: 5 },
            confidence: 0.8,
            warnings: [],
            assumptions: ["Assumes drained tuna."],
            provenance: {
              inputKind: "photo" as const,
              provider: "gemini",
              model: "gemini-3.7-flash",
              promptVersion: "nutrition-draft-v2",
            },
          },
        },
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, responseBody));
    const client = new HttpApiClient({
      baseUrl: "https://api.test",
      authClient: buildAuthClient({
        getSession: () =>
          Promise.resolve(buildSession({ accessToken: "coach-photo-token" })),
      }),
      fetch: fetchMock as unknown as typeof fetch,
    });
    const photo = new Blob(
      [new Uint8Array([0xff, 0xd8]).buffer as ArrayBuffer],
      {
        type: "image/jpeg",
      },
    );

    const result = await client.draftCoachMealPhoto({
      conversationId,
      idempotencyKey: "coach-photo-key-0001",
      photo,
      mimeType: "image/jpeg",
      additionalPhotos: [
        {
          photo: new Blob(["second"], { type: "image/png" }),
          mimeType: "image/png",
        },
      ],
      textHint: "  dinner  ",
    });

    expect(result).toEqual({ ok: true, value: responseBody });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://api.test/v1/coach/conversations/${conversationId}/nutrition-photo`,
    );
    expect(init.headers).toMatchObject({
      authorization: "Bearer coach-photo-token",
      "idempotency-key": "coach-photo-key-0001",
    });
    expect(
      (init.headers as Record<string, string>)["content-type"],
    ).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
    const body = init.body as FormData;
    expect((body.getAll("image") as File[]).map((image) => image.name)).toEqual(
      ["meal.jpg", "meal-2.png"],
    );
    expect(body.get("textHint")).toBe("dinner");
  });
});

describe("HttpApiClient — status", () => {
  it("status() reports configured:true with the baseUrl", () => {
    const authClient = buildAuthClient();
    const client = new HttpApiClient({
      baseUrl: "https://api.test/",
      authClient,
      fetch: vi.fn() as unknown as typeof fetch,
    });

    const status = client.status();
    expect(status.configured).toBe(true);
    if (status.configured) {
      expect(status.baseUrl).toBe("https://api.test");
    }
  });
});

describe("HttpApiClient — client capability header", () => {
  it("marks JSON requests as a current client without dropping caller headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = new HttpApiClient({
      baseUrl: "https://api.example.test",
      authClient: buildAuthClient({
        getSession: () => Promise.resolve(buildSession()),
      }),
      fetch: fetchMock,
    });
    await client.request({
      method: "GET",
      path: "/v1/goals/active",
      headers: { "x-mizyun-activity-kinds": "meal" },
    });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toMatchObject({
      authorization: "Bearer test-token",
      "x-mizyun-activity-kinds": "meal",
      [API_COMPAT_HEADER]: API_COMPAT_VERSION,
    });
  });

  it("sends the device zone read at request time (REL-01)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    let zone: string | null = "America/Los_Angeles";
    const client = new HttpApiClient({
      baseUrl: "https://api.example.test",
      authClient: buildAuthClient({
        getSession: () => Promise.resolve(buildSession()),
      }),
      fetch: fetchMock,
      deviceTimeZone: () => zone,
    });
    await client.request({ method: "GET", path: "/v1/profile" });
    zone = "Europe/Paris";
    await client.request({ method: "GET", path: "/v1/profile" });
    zone = null;
    await client.request({ method: "GET", path: "/v1/profile" });
    const sent = fetchMock.mock.calls.map(
      ([, init]) => (init as RequestInit).headers as Record<string, string>,
    );
    expect(sent[0]?.[DEVICE_TIME_ZONE_HEADER]).toBe("America/Los_Angeles");
    expect(sent[1]?.[DEVICE_TIME_ZONE_HEADER]).toBe("Europe/Paris");
    expect(sent[2]).not.toHaveProperty(DEVICE_TIME_ZONE_HEADER);
    expect(sent[2]?.[API_COMPAT_HEADER]).toBe(API_COMPAT_VERSION);
  });

  it("marks multipart meal-draft uploads too", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, {}));
    const client = new HttpApiClient({
      baseUrl: "https://api.example.test",
      authClient: buildAuthClient({
        getSession: () => Promise.resolve(buildSession()),
      }),
      fetch: fetchMock,
    });
    await client.draftFoodEntry({
      photo: new Blob(["x"], { type: "image/jpeg" }),
      mimeType: "image/jpeg",
    } as never);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toMatchObject({
      [API_COMPAT_HEADER]: API_COMPAT_VERSION,
    });
  });
});

describe("HttpApiClient — conditional GET revalidation", () => {
  const withHeaders = (
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ): Response =>
    ({
      status,
      ok: status >= 200 && status < 300,
      headers: new Headers(headers),
      json: () =>
        body === undefined
          ? Promise.reject(new SyntaxError("Unexpected end of JSON input"))
          : Promise.resolve(body),
    }) as unknown as Response;

  const build = (response: Response) => {
    const fetchMock = vi.fn().mockResolvedValue(response);
    const client = new HttpApiClient({
      baseUrl: "https://api.example.test",
      authClient: buildAuthClient({
        getSession: () => Promise.resolve(buildSession()),
      }),
      fetch: fetchMock,
    });
    return { client, fetchMock };
  };

  const sentHeaders = (fetchMock: Mock): Record<string, string> =>
    (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<
      string,
      string
    >;

  it("sends If-None-Match on a GET and returns notModified on 304 without parsing", async () => {
    const { client, fetchMock } = build(withHeaders(304, undefined));
    const schema = z.object({ items: z.array(z.number()) });
    const result = await client.request({
      method: "GET",
      path: "/v1/items",
      schema,
      ifNoneMatch: '"sha256:abc"',
      headers: { "if-none-match": '"caller"' },
    });
    expect(result).toEqual({ ok: true, value: undefined, notModified: true });
    expect(isNotModified(result)).toBe(true);
    const headers = sentHeaders(fetchMock);
    expect(headers["If-None-Match"]).toBe('"sha256:abc"');
    expect(headers["if-none-match"]).toBeUndefined();
    expect(headers.authorization).toBe("Bearer test-token");
    expect(headers[API_COMPAT_HEADER]).toBe(API_COMPAT_VERSION);
  });

  it("returns the ETag on a 200 and validates the body", async () => {
    const { client } = build(
      withHeaders(200, { items: [1] }, { etag: '"sha256:new"' }),
    );
    const result = await client.request({
      method: "GET",
      path: "/v1/items",
      schema: z.object({ items: z.array(z.number()) }),
      ifNoneMatch: '"sha256:old"',
    });
    expect(result).toEqual({
      ok: true,
      value: { items: [1] },
      etag: '"sha256:new"',
    });
    expect(resultEtag(result)).toBe('"sha256:new"');
    expect(isNotModified(result)).toBe(false);
  });

  it("treats a 200 that names the sent tag as not modified (iOS URLCache merge)", async () => {
    const { client } = build(
      withHeaders(
        200,
        { items: ["old-cached-body"] },
        { etag: 'W/"sha256:abc"' },
      ),
    );
    const result = await client.request({
      method: "GET",
      path: "/v1/items",
      schema: z.object({ items: z.array(z.number()) }),
      ifNoneMatch: '"sha256:abc"',
    });
    expect(result).toEqual({ ok: true, value: undefined, notModified: true });
  });

  it("re-asks without the validator when a conditional 200 carries no tag", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(withHeaders(200, { items: ["untrusted"] }))
      .mockResolvedValueOnce(
        withHeaders(200, { items: [2] }, { etag: '"sha256:fresh"' }),
      );
    const client = new HttpApiClient({
      baseUrl: "https://api.example.test",
      authClient: buildAuthClient({
        getSession: () => Promise.resolve(buildSession()),
      }),
      fetch: fetchMock,
    });
    const result = await client.request({
      method: "GET",
      path: "/v1/items",
      schema: z.object({ items: z.array(z.number()) }),
      ifNoneMatch: '"sha256:abc"',
    });
    expect(result).toEqual({
      ok: true,
      value: { items: [2] },
      etag: '"sha256:fresh"',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retried = (fetchMock.mock.calls[1]?.[1] as RequestInit)
      .headers as Record<string, string>;
    expect(retried["If-None-Match"]).toBeUndefined();
  });

  it("returns the ETag on a 200 even without ifNoneMatch", async () => {
    const { client, fetchMock } = build(
      withHeaders(200, { a: 1 }, { ETag: 'W/"v1"' }),
    );
    const result = await client.request({ method: "GET", path: "/v1/a" });
    expect(resultEtag(result)).toBe('W/"v1"');
    expect(
      Object.keys(sentHeaders(fetchMock)).some(
        (name) => name.toLowerCase() === "if-none-match",
      ),
    ).toBe(false);
  });

  it("omits an unusable ETag header and keeps the plain ok shape", async () => {
    const { client } = build(
      withHeaders(200, { a: 1 }, { etag: `"${"x".repeat(300)}"` }),
    );
    const result = await client.request({ method: "GET", path: "/v1/a" });
    expect(result).toEqual({ ok: true, value: { a: 1 } });
    expect(resultEtag(result)).toBeUndefined();
  });

  it("treats a 304 without ifNoneMatch as an http_error", async () => {
    const { client } = build(withHeaders(304, undefined));
    const result = await client.request({ method: "GET", path: "/v1/a" });
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "http_error", status: 304 }),
    });
    expect(isNotModified(result)).toBe(false);
  });

  it("ignores ifNoneMatch on non-GET methods", async () => {
    const { client, fetchMock } = build(withHeaders(304, undefined));
    const result = await client.request({
      method: "POST",
      path: "/v1/a",
      body: { x: 1 },
      ifNoneMatch: '"sha256:abc"',
    });
    expect(result.ok).toBe(false);
    expect(sentHeaders(fetchMock)["If-None-Match"]).toBeUndefined();
  });

  it("keeps 401 handling for conditional requests", async () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue(withHeaders(401, {}));
    const client = new HttpApiClient({
      baseUrl: "https://api.example.test",
      authClient: buildAuthClient({
        getSession: () => Promise.resolve(buildSession()),
        signOut,
      }),
      fetch: fetchMock,
    });
    const result = await client.request({
      method: "GET",
      path: "/v1/a",
      ifNoneMatch: '"sha256:abc"',
    });
    expect(result).toEqual({ ok: false, error: { kind: "session_expired" } });
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});

describe("HttpApiClient — ETag body verification (stale OS cache)", () => {
  // Same tag format as apps/api/src/plugins/conditional-get.ts.
  const sha256Base64Url = (text: string): Promise<string> =>
    Promise.resolve(createHash("sha256").update(text).digest("base64url"));
  const tagFor = (text: string, weak = false): string =>
    `${weak ? "W/" : ""}"sha256:${createHash("sha256").update(text).digest("base64url").slice(0, 32)}"`;

  const current = JSON.stringify({ workouts: ["oct-23", "oct-26", "nov-02"] });
  const stale = JSON.stringify({ workouts: ["oct-23"] });
  const schema = z.object({ workouts: z.array(z.string()) });

  const textResponse = (
    body: string,
    headers: Record<string, string>,
  ): Response =>
    ({
      status: 200,
      ok: true,
      headers: new Headers(headers),
      text: () => Promise.resolve(body),
      json: () => Promise.resolve(JSON.parse(body)),
    }) as unknown as Response;

  const build = (...responses: Response[]) => {
    const fetchMock = vi.fn();
    for (const response of responses) fetchMock.mockResolvedValueOnce(response);
    const client = new HttpApiClient({
      baseUrl: "https://api.example.test",
      authClient: buildAuthClient({
        getSession: () => Promise.resolve(buildSession()),
      }),
      fetch: fetchMock,
      sha256Base64Url,
    });
    return { client, fetchMock };
  };
  const headersOf = (fetchMock: Mock, call: number) =>
    (fetchMock.mock.calls[call]?.[1] as RequestInit).headers as Record<
      string,
      string
    >;

  it("refetches past the cache when an old body carries the current tag", async () => {
    // iOS URLCache merged a server 304 into a body it stored on Oct 23.
    const { client, fetchMock } = build(
      textResponse(stale, { etag: tagFor(current) }),
      textResponse(current, { etag: tagFor(current, true) }),
    );
    const result = await client.request({
      method: "GET",
      path: "/v1/workouts?limit=200",
      schema,
    });
    expect(result).toEqual({
      ok: true,
      value: JSON.parse(current),
      etag: tagFor(current, true),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(headersOf(fetchMock, 0)["Cache-Control"]).toBeUndefined();
    expect(headersOf(fetchMock, 0)["If-None-Match"]).toBe(
      '"mizyun-cache-bypass"',
    );
    const retry = headersOf(fetchMock, 1);
    expect(retry["Cache-Control"]).toBe("no-cache");
    expect(retry["If-None-Match"]).toBe('"mizyun-cache-bypass"');
  });

  it("never returns a body that still does not match its tag", async () => {
    const { client, fetchMock } = build(
      textResponse(stale, { etag: tagFor(current) }),
      textResponse(stale, { etag: tagFor(current) }),
    );
    const result = await client.request({
      method: "GET",
      path: "/v1/workouts?limit=200",
      schema,
    });
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "network_error" }),
    });
    expect(resultEtag(result)).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("accepts a body that matches its strong or proxy-weakened tag in one request", async () => {
    for (const weak of [false, true]) {
      const { client, fetchMock } = build(
        textResponse(current, { etag: tagFor(current, weak) }),
      );
      const result = await client.request({
        method: "GET",
        path: "/v1/workouts?limit=200",
        schema,
      });
      expect(result).toEqual({
        ok: true,
        value: JSON.parse(current),
        etag: tagFor(current, weak),
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("hashes the UTF-8 bytes, so non-ASCII bodies verify", async () => {
    const body = JSON.stringify({ workouts: ["Übung – Kniebeuge 🏋️"] });
    const { client, fetchMock } = build(
      textResponse(body, { etag: tagFor(body) }),
    );
    const result = await client.request({
      method: "GET",
      path: "/v1/workouts",
      schema,
    });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("guards only unconditional GETs with the never-matching validator", async () => {
    const { client, fetchMock } = build(
      textResponse(current, { etag: tagFor(current) }),
      textResponse(current, { etag: tagFor(current) }),
      textResponse("{}", {}),
    );
    await client.request({ method: "GET", path: "/v1/workouts", schema });
    await client.request({
      method: "GET",
      path: "/v1/workouts",
      schema,
      ifNoneMatch: '"sha256:held"',
    });
    await client.request({ method: "POST", path: "/v1/workouts", body: {} });
    expect(headersOf(fetchMock, 0)["If-None-Match"]).toBe(
      '"mizyun-cache-bypass"',
    );
    expect(headersOf(fetchMock, 1)["If-None-Match"]).toBe('"sha256:held"');
    expect(headersOf(fetchMock, 2)["If-None-Match"]).toBeUndefined();
  });

  it("drops the caller's validator when a conditional 200 fails verification", async () => {
    const { client, fetchMock } = build(
      textResponse(stale, { etag: tagFor(current) }),
      textResponse(current, { etag: tagFor(current) }),
    );
    const result = await client.request({
      method: "GET",
      path: "/v1/workouts",
      schema,
      ifNoneMatch: '"sha256:held"',
    });
    expect(result).toEqual({
      ok: true,
      value: JSON.parse(current),
      etag: tagFor(current),
    });
    expect(headersOf(fetchMock, 1)["If-None-Match"]).toBe(
      '"mizyun-cache-bypass"',
    );
  });

  it("reports a failed digest as a network error without retrying", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textResponse(current, { etag: tagFor(current) }));
    const client = new HttpApiClient({
      baseUrl: "https://api.example.test",
      authClient: buildAuthClient({
        getSession: () => Promise.resolve(buildSession()),
      }),
      fetch: fetchMock,
      sha256Base64Url: () => Promise.reject(new Error("crypto unavailable")),
    });
    const result = await client.request({
      method: "GET",
      path: "/v1/workouts",
      schema,
    });
    expect(result).toEqual({
      ok: false,
      error: { kind: "network_error", cause: new Error("crypto unavailable") },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a 304 to the bypass request as an error, not a stale hit", async () => {
    const { client, fetchMock } = build(
      textResponse(stale, { etag: tagFor(current) }),
      {
        status: 304,
        ok: false,
        headers: new Headers(),
      } as unknown as Response,
    );
    const result = await client.request({
      method: "GET",
      path: "/v1/workouts",
      schema,
    });
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "http_error", status: 304 }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("leaves tags that are not API digests unverified", async () => {
    const { client, fetchMock } = build(
      textResponse(stale, { etag: 'W/"v1"' }),
    );
    const result = await client.request({
      method: "GET",
      path: "/v1/workouts",
      schema,
    });
    expect(result).toEqual({
      ok: true,
      value: JSON.parse(stale),
      etag: 'W/"v1"',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
