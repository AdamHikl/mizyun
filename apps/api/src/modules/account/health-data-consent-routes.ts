import type { FastifyPluginAsync } from "fastify";
import {
  CURRENT_HEALTH_DATA_CONSENT_VERSION,
  healthDataConsentResponseSchema,
  updateHealthDataConsentSchema,
  type HealthDataConsentResponse,
} from "@mizyun/contracts";
import type {
  HealthDataConsentRepository,
  StoredHealthDataConsent,
} from "@mizyun/core";

import { sendApiError } from "../../errors.js";

interface HealthDataConsentRoutesOptions {
  readonly healthDataConsentRepository: HealthDataConsentRepository;
}

/** Shown by a build whose health-data explanation is no longer current. */
export const HEALTH_DATA_CONSENT_UPDATE_REQUIRED_MESSAGE =
  "This version of Mizyun shows an older health data explanation. Update Mizyun to continue.";

const toWire = (
  consent: StoredHealthDataConsent | null,
): HealthDataConsentResponse =>
  healthDataConsentResponseSchema.parse({
    consent: consent
      ? {
          granted: consent.granted,
          consentVersion: consent.consentVersion,
          consentedAt: consent.consentedAt?.toISOString() ?? null,
          revokedAt: consent.revokedAt?.toISOString() ?? null,
        }
      : {
          granted: false,
          consentVersion: CURRENT_HEALTH_DATA_CONSENT_VERSION,
          consentedAt: null,
          revokedAt: null,
        },
  });

/**
 * GET/PUT /v1/account/health-data-consent (PRIV-01). Records explicit,
 * versioned consent to store health data, or its withdrawal. Withdrawal is
 * always accepted; a grant only for the current explanation.
 */
export const healthDataConsentRoutes: FastifyPluginAsync<
  HealthDataConsentRoutesOptions
> = async (app, options) => {
  app.get(
    "/account/health-data-consent",
    { preHandler: app.authenticate },
    async (request): Promise<HealthDataConsentResponse> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      return toWire(
        await options.healthDataConsentRepository.getConsent(principal.userId, {
          accessToken: principal.accessToken,
        }),
      );
    },
  );

  app.put(
    "/account/health-data-consent",
    { preHandler: app.authenticate },
    async (request, reply): Promise<HealthDataConsentResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const parsed = updateHealthDataConsentSchema.safeParse(request.body);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid consent body: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      if (
        parsed.data.granted &&
        parsed.data.consentVersion !== CURRENT_HEALTH_DATA_CONSENT_VERSION
      ) {
        await sendApiError(
          reply,
          request,
          409,
          "CONFLICT",
          HEALTH_DATA_CONSENT_UPDATE_REQUIRED_MESSAGE,
        );
        return;
      }
      const saved = await options.healthDataConsentRepository.saveConsent(
        principal.userId,
        parsed.data,
        { accessToken: principal.accessToken, now: new Date() },
      );
      return toWire(saved);
    },
  );
};
