import {
  deriveSubscriptionEntitlement,
  type PlanTierValue,
  type StoreEntitlementSnapshot,
  type SubscriptionEntitlementRepository,
  type UserId,
} from "@mizyun/core";

/** Server-only reader of the billing service's current customer record. */
export interface EntitlementReader {
  readEntitlement(
    appUserId: string,
    entitlementId: string,
  ): Promise<{
    readonly snapshot: StoreEntitlementSnapshot | null;
    readonly observedAt: Date;
  }>;
}

export interface BillingReconcilerOptions {
  readonly repository: SubscriptionEntitlementRepository;
  readonly reader: EntitlementReader;
  readonly entitlementId: string;
  readonly allowSandbox: boolean;
  readonly now?: () => Date;
}

export type ReconcileOutcome =
  | { readonly kind: "unknown_user" }
  | {
      readonly kind: "applied" | "stale";
      readonly planTier: PlanTierValue | null;
    };

/**
 * Re-reads one account's entitlement from the billing service and records
 * it (ADR-0080). Webhook events and the app's "sync" request only trigger
 * this; neither carries entitlement data the server trusts. The result is a
 * function of the latest snapshot, so a replayed or reordered trigger
 * converges on the same state and never double-applies.
 */
export class BillingReconciler {
  readonly #repository: SubscriptionEntitlementRepository;
  readonly #reader: EntitlementReader;
  readonly #entitlementId: string;
  readonly #allowSandbox: boolean;
  readonly #now: () => Date;

  constructor(options: BillingReconcilerOptions) {
    this.#repository = options.repository;
    this.#reader = options.reader;
    this.#entitlementId = options.entitlementId;
    this.#allowSandbox = options.allowSandbox;
    this.#now = options.now ?? (() => new Date());
  }

  async reconcile(
    userId: UserId,
    eventId: string | null,
  ): Promise<ReconcileOutcome> {
    // Never ask the billing service about ids that are not Mizyun accounts
    // (deleted or foreign): its lookup would create a customer record.
    if (!(await this.#repository.userExists(userId))) {
      return { kind: "unknown_user" };
    }
    const reading = await this.#reader.readEntitlement(
      userId,
      this.#entitlementId,
    );
    const state = deriveSubscriptionEntitlement(
      this.#entitlementId,
      reading.snapshot,
      { now: this.#now(), allowSandbox: this.#allowSandbox },
    );
    const result = await this.#repository.apply(userId, state, {
      observedAt: reading.observedAt,
      eventId,
    });
    if (result.planTier === null && !result.applied) {
      return { kind: "unknown_user" };
    }
    return {
      kind: result.applied ? "applied" : "stale",
      planTier: result.planTier,
    };
  }
}
