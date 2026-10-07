import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAppleAuthClient,
  DefaultAppleAuthClient,
} from "./apple-client.js";

describe("AppleAuthClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  describe("exchangeAuthorizationCode", () => {
    const validExchangeInput = {
      code: "c1234567890abcdef.0.xyz",
      clientId: "com.mizyun.app",
      clientSecret: "mock-client-secret-jwt",
    };

    it("successfully exchanges authorization code and parses tokens", async () => {
      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;

      const mockFetch = vi
        .fn()
        .mockImplementation(async (url: string, init?: RequestInit) => {
          capturedUrl = url;
          capturedInit = init;
          return new Response(
            JSON.stringify({
              access_token: "access-token-xyz",
              token_type: "Bearer",
              expires_in: 3600,
              refresh_token: "refresh-token-123",
              id_token: "id-token-abc",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        });

      const client = new DefaultAppleAuthClient({ fetch: mockFetch });
      const result = await client.exchangeAuthorizationCode({
        ...validExchangeInput,
        redirectUri: "https://mizyun.com/auth/callback",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          accessToken: "access-token-xyz",
          refreshToken: "refresh-token-123",
          idToken: "id-token-abc",
          expiresIn: 3600,
        });
      }

      expect(capturedUrl).toBe("https://appleid.apple.com/auth/token");
      expect(capturedInit?.method).toBe("POST");
      expect(capturedInit?.headers).toEqual({
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      });

      const params = new URLSearchParams(capturedInit?.body as string);
      expect(params.get("grant_type")).toBe("authorization_code");
      expect(params.get("code")).toBe(validExchangeInput.code);
      expect(params.get("client_id")).toBe(validExchangeInput.clientId);
      expect(params.get("client_secret")).toBe(validExchangeInput.clientSecret);
      expect(params.get("redirect_uri")).toBe(
        "https://mizyun.com/auth/callback",
      );
    });

    it("handles Apple error 400 with structured JSON error response", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "The code has expired or has already been used.",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

      const client = new DefaultAppleAuthClient({ fetch: mockFetch });
      const result = await client.exchangeAuthorizationCode(validExchangeInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("http_error");
        expect(result.error.status).toBe(400);
        expect(result.error.error).toBeUndefined();
        expect(result.error.errorDescription).toBeUndefined();
        expect(result.error.message).toBe("Apple auth request failed");
      }
    });

    it("handles HTTP error with non-JSON response body", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response("Bad Gateway", {
          status: 502,
          headers: { "Content-Type": "text/plain" },
        }),
      );

      const client = new DefaultAppleAuthClient({ fetch: mockFetch });
      const result = await client.exchangeAuthorizationCode(validExchangeInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("http_error");
        expect(result.error.status).toBe(502);
        expect(result.error.message).toBe("Apple auth request failed");
      }
    });

    it("handles network timeout gracefully", async () => {
      const mockFetch = vi.fn().mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => {
              const err = new Error("The operation was aborted due to timeout");
              err.name = "TimeoutError";
              reject(err);
            }, 50);
          }),
      );

      const client = new DefaultAppleAuthClient({
        fetch: mockFetch,
        timeoutMs: 10,
      });
      const result = await client.exchangeAuthorizationCode(validExchangeInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("timeout");
        expect(result.error.message).toContain("timed out");
      }
    });

    it("handles generic network connection errors", async () => {
      const mockFetch = vi
        .fn()
        .mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));

      const client = new DefaultAppleAuthClient({ fetch: mockFetch });
      const result = await client.exchangeAuthorizationCode(validExchangeInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("network_error");
        expect(result.error.message).toBe("Apple auth request failed");
        expect(result.error.cause).toBeUndefined();
      }
    });

    it("returns invalid_response when 200 OK has invalid JSON", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response("not-valid-json", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new DefaultAppleAuthClient({ fetch: mockFetch });
      const result = await client.exchangeAuthorizationCode(validExchangeInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("invalid_response");
        expect(result.error.message).toContain("JSON");
      }
    });

    it("returns invalid_response when 200 OK is missing required token fields", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: "access-token-only",
            // missing refresh_token, id_token, expires_in
          }),
          { status: 200 },
        ),
      );

      const client = new DefaultAppleAuthClient({ fetch: mockFetch });
      const result = await client.exchangeAuthorizationCode(validExchangeInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("invalid_response");
        expect(result.error.message).toContain(
          "Missing or invalid token fields",
        );
      }
    });

    it("validates required input parameters", async () => {
      const client = new DefaultAppleAuthClient();

      const missingCode = await client.exchangeAuthorizationCode({
        ...validExchangeInput,
        code: "",
      });
      expect(missingCode.ok).toBe(false);
      if (!missingCode.ok) {
        expect(missingCode.error.kind).toBe("validation_error");
        expect(missingCode.error.message).toContain("code");
      }

      const missingClientId = await client.exchangeAuthorizationCode({
        ...validExchangeInput,
        clientId: "",
      });
      expect(missingClientId.ok).toBe(false);
      if (!missingClientId.ok) {
        expect(missingClientId.error.kind).toBe("validation_error");
        expect(missingClientId.error.message).toContain("clientId");
      }

      const missingClientSecret = await client.exchangeAuthorizationCode({
        ...validExchangeInput,
        clientSecret: "",
      });
      expect(missingClientSecret.ok).toBe(false);
      if (!missingClientSecret.ok) {
        expect(missingClientSecret.error.kind).toBe("validation_error");
        expect(missingClientSecret.error.message).toContain("clientSecret");
      }
    });
  });

  describe("revokeToken", () => {
    const validRevokeInput = {
      token: "refresh-token-to-revoke",
      clientId: "com.mizyun.app",
      clientSecret: "mock-client-secret-jwt",
    };

    it("successfully revokes token on HTTP 200", async () => {
      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;

      const mockFetch = vi
        .fn()
        .mockImplementation(async (url: string, init?: RequestInit) => {
          capturedUrl = url;
          capturedInit = init;
          return new Response("", { status: 200 });
        });

      const client = new DefaultAppleAuthClient({ fetch: mockFetch });
      const result = await client.revokeToken({
        ...validRevokeInput,
        tokenTypeHint: "refresh_token",
      });

      expect(result.ok).toBe(true);
      expect(capturedUrl).toBe("https://appleid.apple.com/auth/revoke");
      expect(capturedInit?.method).toBe("POST");

      const params = new URLSearchParams(capturedInit?.body as string);
      expect(params.get("token")).toBe(validRevokeInput.token);
      expect(params.get("client_id")).toBe(validRevokeInput.clientId);
      expect(params.get("client_secret")).toBe(validRevokeInput.clientSecret);
      expect(params.get("token_type_hint")).toBe("refresh_token");
    });

    it("handles Apple revocation error (e.g. 400 invalid_client)", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "invalid_client",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

      const client = new DefaultAppleAuthClient({ fetch: mockFetch });
      const result = await client.revokeToken(validRevokeInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("http_error");
        expect(result.error.status).toBe(400);
        expect(result.error.error).toBeUndefined();
        expect(result.error.message).toBe("Apple auth request failed");
      }
    });

    it("handles revocation network timeout gracefully", async () => {
      const mockFetch = vi.fn().mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => {
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              reject(err);
            }, 50);
          }),
      );

      const client = new DefaultAppleAuthClient({
        fetch: mockFetch,
        timeoutMs: 10,
      });
      const result = await client.revokeToken(validRevokeInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("timeout");
      }
    });

    it("validates required input parameters and tokenTypeHint", async () => {
      const client = new DefaultAppleAuthClient();

      const missingToken = await client.revokeToken({
        ...validRevokeInput,
        token: "",
      });
      expect(missingToken.ok).toBe(false);
      if (!missingToken.ok) {
        expect(missingToken.error.kind).toBe("validation_error");
        expect(missingToken.error.message).toContain("token");
      }

      const invalidHint = await client.revokeToken({
        ...validRevokeInput,
        tokenTypeHint: "invalid_hint" as any,
      });
      expect(invalidHint.ok).toBe(false);
      if (!invalidHint.ok) {
        expect(invalidHint.error.kind).toBe("validation_error");
        expect(invalidHint.error.message).toContain("tokenTypeHint");
      }
    });
  });

  describe("createAppleAuthClient and global fetch", () => {
    it("createAppleAuthClient factory produces functional client", () => {
      const client = createAppleAuthClient();
      expect(client).toBeInstanceOf(DefaultAppleAuthClient);
    });

    it("uses global fetch when no custom fetch is provided", async () => {
      const mockGlobalFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: "tok",
            refresh_token: "ref",
            id_token: "id",
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      );
      vi.stubGlobal("fetch", mockGlobalFetch);

      const client = createAppleAuthClient();
      const result = await client.exchangeAuthorizationCode({
        code: "c1",
        clientId: "client1",
        clientSecret: "secret1",
      });

      expect(result.ok).toBe(true);
      expect(mockGlobalFetch).toHaveBeenCalledTimes(1);
    });

    it("respects custom baseUrl option", async () => {
      let capturedUrl = "";
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return new Response("", { status: 200 });
      });

      const client = createAppleAuthClient({
        baseUrl: "https://custom-apple-proxy.internal/",
        fetch: mockFetch,
      });

      await client.revokeToken({
        token: "tok",
        clientId: "cid",
        clientSecret: "sec",
      });

      expect(capturedUrl).toBe(
        "https://custom-apple-proxy.internal/auth/revoke",
      );
    });
  });
});

