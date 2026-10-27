import {
  periodFromIso,
  trialUnitFromStore,
  type PlanOption,
  type PlanPeriod,
  type PlanTrial,
} from "./plan-presentation";

/**
 * Thin port around react-native-purchases (RevenueCat), loaded lazily so Expo
 * Go, tests and builds without the native module never crash. The Store SDK is
 * configured only when the plan screen opens (no RevenueCat contact for users
 * who never open it), always with the Supabase user id as the app user id and
 * never with email or other attributes. `logOut()` is never called because it
 * would mint an anonymous id. Results here are advisory: only the server
 * decides `paid` (ADR-0029).
 */

// Minimal structural view of the parts of react-native-purchases we use.
export interface StoreProduct {
  readonly identifier: string;
  readonly priceString: string;
  readonly subscriptionPeriod: string | null;
  readonly pricePerMonthString: string | null;
  readonly introPrice: {
    readonly price: number;
    readonly periodUnit: string;
    readonly periodNumberOfUnits: number;
  } | null;
}
export interface StorePackage {
  readonly identifier: string;
  readonly packageType: string;
  readonly product: StoreProduct;
}
export interface StoreOffering {
  readonly availablePackages: readonly StorePackage[];
}
export interface StoreCustomerInfo {
  readonly entitlements: {
    readonly active: Readonly<Record<string, unknown>>;
  };
}
export interface PurchasesModule {
  configure(config: { apiKey: string; appUserID?: string | null }): void;
  isConfigured?(): Promise<boolean>;
  logIn(appUserID: string): Promise<unknown>;
  getOfferings(): Promise<{
    readonly current: StoreOffering | null;
    readonly all: Readonly<Record<string, StoreOffering>>;
  }>;
  checkTrialOrIntroductoryPriceEligibility?(
    productIdentifiers: string[],
  ): Promise<Record<string, { readonly status: number }>>;
  purchasePackage(pkg: StorePackage): Promise<{
    readonly customerInfo: StoreCustomerInfo;
  }>;
  restorePurchases(): Promise<StoreCustomerInfo>;
}

// INTRO_ELIGIBILITY_STATUS values in react-native-purchases.
const ELIGIBLE = 2;
const INELIGIBLE = 1;
const NO_INTRO_OFFER = 3;
const PURCHASE_CANCELLED_CODE = "1";
const PAYMENT_PENDING_CODE = "20";

export interface StoreSession {
  readonly userId: string;
  readonly apiKey: string;
  readonly entitlementId: string;
  readonly offeringId: string | null;
}

export type LoadPlansResult =
  | { readonly kind: "ok"; readonly options: readonly PlanOption[] }
  | { readonly kind: "unavailable" }
  | { readonly kind: "failed" };

export type StorePurchaseResult =
  | {
      readonly kind: "purchased";
      /** Client-side hint only; never treat as proof of Pro. */
      readonly clientEntitlementActive: boolean;
    }
  | { readonly kind: "cancelled" }
  | { readonly kind: "pending" }
  | { readonly kind: "failed" };

export interface StorePurchases {
  loadPlans(session: StoreSession): Promise<LoadPlansResult>;
  purchase(
    session: StoreSession,
    optionId: string,
  ): Promise<StorePurchaseResult>;
  restore(session: StoreSession): Promise<StorePurchaseResult>;
}

export type PurchasesModuleLoader = () => Promise<PurchasesModule | null>;
export type StorePlatformName = "ios" | "android" | string;

/** Loads the real native module; null when it is not linked in this build. */
export const loadNativePurchases: PurchasesModuleLoader = async () => {
  try {
    const imported = (await import("react-native-purchases")) as unknown as {
      default?: PurchasesModule;
    } & Partial<PurchasesModule>;
    const module = (imported.default ?? imported) as PurchasesModule;
    return typeof module.configure === "function" ? module : null;
  } catch {
    return null;
  }
};

function packagePeriod(pkg: StorePackage): PlanPeriod | null {
  if (pkg.packageType === "ANNUAL") return "yearly";
  if (pkg.packageType === "MONTHLY") return "monthly";
  return periodFromIso(pkg.product.subscriptionPeriod);
}

function freeTrial(product: StoreProduct): PlanTrial | null {
  const intro = product.introPrice;
  if (intro === null || intro.price !== 0) return null;
  const unit = trialUnitFromStore(intro.periodUnit);
  if (unit === null || !(intro.periodNumberOfUnits > 0)) return null;
  return { count: intro.periodNumberOfUnits, unit };
}

/** Maps a Store error to a typed result. User cancellation is silent. */
export function mapPurchaseError(error: unknown): StorePurchaseResult {
  const e = (error ?? {}) as {
    code?: string | number;
    userCancelled?: boolean | null;
  };
  // PURCHASES_ERROR_CODE in @revenuecat/purchases-typescript-internal 19.x:
  // PURCHASE_CANCELLED_ERROR = "1", PAYMENT_PENDING_ERROR = "20".
  const code = e.code === undefined ? "" : String(e.code);
  if (code === PURCHASE_CANCELLED_CODE || e.userCancelled === true) {
    return { kind: "cancelled" };
  }
  if (code === PAYMENT_PENDING_CODE) return { kind: "pending" };
  return { kind: "failed" };
}

