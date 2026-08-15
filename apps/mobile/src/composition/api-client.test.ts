import { describe, expect, it } from "vitest";

import {
  DisabledApiClient,
  HttpApiClient,
  type ApiClient,
} from "@mizyun/api-client";
import type { AuthClient } from "@mizyun/identity";

import { selectApiClient } from "./api-client";

const buildAuthClient = (): AuthClient => ({
  status: () => ({ configured: true, provider: "supabase" }),
  getSession: () => Promise.resolve(null),
  signInWithPassword: () => Promise.reject(new Error("unused")),
  signUpWithPassword: () => Promise.reject(new Error("unused")),
  signInWithOAuth: () => Promise.reject(new Error("unused")),
  signOut: () => Promise.resolve(),
  consumeDeepLink: () => Promise.reject(new Error("unused")),
  updatePassword: () => Promise.reject(new Error("unused")),
  requestPasswordRecovery: () => Promise.reject(new Error("unused")),
  subscribe: () => () => undefined,
  dispose: () => undefined,
});

describe("selectApiClient", () => {
  it("returns DisabledApiClient when apiUrl is null", () => {
    const client = selectApiClient(null, buildAuthClient());
    expect(client).toBeInstanceOf(DisabledApiClient);
    expect(client.status().configured).toBe(false);
  });

  it("returns HttpApiClient when apiUrl is present", () => {
    const client = selectApiClient("http://127.0.0.1:4000", buildAuthClient());
    expect(client).toBeInstanceOf(HttpApiClient);
    const status = client.status();
    expect(status.configured).toBe(true);
    if (status.configured) {
      expect(status.baseUrl).toBe("http://127.0.0.1:4000");
    }
  });

  it("returns HttpApiClient when apiUrl is present even if auth is disabled (runtime errors flow as no_session)", () => {
    const auth: AuthClient = {
      ...buildAuthClient(),
      status: () => ({
        configured: false,
        provider: "supabase",
        reason: "",
      }),
    };
    const client = selectApiClient("http://127.0.0.1:4000", auth);
    expect(client).toBeInstanceOf(HttpApiClient);
  });
});

// Sanity: the composition root side-effect import does not crash under
// vitest. We exercise only the modules that matter and assert the
// factory remains importable.
describe("module surface", () => {
  it("selectApiClient is exported and typed as a function", async () => {
    const mod = await import("./api-client");
    expect(typeof mod.selectApiClient).toBe("function");
    // Sanity that the public surface is an `ApiClient` (not `any`).
    const result: ApiClient = mod.selectApiClient(null, buildAuthClient());
    expect(result).toBeDefined();
  });
});
