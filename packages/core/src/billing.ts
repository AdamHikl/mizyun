import type { UserId } from "./index";

/**
 * Store subscription entitlement rules (#332, ADR-0080).
 *
 * The billing adapter turns the billing service's current customer record
 * into a provider-neutral snapshot; this module decides whether that
 * snapshot grants Pro. Webhook events are only triggers: the decision is
 * always made from the latest snapshot, so a duplicated or reordered event
 * cannot grant or revoke anything on its own.
 */

export type SubscriptionStore = "app_store" | "play_store" | "other";
export type SubscriptionEnvironment = "sandbox" | "production";
export type SubscriptionPeriodType =
  "trial" | "intro" | "normal" | "promotional" | "prepaid";

/** The billing service's current view of one entitlement for one user. */
export interface StoreEntitlementSnapshot {
  readonly entitlementId: string;
  readonly productId: string | null;
  readonly store: SubscriptionStore | null;
  readonly environment: SubscriptionEnvironment | null;
  readonly periodType: SubscriptionPeriodType | null;
  readonly purchasedAt: Date | null;
  /** Null means non-expiring; Mizyun sells no lifetime plan, so it is rare. */
  readonly expiresAt: Date | null;
  readonly gracePeriodExpiresAt: Date | null;
  readonly refundedAt: Date | null;
  readonly unsubscribeDetectedAt: Date | null;
  readonly billingIssueDetectedAt: Date | null;
}

export type SubscriptionEntitlementStatus = "active" | "expired";

export interface SubscriptionEntitlementState {
  readonly entitlementId: string;
  readonly status: SubscriptionEntitlementStatus;
  readonly productId: string | null;
  readonly store: SubscriptionStore | null;
  readonly environment: SubscriptionEnvironment | null;
  readonly inTrial: boolean;
  readonly willRenew: boolean;
  readonly billingIssue: boolean;
  /** Latest instant access lasts: the later of expiry and grace period. */
  readonly expiresAt: Date | null;
}

export interface DeriveEntitlementOptions {
  readonly now: Date;
  /**
   * Sandbox (TestFlight, licence tester) purchases grant Pro only when true.
   * When false, a snapshot whose environment is unknown is refused too.
   */
  readonly allowSandbox: boolean;
}

const later = (a: Date | null, b: Date | null): Date | null => {
  if (a === null) return b;
  if (b === null) return a;
  return a.getTime() >= b.getTime() ? a : b;
};

/**
 * Decide whether a snapshot grants Pro now. A missing snapshot (the user
 * never bought, or the entitlement was transferred away) is expired.
 */
export const deriveSubscriptionEntitlement = (
  entitlementId: string,
  snapshot: StoreEntitlementSnapshot | null,
  options: DeriveEntitlementOptions,
): SubscriptionEntitlementState => {
  if (snapshot === null) {
    return {
      entitlementId,
      status: "expired",
      productId: null,
      store: null,
      environment: null,
      inTrial: false,
      willRenew: false,
      billingIssue: false,
      expiresAt: null,
    };
  }
  const accessUntil =
    snapshot.expiresAt === null
      ? null
      : later(snapshot.expiresAt, snapshot.gracePeriodExpiresAt);
  const refunded =
    snapshot.refundedAt !== null &&
    (snapshot.purchasedAt === null ||
      snapshot.refundedAt.getTime() >= snapshot.purchasedAt.getTime());
  const sandboxBlocked =
    !options.allowSandbox && snapshot.environment !== "production";
  const unexpired =
    snapshot.expiresAt === null ||
    (accessUntil !== null && accessUntil.getTime() > options.now.getTime());
  const active = unexpired && !refunded && !sandboxBlocked;
  return {
    entitlementId,
    status: active ? "active" : "expired",
    productId: snapshot.productId,
    store: snapshot.store,
    environment: snapshot.environment,
    inTrial: active && snapshot.periodType === "trial",
    willRenew:
      active &&
      snapshot.expiresAt !== null &&
      snapshot.unsubscribeDetectedAt === null,
    billingIssue: active && snapshot.billingIssueDetectedAt !== null,
    expiresAt: accessUntil,
  };
};

export type PlanTierValue = "free" | "paid";
export type PaidSource = "subscription" | "beta_pro" | "manual" | "none";

/** Stored entitlement row as the owner reads it. */
export interface StoredSubscriptionEntitlement extends SubscriptionEntitlementState {
  readonly userId: UserId;
  readonly observedAt: Date;
  readonly updatedAt: Date;
}

export interface OwnerBillingView {
  readonly planTier: PlanTierValue;
  readonly betaProApproved: boolean;
  readonly entitlement: StoredSubscriptionEntitlement | null;
}

/** Why `plan_tier` is paid, for display only; the server tier is authoritative. */
export const resolvePaidSource = (
  view: OwnerBillingView,
  now: Date,
): PaidSource => {
  if (view.planTier !== "paid") return "none";
  const entitlement = view.entitlement;
  if (
    entitlement?.status === "active" &&
    (entitlement.expiresAt === null ||
      entitlement.expiresAt.getTime() > now.getTime())
  ) {
    return "subscription";
  }
  return view.betaProApproved ? "beta_pro" : "manual";
};

/**
 * Persistence port. `readForOwner` runs under the user's session (RLS);
 * every write runs with the server's service role only.
 */
export interface SubscriptionEntitlementRepository {
  readForOwner(
    userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<OwnerBillingView>;
  userExists(userId: UserId): Promise<boolean>;
  apply(
    userId: UserId,
    state: SubscriptionEntitlementState,
    options: { readonly observedAt: Date; readonly eventId: string | null },
  ): Promise<{
    readonly applied: boolean;
    readonly planTier: PlanTierValue | null;
  }>;
  /** Records a webhook event id; true when it was already processed. */
  claimWebhookEvent(eventId: string, eventType: string): Promise<boolean>;
  completeWebhookEvent(eventId: string): Promise<void>;
}
