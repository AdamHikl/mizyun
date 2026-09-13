import type { FastifyPluginAsync } from "fastify";
import type { ProductAnalyticsRepository } from "@mizyun/core";
import {
  CURRENT_ANALYTICS_CONSENT_VERSION,
  analyticsBatchIngestRequestSchema,
  analyticsClearRequestSchema,
  analyticsConsentRequestSchema,
  type AnalyticsBatchIngestRequest,
  type AnalyticsBatchIngestResponse,
  type AnalyticsClearRequest,
  type AnalyticsClearResponse,
  type AnalyticsConsentRequest,
  type AnalyticsConsentResponse,
  type AnalyticsEventV2,
} from "@mizyun/contracts";

import { sendApiError } from "../../errors.js";

export interface AnalyticsRoutesOptions {
  readonly productAnalyticsRepository: ProductAnalyticsRepository;
  readonly clock?: { readonly now: () => Date };
}

export const analyticsRoutes: FastifyPluginAsync<
  AnalyticsRoutesOptions
> = async (app, options) => {
  // GET /v1/analytics/consent
  app.get(
    "/consent",
    { preHandler: app.authenticate },
    async (request): Promise<AnalyticsConsentResponse> => {
      const principal = request.principal!;
      const consent = await options.productAnalyticsRepository.getConsent(
        principal.userId,
      );

      if (!consent) {
        return {
          version: CURRENT_ANALYTICS_CONSENT_VERSION,
          granted: false,
          revision: 0,
          epoch: "00000000-0000-0000-0000-000000000000",
          consentedAt: null,
          revokedAt: null,
          updatedAt: (options.clock?.now() ?? new Date()).toISOString(),
        };
      }

      return {
        version: CURRENT_ANALYTICS_CONSENT_VERSION,
        granted: consent.granted,
        revision: consent.revision,
        epoch: consent.epoch,
        consentedAt: consent.consentedAt?.toISOString() ?? null,
        revokedAt: consent.revokedAt?.toISOString() ?? null,
        updatedAt: consent.updatedAt.toISOString(),
      };
    },
  );

  // PUT /v1/analytics/consent
  app.put<{ Body: AnalyticsConsentRequest }>(
    "/consent",
    { preHandler: app.authenticate },
    async (request, reply): Promise<AnalyticsConsentResponse | void> => {
      const principal = request.principal!;
      const parsed = analyticsConsentRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          parsed.error.issues[0]?.message ?? "Invalid consent payload",
        );
        return;
      }

      const res = await options.productAnalyticsRepository.updateConsent(
        principal.userId,
        {
          version: parsed.data.version,
          granted: parsed.data.granted,
          expectedRevision: parsed.data.expectedRevision,
        },
      );

      if (!res.success) {
        sendApiError(
          reply,
          request,
          409,
          "CONFLICT",
          "Consent revision mismatch. Please fetch the latest consent state.",
        );
        return;
      }

      return {
        version: CURRENT_ANALYTICS_CONSENT_VERSION,
        granted: res.consent.granted,
        revision: res.consent.revision,
        epoch: res.consent.epoch,
        consentedAt: res.consent.consentedAt?.toISOString() ?? null,
        revokedAt: res.consent.revokedAt?.toISOString() ?? null,
        updatedAt: res.consent.updatedAt.toISOString(),
      };
    },
  );

  // POST /v1/analytics/events
  app.post<{ Body: AnalyticsBatchIngestRequest }>(
    "/events",
    {
      preHandler: app.authenticate,
      bodyLimit: 32 * 1024,
    },
    async (request, reply): Promise<AnalyticsBatchIngestResponse | void> => {
      const principal = request.principal!;
      const parsed = analyticsBatchIngestRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          parsed.error.issues[0]?.message ?? "Invalid analytics batch payload",
        );
        return;
      }

      const now = (options.clock?.now() ?? new Date()).getTime();
      const maxFutureSkewMs = 5 * 60 * 1000;
      const maxPastAgeMs = 72 * 60 * 60 * 1000;

      for (const ev of parsed.data.events) {
        const evTime = new Date(ev.recordedAt).getTime();
        if (evTime > now + maxFutureSkewMs) {
          sendApiError(
            reply,
            request,
            422,
            "VALIDATION_ERROR",
            `Event ${ev.id} recordedAt is too far in the future.`,
          );
          return;
        }
        if (evTime < now - maxPastAgeMs) {
          sendApiError(
            reply,
            request,
            422,
            "VALIDATION_ERROR",
            `Event ${ev.id} recordedAt is older than retention queue limit (72 hours).`,
          );
          return;
        }
      }

      const res = await options.productAnalyticsRepository.recordBatch(
        principal.userId,
        {
          consentVersion: parsed.data.consentVersion,
          epoch: parsed.data.epoch,
          events: parsed.data.events.map((e) => ({
            id: e.id,
            name: e.name,
            sessionId: e.sessionId,
            sequence: e.sequence,
            flowId: e.flowId ?? null,
            platform: e.platform,
            appVersion: e.appVersion,
            build: e.build ?? null,
            properties: e.properties,
            epoch: parsed.data.epoch,
            version: parsed.data.consentVersion,
            recordedAt: new Date(e.recordedAt),
          })),
        },
      );

      if (!res.success) {
        sendApiError(
          reply,
          request,
          409,
          "CONFLICT",
          "Analytics consent epoch or version mismatch. Discarding stale events.",
        );
        return;
      }

      return {
        acceptedIds: [...res.acceptedIds],
        rejectedCount: res.rejectedCount,
      };
    },
  );

  // DELETE /v1/analytics/events
  app.delete<{ Body: AnalyticsClearRequest }>(
    "/events",
    { preHandler: app.authenticate },
    async (request, reply): Promise<AnalyticsClearResponse | void> => {
      const principal = request.principal!;
      const parsed = analyticsClearRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          parsed.error.issues[0]?.message ?? "Invalid clear request payload",
        );
        return;
      }

      const res = await options.productAnalyticsRepository.clearEvents(
        principal.userId,
        {
          expectedRevision: parsed.data.expectedRevision,
        },
      );

      if (!res.success) {
        sendApiError(
          reply,
          request,
          409,
          "CONFLICT",
          "Revision mismatch when clearing analytics events.",
        );
        return;
      }

      return {
        cleared: true,
        newEpoch: res.newEpoch,
        revision: res.revision,
      };
    },
  );

  // GET /v1/analytics/events
  app.get(
    "/events",
    { preHandler: app.authenticate },
    async (request): Promise<{ events: ReadonlyArray<AnalyticsEventV2> }> => {
      const principal = request.principal!;
      const stored =
        await options.productAnalyticsRepository.listRetainedEvents(
          principal.userId,
        );

      const events: AnalyticsEventV2[] = stored.map((e) => ({
        id: e.id,
        schemaVersion: 2,
        recordedAt: e.recordedAt.toISOString(),
        sessionId: e.sessionId,
        sequence: e.sequence,
        flowId: e.flowId ?? undefined,
        platform: e.platform,
        appVersion: e.appVersion,
        build: e.build ?? undefined,
        name: e.name as any,
        properties: e.properties as any,
      }));

      return { events };
    },
  );
};