describe("Apple transport recovery boundaries", () => {
  const input = {
    code: "secret-code",
    clientId: "client",
    clientSecret: "secret-client",
  };

  it("bounds the entire streamed exchange response including a stalled body", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(new ReadableStream<Uint8Array>({ start() {} })),
      );
    const result = await createAppleAuthClient({
      fetch,
      timeoutMs: 5,
    }).exchangeAuthorizationCode(input);
    expect(result).toEqual({
      ok: false,
      error: { kind: "timeout", message: "Apple auth request timed out" },
    });
  });

  it("rejects oversized bodies without retaining provider content", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response("secret-token".repeat(10000)));
    const result = await createAppleAuthClient({
      fetch,
    }).exchangeAuthorizationCode(input);
    expect(result).toEqual({
      ok: false,
      error: { kind: "network_error", message: "Apple auth request failed" },
    });
  });

  it("rejects empty tokens and invalid expiry in a successful exchange response", async () => {
    for (const override of [
      { refresh_token: " " },
      { id_token: "" },
      { expires_in: -1 },
    ]) {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: "access",
            refresh_token: "refresh",
            id_token: "identity",
            expires_in: 3600,
            ...override,
          }),
        ),
      );
      const result = await createAppleAuthClient({
        fetch,
      }).exchangeAuthorizationCode(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("invalid_response");
    }
  });
});
