import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  resolvePaidSource,
  type OwnerBillingView,
  type SubscriptionEntitlementRepository,
  type UserId,
} from "@mizyun/core";
import {
  billingEntitlementResponseSchema,
  type BillingEntitlementResponse,
} from "@mizyun/contracts";
import {
  parseRevenueCatWebhook,
  verifyRevenueCatWebhook,
} from "@mizyun/adapter-revenuecat-server";
import type { BillingServerConfig } from "@mizyun/config";

import { sendApiError } from "../../errors.js";
import { BillingReconciler, type EntitlementReader } from "./service.js";

export interface BillingRoutesOptions {
  readonly repository: SubscriptionEntitlementRepository;
  /** Null when billing is off (`BILLING_ENABLED`, missing secrets). */
  readonly config: BillingServerConfig | null;
  readonly reader: EntitlementReader | null;
  readonly now?: () => Date;
  /** Minimum gap between remote re-reads one user can trigger. */
  readonly syncIntervalMs?: number;
  /**
   * App-triggered re-reads allowed per minute across all users, leaving the
   * shared RevenueCat key's rate limit for webhooks.
   */
  readonly syncBudgetPerMinute?: number;
}

const WEBHOOK_BODY_LIMIT = 64 * 1024;
const DEFAULT_SYNC_INTERVAL_MS = 10_000;
const SYNC_TRACKING_LIMIT = 10_000;
const DEFAULT_SYNC_BUDGET_PER_MINUTE = 120;

const toResponse = (
  view: OwnerBillingView,
  config: BillingServerConfig | null,
  now: Date,
): BillingEntitlementResponse =>
  billingEntitlementResponseSchema.parse({
    planTier: view.planTier,
    paidSource: resolvePaidSource(view, now),
    purchasesEnabled: config !== null,
    entitlement: view.entitlement
      ? {
          status: view.entitlement.status,
          productId: view.entitlement.productId,
          store: view.entitlement.store,
          environment: view.entitlement.environment,
          inTrial: view.entitlement.inTrial,
          willRenew: view.entitlement.willRenew,
          billingIssue: view.entitlement.billingIssue,
          expiresAt: view.entitlement.expiresAt?.toISOString() ?? null,
          updatedAt: view.entitlement.updatedAt.toISOString(),
        }
      : null,
    storeSdk: config
      ? {
          provider: "revenuecat",
          iosPublicKey: config.iosPublicKey,
          androidPublicKey: config.androidPublicKey,
          entitlementId: config.entitlementId,
          offeringId: config.offeringId,
        }
      : null,
  });

