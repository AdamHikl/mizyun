import { describe, expect, it } from "vitest";

import { IdentityError } from "@mizyun/identity";

import { authErrorMessage } from "./auth-error-message";

describe("authErrorMessage", () => {
  it("never exposes a raw provider response during sign-up", () => {
    const providerResponse =
      '{"status":504,"statusText":"gateway timed out","url":"https://auth.example/signup"}';

    expect(
      authErrorMessage(
        "sign-up",
        new IdentityError("AUTH_PROVIDER_ERROR", providerResponse),
      ),
    ).toBe(
      "We couldn't finish creating your account. Please try again in a moment.",
    );
  });

  it("uses actionable copy for sign-in and recovery failures", () => {
    expect(authErrorMessage("sign-in", new Error("provider detail"))).toBe(
      "We couldn't sign you in. Check your email and password, then try again.",
    );
    expect(authErrorMessage("forgot", new Error("provider detail"))).toBe(
      "We couldn't send a reset link. Check your connection and try again.",
    );
    expect(authErrorMessage("oauth", new Error("provider detail"))).toBe(
      "We couldn't sign you in with Google. Please try again.",
    );
  });

  it("preserves the explicit configuration-required state", () => {
    expect(
      authErrorMessage(
        "sign-in",
        new IdentityError(
          "AUTH_NOT_CONFIGURED",
          "internal configuration detail",
        ),
      ),
    ).toBe("Authentication is not available in this build.");
    expect(
      authErrorMessage(
        "oauth",
        new IdentityError(
          "AUTH_NOT_CONFIGURED",
          "internal configuration detail",
        ),
      ),
    ).toBe("Authentication is not available in this build.");
  });
});
