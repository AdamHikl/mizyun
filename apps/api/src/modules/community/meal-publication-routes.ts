import type { FastifyPluginAsync } from "fastify";
import {
  validateContentSafety,
  type CommunityRepository,
  type FoodEntryRepository,
  type ProfileRepository,
  type StoredFoodEntry,
} from "@mizyun/core";
import {
  authorSharedActivityDtoSchema,
  mealSharePreviewDtoSchema,
  publishMealActivitySchema,
  sharedMealDetailsSchema,
} from "@mizyun/contracts";
import { sendApiError } from "../../errors.js";
import { registerCommunityErrorHandler } from "./error-handler.js";

export interface CommunityMealPublicationRoutesOptions {
  readonly communityRepository: CommunityRepository;
  readonly foodEntryRepository: FoodEntryRepository;
  readonly profileRepository: ProfileRepository;
}

const projectMeal = (meal: StoredFoodEntry, nutrition: boolean) =>
  sharedMealDetailsSchema.parse({
    name: meal.name.trim(),
    caloriesKcal: nutrition ? meal.caloriesKcal : null,
    proteinG: nutrition ? meal.proteinG : null,
    carbsG: nutrition ? meal.carbohydrateG : null,
    fatG: nutrition ? meal.fatG : null,
  });
const reactionCounts = {
  clap: 0,
  fire: 0,
  high_five: 0,
  fist_bump: 0,
  thumbs_up: 0,
};

export const communityMealPublicationRoutes: FastifyPluginAsync<
  CommunityMealPublicationRoutesOptions
> = async (app, options) => {
  registerCommunityErrorHandler(app);
  app.get(
    "/meals/:mealId/preview",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal!;
      const access = { accessToken: principal.accessToken };
      const profile = await options.communityRepository.getProfile(
        principal.userId,
        access,
      );
      if (!profile || profile.status !== "active")
        return sendApiError(
          reply,
          request,
          403,
          "COMMUNITY_NOT_ENROLLED",
          "Enroll in Community before sharing a meal.",
        );
      const { mealId } = request.params as { mealId: string };
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          mealId,
        )
      )
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Meal not found.",
        );
      const meal = await options.foodEntryRepository.getById(mealId, access);
      if (!meal || meal.userId !== principal.userId)
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Meal not found.",
        );
      if (!meal.confirmedByUser)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Confirm the meal before sharing it.",
        );
      const account = await options.profileRepository.getOrCreate(
        principal.userId,
        { now: new Date(), ...access },
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
        }).formatToParts(meal.consumedAt);
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
          { ...access, limit: 50, ...(afterId ? { afterId } : {}) },
        );
        followerCount += page.length;
        if (page.length < 50) break;
        afterId = page[page.length - 1]!.relationship.id;
      }
      const existing = await options.communityRepository.getActivityByMealId(
        meal.id,
        principal.userId,
        access,
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
            activityKind: "meal",
            mealDetails: existing.mealDetails,
            durationSeconds: null,
            workoutDetails: null,
            sourceWorkoutId: null,
            sourceMealId: meal.id,
            publishedAt: existing.publishedAt.toISOString(),
            version: existing.version,
            revokedAt: existing.revokedAt?.toISOString() ?? null,
            reactionCounts,
            viewerReaction: null,
          })
        : null;
      return mealSharePreviewDtoSchema.parse({
        mealId: meal.id,
        enrollmentGeneration: profile.generation,
        existingActivity,
        sharedDay,
        mealDetails: projectMeal(meal, true),
        followerCount,
      });
    },
  );

  app.post(
    "/meal-activities",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal!;
      const access = { accessToken: principal.accessToken };
      const profile = await options.communityRepository.getProfile(
        principal.userId,
        access,
      );
      if (!profile || profile.status !== "active")
        return sendApiError(
          reply,
          request,
          403,
          "COMMUNITY_NOT_ENROLLED",
          "Enroll in Community before sharing a meal.",
        );
      const parsed = publishMealActivitySchema.safeParse(request.body);
      if (!parsed.success)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Choose a valid meal sharing confirmation.",
        );
      const input = parsed.data;
      if (input.enrollmentGeneration !== profile.generation)
        return sendApiError(
          reply,
          request,
          409,
          "CONFLICT",
          "Preview the meal again.",
        );
      const meal = await options.foodEntryRepository.getById(
        input.mealId,
        access,
      );
      if (!meal || meal.userId !== principal.userId)
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Meal not found.",
        );
      if (!meal.confirmedByUser)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Confirm the meal before sharing it.",
        );
      if (
        !input.includeNutrition &&
        [
          input.expectedMealDetails.caloriesKcal,
          input.expectedMealDetails.proteinG,
          input.expectedMealDetails.carbsG,
          input.expectedMealDetails.fatG,
        ].some((n) => n !== null)
      )
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Choose whether to include nutrition.",
        );
      if (!validateContentSafety(input.expectedMealDetails.name).ok)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "This meal name cannot be shared under Community rules.",
        );
      const published = await options.communityRepository.publishMealActivity(
        principal.userId,
        {
          sourceMealId: meal.id,
          enrollmentGeneration: input.enrollmentGeneration,
          operationId: input.operationId,
          expectedVersion: input.expectedVersion,
          expectedRevoked: input.expectedRevoked,
          sharedDay: input.sharedDay,
          mealDetails: input.expectedMealDetails,
          currentSourceMealDetails: projectMeal(meal, input.includeNutrition),
          currentSourceDay: meal.consumedAt.toISOString().slice(0, 10),
        },
        access,
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
        activityKind: "meal",
        mealDetails: published.mealDetails,
        durationSeconds: null,
        workoutDetails: null,
        sourceWorkoutId: null,
        sourceMealId: meal.id,
        publishedAt: published.publishedAt.toISOString(),
        version: published.version,
        revokedAt: published.revokedAt?.toISOString() ?? null,
        reactionCounts,
        viewerReaction: null,
      });
    },
  );
};
