import type { FastifyPluginAsync } from "fastify";
import {
  applyProfilePatch,
  validateProfilePatch,
  type ProfilePatch,
  type HealthDataConsentRepository,
  type ProfileRepository,
  type ProfileValidationError,
  type StoredProfile,
} from "@mizyun/core";
import {
  profilePatchSchema,
  profileResponseSchema,
  type ProfileResponse,
} from "@mizyun/contracts";

import { sendApiError } from "../../errors.js";
import {
  HEALTH_DATA_CONSENT_REQUIRED_MESSAGE,
  changedHealthFields,
  healthDataWriteRefused,
  patchStoresHealthData,
} from "../../health-data-consent.js";

interface ProfileRoutesOptions {
  readonly profileRepository: ProfileRepository;
  /**
   * When set, storing birth year, height, sex at birth or activity level is
   * refused after a recorded withdrawal, and without a current grant for
   * clients that ask for health-data consent.
   */
  readonly healthDataConsentRepository?: HealthDataConsentRepository;
}

/**
 * Map a domain validation failure to the wire contract. Each
 * `ProfileValidationError` variant becomes a stable `code` and a
 * human-readable message. The route is the only place this mapping
 * lives; new error variants must be added here AND in the
 * `ApiErrorCode` union in `errors.ts` if they map to a new HTTP
 * status.
 */
const validationErrorToApi = (
  error: ProfileValidationError,
  requestId: string,
): {
  status: number;
  code: "VALIDATION_ERROR";
  message: string;
  requestId: string;
} => {
  switch (error.kind) {
    case "empty_patch":
      return {
        status: 400,
        code: "VALIDATION_ERROR",
        message: "At least one profile field must be present.",
        requestId,
      };
    case "display_name_empty":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message:
          "displayName cannot be blank; omit the field or set it to null.",
        requestId,
      };
    case "display_name_too_long":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `displayName must be at most ${error.max} characters.`,
        requestId,
      };
    case "invalid_unit_system":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `unitSystem must be 'metric' or 'imperial' (got '${error.value}').`,
        requestId,
      };
    case "invalid_timezone":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `timezone '${error.value}' is not a valid IANA timezone string.`,
        requestId,
      };
    case "height_out_of_range":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `heightCm must be between ${error.min} and ${error.max}.`,
        requestId,
      };
    case "birth_year_out_of_range":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `birthYear must be between ${error.min} and ${error.max}.`,
        requestId,
      };
    case "invalid_activity_level":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `activityLevel '${error.value}' is not a valid activity category.`,
        requestId,
      };
    case "invalid_sex_at_birth":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `sexAtBirth '${error.value}' must be 'male' or 'female'.`,
        requestId,
      };
    case "invalid_coaching_preferences":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message:
          "coachingPreferences contains an unsupported value or out-of-range schedule.",
        requestId,
      };
    case "invalid_ai_provider":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `aiProvider '${error.value}' must be 'gemini'.`,
        requestId,
      };
  }
};

/**
 * Convert a `StoredProfile` (Date timestamps, branded UserId) into the
 * wire `ProfileResponse` (ISO strings, plain UUID). The shape is
 * parsed through the Zod contract at the producer side so any future
 * drift is caught at the boundary, not by a downstream consumer.
 */
const toWire = (stored: StoredProfile): ProfileResponse =>
  profileResponseSchema.parse({
    profile: {
      userId: stored.userId,
      displayName: stored.displayName,
      unitSystem: stored.unitSystem,
      timezone: stored.timezone,
      birthYear: stored.birthYear,
      heightCm: stored.heightCm,
      activityLevel: stored.activityLevel,
      sexAtBirth: stored.sexAtBirth,
      coachingPreferences: {
        ...stored.coachingPreferences,
        availableEquipment: [...stored.coachingPreferences.availableEquipment],
        dietaryPreferences: [...stored.coachingPreferences.dietaryPreferences],
        trainingLimitations: [
          ...stored.coachingPreferences.trainingLimitations,
        ],
      },
      planTier: stored.planTier,
      aiProvider: stored.aiProvider,
      createdAt: stored.createdAt.toISOString(),
      updatedAt: stored.updatedAt.toISOString(),
    },
  });

export const profileRoutes: FastifyPluginAsync<ProfileRoutesOptions> = async (
  app,
  options,
) => {
  // GET /v1/profile — return the verified user's profile. Auto-creates
  // an empty profile on first read so the trigger-vs-client race is
  // absorbed by the repository.
  app.get(
    "/",
    { preHandler: app.authenticate },
    async (request): Promise<ProfileResponse> => {
      const principal = request.principal;
      if (!principal) {
        // The auth preHandler always sets a principal or replies 401;
        // this branch is defensive and never reached.
        throw new Error("principal missing after authentication");
      }
      const stored = await options.profileRepository.getOrCreate(
        principal.userId,
        { now: new Date(), accessToken: principal.accessToken },
      );
      return toWire(stored);
    },
  );

  // PUT /v1/profile — partial update. Body is parsed by Zod (the
  // route uses `profilePatchSchema` via the wire contract); domain
  // validation runs after parsing so the rejection reason carries
  // the typed `ProfileValidationError` shape, not a Zod issue list.
  app.put(
    "/",
    { preHandler: app.authenticate },
    async (request, reply): Promise<ProfileResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      // The request body has already been parsed by Fastify's
      // default JSON parser; re-parse through the Zod schema so a
      // future content-type or body-parser change cannot bypass the
      // contract.
      const body = request.body as unknown;
      const parsed = profilePatchSchema.safeParse(body);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid profile patch: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      const patch: ProfilePatch = parsed.data;
      const validation = validateProfilePatch(patch);
      if (validation !== null) {
        const apiError = validationErrorToApi(validation, request.id);
        await sendApiError(
          reply,
          request,
          apiError.status,
          apiError.code,
          apiError.message,
        );
        return;
      }
      const stored = await options.profileRepository.getOrCreate(
        principal.userId,
        { now: new Date(), accessToken: principal.accessToken },
      );
      // Only new values count: an older build re-sending unchanged height or
      // birth year (e.g. with a display-name edit) is not refused.
      if (
        options.healthDataConsentRepository &&
        patchStoresHealthData(changedHealthFields(patch, stored))
      ) {
        const consent = await options.healthDataConsentRepository.getConsent(
          principal.userId,
          { accessToken: principal.accessToken },
        );
        if (healthDataWriteRefused(request, consent)) {
          await sendApiError(
            reply,
            request,
            403,
            "HEALTH_DATA_CONSENT_REQUIRED",
            HEALTH_DATA_CONSENT_REQUIRED_MESSAGE,
          );
          return;
        }
      }
      const next = applyProfilePatch(stored, patch, new Date());
      const saved = await options.profileRepository.update(
        principal.userId,
        next,
        {
          accessToken: principal.accessToken,
        },
      );
      return toWire(saved);
    },
  );
};
