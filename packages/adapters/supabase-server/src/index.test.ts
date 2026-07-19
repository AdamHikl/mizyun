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
});
