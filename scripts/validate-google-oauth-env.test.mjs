import assert from "node:assert/strict";
import test from "node:test";

import { validateGoogleOAuthConfig } from "./validate-google-oauth-env.mjs";

const validDev = {
  GOTRUE_EXTERNAL_GOOGLE_ENABLED: "true",
  GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID: "client-id",
  GOTRUE_EXTERNAL_GOOGLE_SECRET: "client-secret",
  GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI:
    "https://mizyun-supabase-dev.phiskel.com/auth/v1/callback",
};

test("permits an explicitly disabled provider without credentials", () => {
  assert.deepEqual(validateGoogleOAuthConfig("dev", {}), { enabled: false });
});

for (const key of [
  "GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID",
  "GOTRUE_EXTERNAL_GOOGLE_SECRET",
  "GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI",
]) {
  test(`rejects enabled Google OAuth without ${key}`, () => {
    assert.throws(
      () => validateGoogleOAuthConfig("dev", { ...validDev, [key]: "" }),
      new RegExp(`${key} is required`, "u"),
    );
  });
}

test("rejects a cross-environment callback", () => {
  assert.throws(
    () =>
      validateGoogleOAuthConfig("dev", {
        ...validDev,
        GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI:
          "https://mizyun-supabase.phiskel.com/auth/v1/callback",
      }),
    /must match the dev Supabase callback/u,
  );
});

test("accepts the complete environment-specific configuration", () => {
  assert.deepEqual(validateGoogleOAuthConfig("dev", validDev), {
    enabled: true,
    redirectUri: "https://mizyun-supabase-dev.phiskel.com/auth/v1/callback",
  });
});
