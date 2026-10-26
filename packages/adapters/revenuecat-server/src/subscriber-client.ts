import type {
  StoreEntitlementSnapshot,
  SubscriptionPeriodType,
  SubscriptionStore,
} from "@mizyun/core";
import { z } from "zod";

/**
 * Reads a customer's current entitlement from the RevenueCat REST API v1
 * (`GET /v1/subscribers/{app_user_id}`, secret key, server only), which
 * RevenueCat recommends after every webhook. Source:
 * https://www.revenuecat.com/docs/api-v1/customer-info-model (checked
 * 2026-10-26). The endpoint creates an empty customer for an unknown id, so
 * callers only ask about ids that are existing Mizyun accounts.
 */
const dateSchema = z.string().datetime({ offset: true }).nullable().optional();

const subscriberResponseSchema = z.object({
  request_date_ms: z.number().int().positive(),
  subscriber: z.object({
    entitlements: z
      .record(
        z.object({
          expires_date: dateSchema,
          grace_period_expires_date: dateSchema,
          product_identifier: z.string().min(1).max(200).nullable().optional(),
          purchase_date: dateSchema,
        }),
      )
      .default({}),
    subscriptions: z
      .record(
        z.object({
          store: z.string().max(40).nullable().optional(),
          is_sandbox: z.boolean().nullable().optional(),
          period_type: z.string().max(40).nullable().optional(),
          unsubscribe_detected_at: dateSchema,
          billing_issues_detected_at: dateSchema,
          refunded_at: dateSchema,
        }),
      )
      .default({}),
  }),
});

type SubscriptionRecord = z.infer<
  typeof subscriberResponseSchema
>["subscriber"]["subscriptions"][string];

export interface EntitlementReading {
  readonly snapshot: StoreEntitlementSnapshot | null;
  /** RevenueCat's own request time: the instant this snapshot describes. */
  readonly observedAt: Date;
}

export class RevenueCatRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "RevenueCatRequestError";
  }
}

export interface RevenueCatSubscriberClientOptions {
  readonly secretApiKey: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

const toDate = (value: string | null | undefined): Date | null =>
  typeof value === "string" ? new Date(value) : null;

const toStore = (
  value: string | null | undefined,
): SubscriptionStore | null => {
  if (value === null || value === undefined) return null;
  if (value === "app_store" || value === "mac_app_store") return "app_store";
  if (value === "play_store") return "play_store";
  return "other";
};

const PERIOD_TYPES: readonly SubscriptionPeriodType[] = [
  "trial",
  "intro",
  "normal",
  "promotional",
  "prepaid",
];

const toPeriodType = (
  value: string | null | undefined,
): SubscriptionPeriodType | null =>
  PERIOD_TYPES.find((type) => type === value) ?? null;

/**
 * Play product ids may be `<subscription>:<base plan>` in either map. Only a
 * single base-id match is used; an ambiguous or missing record yields null,
 * which leaves the environment unknown (refused outside Dev).
 */
const findSubscription = (
  subscriptions: Readonly<Record<string, SubscriptionRecord>>,
  productId: string | null,
): SubscriptionRecord | null => {
  if (productId === null) return null;
  const exact = subscriptions[productId];
  if (exact) return exact;
  const base = productId.split(":")[0];
  const keys = Object.keys(subscriptions).filter(
    (candidate) => candidate.split(":")[0] === base,
  );
  return keys.length === 1 ? (subscriptions[keys[0]!] ?? null) : null;
};

export class RevenueCatSubscriberClient {
  readonly #secretApiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: RevenueCatSubscriberClientOptions) {
    this.#secretApiKey = options.secretApiKey;
    this.#baseUrl = (options.baseUrl ?? "https://api.revenuecat.com").replace(
      /\/+$/,
      "",
    );
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  async readEntitlement(
    appUserId: string,
    entitlementId: string,
  ): Promise<EntitlementReading> {
    let response: Response;
    try {
      response = await this.#fetch(
        `${this.#baseUrl}/v1/subscribers/${encodeURIComponent(appUserId)}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.#secretApiKey}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(this.#timeoutMs),
        },
      );
    } catch {
      throw new RevenueCatRequestError("RevenueCat is unreachable", true);
    }
    if (response.status !== 200 && response.status !== 201) {
      throw new RevenueCatRequestError(
        `RevenueCat subscriber read failed with HTTP ${response.status}`,
        response.status === 429 || response.status >= 500,
      );
    }
    const parsed = subscriberResponseSchema.safeParse(
      await response.json().catch(() => null),
    );
    if (!parsed.success) {
      throw new RevenueCatRequestError(
        "RevenueCat subscriber response was not understood",
        false,
      );
    }
    const { subscriber, request_date_ms: requestDateMs } = parsed.data;
    const observedAt = new Date(requestDateMs);
    const entitlement = subscriber.entitlements[entitlementId];
    if (!entitlement) return { snapshot: null, observedAt };
    const productId = entitlement.product_identifier ?? null;
    const subscription = findSubscription(subscriber.subscriptions, productId);
    return {
      observedAt,
      snapshot: {
        entitlementId,
        productId,
        store: toStore(subscription?.store),
        environment:
          subscription?.is_sandbox === true
            ? "sandbox"
            : subscription?.is_sandbox === false
              ? "production"
              : null,
        periodType: toPeriodType(subscription?.period_type),
        purchasedAt: toDate(entitlement.purchase_date),
        expiresAt: toDate(entitlement.expires_date),
        gracePeriodExpiresAt: toDate(entitlement.grace_period_expires_date),
        refundedAt: toDate(subscription?.refunded_at),
        unsubscribeDetectedAt: toDate(subscription?.unsubscribe_detected_at),
        billingIssueDetectedAt: toDate(
          subscription?.billing_issues_detected_at,
        ),
      },
    };
  }
}
