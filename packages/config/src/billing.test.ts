import { describe, expect, it } from "vitest";
import { loadBillingConfig } from "./billing";

const secrets = {
  REVENUECAT_SECRET_API_KEY: "sk_test",
  REVENUECAT_WEBHOOK_SIGNING_SECRET: "whsec_test",
};

describe("loadBillingConfig", () => {
  it("is off in Production unless explicitly enabled", () => {
    expect(
      loadBillingConfig({ MIZYUN_ENVIRONMENT: "production", ...secrets }),
    ).toEqual({ enabled: false, reason: "flag_off" });
    expect(loadBillingConfig({ ...secrets })).toEqual({
      enabled: false,
      reason: "flag_off",
    });
    expect(
      loadBillingConfig({
        MIZYUN_ENVIRONMENT: "production",
        BILLING_ENABLED: "1",
        ...secrets,
      }).enabled,
    ).toBe(false);
    const on = loadBillingConfig({
      MIZYUN_ENVIRONMENT: "production",
      BILLING_ENABLED: "true",
      ...secrets,
    });
    expect(on.enabled).toBe(true);
    expect(on.enabled && on.config.allowSandbox).toBe(false);
  });

  it("is on in Dev by default and can be switched off", () => {
    const dev = loadBillingConfig({ MIZYUN_ENVIRONMENT: "dev", ...secrets });
    expect(dev.enabled && dev.config).toMatchObject({
      entitlementId: "pro",
      allowSandbox: true,
      webhookAuthorization: null,
    });
    expect(
      loadBillingConfig({
        MIZYUN_ENVIRONMENT: "dev",
        BILLING_ENABLED: "false",
        ...secrets,
      }),
    ).toEqual({ enabled: false, reason: "flag_off" });
  });

  it("stays off without both server secrets", () => {
    expect(
      loadBillingConfig({
        MIZYUN_ENVIRONMENT: "dev",
        REVENUECAT_SECRET_API_KEY: "sk_test",
      }),
    ).toEqual({ enabled: false, reason: "missing_secrets" });
    expect(
      loadBillingConfig({
        MIZYUN_ENVIRONMENT: "dev",
        REVENUECAT_WEBHOOK_SIGNING_SECRET: " ",
        REVENUECAT_SECRET_API_KEY: "sk_test",
      }),
    ).toEqual({ enabled: false, reason: "missing_secrets" });
  });

  it("rejects malformed identifiers and honours the sandbox override", () => {
    const result = loadBillingConfig({
      MIZYUN_ENVIRONMENT: "dev",
      BILLING_ALLOW_SANDBOX: "false",
      REVENUECAT_ENTITLEMENT_ID: "pro plan/../",
      REVENUECAT_OFFERING_ID: "default",
      ...secrets,
    });
    expect(result.enabled && result.config).toMatchObject({
      entitlementId: "pro",
      offeringId: "default",
      allowSandbox: false,
    });
  });
});
