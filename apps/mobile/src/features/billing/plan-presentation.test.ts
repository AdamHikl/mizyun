import type { BillingEntitlementResponse } from "@mizyun/contracts";
import { describe, expect, it } from "vitest";

import {
  defaultPlanOption,
  describeCurrentPlan,
  hasStoreSubscription,
  manageSubscriptionUrl,
  offerLabel,
  orderPlanOptions,
  periodFromIso,
  priceLabel,
  purchaseButtonLabel,
  purchasesAvailable,
  renewalDisclosure,
  storeApiKeyFor,
  trialLabel,
  trialUnitFromStore,
  type PlanOption,
} from "./plan-presentation";

const monthly: PlanOption = {
  id: "$rc_monthly",
  period: "monthly",
  priceString: "€4.99",
  monthlyEquivalent: null,
  trial: null,
};
const yearly: PlanOption = {
  id: "$rc_annual",
  period: "yearly",
  priceString: "€49.99",
  monthlyEquivalent: "€4.17",
  trial: { count: 14, unit: "day" },
};
const fmt = (iso: string) => `D(${iso.slice(0, 10)})`;

function response(
  patch: Partial<BillingEntitlementResponse>,
): BillingEntitlementResponse {
  return {
    planTier: "free",
    paidSource: "none",
    purchasesEnabled: true,
    entitlement: null,
    storeSdk: null,
    ...patch,
  };
}
const entitlementBase = {
  status: "active" as const,
  productId: "pro_yearly:base",
  store: "play_store" as const,
  environment: "production" as const,
  inTrial: false,
  willRenew: true,
  billingIssue: false,
  expiresAt: "2027-01-02T00:00:00.000Z",
  updatedAt: "2026-10-26T00:00:00.000Z",
};

describe("options", () => {
  it("orders yearly first and selects it by default", () => {
    expect(orderPlanOptions([monthly, yearly]).map((o) => o.period)).toEqual([
      "yearly",
      "monthly",
    ]);
    expect(defaultPlanOption([monthly, yearly])).toBe(yearly);
    expect(defaultPlanOption([monthly])).toBe(monthly);
    expect(defaultPlanOption([])).toBeNull();
  });

  it("labels prices and trials from Store-provided strings", () => {
    expect(priceLabel(yearly)).toBe("€49.99 / year");
    expect(priceLabel(monthly)).toBe("€4.99 / month");
    expect(trialLabel({ count: 14, unit: "day" })).toBe("14-day free trial");
    expect(offerLabel(yearly)).toBe("14-day free trial, then €49.99 / year");
    expect(offerLabel(monthly)).toBe("€4.99 / month");
    expect(purchaseButtonLabel(yearly)).toBe("Start free trial");
    expect(purchaseButtonLabel(monthly)).toBe("Subscribe");
  });

  it("maps Store period and trial units", () => {
    expect(periodFromIso("P1Y")).toBe("yearly");
    expect(periodFromIso("P1M")).toBe("monthly");
    expect(periodFromIso("P1W")).toBeNull();
    expect(trialUnitFromStore("WEEK")).toBe("week");
    expect(trialUnitFromStore("nonsense")).toBeNull();
  });
});

describe("store sdk availability", () => {
  const sdk = {
    provider: "revenuecat" as const,
    iosPublicKey: "appl_x",
    androidPublicKey: null,
    entitlementId: "pro",
    offeringId: null,
  };
  it("selects the platform key and hides purchases without one", () => {
    expect(storeApiKeyFor(sdk, "ios")).toBe("appl_x");
    expect(storeApiKeyFor(sdk, "android")).toBeNull();
    expect(storeApiKeyFor(null, "ios")).toBeNull();
    expect(storeApiKeyFor(sdk, "web")).toBeNull();
    expect(purchasesAvailable(response({ storeSdk: sdk }), "ios")).toBe(true);
    expect(purchasesAvailable(response({ storeSdk: sdk }), "android")).toBe(
      false,
    );
    expect(
      purchasesAvailable(
        response({ storeSdk: sdk, purchasesEnabled: false }),
        "ios",
      ),
    ).toBe(false);
  });
});

