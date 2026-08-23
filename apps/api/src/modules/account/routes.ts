import type { FastifyPluginAsync } from "fastify";
import type { AccountExport, AccountRepository } from "@mizyun/core";
import type { MemoryRecord, MemoryStore } from "@mizyun/memory";
import {
  accountDeleteResponseSchema,
  accountDeleteSchema,
  accountExportResponseSchema,
  accountDeleteChallengeResponseSchema,
  type AccountDeleteResponse,
  type AccountExportResponse,
  type AccountDeleteChallengeResponse,
} from "@mizyun/contracts";

import { sendApiError } from "../../errors.js";

interface AccountRoutesOptions {
  readonly accountRepository: AccountRepository;
  readonly memoryStore: MemoryStore;
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
      );
      const memories = await options.memoryStore.list(principal.userId, {
        accessToken: principal.accessToken,
        includeSuperseded: true,
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
      const result = await options.accountRepository.deleteUser(
        principal.userId,
        { confirmationToken: parsed.data.confirmationToken, now: new Date() },
      );
      if (result.deleted) {
        const memories = await options.memoryStore.list(principal.userId, {
          accessToken: principal.accessToken,
          includeSuperseded: true,
        });
        await Promise.allSettled(
          memories.map((memory) =>
            options.memoryStore.delete(principal.userId, memory.id, {
              accessToken: principal.accessToken,
            }),
          ),
        );
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
};
