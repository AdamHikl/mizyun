import type { FastifyPluginAsync } from "fastify";
import type {
  AccountExport,
  AccountRepository,
  AiConsentRepository,
  ProfileRepository,
} from "@mizyun/core";
import type { MemoryRecord, MemoryStore } from "@mizyun/memory";
import type { ServerAppleAuthConfiguration } from "@mizyun/config";
import {
  type AppleAuthClient,
  generateAppleClientSecret,
} from "@mizyun/adapter-apple-auth";
import {
  CURRENT_AI_CONSENT_VERSION,
  accountDeleteResponseSchema,
  accountDeleteSchema,
  accountDeleteStatusResponseSchema,
  accountDeleteStatusSchema,
  accountExportResponseSchema,
  accountDeleteChallengeResponseSchema,
  aiConsentResponseSchema,
  updateAiConsentSchema,
  type AccountDeleteResponse,
  type AccountDeleteStatusResponse,
  type AccountExportResponse,
  type AccountDeleteChallengeResponse,
  type AiConsentResponse,
} from "@mizyun/contracts";

import { isAdultEligibleForAi } from "../../ai-eligibility.js";
import { sendApiError } from "../../errors.js";

export interface AppleAuthRouteOptions {
  readonly config: ServerAppleAuthConfiguration;
  readonly client: AppleAuthClient;
}

interface AccountRoutesOptions {
  readonly accountRepository: AccountRepository;
  readonly memoryStore: MemoryStore;
  readonly aiConsentRepository?: AiConsentRepository;
  readonly profileRepository?: ProfileRepository;
  readonly appleAuth?: AppleAuthRouteOptions | undefined;
}

const CHALLENGE_TTL_SECONDS = 5 * 60;

const memoryToWire = (memory: MemoryRecord) => ({
  id: memory.id,
  userId: memory.userId,
  kind: memory.kind,
  content: memory.content,
  source: memory.source,
  status: memory.status,
  confidence: memory.confidence,
  importance: memory.importance,
  createdAt: memory.createdAt.toISOString(),
  updatedAt: memory.updatedAt.toISOString(),
  expiresAt: memory.expiresAt?.toISOString() ?? null,
  metadata: { ...memory.metadata },
});

