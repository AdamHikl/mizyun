import { z } from "zod";

export const COMMUNITY_TERMS_VERSION = "2026-09-30" as const;

export const RESERVED_COMMUNITY_HANDLES = [
  "admin",
  "administrator",
  "api",
  "app",
  "auth",
  "community",
  "feed",
  "friends",
  "help",
  "mizyun",
  "moderator",
  "official",
  "privacy",
  "root",
  "security",
  "staff",
  "status",
  "support",
  "system",
  "terms",
  "www",
  "null",
  "undefined",
] as const;

export const communityHandleRegex = /^[a-z0-9_]{3,24}$/;

export const communityHandleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Handle must be at least 3 characters")
  .max(24, "Handle must be at most 24 characters")
  .regex(
    communityHandleRegex,
    "Handle may only contain lowercase letters, numbers, and underscores",
  )
  .refine(
    (handle) =>
      !RESERVED_COMMUNITY_HANDLES.includes(
        handle as (typeof RESERVED_COMMUNITY_HANDLES)[number],
      ),
    { message: "This handle is reserved and cannot be claimed" },
  );

export const workoutCategorySchema = z.enum([
  "strength",
  "running",
  "cycling",
  "hiit",
  "mobility",
  "walking",
  "other",
]);
export type WorkoutCategory = z.infer<typeof workoutCategorySchema>;

export const communityReactionKindSchema = z.enum([
  "clap",
  "fire",
  "high_five",
  "fist_bump",
  "thumbs_up",
]);
export type CommunityReactionKind = z.infer<typeof communityReactionKindSchema>;

export const communityRelationshipStatusSchema = z.enum([
  "none",
  "pending",
  "approved",
  "declined",
  "canceled",
]);
export type CommunityRelationshipStatus = z.infer<
  typeof communityRelationshipStatusSchema
>;

export const communityReportReasonSchema = z.enum([
  "harassment",
  "impersonation",
  "spam",
  "unsafe_or_sexual_content",
  "other",
  "offensive_content",
]);
export type CommunityReportReason = z.infer<typeof communityReportReasonSchema>;

export const communityProfileStatusSchema = z.enum([
  "active",
  "withdrawn",
  "suspended",
]);
export type CommunityProfileStatus = z.infer<
  typeof communityProfileStatusSchema
>;