const headerValue = (
  value: string | readonly string[] | undefined,
): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * Store billing (#332, ADR-0080).
 *
 * - `GET /billing/entitlement`: the caller's server-verified plan.
 * - `POST /billing/entitlement/sync`: re-read the caller's own entitlement
 *   from the billing service (after a purchase or restore). The body is
 *   ignored; the client never supplies entitlement data.
 * - `POST /billing/revenuecat/webhook`: signed trigger from RevenueCat,
 *   registered only when billing is enabled.
 */
export const billingRoutes: FastifyPluginAsync<BillingRoutesOptions> = async (
  app,
  options,
) => {
  const now = options.now ?? (() => new Date());
  const config = options.config;
  const reconciler =
    config && options.reader
      ? new BillingReconciler({
          repository: options.repository,
          reader: options.reader,
          entitlementId: config.entitlementId,
          allowSandbox: config.allowSandbox,
          now,
        })
      : null;
  const syncIntervalMs = options.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
  const lastSyncAt = new Map<UserId, number>();
  const syncBudget =
    options.syncBudgetPerMinute ?? DEFAULT_SYNC_BUDGET_PER_MINUTE;
  let budgetWindowStart = 0;
  let budgetUsed = 0;

  const throttledReconcile = async (userId: UserId): Promise<void> => {
    if (!reconciler) return;
    const at = now().getTime();
    const previous = lastSyncAt.get(userId);
    if (previous !== undefined && at - previous < syncIntervalMs) return;
    if (at - budgetWindowStart >= 60_000) {
      budgetWindowStart = at;
      budgetUsed = 0;
    }
    // Over budget: answer from the stored row; the webhook still converges.
    if (budgetUsed >= syncBudget) return;
    budgetUsed += 1;
    if (lastSyncAt.size >= SYNC_TRACKING_LIMIT) lastSyncAt.clear();
    lastSyncAt.set(userId, at);
    await reconciler.reconcile(userId, null);
  };

  const readOwner = async (
    request: FastifyRequest,
    reply: FastifyReply,
    sync: boolean,
  ): Promise<BillingEntitlementResponse | void> => {
    const principal = request.principal!;
    const userId = principal.userId as UserId;
    const access = { accessToken: principal.accessToken };
    try {
      let view = await options.repository.readForOwner(userId, access);
      const lapsed =
        view.entitlement?.status === "active" &&
        view.entitlement.expiresAt !== null &&
        view.entitlement.expiresAt.getTime() <= now().getTime();
      // A lapsed row means the expiry webhook has not landed yet; re-read so
      // plan_tier does not stay paid past the paid period.
      if (reconciler && (sync || lapsed)) {
        try {
          await throttledReconcile(userId);
          view = await options.repository.readForOwner(userId, access);
        } catch (error) {
          request.log.warn(
            { errorName: error instanceof Error ? error.name : "unknown" },
            "billing re-read failed; returning stored entitlement",
          );
          if (sync) {
            await sendApiError(
              reply,
              request,
              503,
              "SERVICE_UNAVAILABLE",
              "The Store couldn't be checked. Try again shortly.",
            );
            return;
          }
        }
      }
      reply.header("cache-control", "no-store");
      return toResponse(view, config, now());
    } catch (error) {
      request.log.error(
        { errorName: error instanceof Error ? error.name : "unknown" },
        "billing entitlement read failed",
      );
      await sendApiError(
        reply,
        request,
        503,
        "SERVICE_UNAVAILABLE",
        "Your plan is unavailable. Retry shortly.",
      );
    }
  };

  app.get(
    "/billing/entitlement",
    { preHandler: app.authenticate },
    async (request, reply) => readOwner(request, reply, false),
  );

  app.post(
    "/billing/entitlement/sync",
    { preHandler: app.authenticate },
    async (request, reply) => readOwner(request, reply, true),
  );

  if (!config || !reconciler) return;

  // Encapsulated so only the webhook keeps the raw bytes the signature covers.
  await app.register(async (webhook) => {
    webhook.addContentTypeParser(
      "application/json",
      { parseAs: "buffer", bodyLimit: WEBHOOK_BODY_LIMIT },
      (_request, body, done) => done(null, body),
    );

    webhook.post(
      "/billing/revenuecat/webhook",
      { bodyLimit: WEBHOOK_BODY_LIMIT },
      async (request, reply) => {
        const rawBody = Buffer.isBuffer(request.body)
          ? request.body
          : Buffer.alloc(0);
        const verification = verifyRevenueCatWebhook({
          rawBody,
          signatureHeader: headerValue(
            request.headers["x-revenuecat-webhook-signature"],
          ),
          authorizationHeader: headerValue(request.headers.authorization),
          signingSecret: config.webhookSigningSecret,
          expectedAuthorization: config.webhookAuthorization,
          now: now(),
        });
        if (!verification.ok) {
          request.log.warn(
            { reason: verification.reason },
            "billing webhook rejected",
          );
          return sendApiError(
            reply,
            request,
            401,
            "AUTHENTICATION_REQUIRED",
            "Webhook signature is invalid.",
          );
        }
        let body: unknown;
        try {
          body = JSON.parse(rawBody.toString("utf8"));
        } catch {
          body = null;
        }
        const event = parseRevenueCatWebhook(body);
        if (!event) {
          return sendApiError(
            reply,
            request,
            400,
            "VALIDATION_ERROR",
            "Webhook payload is not understood.",
          );
        }
        try {
          if (
            await options.repository.claimWebhookEvent(event.id, event.type)
          ) {
            request.log.info(
              { eventType: event.type },
              "billing webhook replay",
            );
            return { received: true, duplicate: true };
          }
          let applied = 0;
          for (const userId of event.candidateUserIds) {
            const outcome = await reconciler.reconcile(
              userId as UserId,
              event.id,
            );
            if (outcome.kind === "applied") applied += 1;
          }
          await options.repository.completeWebhookEvent(event.id);
          request.log.info(
            {
              eventType: event.type,
              accounts: event.candidateUserIds.length,
              applied,
            },
            "billing webhook processed",
          );
          return { received: true, duplicate: false };
        } catch (error) {
          // Not completed: RevenueCat retries, and the retry re-reads state.
          request.log.error(
            {
              eventType: event.type,
              errorName: error instanceof Error ? error.name : "unknown",
            },
            "billing webhook processing failed",
          );
          return sendApiError(
            reply,
            request,
            503,
            "SERVICE_UNAVAILABLE",
            "Webhook could not be processed. Retry later.",
          );
        }
      },
    );
  });
};