const accountExportToWire = (
  exportDoc: AccountExport,
  memories: readonly MemoryRecord[],
): AccountExportResponse =>
  accountExportResponseSchema.parse({
    export: {
      manifest: exportDoc.manifest
        ? {
            schemaVersion: exportDoc.manifest.schemaVersion,
            generatedAt: exportDoc.manifest.generatedAt.toISOString(),
            completeness: exportDoc.manifest.completeness,
            counts: {
              ...exportDoc.manifest.counts,
              memories: memories.length,
            },
          }
        : undefined,
      userId: exportDoc.userId,
      generatedAt: exportDoc.generatedAt.toISOString(),
      // `z.unknown()` carries the stored shape; we hand back the
      // verbatim DTOs from the per-feature repositories so the
      // client gets the same structure it sees on the per-feature
      // endpoints.
      profile: exportDoc.profile
        ? {
            userId: exportDoc.profile.userId,
            displayName: exportDoc.profile.displayName,
            unitSystem: exportDoc.profile.unitSystem,
            timezone: exportDoc.profile.timezone,
            birthYear: exportDoc.profile.birthYear,
            heightCm: exportDoc.profile.heightCm,
            activityLevel: exportDoc.profile.activityLevel,
            sexAtBirth: exportDoc.profile.sexAtBirth,
            coachingPreferences: exportDoc.profile.coachingPreferences,
            createdAt: exportDoc.profile.createdAt.toISOString(),
            updatedAt: exportDoc.profile.updatedAt.toISOString(),
          }
        : null,
      goals: exportDoc.goals.map((g) => ({
        id: g.id,
        userId: g.userId,
        kind: g.kind,
        status: g.status,
        pace: g.pace,
        target: {
          weightKg: g.target.weightKg,
          ...(g.target.bodyFatPercent !== undefined
            ? { bodyFatPercent: g.target.bodyFatPercent }
            : {}),
        },
        startsOn: g.startsOn,
        targetDate: g.targetDate,
        ...(g.reviewDate !== undefined ? { reviewDate: g.reviewDate } : {}),
        createdAt: g.createdAt.toISOString(),
        updatedAt: g.updatedAt.toISOString(),
      })),
      foodEntries: exportDoc.foodEntries.map((f) => ({
        id: f.id,
        userId: f.userId,
        name: f.name,
        consumedAt: f.consumedAt.toISOString(),
        caloriesKcal: f.caloriesKcal,
        proteinG: f.proteinG,
        carbohydrateG: f.carbohydrateG,
        fatG: f.fatG,
        source: f.source,
        confidence: f.confidence,
        confirmedByUser: f.confirmedByUser,
        details: { ...f.details },
        createdAt: f.createdAt.toISOString(),
        updatedAt: f.updatedAt.toISOString(),
      })),
      exercises: exportDoc.exercises.map((e) => ({
        id: e.id,
        userId: e.userId,
        name: e.name,
        instructions: e.instructions,
        metadata: { ...e.metadata },
        createdAt: e.createdAt.toISOString(),
        updatedAt: e.updatedAt.toISOString(),
      })),
      workouts: exportDoc.workouts.map((w) => ({
        id: w.id,
        userId: w.userId,
        name: w.name,
        startedAt: w.startedAt.toISOString(),
        completedAt:
          w.completedAt === null ? null : w.completedAt.toISOString(),
        notes: w.notes,
        source: w.source,
        details: { ...w.details },
        createdAt: w.createdAt.toISOString(),
        updatedAt: w.updatedAt.toISOString(),
      })),
      workoutSets: exportDoc.workoutSets.map((s) => ({
        id: s.id,
        userId: s.userId,
        workoutId: s.workoutId,
        exerciseId: s.exerciseId,
        sequence: s.sequence,
        repetitions: s.repetitions,
        loadKg: s.loadKg,
        durationSeconds: s.durationSeconds,
        distanceMeters: s.distanceMeters,
        perceivedExertion: s.perceivedExertion,
        completedAt:
          s.completedAt === null ? null : s.completedAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
      })),
      bodyMeasurements: exportDoc.bodyMeasurements.map((m) => ({
        id: m.id,
        userId: m.userId,
        measuredAt: m.measuredAt.toISOString(),
        weightKg: m.weightKg,
        measurements: { ...m.measurements },
        source: m.source,
        createdAt: m.createdAt.toISOString(),
      })),
      conversations: exportDoc.conversations.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        messages: c.messages.map((message) => ({
          id: message.id,
          role: message.role,
          text: message.text,
          status: message.status,
          createdAt: message.createdAt.toISOString(),
        })),
      })),
      memories: memories.map(memoryToWire),
      privateMedia: exportDoc.privateMedia.map((m) => ({
        id: m.id,
        objectPath: m.objectPath ?? "",
        purpose: m.purpose ?? null,
        mimeType: m.mimeType ?? null,
        byteSize: m.byteSize ?? null,
        downloadUrl: m.downloadUrl ?? null,
        createdAt: m.createdAt.toISOString(),
      })),
      feedback: (exportDoc.feedback ?? []).map((fb) => ({
        id: fb.id,
        userId: fb.userId,
        category: fb.category,
        rating: fb.rating,
        message: fb.message,
        context: { ...fb.context },
        mediaAssetIds: [...fb.mediaAssetIds],
        createdAt: fb.createdAt.toISOString(),
      })),
      aiConsent: exportDoc.aiConsent
        ? {
            userId: exportDoc.aiConsent.userId,
            granted: exportDoc.aiConsent.granted,
            confirmedAdult: exportDoc.aiConsent.confirmedAdult,
            consentVersion: exportDoc.aiConsent.consentVersion,
            consentedAt: exportDoc.aiConsent.consentedAt
              ? exportDoc.aiConsent.consentedAt.toISOString()
              : null,
            revokedAt: exportDoc.aiConsent.revokedAt
              ? exportDoc.aiConsent.revokedAt.toISOString()
              : null,
            createdAt: exportDoc.aiConsent.createdAt.toISOString(),
            updatedAt: exportDoc.aiConsent.updatedAt.toISOString(),
          }
        : null,
    },
  });

