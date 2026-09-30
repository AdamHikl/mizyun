import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { isSessionDetails } from "@mizyun/core";
import type {
  CommunityRepository,
  ProfileRepository,
  WorkoutRepository,
} from "@mizyun/core";
import {
  authorSharedActivityDtoSchema,
  publishWorkoutActivitySchema,
  sharedActivityFeedItemDtoSchema,
  unpublishActivityResponseSchema,
  updateSharedActivitySchema,
  workoutSharePreviewDtoSchema,
  type AuthorSharedActivityDto,
  type SharedActivityFeedItemDto,
  type UnpublishActivityResponse,
  type WorkoutSharePreviewDto,
} from "@mizyun/contracts";
import { sendApiError } from "../../errors.js";
import { registerCommunityErrorHandler } from "./error-handler.js";

const GENERIC_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CommunityPublicationRoutesOptions {
  readonly communityRepository: CommunityRepository;
  readonly workoutRepository: WorkoutRepository;
  readonly profileRepository: ProfileRepository;
}

const defaultReactionCounts = {
  clap: 0,
  fire: 0,
  high_five: 0,
  fist_bump: 0,
  thumbs_up: 0,
};

export const communityPublicationRoutes: FastifyPluginAsync<
  CommunityPublicationRoutesOptions
