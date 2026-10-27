import type {
  BillingEntitlementResponse,
  BillingStoreSdk,
} from "@mizyun/contracts";

/**
 * Pure presentation helpers for the Mizyun Pro plan screen. Prices always come
 * from the Store; nothing here hardcodes an amount or decides `paid` (ADR-0029).
 */

export type PlanPeriod = "monthly" | "yearly";
export type PlanTrialUnit = "day" | "week" | "month" | "year";

export interface PlanTrial {
  readonly count: number;
  readonly unit: PlanTrialUnit;
}

export interface PlanOption {
  /** Store package identifier; opaque to the UI. */
  readonly id: string;
  readonly period: PlanPeriod;
  /** Localised price string exactly as the Store formats it. */
  readonly priceString: string;
  /** Localised per-month price for yearly plans, when the Store provides it. */
  readonly monthlyEquivalent: string | null;
  readonly trial: PlanTrial | null;
}

export function orderPlanOptions(
  options: readonly PlanOption[],
): readonly PlanOption[] {
  const rank = (option: PlanOption) => (option.period === "yearly" ? 0 : 1);
  return [...options].sort((a, b) => rank(a) - rank(b));
}

/** Yearly is selected by default; falls back to the first available option. */
export function defaultPlanOption(
  options: readonly PlanOption[],
): PlanOption | null {
  return (
    options.find((option) => option.period === "yearly") ?? options[0] ?? null
  );
}

export function periodLabel(period: PlanPeriod): string {
  return period === "yearly" ? "year" : "month";
}

/** "€49.99 / year" */
export function priceLabel(option: PlanOption): string {
  return `${option.priceString} / ${periodLabel(option.period)}`;
}

/** "14-day free trial" */
export function trialLabel(trial: PlanTrial): string {
  return `${trial.count}-${trial.unit} free trial`;
}

/** "14-day free trial, then €49.99 / year" or just the price. */
export function offerLabel(option: PlanOption): string {
  return option.trial === null
    ? priceLabel(option)
    : `${trialLabel(option.trial)}, then ${priceLabel(option)}`;
}

export function purchaseButtonLabel(option: PlanOption): string {
  return option.trial === null ? "Subscribe" : "Start free trial";
}

export function planTitle(period: PlanPeriod): string {
  return period === "yearly" ? "Yearly" : "Monthly";
}

/** Maps an ISO-8601 subscription period such as P1Y or P1M to a plan period. */
export function periodFromIso(iso: string | null): PlanPeriod | null {
  if (iso === "P1Y" || iso === "P12M") return "yearly";
  if (iso === "P1M") return "monthly";
  return null;
}

/** Maps a Store intro-price unit name to a trial unit, or null if unknown. */
export function trialUnitFromStore(unit: string): PlanTrialUnit | null {
  switch (unit.toUpperCase()) {
    case "DAY":
      return "day";
    case "WEEK":
      return "week";
    case "MONTH":
      return "month";
    case "YEAR":
      return "year";
    default:
      return null;
  }
}

export type StorePlatform = "ios" | "android";

/** The public Store SDK key for this platform, or null when unavailable. */
export function storeApiKeyFor(
  storeSdk: BillingStoreSdk | null,
  platform: string,
): string | null {
  if (storeSdk === null) return null;
  if (platform === "ios") return storeSdk.iosPublicKey;
  if (platform === "android") return storeSdk.androidPublicKey;
  return null;
}

export function purchasesAvailable(
  response: BillingEntitlementResponse,
  platform: string,
): boolean {
  return (
    response.purchasesEnabled &&
    storeApiKeyFor(response.storeSdk, platform) !== null
  );
}

export interface PlanSummary {
  readonly headline: string;
  readonly detail: string | null;
  readonly isPro: boolean;
  /** Present when the Store reports a payment problem. */
  readonly billingNotice: string | null;
}

export function defaultFormatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Current-plan text, derived only from the server response. */
export function describeCurrentPlan(
  response: BillingEntitlementResponse,
  formatDate: (iso: string) => string = defaultFormatDate,
): PlanSummary {
  const entitlement = response.entitlement;
  const billingNotice =
    entitlement?.status === "active" && entitlement.billingIssue
      ? "The Store could not take your last payment. Update your payment method in your Store account to keep Pro."
      : null;

  if (response.planTier === "paid") {
    if (response.paidSource === "beta_pro") {
      return {
        headline: "Launch Pro Pass",
        detail: "Pro is on through your Launch Pro Pass.",
        isPro: true,
        billingNotice: null,
      };
    }
    if (response.paidSource === "subscription" && entitlement !== null) {
      const prefix = entitlement.inTrial ? "Free trial. " : "";
      let detail: string | null = null;
      if (entitlement.expiresAt !== null) {
        const date = formatDate(entitlement.expiresAt);
        detail = entitlement.willRenew
          ? `${prefix}Renews on ${date}.`
          : `${prefix}Ends on ${date}. It will not renew.`;
      } else if (entitlement.inTrial) {
        detail = "Free trial.";
      }
      return {
        headline: "Mizyun Pro",
        detail,
        isPro: true,
        billingNotice,
      };
    }
    return {
      headline: "Mizyun Pro",
      detail: "Pro is on for your account.",
      isPro: true,
      billingNotice: null,
    };
  }

  const ended =
    entitlement?.status === "expired" && entitlement.expiresAt !== null
      ? `Your Pro subscription ended on ${formatDate(entitlement.expiresAt)}.`
      : null;
  return {
    headline: "Free plan",
    detail: ended,
    isPro: false,
    billingNotice: null,
  };
}

/** Whether the server reports a Store subscription worth managing. */
export function hasStoreSubscription(
  response: BillingEntitlementResponse,
): boolean {
  return (
    response.entitlement !== null &&
    (response.entitlement.store === "app_store" ||
      response.entitlement.store === "play_store")
  );
}

const APPLE_SUBSCRIPTIONS_URL = "https://apps.apple.com/account/subscriptions";
const GOOGLE_SUBSCRIPTIONS_URL =
  "https://play.google.com/store/account/subscriptions";

/**
 * The platform's subscription management (and cancellation) page. Google Play
 * product ids may carry a base-plan suffix after ':'; only the subscription id
 * is passed as `sku`.
 */
export function manageSubscriptionUrl(
  platform: string,
  productId: string | null,
  packageName: string | null,
): string {
  if (platform === "android") {
    const sku = productId?.split(":")[0] ?? "";
    if (sku.length > 0 && packageName !== null && packageName.length > 0) {
      return `${GOOGLE_SUBSCRIPTIONS_URL}?sku=${encodeURIComponent(sku)}&package=${encodeURIComponent(packageName)}`;
    }
    return GOOGLE_SUBSCRIPTIONS_URL;
  }
  return APPLE_SUBSCRIPTIONS_URL;
}

export function renewalDisclosure(platform: string): string {
  const account = platform === "android" ? "Google Play account" : "Apple ID";
  const store = platform === "android" ? "Google Play" : "App Store";
  return `Subscriptions renew automatically unless cancelled at least 24 hours before the end of the current period. Payment is charged to your ${account} at confirmation of purchase. Manage or cancel any time in your ${store} account settings.`;
}
