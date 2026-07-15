import { describe, expect, it } from "vitest";

import { authPrincipalSchema, meResponseSchema } from "./index.js";

describe("authPrincipalSchema", () => {
  it("accepts a userId and optional email and role", () => {
    const result = authPrincipalSchema.safeParse({
      userId: "00000000-0000-4000-8000-000000000001",
      email: "person@example.com",
      role: "authenticated",
    });

    expect(result.success).toBe(true);
  });

  it("accepts a userId with no email or role", () => {
    const result = authPrincipalSchema.safeParse({
      userId: "00000000-0000-4000-8000-000000000001",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a non-UUID userId", () => {
    const result = authPrincipalSchema.safeParse({
      userId: "not-a-uuid",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a non-email email", () => {
    const result = authPrincipalSchema.safeParse({
      userId: "00000000-0000-4000-8000-000000000001",
      email: "not-an-email",
    });

    expect(result.success).toBe(false);
  });
});

describe("meResponseSchema", () => {
  it("accepts { user: { userId, email } }", () => {
    const result = meResponseSchema.safeParse({
      user: {
        userId: "00000000-0000-4000-8000-000000000001",
        email: "person@example.com",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects payloads missing the user key", () => {
    const result = meResponseSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects a user object that fails authPrincipalSchema", () => {
    const result = meResponseSchema.safeParse({
      user: { userId: "not-a-uuid" },
    });

    expect(result.success).toBe(false);
  });
});