export const communityProfileDtoSchema = z.object({
  userId: z.string().uuid(),
  handle: communityHandleSchema,
  displayName: z.string().trim().min(1).max(32),
  avatarSymbol: z.string().trim().min(1).max(4),
  bio: z.string().trim().max(160).nullable().default(null),
  isSearchable: z.boolean().default(false),
  status: communityProfileStatusSchema,
  generation: z.number().int().positive().default(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CommunityProfileDto = z.infer<typeof communityProfileDtoSchema>;

export const publicCommunityProfileDtoSchema = z.object({
  userId: z.string().uuid(),
  handle: communityHandleSchema,
  displayName: z.string().trim().min(1).max(32),
  avatarSymbol: z.string().trim().min(1).max(4),
  bio: z.string().trim().max(160).nullable().default(null),
  createdAt: z.string().datetime(),
  relationshipWithViewer: z
    .enum([
      "none",
      "pending_outgoing",
      "pending_incoming",
      "following",
      "follower",
      "mutual",
      "self",
    ])
    .optional(),
});
export type PublicCommunityProfileDto = z.infer<
  typeof publicCommunityProfileDtoSchema
>;

export const handleAvailabilityResponseSchema = z.object({
  handle: z.string(),
  available: z.boolean(),
  reason: z.string().optional(),
});
export type HandleAvailabilityResponse = z.infer<
  typeof handleAvailabilityResponseSchema
>;

export const searchProfilesResponseSchema = z.object({
  profiles: z.array(publicCommunityProfileDtoSchema),
});
export type SearchProfilesResponse = z.infer<
  typeof searchProfilesResponseSchema
>;

const communityIdentityText = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/.test(value),
    "Use plain text without control characters",
  );
const communityBioText = z
  .string()
  .trim()
  .max(160)
  .refine(
    (value) =>
      !/[\u0000-\u001f\u007f]/.test(value) &&
      !/(https?:\/\/|www\.|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|[0-9][0-9 ()+.-]{6,}[0-9])/i.test(
        value,
      ),
    "Bio cannot contain links or contact details",
  );

export const createCommunityProfileSchema = z
  .object({
    handle: communityHandleSchema,
    displayName: communityIdentityText,
    avatarSymbol: z.string().trim().min(1).max(4).optional(),
    bio: communityBioText.optional().nullable(),
    isSearchable: z.boolean().optional().default(false),
    adultDeclaration: z.literal(true),
    termsVersion: z.literal(COMMUNITY_TERMS_VERSION),
    acceptedTerms: z.literal(true, {
      errorMap: () => ({
        message:
          "You must accept the Community Rules and Safety Policy to join",
      }),
    }),
  })
  .strict();
export type CreateCommunityProfileInput = z.infer<
  typeof createCommunityProfileSchema
>;

export const updateCommunityProfileSchema = z
  .object({
    displayName: communityIdentityText.optional(),
    avatarSymbol: z.string().trim().min(1).max(4).optional(),
    bio: communityBioText.optional().nullable(),
    isSearchable: z.boolean().optional(),
  })
  .strict();
export type UpdateCommunityProfileInput = z.infer<
  typeof updateCommunityProfileSchema
>;

export const sendFollowRequestSchema = z
  .object({
    targetUserId: z.string().uuid(),
    operationId: z.string().uuid(),
    invitationToken: z
      .string()
      .regex(/^[A-Za-z0-9_-]{22}$/)
      .optional(),
  })
  .strict();
export type SendFollowRequestInput = z.infer<typeof sendFollowRequestSchema>;

export const updateFollowRequestSchema = z
  .object({
    action: z.enum(["approve", "decline", "cancel"]),
  })
  .strict();
export type UpdateFollowRequestInput = z.infer<
  typeof updateFollowRequestSchema
>;

export const followRelationshipDtoSchema = z.object({
  id: z.string().uuid(),
  followerUserId: z.string().uuid(),
  targetUserId: z.string().uuid(),
  status: communityRelationshipStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type FollowRelationshipDto = z.infer<typeof followRelationshipDtoSchema>;

export const relationshipListItemDtoSchema = z.object({
  relationshipId: z.string().uuid(),
  user: publicCommunityProfileDtoSchema,
  status: communityRelationshipStatusSchema,
  createdAt: z.string().datetime(),
});
export type RelationshipListItemDto = z.infer<
  typeof relationshipListItemDtoSchema
>;

export const relationshipListResponseSchema = z.object({
  items: z.array(relationshipListItemDtoSchema),
  nextCursor: z.string().nullable().optional(),
});
export type RelationshipListResponse = z.infer<
  typeof relationshipListResponseSchema
>;

export const createBlockSchema = z
  .object({
    blockedUserId: z.string().uuid(),
  })
  .strict();
export type CreateBlockInput = z.infer<typeof createBlockSchema>;

export const communityBlockDtoSchema = z.object({
  id: z.string().uuid(),
  blockerUserId: z.string().uuid(),
  blockedUserId: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type CommunityBlockDto = z.infer<typeof communityBlockDtoSchema>;

export const blockedUserListItemDtoSchema = z.object({
  blockId: z.string().uuid(),
  blockedUser: publicCommunityProfileDtoSchema,
  createdAt: z.string().datetime(),
});
export type BlockedUserListItemDto = z.infer<
  typeof blockedUserListItemDtoSchema
>;

export const blockedUserListResponseSchema = z.object({
  items: z.array(blockedUserListItemDtoSchema),
  nextCursor: z.string().nullable().optional(),
});
export type BlockedUserListResponse = z.infer<
  typeof blockedUserListResponseSchema
>;

export const sharedWorkoutDetailsSchema = z
  .object({
    exercises: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(120),
            sets: z
              .array(
                z
                  .object({
                    setType: z.enum(["normal", "warmup", "drop", "failure"]),
                    repetitions: z.number().min(0).max(9999.99).nullable(),
                    loadKg: z.number().min(0).max(9999.999).nullable(),
                    durationSeconds: z
                      .number()
                      .int()
                      .min(0)
                      .max(86400)
                      .nullable(),
                  })
                  .strict(),
              )
              .min(1)
              .max(500),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (value) => value.exercises.reduce((n, e) => n + e.sets.length, 0) <= 500,
    "At most 500 completed sets can be shared",
  );
export type SharedWorkoutDetails = z.infer<typeof sharedWorkoutDetailsSchema>;

export const sharedMealDetailsSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    caloriesKcal: z.number().min(0).max(20000).nullable(),
    proteinG: z.number().min(0).max(10000).nullable(),
    carbsG: z.number().min(0).max(10000).nullable(),
    fatG: z.number().min(0).max(10000).nullable(),
  })
  .strict();
export type SharedMealDetails = z.infer<typeof sharedMealDetailsSchema>;

export const publishWorkoutActivitySchema = z
  .object({
    workoutId: z.string().uuid(),
    enrollmentGeneration: z.number().int().positive(),
    operationId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative().default(0),
    expectedRevoked: z.boolean().default(false),
    expectedDurationSeconds: z.number().int().min(0).max(86400).optional(),
    includeDuration: z.boolean().default(false),
    includeWorkoutDetails: z.boolean().default(false),
    expectedWorkoutDetails: sharedWorkoutDetailsSchema.optional(),
    sharedDay: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "sharedDay must be in YYYY-MM-DD format")
      .refine((day) => {
        const date = new Date(`${day}T00:00:00Z`);
        return (
          Number.isFinite(date.getTime()) &&
          date.toISOString().slice(0, 10) === day
        );
      }, "sharedDay must be a real calendar date"),
    category: workoutCategorySchema.default("other"),
  })
  .strict();
export type PublishWorkoutActivityInput = z.infer<
  typeof publishWorkoutActivitySchema
>;

export const publishMealActivitySchema = z
  .object({
    mealId: z.string().uuid(),
    enrollmentGeneration: z.number().int().positive(),
    operationId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative().default(0),
    expectedRevoked: z.boolean().default(false),
    sharedDay: publishWorkoutActivitySchema.shape.sharedDay,
    includeNutrition: z.boolean().default(false),
    expectedMealDetails: sharedMealDetailsSchema,
  })
  .strict();
export type PublishMealActivityInput = z.infer<
  typeof publishMealActivitySchema
>;

export const sharedActivityFeedItemDtoSchema = z.object({
  id: z.string().uuid(),
  authorUserId: z.string().uuid(),
  authorHandle: z.string(),
  authorDisplayName: z.string(),
  authorAvatarSymbol: z.string(),
  activityKind: z.enum(["workout", "meal"]).default("workout"),
  mealDetails: sharedMealDetailsSchema.nullable().default(null),
  category: workoutCategorySchema,
  sharedDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationSeconds: z.number().int().nonnegative().nullable(),
  workoutDetails: sharedWorkoutDetailsSchema.nullable().default(null),
  publishedAt: z.string().datetime(),
  reactionCounts: z.record(
    communityReactionKindSchema,
    z.number().int().nonnegative(),
  ),
  viewerReaction: communityReactionKindSchema.nullable(),
});
export type SharedActivityFeedItemDto = Omit<
  z.infer<typeof sharedActivityFeedItemDtoSchema>,
  "activityKind" | "mealDetails"
> & {
  activityKind?: "workout" | "meal";
  mealDetails?: SharedMealDetails | null;
};

export const authorSharedActivityDtoSchema =
  sharedActivityFeedItemDtoSchema.extend({
    sourceWorkoutId: z.string().uuid().nullable().default(null),
    sourceMealId: z.string().uuid().nullable().default(null),
    version: z.number().int().positive(),
    revokedAt: z.string().datetime().nullable(),
  });
export type AuthorSharedActivityDto = Omit<
  z.infer<typeof authorSharedActivityDtoSchema>,
  "activityKind" | "mealDetails" | "sourceMealId"
> & {
  activityKind?: "workout" | "meal";
  mealDetails?: SharedMealDetails | null;
  sourceMealId?: string | null;
};

export const setCommunityReactionSchema = z
  .object({
    reaction: communityReactionKindSchema.nullable(),
  })
  .strict();
export type SetCommunityReactionInput = z.infer<
  typeof setCommunityReactionSchema
>;

export const reactorSummarySchema = z.object({
  userId: z.string().uuid(),
  handle: communityHandleSchema,
  displayName: z.string(),
  avatarSymbol: z.string(),
  reaction: communityReactionKindSchema,
  createdAt: z.string().datetime(),
});
export type ReactorSummary = z.infer<typeof reactorSummarySchema>;

export const activityReactionsResponseSchema = z.object({
  activityId: z.string().uuid(),
  reactionCounts: z.record(
    communityReactionKindSchema,
    z.number().int().nonnegative(),
  ),
  viewerReaction: communityReactionKindSchema.nullable(),
  reactors: z.array(reactorSummarySchema).optional(),
});
export type ActivityReactionsResponse = z.infer<
  typeof activityReactionsResponseSchema
>;

export const createCommunityReportSchema = z
  .object({
    targetType: z.enum([
      "profile",
      "activity",
      "comment",
      "group",
      "group_post",
      "routine",
      "message",
      "challenge",
      "media",
    ]),
    targetId: z.string().min(1),
    reason: communityReportReasonSchema,
    notes: z.string().trim().max(1000).optional().nullable(),
    alsoBlock: z.boolean().optional(),
    interactionReceiptId: z.string().uuid().optional(),
  })
  .strict();
export type CreateCommunityReportInput = z.infer<
  typeof createCommunityReportSchema
>;

export const communityReportResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["submitted", "under_review", "resolved", "dismissed"]),
  createdAt: z.string().datetime(),
  safetyContact: z.string().nullable(),
  blocked: z.boolean().optional(),
  message: z.string(),
});
export type CommunityReportResponse = z.infer<
  typeof communityReportResponseSchema
>;

export const communityReportSummaryDtoSchema = z.object({
  id: z.string().uuid(),
  targetType: z.enum([
    "profile",
    "activity",
    "comment",
    "group",
    "group_post",
    "routine",
    "message",
    "challenge",
    "media",
  ]),
  targetId: z.string(),
  reason: communityReportReasonSchema,
  status: z.enum(["submitted", "under_review", "resolved", "dismissed"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CommunityReportSummaryDto = z.infer<
  typeof communityReportSummaryDtoSchema
>;

export const communityReportListResponseSchema = z.array(
  communityReportSummaryDtoSchema,
);
export type CommunityReportListResponse = z.infer<
  typeof communityReportListResponseSchema
>;

export const safetyContactInfoSchema = z.object({
  available: z.boolean().optional(),
  contactEmail: z.string().email().nullable(),
  emergencyAdvice: z.string(),
  standardsUrl: z.string().url().nullable(),
  ordinaryResponseHours: z.number().int().positive(),
  urgentResponseHours: z.number().int().positive(),
});
export type SafetyContactInfo = z.infer<typeof safetyContactInfoSchema>;

export const moderationQueueItemSchema = z.object({
  evidenceSnapshot: z.record(z.unknown()).optional(),
  id: z.string().uuid(),
  reporterUserId: z.string().uuid().nullable(),
  targetType: z.enum([
    "profile",
    "activity",
    "comment",
    "group",
    "group_post",
    "routine",
    "message",
    "challenge",
    "media",
  ]),
  targetId: z.string(),
  reason: communityReportReasonSchema,
  notes: z.string().nullable(),
  status: z.enum(["submitted", "under_review", "resolved", "dismissed"]),
  priority: z.enum(["normal", "urgent"]),
  assignedTo: z.string().nullable(),
  decision: z.enum(["warn", "remove", "suspend", "ban", "dismiss"]).nullable(),
  decisionReason: z.string().nullable(),
  staffNotes: z.string().nullable(),
  actionTakenAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ModerationQueueItem = z.infer<typeof moderationQueueItemSchema>;

export const moderationActionSchema = z
  .object({
    action: z.enum(["warn", "remove", "suspend", "ban", "dismiss"]),
    reason: z.string().trim().min(1).max(500),
    staffNotes: z.string().trim().max(1000).optional().nullable(),
    suspensionDurationDays: z
      .union([z.literal(7), z.literal(14), z.literal(30)])
      .optional()
      .nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === "suspend" && value.suspensionDurationDays == null)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["suspensionDurationDays"],
        message: "Choose a 7, 14 or 30-day suspension.",
      });
  });
export type ModerationActionInput = z.infer<typeof moderationActionSchema>;

export const createModerationAppealSchema = z
  .object({
    reportId: z.string().uuid(),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export type CreateModerationAppealInput = z.infer<
  typeof createModerationAppealSchema
>;

export const moderationAppealDtoSchema = z.object({
  id: z.string().uuid(),
  reportId: z.string().uuid(),
  appellantUserId: z.string().uuid(),
  reason: z.string(),
  status: z.enum(["pending", "approved", "rejected"]),
  reviewedBy: z.string().nullable(),
  reviewerNotes: z.string().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type ModerationAppealDto = z.infer<typeof moderationAppealDtoSchema>;

export const communityInvitationDtoSchema = z.object({
  id: z.string().uuid(),
  token: z.string().min(16),
  inviterUserId: z.string().uuid(),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type CommunityInvitationDto = z.infer<
  typeof communityInvitationDtoSchema
>;

export const createInvitationResponseSchema = z.object({
  invitation: communityInvitationDtoSchema,
  inviteUrl: z.string().url(),
});
export type CreateInvitationResponse = z.infer<
  typeof createInvitationResponseSchema
>;

export const communityInvitationListResponseSchema = z.object({
  items: z.array(communityInvitationDtoSchema),
});
export type CommunityInvitationListResponse = z.infer<
  typeof communityInvitationListResponseSchema
>;

export const resolveInvitationResponseSchema = z.object({
  id: z.string().uuid(),
  token: z.string(),
  inviter: publicCommunityProfileDtoSchema,
  expiresAt: z.string().datetime(),
  isExpired: z.boolean(),
  isRevoked: z.boolean(),
});
export type ResolveInvitationResponse = z.infer<
  typeof resolveInvitationResponseSchema
>;

export const revokeInvitationResponseSchema = z.object({
  revoked: z.boolean(),
});
export type RevokeInvitationResponse = z.infer<
  typeof revokeInvitationResponseSchema
>;

export const updateSharedActivitySchema = z
  .object({
    includeDuration: z.boolean().optional(),
    expectedDurationSeconds: z.number().int().min(0).max(86400).optional(),
    expectedVersion: z.number().int().positive().default(1),
  })
  .strict();
export type UpdateSharedActivityInput = z.infer<
  typeof updateSharedActivitySchema
>;

export const unpublishActivityResponseSchema = z.object({
  revoked: z.boolean(),
});
export type UnpublishActivityResponse = z.infer<
  typeof unpublishActivityResponseSchema
>;

export const workoutSharePreviewDtoSchema = z.object({
  enrollmentGeneration: z.number().int().positive(),
  existingActivity: authorSharedActivityDtoSchema.nullable().optional(),
  workoutId: z.string().uuid(),
  category: workoutCategorySchema,
  sharedDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationSeconds: z.number().int().nonnegative().nullable(),
  workoutDetails: sharedWorkoutDetailsSchema.nullable().default(null),
  followerCount: z.number().int().nonnegative(),
});
export type WorkoutSharePreviewDto = z.infer<
  typeof workoutSharePreviewDtoSchema
>;

export const mealSharePreviewDtoSchema = z.object({
  mealId: z.string().uuid(),
  enrollmentGeneration: z.number().int().positive(),
  existingActivity: authorSharedActivityDtoSchema.nullable(),
  sharedDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mealDetails: sharedMealDetailsSchema,
  followerCount: z.number().int().nonnegative(),
});
export type MealSharePreviewDto = z.infer<typeof mealSharePreviewDtoSchema>;

export const withdrawCommunityResponseSchema = z.object({
  withdrawn: z.boolean(),
});
export type WithdrawCommunityResponse = z.infer<
  typeof withdrawCommunityResponseSchema
>;

export const unfollowCommunityResponseSchema = z.object({
  unfollowed: z.boolean(),
});
export type UnfollowCommunityResponse = z.infer<
  typeof unfollowCommunityResponseSchema
>;

export const removeFollowerResponseSchema = z.object({
  removed: z.boolean(),
});
export type RemoveFollowerResponse = z.infer<
  typeof removeFollowerResponseSchema
>;

export const unblockCommunityResponseSchema = z.object({
  unblocked: z.boolean(),
});
export type UnblockCommunityResponse = z.infer<
  typeof unblockCommunityResponseSchema
>;

export const communityListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().max(512).optional(),
  })
  .strict();
export const setCommunityMuteSchema = z.object({ muted: z.boolean() }).strict();
export const mutedUserListResponseSchema = z.object({
  items: z.array(
    z.object({
      user: publicCommunityProfileDtoSchema,
      createdAt: z.string().datetime(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type MutedUserListResponse = z.infer<typeof mutedUserListResponseSchema>;

export const communityFeedResponseSchema = z.object({
  items: z.array(sharedActivityFeedItemDtoSchema),
  nextCursor: z.string().nullable().optional(),
});
export type CommunityFeedResponse = z.infer<typeof communityFeedResponseSchema>;

export const communitySafetyReceiptResponseSchema = z.object({
  id: z.string().uuid(),
});
export const communitySafetyReceiptListSchema = z.array(
  z.object({
    id: z.string().uuid(),
    targetType: z.enum([
      "profile",
      "activity",
      "comment",
      "group",
      "group_post",
      "routine",
      "message",
      "challenge",
      "media",
    ]),
    targetId: z.string(),
    expiresAt: z.string().datetime(),
  }),
);
export const communitySafetyNoticeListSchema = z.array(
  communityReportSummaryDtoSchema.omit({ updatedAt: true }).extend({
    decision: z
      .enum(["warn", "remove", "suspend", "ban", "dismiss"])
      .nullable(),
    actionTakenAt: z.string().datetime().nullable(),
    suspensionExpiresAt: z.string().datetime().nullable(),
  }),
);
