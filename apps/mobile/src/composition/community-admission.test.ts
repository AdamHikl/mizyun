import { afterEach, describe, expect, it, vi } from "vitest";
import { loadMobileConfig } from "@mizyun/config";
import { resolveCommunityEnrollmentOpen } from "./community-admission";

const devEnv = {
  EXPO_PUBLIC_API_URL: "https://mizyun-api-dev.phiskel.com",
  EXPO_PUBLIC_SUPABASE_URL: "https://mizyun-supabase-dev.phiskel.com",
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  EXPO_PUBLIC_AUTH_REDIRECT_URI: "mizyun-dev://auth/callback",
};
const resolve = (variant: unknown = "dev", env = devEnv) =>
  resolveCommunityEnrollmentOpen({
    variant,
    configuration: loadMobileConfig({ env }),
  });

afterEach(() => vi.unstubAllEnvs());
describe("Dev-only Community enrollment presentation", () => {
  it("opens deliberate enrollment for the validated canonical Dev build targets", () => {
    expect(resolve()).toBe(true);
    expect(
      resolve("dev", {
        ...devEnv,
        EXPO_PUBLIC_API_URL: `${devEnv.EXPO_PUBLIC_API_URL}/`,
        EXPO_PUBLIC_SUPABASE_URL: `${devEnv.EXPO_PUBLIC_SUPABASE_URL}/`,
      }),
    ).toBe(true);
  });
  it.each(["production", "preview", undefined, null, "DEV"])(
    "keeps variant %s closed even with Dev endpoints",
    (variant) => {
      expect(
        resolveCommunityEnrollmentOpen({
          variant,
          configuration: loadMobileConfig({ env: devEnv }),
        }),
      ).toBe(false);
    },
  );
  const productionEnv = {
    ...devEnv,
    EXPO_PUBLIC_API_URL: "https://mizyun-api.phiskel.com",
    EXPO_PUBLIC_SUPABASE_URL: "https://mizyun-supabase.phiskel.com",
    EXPO_PUBLIC_AUTH_REDIRECT_URI: "mizyun://auth/callback",
  };
  const resolveProduction = (communityReleased: unknown, env = productionEnv) =>
    resolveCommunityEnrollmentOpen({
      variant: "production",
      configuration: loadMobileConfig({ env }),
      communityReleased,
    });
  it("keeps Production closed without the build's release flag, even when a public enrollment flag is true", () => {
    vi.stubEnv("EXPO_PUBLIC_COMMUNITY_ENROLLMENT_OPEN", "true");
    expect(resolve("production", productionEnv)).toBe(false);
    for (const flag of [false, "true", 1, null, undefined])
      expect(resolveProduction(flag)).toBe(false);
    expect(resolve("dev", productionEnv)).toBe(false);
  });
  it("opens a released Production build only on the canonical Production targets", () => {
    expect(resolveProduction(true)).toBe(true);
    expect(
      resolveProduction(true, {
        ...productionEnv,
        EXPO_PUBLIC_API_URL: `${productionEnv.EXPO_PUBLIC_API_URL}/`,
      }),
    ).toBe(true);
    for (const override of [
      { EXPO_PUBLIC_API_URL: "https://mizyun-api-dev.phiskel.com" },
      { EXPO_PUBLIC_SUPABASE_URL: "https://mizyun-supabase-dev.phiskel.com" },
      { EXPO_PUBLIC_AUTH_REDIRECT_URI: "mizyun-dev://auth/callback" },
      { EXPO_PUBLIC_API_URL: "https://mizyun-api.phiskel.com.attacker.test" },
    ])
      expect(resolveProduction(true, { ...productionEnv, ...override })).toBe(
        false,
      );
    expect(
      resolveCommunityEnrollmentOpen({
        variant: "preview",
        configuration: loadMobileConfig({ env: productionEnv }),
        communityReleased: true,
      }),
    ).toBe(false);
  });
  it.each([
    { EXPO_PUBLIC_API_URL: "https://mizyun-api.phiskel.com" },
    { EXPO_PUBLIC_SUPABASE_URL: "https://mizyun-supabase.phiskel.com" },
    { EXPO_PUBLIC_AUTH_REDIRECT_URI: "mizyun://auth/callback" },
    { EXPO_PUBLIC_API_URL: "https://mizyun-api-dev.phiskel.com.attacker.test" },
    { EXPO_PUBLIC_API_URL: "https://attacker.test/mizyun-api-dev" },
    { EXPO_PUBLIC_API_URL: "https://mizyun-api-dev.phiskel.com@attacker.test" },
    { EXPO_PUBLIC_API_URL: "http://mizyun-api-dev.phiskel.com" },
    { EXPO_PUBLIC_API_URL: "https://mizyun-api-dev.phiskel.com:4000" },
    { EXPO_PUBLIC_API_URL: "https://mizyun-api-dev.phiskel.com/production" },
    {
      EXPO_PUBLIC_API_URL:
        "https://mizyun-api-dev.phiskel.com?target=production",
    },
    { EXPO_PUBLIC_AUTH_REDIRECT_URI: "mizyun-dev://auth/callback/other" },
  ])("fails closed on conflicting or noncanonical target %j", (override) => {
    expect(resolve("dev", { ...devEnv, ...override })).toBe(false);
  });
  it("fails closed when the public configuration is missing, malformed or contains an unvalidated flag", () => {
    expect(
      resolve("dev", { ...devEnv, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" }),
    ).toBe(false);
    expect(
      resolve("dev", { ...devEnv, EXPO_PUBLIC_API_URL: "not a URL" }),
    ).toBe(false);
    expect(
      resolveCommunityEnrollmentOpen({
        variant: "dev",
        configuration: loadMobileConfig({ env: {} }),
      }),
    ).toBe(false);
    expect(
      resolveCommunityEnrollmentOpen({
        variant: "dev",
        configuration: loadMobileConfig({
          env: { ...devEnv, EXPO_PUBLIC_COMMUNITY_ENROLLMENT_OPEN: "true" },
        }),
      }),
    ).toBe(false);
  });
});
