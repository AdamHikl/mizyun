import { describe, expect, it } from "vitest";

import {
  billingEntitlementResponseSchema,
  billingEntitlementSchema,
  billingStoreSdkSchema,
} from "./billing";

const entitlement = {
  status: "active",
  productId: "mizyun_pro:yearly",
  store: "app_store",
  environment: "production",
  inTrial: false,
  willRenew: true,
  billingIssue: false,
  expiresAt: "2026-11-26T12:00:00.000Z",
  updatedAt: "2026-10-26T12:00:00.000Z",
};

const storeSdk = {
  provider: "revenuecat",
  iosPublicKey: "appl_public",
  androidPublicKey: null,
  entitlementId: "pro",
  offeringId: "default",
};

const response = {
  planTier: "paid",
  paidSource: "subscription",
  purchasesEnabled: true,
  entitlement,
  storeSdk,
};

describe("billingEntitlementResponseSchema", () => {
  it("parses a full response", () => {
    expect(billingEntitlementResponseSchema.parse(response)).toEqual(response);
  });

  it("parses a free account with no entitlement or SDK", () => {
    const free = {
      planTier: "free",
      paidSource: "none",
      purchasesEnabled: false,
      entitlement: null,
      storeSdk: null,
    };
    expect(billingEntitlementResponseSchema.parse(free)).toEqual(free);
  });

  it("strips unknown top-level keys for forward compatibility", () => {
    const parsed = billingEntitlementResponseSchema.parse({
      ...response,
      futureField: 1,
    });
    expect(parsed).not.toHaveProperty("futureField");
  });

  it("rejects an invalid plan tier or paid source", () => {
    expect(
      billingEntitlementResponseSchema.safeParse({
        ...response,
        planTier: "pro",
      }).success,
    ).toBe(false);
    expect(
      billingEntitlementResponseSchema.safeParse({
        ...response,
        paidSource: "stripe",
      }).success,
    ).toBe(false);
  });

  it("rejects missing required fields", () => {
    const { purchasesEnabled: _omit, ...rest } = response;
    expect(billingEntitlementResponseSchema.safeParse(rest).success).toBe(
      false,
    );
  });
});

describe("billingEntitlementSchema", () => {
  it("rejects unknown keys", () => {
    expect(
      billingEntitlementSchema.safeParse({ ...entitlement, receipt: "abc" })
        .success,
    ).toBe(false);
  });

  it("rejects unknown enum values and non-ISO dates", () => {
    expect(
      billingEntitlementSchema.safeParse({ ...entitlement, status: "grace" })
        .success,
    ).toBe(false);
    expect(
      billingEntitlementSchema.safeParse({ ...entitlement, store: "amazon" })
        .success,
    ).toBe(false);
    expect(
      billingEntitlementSchema.safeParse({
        ...entitlement,
        expiresAt: "tomorrow",
      }).success,
    ).toBe(false);
  });

  it("allows null product, store, environment and expiry", () => {
    expect(
      billingEntitlementSchema.safeParse({
        ...entitlement,
        productId: null,
        store: null,
        environment: null,
        expiresAt: null,
      }).success,
    ).toBe(true);
  });
});

describe("billingStoreSdkSchema", () => {
  it("requires the revenuecat provider", () => {
    expect(
      billingStoreSdkSchema.safeParse({ ...storeSdk, provider: "stripe" })
        .success,
    ).toBe(false);
  });

  it("rejects unknown keys such as a secret key", () => {
    expect(
      billingStoreSdkSchema.safeParse({ ...storeSdk, secretKey: "sk_x" })
        .success,
    ).toBe(false);
  });

  it("rejects an empty entitlement id", () => {
    expect(
      billingStoreSdkSchema.safeParse({ ...storeSdk, entitlementId: "" })
        .success,
    ).toBe(false);
  });
});
