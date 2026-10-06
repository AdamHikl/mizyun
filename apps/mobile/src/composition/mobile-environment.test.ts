import { afterEach, describe, expect, it, vi } from "vitest";
import { loadMobileConfig } from "@mizyun/config";
import { guardMobileEnvironment as guardNativeEnvironment } from "./mobile-environment";

const devRuntime = { platform: "ios", applicationId: "com.mizyun.development" };
const guardMobileEnvironment = (
  result: Parameters<typeof guardNativeEnvironment>[0],
  identity: Parameters<typeof guardNativeEnvironment>[1],
  runtime: Parameters<typeof guardNativeEnvironment>[2] = devRuntime,
) => guardNativeEnvironment(result, identity, runtime);

const dev = {
  EXPO_PUBLIC_API_URL: "https://mizyun-api-dev.phiskel.com",
  EXPO_PUBLIC_SUPABASE_URL: "https://mizyun-supabase-dev.phiskel.com",
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-public-test-key",
  EXPO_PUBLIC_AUTH_REDIRECT_URI: "mizyun-dev://auth/callback",
};
const identity = {
  ios: { bundleIdentifier: "com.mizyun.development" },
  android: { package: "com.mizyun.dev" },
  extra: {
    mizyunVariant: "dev",
    mizyunRuntimeEndpoints: {
      apiUrl: dev.EXPO_PUBLIC_API_URL,
      supabaseUrl: dev.EXPO_PUBLIC_SUPABASE_URL,
      authRedirectUri: dev.EXPO_PUBLIC_AUTH_REDIRECT_URI,
    },
  },
};
const adapterFactory = vi.fn();
vi.mock("@mizyun/adapter-supabase-mobile", () => ({
  createSupabaseMobileAuthClient: (...args: unknown[]) =>
    adapterFactory(...args),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("expo-constants");
  vi.doUnmock("expo-application");
  vi.resetModules();
  adapterFactory.mockClear();
});

describe("effective mobile environment", () => {
  it("accepts the selected Dev snapshot and equivalent trailing slashes", () => {
    expect(
      guardMobileEnvironment(loadMobileConfig({ env: dev }), identity).ok,
    ).toBe(true);
    expect(
      guardMobileEnvironment(
        loadMobileConfig({
          env: { ...dev, EXPO_PUBLIC_API_URL: `${dev.EXPO_PUBLIC_API_URL}/` },
        }),
        identity,
      ).ok,
    ).toBe(true);
  });

  it.each([
    { EXPO_PUBLIC_API_URL: "http://localhost:4000" },
    { EXPO_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" },
    { EXPO_PUBLIC_API_URL: "https://mizyun-api.phiskel.com" },
    { EXPO_PUBLIC_SUPABASE_URL: "https://mizyun-supabase.phiskel.com" },
    { EXPO_PUBLIC_AUTH_REDIRECT_URI: "mizyun://auth/callback" },
    { EXPO_PUBLIC_API_URL: `${dev.EXPO_PUBLIC_API_URL}:444` },
    { EXPO_PUBLIC_API_URL: `${dev.EXPO_PUBLIC_API_URL}/unexpected` },
  ])(
    "disables the entire config for a poisoned effective field %j",
    (override) => {
      const result = guardMobileEnvironment(
        loadMobileConfig({ env: { ...dev, ...override } }),
        identity,
      );
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(
        dev.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      );
    },
  );

  it("uses manifest identity to reject a conflicting declared variant", () => {
    expect(
      guardMobileEnvironment(loadMobileConfig({ env: dev }), {
        ...identity,
        extra: { ...identity.extra, mizyunVariant: "production" },
      }).ok,
    ).toBe(false);
  });

  it("blocks foreign hosts with an older Dev manifest", () => {
    expect(
      guardMobileEnvironment(
        loadMobileConfig({
          env: {
            ...dev,
            EXPO_PUBLIC_SUPABASE_URL: "https://mizyun-supabase.phiskel.com",
          },
        }),
        { ios: identity.ios },
      ).ok,
    ).toBe(false);
  });

  it("keeps intentionally selected local Dev and Android emulator routing", () => {
    for (const host of ["localhost", "127.0.0.1", "10.0.2.2"]) {
      const local = {
        ...dev,
        EXPO_PUBLIC_API_URL: `http://${host}:4000`,
        EXPO_PUBLIC_SUPABASE_URL: `http://${host}:54321`,
      };
      expect(
        guardMobileEnvironment(loadMobileConfig({ env: local }), {
          ...identity,
          extra: {
            ...identity.extra,
            mizyunRuntimeEndpoints: {
              apiUrl: local.EXPO_PUBLIC_API_URL,
              supabaseUrl: local.EXPO_PUBLIC_SUPABASE_URL,
              authRedirectUri: local.EXPO_PUBLIC_AUTH_REDIRECT_URI,
            },
          },
        }).ok,
      ).toBe(true);
    }
  });

  it("preserves Production routing and rejects Dev routing in Production", () => {
    const production = {
      ...dev,
      EXPO_PUBLIC_API_URL: "https://mizyun-api.phiskel.com",
      EXPO_PUBLIC_SUPABASE_URL: "https://mizyun-supabase.phiskel.com",
      EXPO_PUBLIC_AUTH_REDIRECT_URI: "mizyun://auth/callback",
    };
    const productionIdentity = {
      ios: { bundleIdentifier: "com.mizyun.app" },
      extra: { mizyunVariant: "production" },
    };
    expect(
      guardMobileEnvironment(
        loadMobileConfig({ env: production }),
        productionIdentity,
        { platform: "ios", applicationId: "com.mizyun.app" },
      ).ok,
    ).toBe(true);
    expect(
      guardMobileEnvironment(loadMobileConfig({ env: dev }), productionIdentity)
        .ok,
    ).toBe(false);
  });

  it("preserves an unconfigured setup and an existing malformed result", () => {
    const result = loadMobileConfig({ env: {} });
    expect(
      guardMobileEnvironment(result, { extra: { mizyunVariant: "dev" } }),
    ).toBe(result);
    const malformed = loadMobileConfig({
      env: { EXPO_PUBLIC_API_URL: "invalid" },
    });
    expect(guardMobileEnvironment(malformed, identity)).toBe(malformed);
  });

  it("never constructs Supabase Auth or enables API requests on a mismatch", async () => {
    for (const [key, value] of Object.entries({
      ...dev,
      EXPO_PUBLIC_SUPABASE_URL: "http://localhost:54321",
    })) {
      vi.stubEnv(key, value);
    }
    vi.doMock("expo-constants", () => ({ default: { expoConfig: identity } }));
    vi.doMock("expo-application", () => ({
      applicationId: devRuntime.applicationId,
    }));
    vi.resetModules();
    const auth = await import("./auth-client");
    const api = await import("./api-client");
    expect(adapterFactory).not.toHaveBeenCalled();
    expect(auth.authConfiguration.configured).toBe(false);
    expect(api.apiConfiguration.configured).toBe(false);
    expect(await auth.authClient.getSession()).toBeNull();
  });

  it.each([null, "", "com.unrecognized.app", "host.exp.Exponent"])(
    "rejects a missing or unrecognized native identity %s",
    (applicationId) => {
      expect(
        guardMobileEnvironment(loadMobileConfig({ env: dev }), identity, {
          platform: "ios",
          applicationId,
        }).ok,
      ).toBe(false);
    },
  );

  it.each([null, {}, { extra: { mizyunVariant: "unknown" } }])(
    "rejects configured runs without a usable manifest identity %j",
    (manifest) => {
      expect(
        guardMobileEnvironment(loadMobileConfig({ env: dev }), manifest).ok,
      ).toBe(false);
    },
  );

  it("rejects a self-consistent Dev manifest on installed Production", () => {
    expect(
      guardMobileEnvironment(loadMobileConfig({ env: dev }), identity, {
        platform: "ios",
        applicationId: "com.mizyun.app",
      }).ok,
    ).toBe(false);
  });

  it("requires the selected platform manifest ID to match the installed app", () => {
    expect(
      guardMobileEnvironment(loadMobileConfig({ env: dev }), {
        ...identity,
        ios: { bundleIdentifier: "com.unknown" },
      }).ok,
    ).toBe(false);
    expect(
      guardMobileEnvironment(loadMobileConfig({ env: dev }), identity, {
        platform: "android",
        applicationId: "com.mizyun.dev",
      }).ok,
    ).toBe(true);
  });

  it("supports an explicit web manifest but rejects unidentified configured web", () => {
    const web = { platform: "web", applicationId: null };
    expect(
      guardMobileEnvironment(loadMobileConfig({ env: dev }), identity, web).ok,
    ).toBe(true);
    expect(
      guardMobileEnvironment(loadMobileConfig({ env: dev }), null, web).ok,
    ).toBe(false);
  });

  it.each([
    {
      platform: "ios",
      applicationId: "host.exp.Exponent",
      executionEnvironment: "storeClient",
    },
    {
      platform: "android",
      applicationId: "host.exp.exponent",
      executionEnvironment: "storeClient",
    },
  ])("allows only Dev in the explicit Expo Go runtime %j", (expoGo) => {
    expect(
      guardMobileEnvironment(loadMobileConfig({ env: dev }), identity, expoGo)
        .ok,
    ).toBe(true);
    expect(
      guardMobileEnvironment(
        loadMobileConfig({ env: dev }),
        {
          ios: { bundleIdentifier: "com.mizyun.app" },
          android: { package: "com.mizyun.app" },
          extra: { mizyunVariant: "production" },
        },
        expoGo,
      ).ok,
    ).toBe(false);
  });

  it.each(["com.mizyun.app", null, "com.unknown.app"])(
    "does not construct either client when installed identity is %s for a Dev manifest",
    async (applicationId) => {
      for (const [key, value] of Object.entries(dev)) vi.stubEnv(key, value);
      vi.doMock("expo-constants", () => ({
        default: { expoConfig: identity },
      }));
      vi.doMock("expo-application", () => ({ applicationId }));
      vi.resetModules();
      const auth = await import("./auth-client");
      const api = await import("./api-client");
      expect(adapterFactory).not.toHaveBeenCalled();
      expect(auth.authConfiguration.configured).toBe(false);
      expect(api.apiConfiguration.configured).toBe(false);
    },
  );
});
