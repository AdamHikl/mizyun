import { describe, expect, it } from "vitest";

import {
  SERVER_ENV_KEYS,
  loadServerConfig,
  type ServerConfig,
} from "./server.js";

const baseSnapshot = {
  [SERVER_ENV_KEYS.host]: "127.0.0.1",
  [SERVER_ENV_KEYS.port]: "4000",
  [SERVER_ENV_KEYS.env]: "development",
};

const expectOk = (value: ServerConfig) => {
  expect(value.host).toBe("127.0.0.1");
  expect(value.port).toBe(4000);
  expect(value.env).toBe("development");
};

describe("loadServerConfig — defaults and ranges", () => {
  it("applies 127.0.0.1 / 4000 / development defaults when nothing is set", () => {
    const result = loadServerConfig({ env: {} });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectOk(result.value);
  });

  it("accepts NODE_ENV=test and NODE_ENV=production", () => {
    const result = loadServerConfig({
      env: { ...baseSnapshot, [SERVER_ENV_KEYS.env]: "test" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.env).toBe("test");
  });

  it("rejects an unrecognised NODE_ENV with kind:malformed", () => {
    const result = loadServerConfig({
      env: { ...baseSnapshot, [SERVER_ENV_KEYS.env]: "staging" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]?.kind).toBe("malformed");
  });

  it("parses a valid API_PORT string into an integer", () => {
    const result = loadServerConfig({
      env: { ...baseSnapshot, [SERVER_ENV_KEYS.port]: "5000" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.port).toBe(5000);
  });

  it("rejects a non-integer API_PORT with kind:out_of_range", () => {
    const result = loadServerConfig({
      env: { ...baseSnapshot, [SERVER_ENV_KEYS.port]: "not-a-number" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const first = result.error[0];
    expect(first?.kind).toBe("out_of_range");
    if (first?.kind === "out_of_range") {
      expect(first.key).toBe(SERVER_ENV_KEYS.port);
    }
  });

  it("rejects API_PORT outside 1..65535 with kind:out_of_range", () => {
    const tooHigh = loadServerConfig({
      env: { ...baseSnapshot, [SERVER_ENV_KEYS.port]: "70000" },
    });
    const tooLow = loadServerConfig({
      env: { ...baseSnapshot, [SERVER_ENV_KEYS.port]: "0" },
    });

    expect(tooHigh.ok).toBe(false);
    if (!tooHigh.ok) {
      expect(tooHigh.error[0]?.kind).toBe("out_of_range");
    }
    expect(tooLow.ok).toBe(false);
    if (!tooLow.ok) {
      expect(tooLow.error[0]?.kind).toBe("out_of_range");
    }
  });

  it("treats an empty API_HOST the same as missing (uses default)", () => {
    // Default-having fields treat empty strings as absent so a partially
    // configured `.env` does not silently disable the server. The
    // Supabase pair (no default) behaves differently — empty values there
    // are filtered to "missing" so the asymmetry check still works.
    const result = loadServerConfig({
      env: { ...baseSnapshot, [SERVER_ENV_KEYS.host]: "" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.host).toBe("127.0.0.1");
  });
});

describe("loadServerConfig — optional supabase", () => {
  it("returns supabase.configured:true when both keys are valid", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.supabaseUrl]: "http://127.0.0.1:54321",
        [SERVER_ENV_KEYS.supabasePublishableKey]: "publishable-key",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.supabase).toEqual({
      configured: true,
      provider: "supabase",
    });
  });

  it("returns supabase.configured:false with reason when both are absent", () => {
    const result = loadServerConfig({ env: baseSnapshot });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.supabase.configured).toBe(false);
    if (result.value.supabase.configured === false) {
      expect(result.value.supabase.provider).toBe("supabase");
      expect(result.value.supabase.reason).toMatch(/has not been provided/);
    }
  });

  it("treats empty strings the same as missing keys", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.supabaseUrl]: "",
        [SERVER_ENV_KEYS.supabasePublishableKey]: "",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.supabase.configured).toBe(false);
  });

  it("accepts a long SUPABASE_SERVICE_ROLE_KEY alongside the pair", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.supabaseUrl]: "http://127.0.0.1:54321",
        [SERVER_ENV_KEYS.supabasePublishableKey]: "publishable-key",
        [SERVER_ENV_KEYS.supabaseServiceRoleKey]:
          "service-role-key-that-is-long-enough",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.supabaseConfig?.serviceRoleKey).toBe(
      "service-role-key-that-is-long-enough",
    );
  });

  it("leaves serviceRoleKey undefined when omitted", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.supabaseUrl]: "http://127.0.0.1:54321",
        [SERVER_ENV_KEYS.supabasePublishableKey]: "publishable-key",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.supabaseConfig?.serviceRoleKey).toBeUndefined();
  });

  it("rejects a too-short SUPABASE_SERVICE_ROLE_KEY with kind:out_of_range", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.supabaseUrl]: "http://127.0.0.1:54321",
        [SERVER_ENV_KEYS.supabasePublishableKey]: "publishable-key",
        [SERVER_ENV_KEYS.supabaseServiceRoleKey]: "short",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const first = result.error[0];
    expect(first?.kind).toBe("out_of_range");
    if (first?.kind === "out_of_range") {
      expect(first.key).toBe(SERVER_ENV_KEYS.supabaseServiceRoleKey);
    }
  });

  it("rejects when only one of URL/key is set (asymmetry)", () => {
    const onlyUrl = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.supabaseUrl]: "http://127.0.0.1:54321",
      },
    });
    const onlyKey = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.supabasePublishableKey]: "publishable-key",
      },
    });

    expect(onlyUrl.ok).toBe(false);
    if (!onlyUrl.ok) {
      expect(onlyUrl.error[0]?.kind).toBe("malformed");
      if (onlyUrl.error[0]?.kind === "malformed") {
        expect(onlyUrl.error[0].reason).toMatch(/must be set together/);
      }
    }
    expect(onlyKey.ok).toBe(false);
  });

  it("rejects a malformed SUPABASE_URL with kind:malformed", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.supabaseUrl]: "not-a-url",
        [SERVER_ENV_KEYS.supabasePublishableKey]: "publishable-key",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const first = result.error[0];
    expect(first?.kind).toBe("malformed");
    if (first?.kind === "malformed") {
      expect(first.key).toBe(SERVER_ENV_KEYS.supabaseUrl);
    }
  });

  it("rejects an empty SUPABASE_PUBLISHABLE_KEY with kind:malformed", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.supabaseUrl]: "http://127.0.0.1:54321",
        [SERVER_ENV_KEYS.supabasePublishableKey]: "",
      },
    });

    // Empty key is filtered out by `readString`, leaving only URL — asymmetry.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const first = result.error[0];
    expect(first?.kind).toBe("malformed");
    if (first?.kind === "malformed") {
      expect(first.reason).toMatch(/must be set together/);
    }
  });
});