> = async (app, options) => {
  registerCommunityErrorHandler(app);
  // GET /v1/community/workouts/:workoutId/preview — preview what will be shared
  app.get(
    "/workouts/:workoutId/preview",
    { preHandler: app.authenticate },
    async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<WorkoutSharePreviewDto | void> => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const profile = await options.communityRepository.getProfile(
        principal.userId,
        { accessToken: principal.accessToken },
      );
      if (!profile || profile.status !== "active") {
        return sendApiError(
          reply,
          request,
          403,
          "COMMUNITY_NOT_ENROLLED",
          "You must be enrolled in Community to share workouts.",
        );
      }

      const { workoutId } = request.params as { workoutId?: string };
      if (!workoutId || !GENERIC_UUID.test(workoutId)) {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Workout not found.",
        );
      }

      const workout = await options.workoutRepository.getById(workoutId, {
        accessToken: principal.accessToken,
      });
      if (!workout || workout.userId !== principal.userId) {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Workout not found.",
        );
      }

      if (workout.completedAt === null || !isSessionDetails(workout.details)) {
        return sendApiError(
          reply,
          request,
          422,
          "WORKOUT_NOT_COMPLETED",
          "Only completed workouts can be shared to Community.",
        );
      }

      const durationSeconds = Math.max(
        0,
        Math.floor(
          (workout.completedAt.getTime() - workout.startedAt.getTime()) / 1000,
        ),
      );
      const account = await options.profileRepository.getOrCreate(
        principal.userId,
        { now: new Date(), accessToken: principal.accessToken },
      );
      const timezone =
        (request.query as { timezone?: string }).timezone ?? account.timezone;
      let sharedDay: string;
      try {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).formatToParts(workout.completedAt);
        const part = (type: string) =>
          parts.find((p) => p.type === type)?.value;
        sharedDay = `${part("year")}-${part("month")}-${part("day")}`;
      } catch {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Choose a valid timezone.",
        );
      }

      let followerCount = 0;
      let afterId: string | undefined;
      for (;;) {
        const page = await options.communityRepository.getFollowers(
          principal.userId,
          {
            accessToken: principal.accessToken,
            limit: 50,
            ...(afterId ? { afterId } : {}),
          },
        );
        followerCount += page.length;
        if (page.length < 50) break;
        afterId = page[page.length - 1]!.relationship.id;
      }

      const existing = await options.communityRepository.getActivityByWorkoutId(
        workout.id,
        principal.userId,
        { accessToken: principal.accessToken },
      );
      const existingActivity = existing
        ? authorSharedActivityDtoSchema.parse({
            id: existing.id,
            authorUserId: principal.userId,
            authorHandle: profile.handle,
            authorDisplayName: profile.displayName,
            authorAvatarSymbol: profile.avatarSymbol,
            category: existing.category,
            sharedDay: existing.sharedDay,
            durationSeconds: existing.durationSeconds,
            publishedAt: existing.publishedAt.toISOString(),
            sourceWorkoutId: existing.sourceWorkoutId,
            version: existing.version,
            revokedAt: existing.revokedAt?.toISOString() ?? null,
            reactionCounts: defaultReactionCounts,
            viewerReaction: null,
          })
        : null;
      return workoutSharePreviewDtoSchema.parse({
        workoutId: workout.id,
        enrollmentGeneration: profile.generation,
        existingActivity,
        category: "strength",
        sharedDay,
        durationSeconds,
        followerCount,
      });
    },
  );

  // POST /v1/community/activities — publish a selected workout
  app.post(
    "/activities",
    { preHandler: app.authenticate },
    async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<AuthorSharedActivityDto | void> => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const profile = await options.communityRepository.getProfile(
        principal.userId,
        { accessToken: principal.accessToken },
      );
      if (!profile || profile.status !== "active") {
        return sendApiError(
          reply,
          request,
          403,
          "COMMUNITY_NOT_ENROLLED",
          "You must be enrolled in Community to share workouts.",
        );
      }

      const parsed = publishWorkoutActivitySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          parsed.error.issues.map((i) => i.message).join("; "),
        );
      }

      if (parsed.data.enrollmentGeneration !== profile.generation)
        return sendApiError(
          reply,
          request,
          409,
          "CONFLICT",
          "This sharing confirmation has expired. Preview the workout again.",
        );
      const workout = await options.workoutRepository.getById(
        parsed.data.workoutId,
        { accessToken: principal.accessToken },
      );
      if (!workout || workout.userId !== principal.userId) {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Workout not found.",
        );
      }

      if (workout.completedAt === null || !isSessionDetails(workout.details)) {
        return sendApiError(
          reply,
          request,
          422,
          "WORKOUT_NOT_COMPLETED",
          "Only completed workouts can be shared to Community.",
        );
      }

      let durationSeconds: number | null = null;
      if (parsed.data.includeDuration) {
        durationSeconds = Math.max(
          0,
          Math.floor(
            (workout.completedAt.getTime() - workout.startedAt.getTime()) /
              1000,
          ),
        );
      }

      // Pass the confirmed snapshot to the atomic repository. Durable retries
      // resolve the original card before comparing an ordinarily edited source.
      if (
        parsed.data.includeDuration &&
        parsed.data.expectedDurationSeconds === undefined
      )
        return sendApiError(
          reply,
          request,
          409,
          "CONFLICT",
          "Preview the duration before sharing.",
        );
      const confirmedDuration = parsed.data.includeDuration
        ? parsed.data.expectedDurationSeconds!
        : null;
      const published = await options.communityRepository.publishActivity(
        principal.userId,
        {
          sourceWorkoutId: workout.id,
          enrollmentGeneration: parsed.data.enrollmentGeneration,
          operationId: parsed.data.operationId,
          expectedVersion: parsed.data.expectedVersion,
          expectedRevoked: parsed.data.expectedRevoked,
          category: parsed.data.category,
          sharedDay: parsed.data.sharedDay,
          durationSeconds: confirmedDuration,
          currentSourceDurationSeconds: durationSeconds,
          currentSourceDay: workout.completedAt.toISOString().slice(0, 10),
        },
        { accessToken: principal.accessToken },
      );

      reply.status(201);
      return authorSharedActivityDtoSchema.parse({
        id: published.id,
        authorUserId: principal.userId,
        authorHandle: profile.handle,
        authorDisplayName: profile.displayName,
        authorAvatarSymbol: profile.avatarSymbol,
        category: published.category,
        sharedDay: published.sharedDay,
        durationSeconds: published.durationSeconds,
        publishedAt: published.publishedAt.toISOString(),
        sourceWorkoutId: published.sourceWorkoutId,
        version: published.version,
        revokedAt: published.revokedAt
          ? published.revokedAt.toISOString()
          : null,
        reactionCounts: defaultReactionCounts,
        viewerReaction: null,
      });
    },
  );

  // PATCH /v1/community/activities/:id — narrow edit: toggle duration
  app.patch(
    "/activities/:id",
    { preHandler: app.authenticate },
    async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<AuthorSharedActivityDto | void> => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const profile = await options.communityRepository.getProfile(
        principal.userId,
        { accessToken: principal.accessToken },
      );
      if (!profile || profile.status !== "active") {
        return sendApiError(
          reply,
          request,
          403,
          "COMMUNITY_NOT_ENROLLED",
          "You must be enrolled in Community to update shared workouts.",
        );
      }

      const { id } = request.params as { id?: string };
      if (!id || !GENERIC_UUID.test(id)) {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Activity not found.",
        );
      }

      const activity = await options.communityRepository.getActivityById(id, {
        accessToken: principal.accessToken,
      });
      if (
        !activity ||
        activity.userId !== principal.userId ||
        activity.revokedAt !== null
      ) {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Activity not found or unavailable.",
        );
      }

      const parsed = updateSharedActivitySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          parsed.error.issues.map((i) => i.message).join("; "),
        );
      }

      let durationSeconds = activity.durationSeconds;

      if (parsed.data.includeDuration !== undefined) {
        if (parsed.data.includeDuration) {
          const workout = await options.workoutRepository.getById(
            activity.sourceWorkoutId,
            { accessToken: principal.accessToken },
          );
          if (
            !workout ||
            workout.userId !== principal.userId ||
            workout.completedAt === null ||
            !isSessionDetails(workout.details)
          ) {
            // Source workout is gone or uncompleted: revoke immediately
            await options.communityRepository.revokeActivity(
              id,
              principal.userId,
              { accessToken: principal.accessToken },
            );
            return sendApiError(
              reply,
              request,
              404,
              "NOT_FOUND",
              "Source workout is no longer available as completed.",
            );
          }
          durationSeconds = Math.max(
            0,
            Math.floor(
              (workout.completedAt.getTime() - workout.startedAt.getTime()) /
                1000,
            ),
          );
        } else {
          durationSeconds = null;
        }
      }

      if (
        parsed.data.includeDuration &&
        parsed.data.expectedDurationSeconds !== durationSeconds
      )
        return sendApiError(
          reply,
          request,
          409,
          "CONFLICT",
          "Workout duration changed. Preview again.",
        );
      const updated = await options.communityRepository.updateActivity(
        id,
        principal.userId,
        { durationSeconds, expectedVersion: parsed.data.expectedVersion },
        { accessToken: principal.accessToken },
      );

      return authorSharedActivityDtoSchema.parse({
        id: updated.id,
        authorUserId: principal.userId,
        authorHandle: profile.handle,
        authorDisplayName: profile.displayName,
        authorAvatarSymbol: profile.avatarSymbol,
        category: updated.category,
        sharedDay: updated.sharedDay,
        durationSeconds: updated.durationSeconds,
        publishedAt: updated.publishedAt.toISOString(),
        sourceWorkoutId: updated.sourceWorkoutId,
        version: updated.version,
        revokedAt: updated.revokedAt ? updated.revokedAt.toISOString() : null,
        reactionCounts: defaultReactionCounts,
        viewerReaction: null,
      });
    },
  );

  // DELETE /v1/community/activities/:id and POST /v1/community/activities/:id/unpublish
  const unpublishHandler = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<UnpublishActivityResponse | void> => {
    const principal = request.principal;
    if (!principal) throw new Error("principal missing after authentication");

    const { id } = request.params as { id?: string };
    if (!id || !GENERIC_UUID.test(id)) {
      return sendApiError(
        reply,
        request,
        404,
        "NOT_FOUND",
        "Activity not found.",
      );
    }

    const activity = await options.communityRepository.getActivityById(id, {
      accessToken: principal.accessToken,
    });
    if (!activity || activity.userId !== principal.userId) {
      return sendApiError(
        reply,
        request,
        404,
        "NOT_FOUND",
        "Activity not found.",
      );
    }

    const suppliedVersion = (request.query as { version?: string }).version;
    const expectedVersion =
      suppliedVersion === undefined
        ? activity.version
        : Number(suppliedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1)
      return sendApiError(
        reply,
        request,
        422,
        "VALIDATION_ERROR",
        "Choose the current card version.",
      );
    await options.communityRepository.revokeActivity(id, principal.userId, {
      accessToken: principal.accessToken,
      expectedVersion,
    });

    return unpublishActivityResponseSchema.parse({
      revoked: true,
    });
  };

  app.delete(
    "/activities/:id",
    { preHandler: app.authenticate },
    unpublishHandler,
  );
  app.post(
    "/activities/:id/unpublish",
    { preHandler: app.authenticate },
    unpublishHandler,
  );

  // GET /v1/community/activities/:id — view a shared activity card
  app.get(
    "/activities/:id",
    { preHandler: app.authenticate },
    async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<SharedActivityFeedItemDto | void> => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const viewerProfile = await options.communityRepository.getProfile(
        principal.userId,
        { accessToken: principal.accessToken },
      );
      if (!viewerProfile || viewerProfile.status !== "active") {
        return sendApiError(
          reply,
          request,
          403,
          "COMMUNITY_NOT_ENROLLED",
          "You must be enrolled in Community to view activity cards.",
        );
      }

      const { id } = request.params as { id?: string };
      if (!id || !GENERIC_UUID.test(id)) {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Activity not found or unavailable.",
        );
      }

      const activity = await options.communityRepository.getActivityById(id, {
        accessToken: principal.accessToken,
      });
      if (!activity || activity.revokedAt !== null) {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Activity not found or unavailable.",
        );
      }

      // Check author profile
      const authorProfile = await options.communityRepository.getProfile(
        activity.userId,
        { accessToken: principal.accessToken },
      );
      if (!authorProfile || authorProfile.status !== "active") {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Activity not found or unavailable.",
        );
      }

      // If viewer is not author, check block and follow status
      if (principal.userId !== activity.userId) {
        const isBlocked = await options.communityRepository.isBlockedBilateral(
          principal.userId,
          activity.userId,
          { accessToken: principal.accessToken },
        );
        if (isBlocked) {
          return sendApiError(
            reply,
            request,
            404,
            "NOT_FOUND",
            "Activity not found or unavailable.",
          );
        }

        const relationship = await options.communityRepository.getRelationship(
          principal.userId,
          activity.userId,
          { accessToken: principal.accessToken },
        );
        if (!relationship || relationship.status !== "approved") {
          return sendApiError(
            reply,
            request,
            404,
            "NOT_FOUND",
            "Activity not found or unavailable.",
          );
        }
      }

      return sharedActivityFeedItemDtoSchema.parse({
        id: activity.id,
        authorUserId: activity.userId,
        authorHandle: authorProfile.handle,
        authorDisplayName: authorProfile.displayName,
        authorAvatarSymbol: authorProfile.avatarSymbol,
        category: activity.category,
        sharedDay: activity.sharedDay,
        durationSeconds: activity.durationSeconds,
        publishedAt: activity.publishedAt.toISOString(),
        reactionCounts: defaultReactionCounts,
        viewerReaction: null,
      });
    },
  );
};
