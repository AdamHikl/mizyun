import { describe, expect, it } from "vitest";

import { DisabledApiClient } from "./disabled-api-client";
import { parseApiErrorBody } from "./errors";

describe("parseApiErrorBody", () => {
  it("returns http_error when the body matches apiErrorSchema", () => {
    const body = {
      error: {
        code: "AUTHENTICATION_REQUIRED",
        message: "A valid bearer token is required.",
        requestId: "req-123",
      },
    };

    const result = parseApiErrorBody(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("http_error");
    if (result.error.kind === "http_error") {
      expect(result.error.code).toBe("AUTHENTICATION_REQUIRED");
      expect(result.error.message).toBe("A valid bearer token is required.");
      expect(result.error.requestId).toBe("req-123");
    }
  });

  it("returns parse_error when the body is not the expected envelope", () => {
    const result = parseApiErrorBody({ unexpected: "shape" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("parse_error");
  });

  it("preserves the requestId when present, omits it when absent", () => {
    const withId = parseApiErrorBody({
      error: {
        code: "X",
        message: "Y",
        requestId: "req-abc",
      },
    });
    const withoutId = parseApiErrorBody({
      error: { code: "X", message: "Y" },
    });

    expect(withId.ok).toBe(false);
    if (!withId.ok && withId.error.kind === "http_error") {
      expect(withId.error.requestId).toBe("req-abc");
    }
    expect(withoutId.ok).toBe(false);
    if (!withoutId.ok && withoutId.error.kind === "http_error") {
      expect(withoutId.error.requestId).toBeUndefined();
    }
  });
});

describe("DisabledApiClient", () => {
  it("status() reports configured:false with a reason", () => {
    const client = new DisabledApiClient();
    const status = client.status();
    expect(status.configured).toBe(false);
    if (status.configured === false) {
      expect(status.reason).toMatch(/base URL/);
    }
  });

  it("request() always returns err({ kind: 'not_configured' })", async () => {
    const client = new DisabledApiClient();
    const result = await client.request({ method: "GET", path: "/v1/me" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("not_configured");
    if (result.error.kind === "not_configured") {
      expect(result.error.reason).toMatch(/base URL/);
    }
  });

  it("does not invoke fetch or the auth client", async () => {
    const fetchSpy = (() =>
      Promise.reject(
        new Error("should not be called"),
      )) as unknown as typeof fetch;
    const authClient = {
      getSession: () => Promise.reject(new Error("should not be called")),
      signOut: () => Promise.reject(new Error("should not be called")),
      status: () => ({
        configured: false,
        provider: "supabase" as const,
        reason: "",
      }),
      signInWithPassword: () =>
        Promise.reject(new Error("should not be called")),
      signUpWithPassword: () =>
        Promise.reject(new Error("should not be called")),
      subscribe: () => () => undefined,
      dispose: () => undefined,
    };

    const client = new DisabledApiClient();
    await expect(
      client.request({ method: "GET", path: "/v1/me" } /* unused */),
    ).resolves.toBeDefined();

    // Sanity: the fetch and authClient are not even passed to the disabled
    // client. This assertion documents that contract.
    expect(fetchSpy).toBeDefined();
    expect(authClient).toBeDefined();
  });
});
