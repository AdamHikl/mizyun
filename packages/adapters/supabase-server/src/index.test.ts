import { describe, expect, it, vi } from "vitest";

import { SupabaseAccessTokenVerifier } from "./index.js";

describe("SupabaseAccessTokenVerifier", () => {
  it("maps only verified claims to a principal", async () => {
    const getClaims = vi.fn().mockResolvedValue({
      data: {
        claims: {
          sub: "00000000-0000-4000-8000-000000000001",
          email: "person@example.com",
          role: "authenticated",
        },
      },
      error: null,
    });
    const verifier = new SupabaseAccessTokenVerifier({ auth: { getClaims } });

    await expect(verifier.verify("signed-token")).resolves.toEqual({
      userId: "00000000-0000-4000-8000-000000000001",
      email: "person@example.com",
      role: "authenticated",
      accessToken: "signed-token",
    });
    expect(getClaims).toHaveBeenCalledWith("signed-token");
  });

  it("rejects invalid or unverifiable subjects", async () => {
    const verifier = new SupabaseAccessTokenVerifier({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: "not-a-user-id" } },
          error: null,
        }),
      },
    });

    await expect(verifier.verify("token")).resolves.toBeNull();
  });

  it.each([
    ["server error", { name: "AuthApiError", status: 500 }],
    ["gateway timeout", { name: "AuthRetryableFetchError", status: 504 }],
    ["network failure", { name: "AuthRetryableFetchError", status: 0 }],
    ["rate limit", { name: "AuthApiError", status: 429 }],
    ["request timeout", { name: "AuthApiError", status: 408 }],
    ["non-object error", "unavailable"],
  ])(
    "reports an auth %s as unavailable instead of an invalid token",
    async (_label, error) => {
      const verifier = new SupabaseAccessTokenVerifier({
        auth: {
          getClaims: vi.fn().mockResolvedValue({ data: null, error }),
        },
      });

      await expect(verifier.verify("token")).rejects.toThrow(
        "Access token verification is unavailable.",
      );
    },
  );

  it.each([
    ["rejected token", { name: "AuthApiError", status: 403 }],
    ["expired token", { name: "AuthInvalidJwtError", status: 400 }],
    ["missing user", { name: "AuthApiError", status: 404 }],
    ["missing session", { name: "AuthSessionMissingError", status: 400 }],
    ["non-JSON rejection", { name: "AuthUnknownError" }],
  ])("rejects a %s", async (_label, error) => {
    const verifier = new SupabaseAccessTokenVerifier({
      auth: {
        getClaims: vi.fn().mockResolvedValue({ data: null, error }),
      },
    });

    await expect(verifier.verify("token")).resolves.toBeNull();
  });
});
