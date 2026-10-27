import { describe, expect, it } from "vitest";

import {
  deriveSubscriptionEntitlement,
  resolvePaidSource,
  type OwnerBillingView,
  type StoreEntitlementSnapshot,
  type StoredSubscriptionEntitlement,
} from "./billing";
import type { UserId } from "./index";

const NOW = new Date("2026-10-26T12:00:00.000Z");
const at = (offsetMs: number): Date => new Date(NOW.getTime() + offsetMs);
const DAY = 86_400_000;
const options = { now: NOW, allowSandbox: false };

const snapshot = (
  overrides: Partial<StoreEntitlementSnapshot> = {},
): StoreEntitlementSnapshot => ({
  entitlementId: "pro",
  productId: "mizyun_pro_yearly",
  store: "app_store",
  environment: "production",
  periodType: "normal",
  purchasedAt: at(-30 * DAY),
  expiresAt: at(30 * DAY),
  gracePeriodExpiresAt: null,
  refundedAt: null,
  unsubscribeDetectedAt: null,
  billingIssueDetectedAt: null,
  ...overrides,
});

const derive = (
  s: StoreEntitlementSnapshot | null,
  o: { now?: Date; allowSandbox?: boolean } = {},
) =>
  deriveSubscriptionEntitlement("pro", s, {
    now: o.now ?? NOW,
    allowSandbox: o.allowSandbox ?? false,
  });

describe("deriveSubscriptionEntitlement", () => {
  it("treats a missing snapshot as expired with no flags", () => {
    expect(derive(null)).toEqual({
      entitlementId: "pro",
      status: "expired",
      productId: null,
      store: null,
      environment: null,
      inTrial: false,
      willRenew: false,
      billingIssue: false,
      expiresAt: null,
    });
  });

  it("is active, renewing and not in trial for a normal paid period", () => {
    const state = derive(snapshot());
    expect(state.status).toBe("active");
    expect(state.willRenew).toBe(true);
    expect(state.inTrial).toBe(false);
    expect(state.expiresAt).toEqual(at(30 * DAY));
    expect(state.productId).toBe("mizyun_pro_yearly");
    expect(state.store).toBe("app_store");
  });

  it("reports an active trial", () => {
    const state = derive(snapshot({ periodType: "trial" }));
    expect(state.status).toBe("active");
    expect(state.inTrial).toBe(true);
  });

  it("is expired at exactly now and active one millisecond earlier", () => {
    expect(derive(snapshot({ expiresAt: NOW })).status).toBe("expired");
    expect(derive(snapshot({ expiresAt: at(1) })).status).toBe("active");
    expect(derive(snapshot({ expiresAt: at(-1) })).status).toBe("expired");
  });

  it("extends access through the grace period and reports the later instant", () => {
    const state = derive(
      snapshot({
        expiresAt: at(-DAY),
        gracePeriodExpiresAt: at(2 * DAY),
        billingIssueDetectedAt: at(-DAY),
      }),
    );
    expect(state.status).toBe("active");
    expect(state.expiresAt).toEqual(at(2 * DAY));
    expect(state.billingIssue).toBe(true);
  });

  it("expires once the grace period has also passed", () => {
    const state = derive(
      snapshot({ expiresAt: at(-3 * DAY), gracePeriodExpiresAt: at(-DAY) }),
    );
    expect(state.status).toBe("expired");
    expect(state.expiresAt).toEqual(at(-DAY));
  });

  it("does not let an earlier grace date shorten expiry", () => {
    const state = derive(
      snapshot({ expiresAt: at(5 * DAY), gracePeriodExpiresAt: at(DAY) }),
    );
    expect(state.expiresAt).toEqual(at(5 * DAY));
  });

  it("expires when refunded after purchase, even if time remains", () => {
    const state = derive(
      snapshot({ purchasedAt: at(-10 * DAY), refundedAt: at(-DAY) }),
    );
    expect(state.status).toBe("expired");
  });

  it("treats a refund at the purchase instant as a refund", () => {
    const t = at(-DAY);
    expect(derive(snapshot({ purchasedAt: t, refundedAt: t })).status).toBe(
      "expired",
    );
  });

  it("stays active when the refund predates a newer purchase", () => {
    const state = derive(
      snapshot({ purchasedAt: at(-DAY), refundedAt: at(-20 * DAY) }),
    );
    expect(state.status).toBe("active");
  });

  it("treats a refund with an unknown purchase date as a refund", () => {
    expect(
      derive(snapshot({ purchasedAt: null, refundedAt: at(-DAY) })).status,
    ).toBe("expired");
  });

  it("blocks sandbox purchases unless allowed", () => {
    const sandbox = snapshot({ environment: "sandbox" });
    expect(derive(sandbox).status).toBe("expired");
    expect(derive(sandbox, { allowSandbox: true }).status).toBe("active");
    expect(derive(sandbox).environment).toBe("sandbox");
  });

  it("does not let allowSandbox change a production purchase", () => {
    const prod = snapshot({ environment: "production" });
    expect(derive(prod, { allowSandbox: true }).status).toBe("active");
    expect(derive(prod, { allowSandbox: false }).status).toBe("active");
    const expiredProd = snapshot({ expiresAt: at(-DAY) });
    expect(derive(expiredProd, { allowSandbox: true }).status).toBe("expired");
  });

  it("refuses an unknown environment unless sandbox is allowed", () => {
    expect(derive(snapshot({ environment: null })).status).toBe("expired");
    expect(
      derive(snapshot({ environment: null }), { allowSandbox: true }).status,
    ).toBe("active");
  });

  it("treats a null expiry as active, non-renewing and unbounded", () => {
    const state = derive(snapshot({ expiresAt: null }));
    expect(state.status).toBe("active");
    expect(state.willRenew).toBe(false);
    expect(state.expiresAt).toBeNull();
  });

  it("ignores a grace date when the entitlement never expires", () => {
    const state = derive(
      snapshot({ expiresAt: null, gracePeriodExpiresAt: at(DAY) }),
    );
    expect(state.expiresAt).toBeNull();
  });

  it("keeps access but stops renewing after an unsubscribe", () => {
    const state = derive(snapshot({ unsubscribeDetectedAt: at(-DAY) }));
    expect(state.status).toBe("active");
    expect(state.willRenew).toBe(false);
  });

  it("flags a billing issue only while active", () => {
    expect(
      derive(snapshot({ billingIssueDetectedAt: at(-1000) })).billingIssue,
    ).toBe(true);
    expect(derive(snapshot()).billingIssue).toBe(false);
  });

  it("never reports trial, renewal or billing issue once expired", () => {
    const expiredCases = [
      snapshot({
        periodType: "trial",
        expiresAt: at(-DAY),
        billingIssueDetectedAt: at(-2 * DAY),
      }),
      snapshot({
        periodType: "trial",
        purchasedAt: at(-DAY),
        refundedAt: at(-1000),
        billingIssueDetectedAt: at(-2 * DAY),
      }),
      snapshot({
        periodType: "trial",
        environment: "sandbox",
        billingIssueDetectedAt: at(-2 * DAY),
      }),
    ];
    for (const s of expiredCases) {
      const state = derive(s);
      expect(state.status).toBe("expired");
      expect(state.inTrial).toBe(false);
      expect(state.willRenew).toBe(false);
      expect(state.billingIssue).toBe(false);
    }
  });
});

