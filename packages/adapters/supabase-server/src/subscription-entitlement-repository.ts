import type {
  OwnerBillingView,
  PlanTierValue,
  StoredSubscriptionEntitlement,
  SubscriptionEntitlementRepository,
  SubscriptionEntitlementState,
  SubscriptionEnvironment,
  SubscriptionStore,
  UserId,
} from "@mizyun/core";
import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

interface SubscriptionEntitlementRow extends Record<string, unknown> {
  readonly user_id: string;
  readonly entitlement_id: string;
  readonly status: "active" | "expired";
  readonly product_id: string | null;
  readonly store: SubscriptionStore | null;
  readonly environment: SubscriptionEnvironment | null;
  readonly in_trial: boolean;
  readonly will_renew: boolean;
  readonly billing_issue: boolean;
  readonly expires_at: string | null;
  readonly observed_at: string;
  readonly updated_at: string;
}

interface ProfileTierRow extends Record<string, unknown> {
  readonly plan_tier: PlanTierValue;
}

interface BetaProStatusRow extends Record<string, unknown> {
  readonly status: string;
}

interface ApplyRow extends Record<string, unknown> {
  readonly applied: boolean;
  readonly plan_tier: PlanTierValue | null;
}

interface ClaimRow extends Record<string, unknown> {
  readonly already_processed: boolean;
}

const ENTITLEMENT_COLUMNS =
  "user_id,entitlement_id,status,product_id,store,environment,in_trial,will_renew,billing_issue,expires_at,observed_at,updated_at";

const toStored = (
  row: SubscriptionEntitlementRow,
): StoredSubscriptionEntitlement => ({
  userId: row.user_id as UserId,
  entitlementId: row.entitlement_id,
  status: row.status,
  productId: row.product_id,
  store: row.store,
  environment: row.environment,
  inTrial: row.in_trial,
  willRenew: row.will_renew,
  billingIssue: row.billing_issue,
  expiresAt: row.expires_at === null ? null : new Date(row.expires_at),
  observedAt: new Date(row.observed_at),
  updatedAt: new Date(row.updated_at),
});

export interface SupabaseSubscriptionEntitlementRepositoryOptions {
  /** Principal-scoped client: owner reads run under RLS. */
  readonly clientFor: (accessToken: string) => RepositorySupabaseClient;
  /** Service-role client: the only writer (ADR-0080). */
  readonly serviceRoleClient: RepositorySupabaseClient | null;
}

export class SupabaseSubscriptionEntitlementRepository implements SubscriptionEntitlementRepository {
  readonly #clientFor: (accessToken: string) => RepositorySupabaseClient;
  readonly #serviceClient: RepositorySupabaseClient | null;

  constructor(options: SupabaseSubscriptionEntitlementRepositoryOptions) {
    this.#clientFor = options.clientFor;
    this.#serviceClient = options.serviceRoleClient;
  }

  get #service(): RepositorySupabaseClient {
    if (!this.#serviceClient) {
      throw new RepositoryError("Billing writes need the service role");
    }
    return this.#serviceClient;
  }

  async readForOwner(
    userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<OwnerBillingView> {
    const client = this.#clientFor(options.accessToken);
    const [profile, entitlement, betaPro] = await Promise.all([
      client
        .from<ProfileTierRow>("profiles")
        .select("plan_tier")
        .eq("id", userId)
        .maybeSingle(),
      client
        .from<SubscriptionEntitlementRow>("subscription_entitlements")
        .select(ENTITLEMENT_COLUMNS)
        .eq("user_id", userId)
        .maybeSingle(),
      client
        .from<BetaProStatusRow>("beta_pro_requests")
        .select("status")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    if (profile.error || entitlement.error || betaPro.error) {
      throw new RepositoryError("Billing state is unavailable");
    }
    const row = entitlement.data;
    if (row && row.user_id !== userId) {
      throw new RepositoryError("Billing state is invalid");
    }
    return {
      planTier: profile.data?.plan_tier === "paid" ? "paid" : "free",
      betaProApproved: betaPro.data?.status === "approved",
      entitlement: row ? toStored(row) : null,
    };
  }

  async userExists(userId: UserId): Promise<boolean> {
    const { data, error } = await this.#service
      .from<{ readonly id: string }>("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new RepositoryError("Account lookup is unavailable");
    return data?.id === userId;
  }

  async apply(
    userId: UserId,
    state: SubscriptionEntitlementState,
    options: { readonly observedAt: Date; readonly eventId: string | null },
  ): Promise<{
    readonly applied: boolean;
    readonly planTier: PlanTierValue | null;
  }> {
    const { data, error } = await this.#service.rpc<ApplyRow>(
      "billing_apply_entitlement",
      {
        p_user_id: userId,
        p_entitlement_id: state.entitlementId,
        p_status: state.status,
        p_product_id: state.productId,
        p_store: state.store,
        p_environment: state.environment,
        p_in_trial: state.inTrial,
        p_will_renew: state.willRenew,
        p_billing_issue: state.billingIssue,
        p_expires_at: state.expiresAt?.toISOString() ?? null,
        p_observed_at: options.observedAt.toISOString(),
        p_event_id: options.eventId,
      },
    );
    const row = data?.[0];
    if (error || !row) {
      throw new RepositoryError("Entitlement could not be saved");
    }
    return { applied: row.applied === true, planTier: row.plan_tier ?? null };
  }

  async claimWebhookEvent(
    eventId: string,
    eventType: string,
  ): Promise<boolean> {
    const { data, error } = await this.#service.rpc<ClaimRow>(
      "billing_claim_webhook_event",
      { p_event_id: eventId, p_event_type: eventType },
    );
    const row = data?.[0];
    if (error || !row) {
      throw new RepositoryError("Webhook event could not be recorded");
    }
    return row.already_processed === true;
  }

  async completeWebhookEvent(eventId: string): Promise<void> {
    const { error } = await this.#service.rpc<Record<string, unknown>>(
      "billing_complete_webhook_event",
      { p_event_id: eventId },
    );
    if (error) throw new RepositoryError("Webhook event could not be closed");
  }
}
