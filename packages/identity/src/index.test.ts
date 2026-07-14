import { describe, expect, it } from "vitest";

import {
  DisabledAuthClient,
  IdentityError,
  RejectingAccessTokenVerifier,
} from "./index.js";

describe("disabled identity adapters", () => {
  it("rejects sign-in explicitly when configuration is absent", async () => {
    const client = new DisabledAuthClient();

    await expect(
      client.signInWithPassword({
        email: "person@example.com",
        password: "password",
      }),
    ).rejects.toMatchObject({
      code: "AUTH_NOT_CONFIGURED",
    });
  });

  it("does not authenticate arbitrary bearer tokens", async () => {
    await expect(
      new RejectingAccessTokenVerifier().verify("token"),
    ).resolves.toBeNull();
  });
});