export const accountRoutes: FastifyPluginAsync<AccountRoutesOptions> = async (
  app,
  options,
) => {
  // GET /v1/account/export — return the verified user's full
  // export envelope. Pure read; no side effects. The client
  // is expected to download this before initiating deletion.
  app.get(
    "/account/export",
    { preHandler: app.authenticate },
    async (request): Promise<AccountExportResponse> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const exportDoc = await options.accountRepository.exportForUser(
        principal.userId,
        { accessToken: principal.accessToken },
      );
      const memories = await options.memoryStore.list(principal.userId, {
        accessToken: principal.accessToken,
        includeSuperseded: true,
        limit: 10_000,
      });
      return accountExportToWire(exportDoc, memories);
    },
  );

  // POST /v1/account/delete/request — issue a short-lived
  // confirmation token. The token is opaque to the client and
  // is single-use; the route returns it alongside its expiry so
  // the UI can render "this challenge expires in 5 minutes".
  app.post(
    "/account/delete/request",
    { preHandler: app.authenticate },
    async (request): Promise<AccountDeleteChallengeResponse> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const now = new Date();
      const token = await options.accountRepository.issueDeletionChallenge(
        principal.userId,
        { ttlSeconds: CHALLENGE_TTL_SECONDS, now },
      );
      const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_SECONDS * 1000);
      return accountDeleteChallengeResponseSchema.parse({
        confirmationToken: token,
        expiresAt: expiresAt.toISOString(),
      });
    },
  );

  // DELETE /v1/account — confirm deletion with the token from
  // the request endpoint. A misclick without a valid token
  // returns 409 with a typed reason.
  app.delete(
    "/account",
    { preHandler: app.authenticate },
    async (request, reply): Promise<AccountDeleteResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const body = request.body as unknown;
      const parsed = accountDeleteSchema.safeParse(body);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid account delete body: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }

      if (parsed.data.appleAuthorizationCode && options.appleAuth) {
        try {
          const clientSecret = generateAppleClientSecret({
            teamId: options.appleAuth.config.teamId,
            keyId: options.appleAuth.config.keyId,
            clientId: options.appleAuth.config.clientId,
            privateKey: options.appleAuth.config.privateKey,
            expiresInSeconds: 300,
          });
          const exchangeResult =
            await options.appleAuth.client.exchangeAuthorizationCode({
              code: parsed.data.appleAuthorizationCode,
              clientId: options.appleAuth.config.clientId,
              clientSecret,
            });
          if (exchangeResult.ok && exchangeResult.value.refreshToken) {
            const revokeResult = await options.appleAuth.client.revokeToken({
              token: exchangeResult.value.refreshToken,
              tokenTypeHint: "refresh_token",
              clientId: options.appleAuth.config.clientId,
              clientSecret,
            });
            if (revokeResult.ok) {
              request.log.info(
                { userId: principal.userId },
                "Successfully revoked Apple authorization token for user during account deletion",
              );
            } else {
              request.log.warn(
                { err: revokeResult.error, userId: principal.userId },
                "Failed to revoke Apple token with Apple servers during account deletion",
              );
            }
          } else if (!exchangeResult.ok) {
            request.log.warn(
              { err: exchangeResult.error, userId: principal.userId },
              "Failed to exchange Apple authorization code during deletion",
            );
          }
        } catch (appleErr) {
          request.log.warn(
            { err: appleErr },
            "Unexpected error during Apple token revocation on deletion",
          );
        }
      }

      const result = await options.accountRepository.deleteUser(
        principal.userId,
        {
          confirmationToken: parsed.data.confirmationToken,
          now: new Date(),
          accessToken: principal.accessToken,
        },
      );
      if (result.deleted) {
        return accountDeleteResponseSchema.parse({ deleted: true });
      }
      const reason = result.reason;
      let status = 409;
      let message = "Confirmation token rejected.";
      switch (reason.kind) {
        case "confirmation_token_missing":
          message =
            "No deletion challenge is active for this user. Request one first.";
          break;
        case "confirmation_token_expired":
          status = 410;
          message = "The deletion challenge has expired. Request a fresh one.";
          break;
        case "confirmation_token_mismatch":
          message = "Confirmation token does not match the active challenge.";
          break;
      }
      await sendApiError(reply, request, status, "VALIDATION_ERROR", message);
      return;
    },
  );

  // POST /v1/account/delete/status — unauthenticated status check
  // using the confirmation token. Allows clients whose connection
  // dropped after Auth was deleted to recover and confirm deletion status.
  app.post(
    "/account/delete/status",
    async (request, reply): Promise<AccountDeleteStatusResponse | void> => {
      const body = request.body as unknown;
      const parsed = accountDeleteStatusSchema.safeParse(body);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid account delete status body: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      if (!options.accountRepository.getDeletionJobByToken) {
        await sendApiError(
          reply,
          request,
          500,
          "INTERNAL_ERROR",
          "Deletion status check is not supported by the configured repository.",
        );
        return;
      }
      const job = await options.accountRepository.getDeletionJobByToken(
        parsed.data.confirmationToken,
      );
      if (!job) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "No deletion challenge found for the provided confirmation token.",
        );
        return;
      }
      return accountDeleteStatusResponseSchema.parse({
        status: job.status,
        stage: job.stage,
        completedAt: job.completedAt ? job.completedAt.toISOString() : null,
        createdAt: job.createdAt.toISOString(),
      });
    },
  );

  // GET /v1/account/ai-consent — retrieve explicit AI consent status
  app.get(
    "/account/ai-consent",
    { preHandler: app.authenticate },
    async (request): Promise<AiConsentResponse> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const consent = options.aiConsentRepository
        ? await options.aiConsentRepository.getConsent(principal.userId, {
            accessToken: principal.accessToken,
          })
        : null;

      if (!consent) {
        return aiConsentResponseSchema.parse({
          consent: {
            granted: false,
            confirmedAdult: false,
            consentVersion: CURRENT_AI_CONSENT_VERSION,
            consentedAt: null,
            revokedAt: null,
          },
        });
      }

      return aiConsentResponseSchema.parse({
        consent: {
          granted: consent.granted,
          confirmedAdult: consent.confirmedAdult,
          consentVersion: consent.consentVersion,
          consentedAt: consent.consentedAt
            ? consent.consentedAt.toISOString()
            : null,
          revokedAt: consent.revokedAt ? consent.revokedAt.toISOString() : null,
        },
      });
    },
  );

  // PUT /v1/account/ai-consent — record or revoke explicit AI consent
  app.put(
    "/account/ai-consent",
    { preHandler: app.authenticate },
    async (request, reply): Promise<AiConsentResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const parsed = updateAiConsentSchema.safeParse(request.body);
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

      const now = new Date();
      if (parsed.data.granted) {
        if (!parsed.data.confirmedAdult) {
          await sendApiError(
            reply,
            request,
            403,
            "AI_AGE_RESTRICTED",
            "Mizyun AI features require confirmed adult status (18+).",
          );
          return;
        }

        if (options.profileRepository) {
          const profile = await options.profileRepository.getOrCreate(
            principal.userId,
            { now, accessToken: principal.accessToken },
          );
          if (!isAdultEligibleForAi(profile, now)) {
            await sendApiError(
              reply,
              request,
              403,
              "AI_AGE_RESTRICTED",
              "Mizyun AI features require adult eligibility (18 years or older) under provider terms.",
            );
            return;
          }
        }
      }

      if (!options.aiConsentRepository) {
        throw new Error("aiConsentRepository not configured");
      }

      const saved = await options.aiConsentRepository.saveConsent(
        principal.userId,
        {
          granted: parsed.data.granted,
          confirmedAdult: parsed.data.confirmedAdult,
          consentVersion: parsed.data.consentVersion,
        },
        { accessToken: principal.accessToken, now },
      );

      return aiConsentResponseSchema.parse({
        consent: {
          granted: saved.granted,
          confirmedAdult: saved.confirmedAdult,
          consentVersion: saved.consentVersion,
          consentedAt: saved.consentedAt
            ? saved.consentedAt.toISOString()
            : null,
          revokedAt: saved.revokedAt ? saved.revokedAt.toISOString() : null,
        },
      });
    },
  );
};