describe("loadServerConfig — closed-world", () => {
  it("ignores unrelated env vars (e.g. PATH) without producing an error", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        PATH: "/usr/bin",
        HOME: "/Users/example",
        NODE_PATH: "/usr/lib/node_modules",
      },
    });

    expect(result.ok).toBe(true);
  });

  it("reports multiple issues at once (malformed port + missing supabase pair)", () => {
    const result = loadServerConfig({
      env: {
        [SERVER_ENV_KEYS.host]: "127.0.0.1",
        [SERVER_ENV_KEYS.port]: "not-a-number",
        [SERVER_ENV_KEYS.supabaseUrl]: "http://127.0.0.1:54321",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Port is reported as out_of_range; supabase asymmetry is reported as
    // malformed. Both should be present in the same envelope.
    const kinds = result.error.map((issue) => issue.kind).sort();
    expect(kinds).toEqual(["malformed", "out_of_range"]);
  });

  it("defaults agentProvider to 'disabled' when AGENT_PROVIDER is absent", () => {
    const result = loadServerConfig({ env: baseSnapshot });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.agentProvider).toBe("disabled");
  });

  it("rejects an unrecognised AGENT_PROVIDER with kind:malformed", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.agentProvider]: "openai",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const first = result.error[0];
    expect(first?.kind).toBe("malformed");
    if (first?.kind === "malformed") {
      expect(first.key).toBe(SERVER_ENV_KEYS.agentProvider);
    }
  });

  it("requires a server-only key when Mistral is selected", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.agentProvider]: "mistral",
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContainEqual({
      kind: "missing",
      keys: [SERVER_ENV_KEYS.mistralApiKey],
    });
  });

  it("builds a bounded Mistral configuration with external access default-off", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.agentProvider]: "mistral",
        [SERVER_ENV_KEYS.mistralApiKey]: "test-key-that-is-long-enough",
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      agentProvider: "mistral",
      aiExternalAccess: false,
      mistralConfig: {
        model: "mistral-medium-latest",
        timeoutMs: 30_000,
        maxOutputTokens: 1_200,
        dailyUserTokenBudget: 100_000,
        userRequestsPerMinute: 6,
        userMaxConcurrentRequests: 1,
      },
    });
  });

  it("validates bounded per-user AI request controls", () => {
    const configured = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.agentProvider]: "mistral",
        [SERVER_ENV_KEYS.mistralApiKey]: "test-key-that-is-long-enough",
        [SERVER_ENV_KEYS.aiUserRequestsPerMinute]: "12",
        [SERVER_ENV_KEYS.aiUserMaxConcurrentRequests]: "1",
      },
    });
    expect(configured.ok).toBe(true);
    if (configured.ok) {
      expect(configured.value.mistralConfig).toMatchObject({
        userRequestsPerMinute: 12,
        userMaxConcurrentRequests: 1,
      });
    }

    const invalid = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.aiUserRequestsPerMinute]: "0",
        [SERVER_ENV_KEYS.aiUserMaxConcurrentRequests]: "2",
      },
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "out_of_range",
            key: SERVER_ENV_KEYS.aiUserRequestsPerMinute,
          }),
          expect.objectContaining({
            kind: "out_of_range",
            key: SERVER_ENV_KEYS.aiUserMaxConcurrentRequests,
          }),
        ]),
      );
    }
  });
});
