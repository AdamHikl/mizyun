import type {
  OwnerBillingView,
  PlanTierValue,
  StoredSubscriptionEntitlement,
  SubscriptionEntitlementRepository,
  SubscriptionEntitlementState,
  UserId,
} from "@mizyun/core";

/**
 * In-memory mirror of the `subscription_entitlements` table and the
 * `billing_apply_entitlement` / `billing_recompute_plan_tier` SQL functions,
 * for API tests and the no-Supabase development server.
 */
export class InMemorySubscriptionEntitlementRepository implements SubscriptionEntitlementRepository {
  readonly #users = new Set<UserId>();
  readonly #betaPro = new Set<UserId>();
  readonly #tiers = new Map<UserId, PlanTierValue>();
  readonly #rows = new Map<UserId, StoredSubscriptionEntitlement>();
  readonly #events = new Map<string, { processed: boolean }>();
  readonly #now: () => Date;
  applyCalls = 0;

  constructor(options: { readonly now?: () => Date } = {}) {
    this.#now = options.now ?? (() => new Date());
  }

  addUser(
    userId: UserId,
    options: { readonly betaPro?: boolean; readonly manualPaid?: boolean } = {},
  ): void {
    this.#users.add(userId);
    if (options.betaPro) this.#betaPro.add(userId);
    this.#tiers.set(userId, options.manualPaid ? "paid" : "free");
    this.#recompute(userId, false);
  }

  deleteUser(userId: UserId): void {
    this.#users.delete(userId);
    this.#betaPro.delete(userId);
    this.#tiers.delete(userId);
    this.#rows.delete(userId);
  }

  planTier(userId: UserId): PlanTierValue | undefined {
    return this.#tiers.get(userId);
  }

  row(userId: UserId): StoredSubscriptionEntitlement | undefined {
    return this.#rows.get(userId);
  }

  #recompute(userId: UserId, subscriptionWasActive: boolean): PlanTierValue {
    const row = this.#rows.get(userId);
    const active =
      row?.status === "active" &&
      (row.expiresAt === null ||
        row.expiresAt.getTime() > this.#now().getTime());
    const current = this.#tiers.get(userId) ?? "free";
    const tier: PlanTierValue =
      active || this.#betaPro.has(userId)
        ? "paid"
        : subscriptionWasActive
          ? "free"
          : current;
    this.#tiers.set(userId, tier);
    return tier;
  }

  async readForOwner(userId: UserId): Promise<OwnerBillingView> {
    return {
      planTier: this.#tiers.get(userId) ?? "free",
      betaProApproved: this.#betaPro.has(userId),
      entitlement: this.#rows.get(userId) ?? null,
    };
  }

  async userExists(userId: UserId): Promise<boolean> {
    return this.#users.has(userId);
  }

  async apply(
    userId: UserId,
    state: SubscriptionEntitlementState,
    options: { readonly observedAt: Date; readonly eventId: string | null },
  ): Promise<{
    readonly applied: boolean;
    readonly planTier: PlanTierValue | null;
  }> {
    this.applyCalls += 1;
    if (!this.#users.has(userId)) return { applied: false, planTier: null };
    const existing = this.#rows.get(userId);
    const wasActive = existing?.status === "active";
    const applied =
      existing === undefined ||
      existing.observedAt.getTime() <= options.observedAt.getTime();
    if (applied) {
      this.#rows.set(userId, {
        ...state,
        userId,
        observedAt: options.observedAt,
        updatedAt: this.#now(),
      });
    }
    return { applied, planTier: this.#recompute(userId, wasActive) };
  }

  async claimWebhookEvent(eventId: string): Promise<boolean> {
    const existing = this.#events.get(eventId);
    if (existing) return existing.processed;
    this.#events.set(eventId, { processed: false });
    return false;
  }

  async completeWebhookEvent(eventId: string): Promise<void> {
    this.#events.set(eventId, { processed: true });
  }
}
