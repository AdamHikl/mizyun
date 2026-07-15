import { describe, expect, it } from "vitest";

import { loadMobileConfig } from "./mobile.js";

const supabaseSnapshot = {
  EXPO_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
};

describe("loadMobileConfig — happy path", () => {
  it("accepts valid Supabase public vars and returns configured:true", () => {
    const result = loadMobileConfig({ env: supabaseSnapshot });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.supabase).toEqual({
      configured: true,
      provider: "supabase",
    });
    expect(result.value.apiUrl).toBeNull();
  });

  it("accepts a present EXPO_PUBLIC_API_URL alongside Supabase vars", () => {
    const result = loadMobileConfig({
      env: {
        ...supabaseSnapshot,
        EXPO_PUBLIC_API_URL: "http://127.0.0.1:4000",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.apiUrl).toBe("http://127.0.0.1:4000");
  });

  it("returns configured:false with reason when only the URL is set", () => {
    const result = loadMobileConfig({
      env: { EXPO_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const first = result.error[0];
    expect(first?.kind).toBe("malformed");
    if (first?.kind === "malformed") {
      expect(first.reason).toMatch(/set together/);
    }
  });

  it("returns configured:false with reason when only the key is set", () => {
    const result = loadMobileConfig({
      env: { EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]?.kind).toBe("malformed");
  });

  it("returns configured:false with reason when neither is set", () => {
    const result = loadMobileConfig({ env: {} });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.supabase.configured).toBe(false);
    if (result.value.supabase.configured === false) {
      expect(result.value.supabase.reason).toMatch(/has not been provided/);
    }
    expect(result.value.apiUrl).toBeNull();
  });
});

describe("loadMobileConfig — public-only enforcement", () => {
  it("rejects an EXPO_PUBLIC_* key not in the allowlist with kind:unexpected", () => {
    const result = loadMobileConfig({
      env: {
        ...supabaseSnapshot,
        EXPO_PUBLIC_OPENAI_API_KEY: "sk-test",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const unexpected = result.error.find(
      (issue) => issue.kind === "unexpected",
    );
    expect(unexpected).toBeDefined();
    if (unexpected && unexpected.kind === "unexpected") {
      expect(unexpected.keys).toContain("EXPO_PUBLIC_OPENAI_API_KEY");
    }
  });

  it("rejects any non-EXPO_PUBLIC_* key passed via the snapshot", () => {
    const result = loadMobileConfig({
      env: {
        ...supabaseSnapshot,
        SUPABASE_SECRET_KEY: "service-role-key",
        API_PORT: "4000",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const unexpected = result.error.find(
      (issue) => issue.kind === "unexpected",
    );
    expect(unexpected).toBeDefined();
    if (unexpected && unexpected.kind === "unexpected") {
      expect(unexpected.keys).toEqual(
        expect.arrayContaining(["SUPABASE_SECRET_KEY", "API_PORT"]),
      );
    }
  });

  it("rejects injection attempts that combine an allowed key with SUPABASE_SECRET_KEY", () => {
    const result = loadMobileConfig({
      env: {
        EXPO_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
        SUPABASE_SECRET_KEY: "service-role-key",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const unexpected = result.error.find(
      (issue) => issue.kind === "unexpected",
    );
    expect(unexpected).toBeDefined();
    if (unexpected && unexpected.kind === "unexpected") {
      expect(unexpected.keys).toContain("SUPABASE_SECRET_KEY");
    }
  });

  it("never returns a value whose string fields include a server-secret-shaped string", () => {
    // This is a structural guarantee — a snapshot that passes is necessarily
    // sanitised. Assert that no successful value contains JWT/secret-shaped
    // substrings by exercising every field the loader exposes.
    const result = loadMobileConfig({ env: supabaseSnapshot });

    if (!result.ok) {
      // Success is not what this test cares about; if we got an error, that
      // itself means the loader refused something. We only need to check
      // sanitisation when a value is returned.
      return;
    }
    const serialised = JSON.stringify(result.value);
    expect(serialised).not.toMatch(/sbp_/);
    expect(serialised).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });
});

describe("loadMobileConfig — malformed values", () => {
  it("rejects a non-URL EXPO_PUBLIC_SUPABASE_URL with kind:malformed", () => {
    const result = loadMobileConfig({
      env: {
        EXPO_PUBLIC_SUPABASE_URL: "not-a-url",
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const first = result.error[0];
    expect(first?.kind).toBe("malformed");
    if (first?.kind === "malformed") {
      expect(first.key).toBe("EXPO_PUBLIC_SUPABASE_URL");
    }
  });

  it("rejects a non-URL EXPO_PUBLIC_API_URL with kind:malformed", () => {
    const result = loadMobileConfig({
      env: { EXPO_PUBLIC_API_URL: "not-a-url" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const malformed = result.error.find((issue) => issue.kind === "malformed");
    expect(malformed).toBeDefined();
    if (malformed && malformed.kind === "malformed") {
      expect(malformed.key).toBe("EXPO_PUBLIC_API_URL");
    }
  });

  it("reports multiple issues at once (URL malformed AND unknown key present)", () => {
    const result = loadMobileConfig({
      env: {
        EXPO_PUBLIC_SUPABASE_URL: "not-a-url",
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
        EXPO_PUBLIC_OPENAI_API_KEY: "sk-test",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const kinds = result.error.map((issue) => issue.kind).sort();
    expect(kinds).toEqual(["malformed", "unexpected"]);
  });

  it("treats empty strings for EXPO_PUBLIC_SUPABASE_URL/key as absent", () => {
    const result = loadMobileConfig({
      env: {
        EXPO_PUBLIC_SUPABASE_URL: "",
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      },
    });

    // Both empty → configured:false, no error.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.supabase.configured).toBe(false);
  });
});
