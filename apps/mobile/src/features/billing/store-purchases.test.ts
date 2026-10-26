import { describe, expect, it, vi } from "vitest";

import {
  createStorePurchases,
  mapPurchaseError,
  type PurchasesModule,
  type StorePackage,
  type StoreSession,
} from "./store-purchases";

const session: StoreSession = {
  userId: "user-1",
  apiKey: "appl_public",
  entitlementId: "pro",
  offeringId: null,
};

function pkg(
  identifier: string,
  packageType: string,
  extra: Partial<StorePackage["product"]> = {},
): StorePackage {
  return {
    identifier,
    packageType,
    product: {
      identifier: `${identifier}_product`,
      priceString: "€1.00",
      subscriptionPeriod: null,
      pricePerMonthString: null,
      introPrice: null,
      ...extra,
    },
  };
}

function fakeModule(overrides: Partial<PurchasesModule> = {}): PurchasesModule {
  const yearly = pkg("$rc_annual", "ANNUAL", {
    priceString: "€49.99",
    pricePerMonthString: "€4.17",
    introPrice: { price: 0, periodUnit: "DAY", periodNumberOfUnits: 14 },
  });
  const monthly = pkg("$rc_monthly", "MONTHLY", { priceString: "€4.99" });
  return {
    configure: vi.fn(),
    logIn: vi.fn().mockResolvedValue({}),
    getOfferings: vi.fn().mockResolvedValue({
      current: {
        availablePackages: [monthly, yearly, pkg("$rc_week", "WEEKLY")],
      },
      all: {},
    }),
    checkTrialOrIntroductoryPriceEligibility: vi
      .fn()
      .mockResolvedValue({ $rc_annual_product: { status: 2 } }),
    purchasePackage: vi.fn().mockResolvedValue({
      customerInfo: { entitlements: { active: { pro: {} } } },
    }),
    restorePurchases: vi
      .fn()
      .mockResolvedValue({ entitlements: { active: {} } }),
    ...overrides,
  };
}

const make = (mod: PurchasesModule | null, platform = "ios") =>
  createStorePurchases({ loadModule: async () => mod, platform });

describe("createStorePurchases", () => {
  it("reports unavailable when the native module is missing", async () => {
    const store = make(null);
    expect(await store.loadPlans(session)).toEqual({ kind: "unavailable" });
    expect(await store.purchase(session, "x")).toEqual({ kind: "failed" });
  });

  it("configures with only the user id and does not configure until used", async () => {
    const mod = fakeModule();
    const store = make(mod);
    expect(mod.configure).not.toHaveBeenCalled();
    await store.loadPlans(session);
    await store.loadPlans(session);
    expect(mod.configure).toHaveBeenCalledTimes(1);
    expect(mod.configure).toHaveBeenCalledWith({
      apiKey: "appl_public",
      appUserID: "user-1",
    });
    expect(mod.logIn).not.toHaveBeenCalled();
  });

  it("calls logIn (never logOut) when a different user opens the screen", async () => {
    const mod = fakeModule();
    const store = make(mod);
    await store.loadPlans(session);
    await store.loadPlans({ ...session, userId: "user-2" });
    expect(mod.configure).toHaveBeenCalledTimes(1);
    expect(mod.logIn).toHaveBeenCalledWith("user-2");
    expect("logOut" in mod).toBe(false);
  });

  it("logs in instead of reconfiguring when the native SDK is already configured", async () => {
    const mod = fakeModule({ isConfigured: vi.fn().mockResolvedValue(true) });
    await make(mod).loadPlans(session);
    expect(mod.configure).not.toHaveBeenCalled();
    expect(mod.logIn).toHaveBeenCalledWith("user-1");
  });

  it("maps monthly and yearly packages, ignoring others", async () => {
    const result = await make(fakeModule()).loadPlans(session);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.options).toEqual([
      {
        id: "$rc_monthly",
        period: "monthly",
        priceString: "€4.99",
        monthlyEquivalent: null,
        trial: null,
      },
      {
        id: "$rc_annual",
        period: "yearly",
        priceString: "€49.99",
        monthlyEquivalent: "€4.17",
        trial: { count: 14, unit: "day" },
      },
    ]);
  });

  it("hides the trial when iOS does not report eligibility", async () => {
    const mod = fakeModule({
      checkTrialOrIntroductoryPriceEligibility: vi
        .fn()
        .mockResolvedValue({ $rc_annual_product: { status: 1 } }),
    });
    const result = await make(mod).loadPlans(session);
    expect(
      result.kind === "ok" && result.options.every((o) => o.trial === null),
    ).toBe(true);
  });

  it("keeps the Android trial unless explicitly ineligible", async () => {
    const mod = fakeModule({
      checkTrialOrIntroductoryPriceEligibility: vi
        .fn()
        .mockResolvedValue({ $rc_annual_product: { status: 0 } }),
    });
    const result = await make(mod, "android").loadPlans(session);
    expect(
      result.kind === "ok" &&
        result.options.find((o) => o.period === "yearly")?.trial,
    ).toEqual({ count: 14, unit: "day" });
  });

  it("uses the named offering and fails when it is missing", async () => {
    const result = await make(fakeModule()).loadPlans({
      ...session,
      offeringId: "nope",
    });
    expect(result).toEqual({ kind: "failed" });
  });

  it("fails softly when offerings throw", async () => {
    const mod = fakeModule({
      getOfferings: vi.fn().mockRejectedValue(new Error("x")),
    });
    expect(await make(mod).loadPlans(session)).toEqual({ kind: "failed" });
  });

  it("purchases a loaded option and reports the client hint", async () => {
    const mod = fakeModule();
    const store = make(mod);
    await store.loadPlans(session);
    expect(await store.purchase(session, "$rc_annual")).toEqual({
      kind: "purchased",
      clientEntitlementActive: true,
    });
    expect(await store.purchase(session, "unknown")).toEqual({
      kind: "failed",
    });
  });

  it("maps cancel silently, pending and other failures", async () => {
    const run = async (error: unknown) => {
      const mod = fakeModule({
        purchasePackage: vi.fn().mockRejectedValue(error),
      });
      const store = make(mod);
      await store.loadPlans(session);
      return store.purchase(session, "$rc_annual");
    };
    expect(await run({ code: "1", userCancelled: null })).toEqual({
      kind: "cancelled",
    });
    expect(await run({ userCancelled: true })).toEqual({ kind: "cancelled" });
    expect(await run({ code: "20" })).toEqual({ kind: "pending" });
    expect(await run({ code: "2" })).toEqual({ kind: "failed" });
    expect(await run(new Error("boom"))).toEqual({ kind: "failed" });
    expect(mapPurchaseError(null)).toEqual({ kind: "failed" });
  });

  it("restores and reports whether the client sees an active entitlement", async () => {
    const store = make(fakeModule());
    expect(await store.restore(session)).toEqual({
      kind: "purchased",
      clientEntitlementActive: false,
    });
  });
});