const USER = "00000000-0000-4000-8000-000000000001" as UserId;

const stored = (
  overrides: Partial<StoredSubscriptionEntitlement> = {},
): StoredSubscriptionEntitlement => ({
  userId: USER,
  entitlementId: "pro",
  status: "active",
  productId: "p",
  store: "app_store",
  environment: "production",
  inTrial: false,
  willRenew: true,
  billingIssue: false,
  expiresAt: at(DAY),
  observedAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const view = (overrides: Partial<OwnerBillingView> = {}): OwnerBillingView => ({
  planTier: "paid",
  betaProApproved: false,
  entitlement: stored(),
  ...overrides,
});

describe("resolvePaidSource", () => {
  it("is none for a free tier even with an active entitlement row", () => {
    expect(resolvePaidSource(view({ planTier: "free" }), NOW)).toBe("none");
  });

  it("is subscription for paid with an active unexpired entitlement", () => {
    expect(resolvePaidSource(view(), NOW)).toBe("subscription");
  });

  it("is subscription for an active non-expiring entitlement", () => {
    expect(
      resolvePaidSource(
        view({ entitlement: stored({ expiresAt: null }) }),
        NOW,
      ),
    ).toBe("subscription");
  });

  it("falls to beta_pro when the entitlement lapsed and beta is approved", () => {
    expect(
      resolvePaidSource(
        view({
          betaProApproved: true,
          entitlement: stored({ status: "expired" }),
        }),
        NOW,
      ),
    ).toBe("beta_pro");
  });

  it("does not trust a stale active row whose expiry has passed", () => {
    expect(
      resolvePaidSource(
        view({
          entitlement: stored({ expiresAt: NOW }),
          betaProApproved: true,
        }),
        NOW,
      ),
    ).toBe("beta_pro");
    expect(
      resolvePaidSource(
        view({ entitlement: stored({ expiresAt: at(-1) }) }),
        NOW,
      ),
    ).toBe("manual");
  });

  it("is manual for paid with no entitlement and no beta approval", () => {
    expect(resolvePaidSource(view({ entitlement: null }), NOW)).toBe("manual");
  });

  it("prefers subscription over an approved beta", () => {
    expect(resolvePaidSource(view({ betaProApproved: true }), NOW)).toBe(
      "subscription",
    );
  });
});