describe("describeCurrentPlan", () => {
  it("describes the free plan", () => {
    expect(describeCurrentPlan(response({}), fmt)).toMatchObject({
      headline: "Free plan",
      detail: null,
      isPro: false,
    });
  });

  it("mentions an ended subscription while on free", () => {
    const summary = describeCurrentPlan(
      response({
        entitlement: { ...entitlementBase, status: "expired" },
      }),
      fmt,
    );
    expect(summary.isPro).toBe(false);
    expect(summary.detail).toBe(
      "Your Pro subscription ended on D(2027-01-02).",
    );
  });

  it("describes a renewing subscription", () => {
    const summary = describeCurrentPlan(
      response({
        planTier: "paid",
        paidSource: "subscription",
        entitlement: entitlementBase,
      }),
      fmt,
    );
    expect(summary).toMatchObject({
      headline: "Mizyun Pro",
      detail: "Renews on D(2027-01-02).",
      isPro: true,
      billingNotice: null,
    });
  });

  it("says when a subscription will end instead of renew, including trials", () => {
    const summary = describeCurrentPlan(
      response({
        planTier: "paid",
        paidSource: "subscription",
        entitlement: { ...entitlementBase, willRenew: false, inTrial: true },
      }),
      fmt,
    );
    expect(summary.detail).toBe(
      "Free trial. Ends on D(2027-01-02). It will not renew.",
    );
  });

  it("surfaces a billing issue", () => {
    const summary = describeCurrentPlan(
      response({
        planTier: "paid",
        paidSource: "subscription",
        entitlement: { ...entitlementBase, billingIssue: true },
      }),
      fmt,
    );
    expect(summary.billingNotice).toMatch(/payment method/);
  });

  it("names the Launch Pro Pass for beta_pro", () => {
    const summary = describeCurrentPlan(
      response({ planTier: "paid", paidSource: "beta_pro" }),
      fmt,
    );
    expect(summary.headline).toBe("Launch Pro Pass");
    expect(summary.isPro).toBe(true);
  });
});

describe("subscription management", () => {
  it("links to Apple subscriptions on iOS", () => {
    expect(manageSubscriptionUrl("ios", "pro_yearly", "com.mizyun.app")).toBe(
      "https://apps.apple.com/account/subscriptions",
    );
  });

  it("deep-links Google Play with the sku before ':' and the package", () => {
    expect(
      manageSubscriptionUrl(
        "android",
        "pro_yearly:base-plan",
        "com.mizyun.app",
      ),
    ).toBe(
      "https://play.google.com/store/account/subscriptions?sku=pro_yearly&package=com.mizyun.app",
    );
  });

  it("falls back to the generic Play page without a product", () => {
    expect(manageSubscriptionUrl("android", null, "com.mizyun.app")).toBe(
      "https://play.google.com/store/account/subscriptions",
    );
    expect(manageSubscriptionUrl("android", "pro", null)).toBe(
      "https://play.google.com/store/account/subscriptions",
    );
  });

  it("URL-encodes parameters", () => {
    expect(manageSubscriptionUrl("android", "a b&c", "p.q")).toContain(
      "sku=a%20b%26c",
    );
  });

  it("detects store subscriptions and names the store in the disclosure", () => {
    expect(hasStoreSubscription(response({}))).toBe(false);
    expect(
      hasStoreSubscription(response({ entitlement: entitlementBase })),
    ).toBe(true);
    expect(renewalDisclosure("ios")).toContain("Apple ID");
    expect(renewalDisclosure("android")).toContain("Google Play account");
    expect(renewalDisclosure("ios")).toContain("24 hours");
  });
});
