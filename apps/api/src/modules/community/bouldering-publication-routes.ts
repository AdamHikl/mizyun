import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  boulderingShareDetails,
  readBoulderSession,
  type BoulderingRepository,
  type CommunityRepository,
  type SharedBoulderingDetails,
  type StoredCommunityProfile,
  type StoredSharedActivity,
  type StoredWorkout,
  type UserId,
} from "@mizyun/core";
import {
  authorSharedActivityDtoSchema,
  boulderingSharePreviewDtoSchema,
  publishBoulderingActivitySchema,
  sharedBoulderingDetailsSchema,
} from "@mizyun/contracts";
import { sendApiError } from "../../errors.js";
import { registerCommunityErrorHandler } from "./error-handler.js";

/** ADR-0067: explicit Community sharing of a completed bouldering session. */
export interface CommunityBoulderingPublicationRoutesOptions {
  readonly communityRepository: CommunityRepository;
  readonly boulderingRepository: BoulderingRepository;
  /** `MIZYUN_BOULDERING_ENABLED`; off answers both routes with FEATURE_DISABLED. */
  readonly enabled: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reactionCounts = {
  clap: 0,
  fire: 0,
  high_five: 0,
  fist_bump: 0,
  thumbs_up: 0,
};

type Access = { readonly accessToken: string };

/** The exact projection the database recomputes in `community_bouldering_details`. */
const project = async (
  repository: BoulderingRepository,
  userId: UserId,
  session: StoredWorkout,
  activityDate: string,
  includeGradeBreakdown: boolean,
  access: Access,
): Promise<SharedBoulderingDetails> => {
  const ascents = await repository.listAscents(userId, [session.id], access);
  return sharedBoulderingDetailsSchema.parse(
    boulderingShareDetails(
      activityDate,
      ascents.filter((a) => a.userId === userId && a.sessionId === session.id),
      includeGradeBreakdown,
    ),
  ) as SharedBoulderingDetails;
};

const authorDto = (
  profile: StoredCommunityProfile,
  userId: UserId,
  activity: StoredSharedActivity,
) =>
  authorSharedActivityDtoSchema.parse({
    id: activity.id,
    authorUserId: userId,
    authorHandle: profile.handle,
    authorDisplayName: profile.displayName,
    authorAvatarSymbol: profile.avatarSymbol,
    category: activity.category,
    sharedDay: activity.sharedDay,
    activityKind: "bouldering",
    mealDetails: null,
    boulderingDetails: activity.boulderingDetails ?? null,
    durationSeconds: null,
    workoutDetails: null,
    sourceWorkoutId: activity.sourceWorkoutId,
    sourceMealId: null,
    publishedAt: activity.publishedAt.toISOString(),
    version: activity.version,
    revokedAt: activity.revokedAt?.toISOString() ?? null,
    reactionCounts,
    viewerReaction: null,
  });

export const communityBoulderingPublicationRoutes: FastifyPluginAsync<
  CommunityBoulderingPublicationRoutesOptions
> = async (app, options) => {
  registerCommunityErrorHandler(app);

  /**
   * Shared admission: bouldering flag, active Community profile and the
   * caller's own completed session. Returns null after replying.
   */
  const admit = async (
    request: FastifyRequest,
    reply: FastifyReply,
    sessionId: string,
  ) => {
    const principal = request.principal!;
    const access = { accessToken: principal.accessToken };
    if (!options.enabled) {
      await sendApiError(
        reply,
        request,
        503,
        "FEATURE_DISABLED",
        "Bouldering is not available yet.",
      );
      return null;
    }
    const profile = await options.communityRepository.getProfile(
      principal.userId,
      access,
    );
    if (!profile || profile.status !== "active") {
      await sendApiError(
        reply,
        request,
        403,
        "COMMUNITY_NOT_ENROLLED",
        "Enroll in Community before sharing a session.",
      );
      return null;
    }
    const session = UUID.test(sessionId)
      ? await options.boulderingRepository.getSession(
          principal.userId,
          sessionId.toLowerCase(),
          access,
        )
      : null;
    const core = session ? readBoulderSession(session.details) : null;
    if (!session || session.userId !== principal.userId || !core) {
      await sendApiError(
        reply,
        request,
        404,
        "NOT_FOUND",
        "Session not found.",
      );
      return null;
    }
    if (session.completedAt === null) {
      await sendApiError(
        reply,
        request,
        422,
        "WORKOUT_NOT_COMPLETED",
        "Finish the session before sharing it.",
      );
      return null;
    }
    return { principal, access, profile, session, core };
  };

  app.get(
    "/bouldering-sessions/:sessionId/preview",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string };
      const admitted = await admit(request, reply, sessionId);
      if (!admitted) return;
      const { principal, access, profile, session, core } = admitted;
      const [boulderingDetails, boulderingDetailsWithBreakdown] =
        await Promise.all([
          project(
            options.boulderingRepository,
            principal.userId,
            session,
            core.activityDate,
            false,
            access,
          ),
          project(
            options.boulderingRepository,
            principal.userId,
            session,
            core.activityDate,
            true,
            access,
          ),
        ]);
      let followerCount = 0;
      let afterId: string | undefined;
      for (;;) {
        const page = await options.communityRepository.getFollowers(
          principal.userId,
          { ...access, limit: 50, ...(afterId ? { afterId } : {}) },
        );
        followerCount += page.length;
        if (page.length < 50) break;
        afterId = page[page.length - 1]!.relationship.id;
      }
      const existing = await options.communityRepository.getActivityByWorkoutId(
        session.id,
        principal.userId,
        access,
      );
      return boulderingSharePreviewDtoSchema.parse({
        sessionId: session.id,
        enrollmentGeneration: profile.generation,
        existingActivity:
          existing && existing.activityKind === "bouldering"
            ? authorDto(profile, principal.userId, existing)
            : null,
        sharedDay: core.activityDate,
        boulderingDetails,
        boulderingDetailsWithBreakdown,
        followerCount,
      });
    },
  );

  app.post(
    "/bouldering-activities",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = publishBoulderingActivitySchema.safeParse(request.body);
      if (!parsed.success) {
        if (!options.enabled)
          return sendApiError(
            reply,
            request,
            503,
            "FEATURE_DISABLED",
            "Bouldering is not available yet.",
          );
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Choose a valid session sharing confirmation.",
        );
      }
      const input = parsed.data;
      const admitted = await admit(request, reply, input.sessionId);
      if (!admitted) return;
      const { principal, access, profile, session, core } = admitted;
      if (input.enrollmentGeneration !== profile.generation)
        return sendApiError(
          reply,
          request,
          409,
          "CONFLICT",
          "Preview the session again.",
        );
      if (
        (input.expectedBoulderingDetails.gradeBreakdown !== null) !==
        input.includeGradeBreakdown
      )
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Choose whether to include the grade breakdown.",
        );
      const current = await project(
        options.boulderingRepository,
        principal.userId,
        session,
        core.activityDate,
        input.includeGradeBreakdown,
        access,
      );
      const published =
        await options.communityRepository.publishBoulderingActivity(
          principal.userId,
          {
            sourceSessionId: session.id,
            enrollmentGeneration: input.enrollmentGeneration,
            operationId: input.operationId,
            expectedVersion: input.expectedVersion,
            expectedRevoked: input.expectedRevoked,
            sharedDay: input.sharedDay,
            boulderingDetails:
              input.expectedBoulderingDetails as SharedBoulderingDetails,
            currentSourceBoulderingDetails: current,
          },
          access,
        );
      reply.status(201);
      return authorDto(profile, principal.userId, published);
    },
  );
};