export function createStorePurchases(deps: {
  readonly loadModule: PurchasesModuleLoader;
  readonly platform: StorePlatformName;
}): StorePurchases {
  let configuredFor: string | null = null;
  let packages = new Map<string, StorePackage>();
  // Serialises configure/logIn so rapid screen opens never race.
  let queue: Promise<unknown> = Promise.resolve();

  const ensureConfigured = (
    session: StoreSession,
  ): Promise<PurchasesModule | null> => {
    const run = async (): Promise<PurchasesModule | null> => {
      const purchases = await deps.loadModule();
      if (purchases === null) return null;
      if (configuredFor === session.userId) return purchases;
      const alreadyConfigured =
        configuredFor !== null ||
        (purchases.isConfigured !== undefined &&
          (await purchases.isConfigured()));
      if (alreadyConfigured) {
        await purchases.logIn(session.userId);
      } else {
        purchases.configure({
          apiKey: session.apiKey,
          appUserID: session.userId,
        });
      }
      configuredFor = session.userId;
      return purchases;
    };
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  };

  const withModule = async <T>(
    session: StoreSession,
    onMissing: T,
    onError: (error: unknown) => T,
    action: (purchases: PurchasesModule) => Promise<T>,
  ): Promise<T> => {
    try {
      const purchases = await ensureConfigured(session);
      if (purchases === null) return onMissing;
      return await action(purchases);
    } catch (error) {
      return onError(error);
    }
  };

  const hasEntitlement = (info: StoreCustomerInfo, entitlementId: string) =>
    Object.prototype.hasOwnProperty.call(
      info.entitlements.active,
      entitlementId,
    );

  return {
    loadPlans: (session) =>
      withModule<LoadPlansResult>(
        session,
        { kind: "unavailable" },
        () => ({ kind: "failed" }),
        async (purchases) => {
          const offerings = await purchases.getOfferings();
          const offering =
            session.offeringId !== null
              ? (offerings.all[session.offeringId] ?? null)
              : offerings.current;
          if (offering === null) return { kind: "failed" };

          const picked = new Map<PlanPeriod, StorePackage>();
          for (const pkg of offering.availablePackages) {
            const period = packagePeriod(pkg);
            if (period !== null && !picked.has(period)) picked.set(period, pkg);
          }

          // Trial copy is shown only when the Store says this account can
          // actually get it. iOS must report ELIGIBLE; on Android the default
          // subscription option is already resolved per account, so only an
          // explicit "not eligible / no offer" hides it.
          let eligibility: Record<string, { readonly status: number }> = {};
          const withTrial = [...picked.values()].filter(
            (pkg) => freeTrial(pkg.product) !== null,
          );
          if (
            withTrial.length > 0 &&
            purchases.checkTrialOrIntroductoryPriceEligibility !== undefined
          ) {
            try {
              eligibility =
                await purchases.checkTrialOrIntroductoryPriceEligibility(
                  withTrial.map((pkg) => pkg.product.identifier),
                );
            } catch {
              eligibility = {};
            }
          }
          const trialAllowed = (pkg: StorePackage): boolean => {
            const status = eligibility[pkg.product.identifier]?.status;
            if (deps.platform === "android") {
              return status !== INELIGIBLE && status !== NO_INTRO_OFFER;
            }
            return status === ELIGIBLE;
          };

          packages = new Map();
          const options: PlanOption[] = [];
          for (const [period, pkg] of picked) {
            packages.set(pkg.identifier, pkg);
            options.push({
              id: pkg.identifier,
              period,
              priceString: pkg.product.priceString,
              monthlyEquivalent:
                period === "yearly" ? pkg.product.pricePerMonthString : null,
              trial: trialAllowed(pkg) ? freeTrial(pkg.product) : null,
            });
          }
          return options.length === 0
            ? { kind: "failed" }
            : { kind: "ok", options };
        },
      ),

    purchase: (session, optionId) =>
      withModule<StorePurchaseResult>(
        session,
        { kind: "failed" },
        mapPurchaseError,
        async (purchases) => {
          const pkg = packages.get(optionId);
          if (pkg === undefined) return { kind: "failed" };
          const result = await purchases.purchasePackage(pkg);
          return {
            kind: "purchased",
            clientEntitlementActive: hasEntitlement(
              result.customerInfo,
              session.entitlementId,
            ),
          };
        },
      ),

    restore: (session) =>
      withModule<StorePurchaseResult>(
        session,
        { kind: "failed" },
        mapPurchaseError,
        async (purchases) => {
          const info = await purchases.restorePurchases();
          return {
            kind: "purchased",
            clientEntitlementActive: hasEntitlement(
              info,
              session.entitlementId,
            ),
          };
        },
      ),
  };
}
