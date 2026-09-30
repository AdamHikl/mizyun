import { describe, expect, it } from "vitest";
import {
  activityReactionsResponseSchema,
  authorSharedActivityDtoSchema,
  blockedUserListResponseSchema,
  communityBlockDtoSchema,
  communityFeedResponseSchema,
  communityHandleSchema,
  communityInvitationDtoSchema,
  communityProfileDtoSchema,
  createBlockSchema,
  createCommunityProfileSchema,
  createCommunityReportSchema,
  communityReportResponseSchema,
  communityReportSummaryDtoSchema,
  createInvitationResponseSchema,
  followRelationshipDtoSchema,
  handleAvailabilityResponseSchema,
  moderationActionSchema,
  moderationAppealDtoSchema,
  createModerationAppealSchema,
  moderationQueueItemSchema,
  publicCommunityProfileDtoSchema,
  publishWorkoutActivitySchema,
  reactorSummarySchema,
  relationshipListResponseSchema,
  resolveInvitationResponseSchema,
  safetyContactInfoSchema,
  searchProfilesResponseSchema,
  sendFollowRequestSchema,
  setCommunityReactionSchema,
  sharedActivityFeedItemDtoSchema,
  updateCommunityProfileSchema,
  updateFollowRequestSchema,
  updateSharedActivitySchema,
  workoutSharePreviewDtoSchema,
} from "./community";

describe("communityHandleSchema", () => {
  it("accepts valid alphanumeric and underscore handles", () => {
    expect(communityHandleSchema.parse("alex_runner")).toBe("alex_runner");
    expect(communityHandleSchema.parse("miz_user123")).toBe("miz_user123");
    expect(communityHandleSchema.parse("  TRAINER_PRO  ")).toBe("trainer_pro");
  });

  it("rejects handles that are too short or too long", () => {
    expect(() => communityHandleSchema.parse("al")).toThrow();
    expect(() => communityHandleSchema.parse("a".repeat(25))).toThrow();
  });

  it("rejects invalid characters (dashes, spaces, punctuation)", () => {
    expect(() => communityHandleSchema.parse("alex-runner")).toThrow();
    expect(() => communityHandleSchema.parse("alex runner")).toThrow();
    expect(() => communityHandleSchema.parse("alex.runner")).toThrow();
    expect(() => communityHandleSchema.parse("alex@runner")).toThrow();
  });

  it("rejects reserved system handles", () => {
    expect(() => communityHandleSchema.parse("admin")).toThrow();
    expect(() => communityHandleSchema.parse("mizyun")).toThrow();
    expect(() => communityHandleSchema.parse("support")).toThrow();
    expect(() => communityHandleSchema.parse("system")).toThrow();
  });
});

describe("createCommunityProfileSchema", () => {
  it("accepts valid profile creation with terms acceptance", () => {
    const valid = {
      handle: "fitness_fan",
      displayName: "Fitness Fan",
      bio: "Just working out and staying healthy",
      isSearchable: true,
      acceptedTerms: true,
      adultDeclaration: true,
      termsVersion: "2026-09-30",
    };
    const parsed = createCommunityProfileSchema.parse(valid);
    expect(parsed.handle).toBe("fitness_fan");
    expect(parsed.displayName).toBe("Fitness Fan");
    expect(parsed.acceptedTerms).toBe(true);
  });

  it("fails when terms are not accepted", () => {
    const invalid = {
      handle: "fitness_fan",
      displayName: "Fitness Fan",
      acceptedTerms: false,
    };
    expect(() => createCommunityProfileSchema.parse(invalid)).toThrow();
  });

  it("leaves handle discovery off unless enrollment deliberately enables it", () => {
    expect(
      createCommunityProfileSchema.parse({
        handle: "fitness_fan",
        displayName: "Fitness Fan",
        acceptedTerms: true,
        adultDeclaration: true,
        termsVersion: "2026-09-30",
      }).isSearchable,
    ).toBe(false);
  });

  it("rejects unknown extra fields due to strict schema", () => {
    const withExtra = {
      handle: "fitness_fan",
      displayName: "Fitness Fan",
      acceptedTerms: true,
      adultDeclaration: true,
      termsVersion: "2026-09-30",
      email: "leak@mizyun.test",
    };
    expect(() => createCommunityProfileSchema.parse(withExtra)).toThrow();
  });
});

describe("updateCommunityProfileSchema", () => {
  it("allows partial updates", () => {
    expect(
      updateCommunityProfileSchema.parse({ displayName: "New Name" }),
    ).toEqual({
      displayName: "New Name",
    });
    expect(updateCommunityProfileSchema.parse({ bio: null })).toEqual({
      bio: null,
    });
    expect(updateCommunityProfileSchema.parse({ isSearchable: false })).toEqual(
      {
        isSearchable: false,
      },
    );
  });
});

describe("follow and relationship schemas", () => {
  it("validates sendFollowRequestSchema", () => {
    const valid = {
      targetUserId: "c0000000-0000-4000-8000-000000000002",
      operationId: "e1430000-0000-4000-8000-000000000001",
    };
    expect(sendFollowRequestSchema.parse(valid)).toEqual(valid);
    expect(() =>
      sendFollowRequestSchema.parse({ targetUserId: "invalid-uuid" }),
    ).toThrow();
  });

  it("validates updateFollowRequestSchema actions", () => {
    expect(updateFollowRequestSchema.parse({ action: "approve" })).toEqual({
      action: "approve",
    });
    expect(updateFollowRequestSchema.parse({ action: "decline" })).toEqual({
      action: "decline",
    });
    expect(updateFollowRequestSchema.parse({ action: "cancel" })).toEqual({
      action: "cancel",
    });
    expect(() =>
      updateFollowRequestSchema.parse({ action: "ignore" }),
    ).toThrow();
  });

  it("validates followRelationshipDtoSchema", () => {
    const dto = {
      id: "a0000000-0000-4000-8000-000000000001",
      followerUserId: "c0000000-0000-4000-8000-000000000001",
      targetUserId: "c0000000-0000-4000-8000-000000000002",
      status: "approved",
      createdAt: "2026-09-29T12:00:00.000Z",
      updatedAt: "2026-09-29T12:05:00.000Z",
    };
    expect(followRelationshipDtoSchema.parse(dto)).toEqual(dto);
  });
});

describe("createBlockSchema & communityBlockDtoSchema", () => {
  it("validates block request", () => {
    const valid = { blockedUserId: "c0000000-0000-4000-8000-000000000004" };
    expect(createBlockSchema.parse(valid)).toEqual(valid);
  });

  it("validates block DTO", () => {
    const dto = {
      id: "b0000000-0000-4000-8000-000000000001",
      blockerUserId: "c0000000-0000-4000-8000-000000000001",
      blockedUserId: "c0000000-0000-4000-8000-000000000004",
      createdAt: "2026-09-29T12:00:00.000Z",
    };
    expect(communityBlockDtoSchema.parse(dto)).toEqual(dto);
  });
});

describe("sharedActivity schemas & BOLA data minimization", () => {
  it("keeps duration off when a client omits the sharing choice", () => {
    const input = {
      workoutId: "d0000000-0000-4000-8000-000000000001",
      enrollmentGeneration: 1,
      operationId: "a0000000-0000-4000-8000-000000000001",
      sharedDay: "2026-09-29",
    };
    expect(publishWorkoutActivitySchema.parse(input).includeDuration).toBe(
      false,
    );
  });

  it("validates publishWorkoutActivitySchema", () => {
    const valid = {
      workoutId: "d0000000-0000-4000-8000-000000000001",
      enrollmentGeneration: 2,
      operationId: "a0000000-0000-4000-8000-000000000001",
      includeDuration: true,
      expectedDurationSeconds: 2700,
      sharedDay: "2026-09-29",
      category: "strength",
    };
    expect(publishWorkoutActivitySchema.parse(valid)).toEqual({
      ...valid,
      expectedVersion: 0,
      expectedRevoked: false,
    });
  });

  it.each([
    "2026-02-29",
    "2026-02-30",
    "2026-04-31",
    "2026-13-01",
    "2026-00-10",
    "2026-09-00",
  ])("rejects nonexistent author calendar date %s", (sharedDay) => {
    expect(
      publishWorkoutActivitySchema.safeParse({
        workoutId: "d0000000-0000-4000-8000-000000000001",
        enrollmentGeneration: 2,
        operationId: "a0000000-0000-4000-8000-000000000001",
        sharedDay,
      }).success,
    ).toBe(false);
  });

  it("accepts an actual leap day without converting the authors calendar date", () => {
    const parsed = publishWorkoutActivitySchema.parse({
      workoutId: "d0000000-0000-4000-8000-000000000001",
      enrollmentGeneration: 2,
      operationId: "a0000000-0000-4000-8000-000000000001",
      sharedDay: "2028-02-29",
    });
    expect(parsed.sharedDay).toBe("2028-02-29");
  });

  it.each([undefined, 0, -1, 1.5, "2", NaN, Infinity])(
    "rejects absent or invalid preview enrollment generation %s",
    (enrollmentGeneration) => {
      expect(
        publishWorkoutActivitySchema.safeParse({
          workoutId: "d0000000-0000-4000-8000-000000000001",
          enrollmentGeneration,
          operationId: "a0000000-0000-4000-8000-000000000001",
          sharedDay: "2026-09-30",
        }).success,
      ).toBe(false);
    },
  );

  it.each([undefined, "", "retry-key", "not-a-uuid"])(
    "rejects absent or invalid publication operation ID %s",
    (operationId) => {
      expect(
        publishWorkoutActivitySchema.safeParse({
          workoutId: "d0000000-0000-4000-8000-000000000001",
          enrollmentGeneration: 2,
          operationId,
          sharedDay: "2026-09-30",
        }).success,
      ).toBe(false);
    },
  );

  it("validates sharedActivityFeedItemDtoSchema without sourceWorkoutId", () => {
    const feedItem = {
      id: "f0000000-0000-4000-8000-000000000001",
      authorUserId: "c0000000-0000-4000-8000-000000000001",
      authorHandle: "alex_runner",
      authorDisplayName: "Alex R.",
      authorAvatarSymbol: "AR",
      category: "running",
      sharedDay: "2026-09-29",
      durationSeconds: 2400,
      publishedAt: "2026-09-29T14:30:00.000Z",
      reactionCounts: {
        clap: 3,
        fire: 5,
        high_five: 1,
        fist_bump: 0,
        thumbs_up: 2,
      },
      viewerReaction: "fire",
    };
    const parsed = sharedActivityFeedItemDtoSchema.parse(feedItem);
    expect(parsed.category).toBe("running");
    expect((parsed as Record<string, unknown>).sourceWorkoutId).toBeUndefined();
  });

  it("validates authorSharedActivityDtoSchema containing sourceWorkoutId for author management", () => {
    const authorItem = {
      id: "f0000000-0000-4000-8000-000000000001",
      authorUserId: "c0000000-0000-4000-8000-000000000001",
      authorHandle: "alex_runner",
      authorDisplayName: "Alex R.",
      authorAvatarSymbol: "AR",
      category: "running",
      sharedDay: "2026-09-29",
      durationSeconds: 2400,
      publishedAt: "2026-09-29T14:30:00.000Z",
      reactionCounts: {
        clap: 0,
        fire: 0,
        high_five: 0,
        fist_bump: 0,
        thumbs_up: 0,
      },
      viewerReaction: null,
      sourceWorkoutId: "d0000000-0000-4000-8000-000000000001",
      version: 1,
      revokedAt: null,
    };
    const parsed = authorSharedActivityDtoSchema.parse(authorItem);
    expect(parsed.sourceWorkoutId).toBe("d0000000-0000-4000-8000-000000000001");
  });
});

describe("reactions and reports", () => {
  it("validates setCommunityReactionSchema", () => {
    expect(setCommunityReactionSchema.parse({ reaction: "high_five" })).toEqual(
      {
        reaction: "high_five",
      },
    );
    expect(setCommunityReactionSchema.parse({ reaction: null })).toEqual({
      reaction: null,
    });
    expect(() =>
      setCommunityReactionSchema.parse({ reaction: "laugh" }),
    ).toThrow();
  });

  it("validates reactorSummarySchema and activityReactionsResponseSchema", () => {
    const reactor = {
      userId: "c0000000-0000-4000-8000-000000000001",
      handle: "sam_runner",
      displayName: "Sam Runner",
      avatarSymbol: "SR",
      reaction: "fire",
      createdAt: "2026-09-30T12:00:00.000Z",
    };
    expect(reactorSummarySchema.parse(reactor)).toEqual(reactor);

    const responseWithoutReactors = {
      activityId: "f0000000-0000-4000-8000-000000000001",
      reactionCounts: {
        clap: 2,
        fire: 1,
        high_five: 0,
        fist_bump: 0,
        thumbs_up: 0,
      },
      viewerReaction: "clap",
    };
    expect(
      activityReactionsResponseSchema.parse(responseWithoutReactors),
    ).toEqual(responseWithoutReactors);

    const responseWithReactors = {
      ...responseWithoutReactors,
      reactors: [reactor],
    };
    expect(activityReactionsResponseSchema.parse(responseWithReactors)).toEqual(
      responseWithReactors,
    );
  });

  it("validates createCommunityReportSchema with all reasons and bounds", () => {
    const report = {
      targetType: "activity",
      targetId: "f0000000-0000-4000-8000-000000000001",
      reason: "unsafe_or_sexual_content",
      notes: "Contains prohibited content",
      alsoBlock: true,
      interactionReceiptId: "e0000000-0000-4000-8000-000000000001",
    };
    expect(createCommunityReportSchema.parse(report)).toEqual(report);

    // Rejects notes exceeding 1000 characters
    expect(() =>
      createCommunityReportSchema.parse({
        ...report,
        notes: "a".repeat(1001),
      }),
    ).toThrow();
  });

  it("validates communityReportResponseSchema", () => {
    const response = {
      id: "f0000000-0000-4000-8000-000000000001",
      status: "submitted",
      createdAt: "2026-09-30T10:00:00.000Z",
      safetyContact: "safety@mizyun.com",
      message: "Report received. We will review it.",
    };
    expect(communityReportResponseSchema.parse(response)).toEqual(response);
  });

  it("validates communityReportSummaryDtoSchema", () => {
    const summary = {
      id: "f0000000-0000-4000-8000-000000000001",
      targetType: "profile",
      targetId: "c0000000-0000-4000-8000-000000000001",
      reason: "harassment",
      status: "under_review",
      createdAt: "2026-09-30T10:00:00.000Z",
      updatedAt: "2026-09-30T10:30:00.000Z",
    };
    expect(communityReportSummaryDtoSchema.parse(summary)).toEqual(summary);
  });

  it("validates safetyContactInfoSchema", () => {
    const contact = {
      contactEmail: "safety@mizyun.com",
      emergencyAdvice:
        "If in immediate danger, contact local emergency services.",
      standardsUrl: "https://mizyun.com/community-standards",
      ordinaryResponseHours: 24,
      urgentResponseHours: 4,
    };
    expect(safetyContactInfoSchema.parse(contact)).toEqual(contact);
  });

  it("validates moderationQueueItemSchema, moderationActionSchema, and appeal schemas", () => {
    const queueItem = {
      id: "f0000000-0000-4000-8000-000000000001",
      reporterUserId: "a0000000-0000-4000-8000-000000000001",
      targetType: "profile",
      targetId: "b0000000-0000-4000-8000-000000000001",
      reason: "harassment",
      notes: "Abusive handle and behavior",
      status: "submitted",
      priority: "normal",
      assignedTo: null,
      decision: null,
      decisionReason: null,
      staffNotes: null,
      actionTakenAt: null,
      createdAt: "2026-09-30T10:00:00.000Z",
      updatedAt: "2026-09-30T10:00:00.000Z",
    };
    expect(moderationQueueItemSchema.parse(queueItem)).toEqual(queueItem);

    const action = {
      action: "warn",
      reason: "Violated community standards on harassment",
      staffNotes: "First offense, issued warning",
    };
    expect(moderationActionSchema.parse(action)).toEqual({
      ...action,
      suspensionDurationDays: undefined,
    });

    const appeal = {
      reportId: "f0000000-0000-4000-8000-000000000001",
      reason: "The reported content was taken out of context",
    };
    expect(createModerationAppealSchema.parse(appeal)).toEqual(appeal);

    const appealDto = {
      id: "e0000000-0000-4000-8000-000000000001",
      reportId: "f0000000-0000-4000-8000-000000000001",
      appellantUserId: "b0000000-0000-4000-8000-000000000001",
      reason: "The reported content was taken out of context",
      status: "pending",
      reviewedBy: null,
      reviewerNotes: null,
      resolvedAt: null,
      createdAt: "2026-09-30T11:00:00.000Z",
    };
    expect(moderationAppealDtoSchema.parse(appealDto)).toEqual(appealDto);
  });
});

describe("publicCommunityProfile and search/list schemas", () => {
  it("validates publicCommunityProfileDtoSchema without exposing private fields", () => {
    const publicProfile = {
      userId: "c0000000-0000-4000-8000-000000000001",
      handle: "sam_runner",
      displayName: "Sam Runner",
      avatarSymbol: "SR",
      bio: "Marathon runner",
      createdAt: "2026-09-29T10:00:00.000Z",
      relationshipWithViewer: "following",
    };
    const parsed = publicCommunityProfileDtoSchema.parse(publicProfile);
    expect(parsed.handle).toBe("sam_runner");
    expect(parsed.relationshipWithViewer).toBe("following");
    expect((parsed as Record<string, unknown>).email).toBeUndefined();
    expect((parsed as Record<string, unknown>).birthYear).toBeUndefined();
  });

  it("validates handleAvailabilityResponseSchema", () => {
    expect(
      handleAvailabilityResponseSchema.parse({
        handle: "cool_name",
        available: true,
      }),
    ).toEqual({
      handle: "cool_name",
      available: true,
    });

    expect(
      handleAvailabilityResponseSchema.parse({
        handle: "admin",
        available: false,
        reason: "Reserved handle",
      }),
    ).toEqual({
      handle: "admin",
      available: false,
      reason: "Reserved handle",
    });
  });

  it("validates searchProfilesResponseSchema", () => {
    const searchRes = {
      profiles: [
        {
          userId: "c0000000-0000-4000-8000-000000000002",
          handle: "runner_bob",
          displayName: "Bob",
          avatarSymbol: "B",
          bio: null,
          createdAt: "2026-09-29T10:00:00.000Z",
        },
      ],
    };
    expect(searchProfilesResponseSchema.parse(searchRes)).toEqual(searchRes);
  });

  it("validates relationshipListResponseSchema and blockedUserListResponseSchema", () => {
    const relRes = {
      items: [
        {
          relationshipId: "a0000000-0000-4000-8000-000000000001",
          user: {
            userId: "c0000000-0000-4000-8000-000000000002",
            handle: "runner_bob",
            displayName: "Bob",
            avatarSymbol: "B",
            bio: null,
            createdAt: "2026-09-29T10:00:00.000Z",
          },
          status: "approved",
          createdAt: "2026-09-29T12:00:00.000Z",
        },
      ],
    };
    expect(relationshipListResponseSchema.parse(relRes)).toEqual(relRes);

    const blockRes = {
      items: [
        {
          blockId: "b0000000-0000-4000-8000-000000000001",
          blockedUser: {
            userId: "c0000000-0000-4000-8000-000000000003",
            handle: "spammer",
            displayName: "Spam Bot",
            avatarSymbol: "SB",
            bio: null,
            createdAt: "2026-09-29T10:00:00.000Z",
          },
          createdAt: "2026-09-29T12:00:00.000Z",
        },
      ],
    };
    expect(blockedUserListResponseSchema.parse(blockRes)).toEqual(blockRes);
  });

  it("validates communityInvitationDtoSchema, createInvitationResponseSchema, and resolveInvitationResponseSchema", () => {
    const invite = {
      id: "d0000000-0000-4000-8000-000000000001",
      token: "AbCdEfGhIjKlMnOpQrStUv",
      inviterUserId: "c0000000-0000-4000-8000-000000000001",
      expiresAt: "2026-10-06T12:00:00.000Z",
      revokedAt: null,
      createdAt: "2026-09-29T12:00:00.000Z",
    };
    expect(communityInvitationDtoSchema.parse(invite)).toEqual(invite);

    const createRes = {
      invitation: invite,
      inviteUrl: "https://mizyun.app/invite/AbCdEfGhIjKlMnOpQrStUv",
    };
    expect(createInvitationResponseSchema.parse(createRes)).toEqual(createRes);

    const resolveRes = {
      id: "d0000000-0000-4000-8000-000000000001",
      token: "AbCdEfGhIjKlMnOpQrStUv",
      inviter: {
        userId: "c0000000-0000-4000-8000-000000000001",
        handle: "alex_runner",
        displayName: "Alex",
        avatarSymbol: "AR",
        bio: null,
        createdAt: "2026-09-29T10:00:00.000Z",
      },
      expiresAt: "2026-10-06T12:00:00.000Z",
      isExpired: false,
      isRevoked: false,
    };
    expect(resolveInvitationResponseSchema.parse(resolveRes)).toEqual(
      resolveRes,
    );
  });

  it("validates updateSharedActivitySchema and workoutSharePreviewDtoSchema", () => {
    expect(
      updateSharedActivitySchema.parse({ includeDuration: false }),
    ).toEqual({ includeDuration: false, expectedVersion: 1 });

    const preview = {
      workoutId: "e0000000-0000-4000-8000-000000000001",
      enrollmentGeneration: 2,
      category: "strength",
      sharedDay: "2026-09-29",
      durationSeconds: 3600,
      followerCount: 5,
    };
    expect(workoutSharePreviewDtoSchema.parse(preview)).toEqual(preview);
  });

  it("validates communityFeedResponseSchema", () => {
    const item = {
      id: "f0000000-0000-4000-8000-000000000001",
      authorUserId: "a0000000-0000-4000-8000-000000000001",
      authorHandle: "alex_fit",
      authorDisplayName: "Alex",
      authorAvatarSymbol: "AL",
      category: "running" as const,
      sharedDay: "2026-09-30",
      durationSeconds: 1800,
      publishedAt: "2026-09-30T10:00:00.000Z",
      reactionCounts: {
        clap: 2,
        fire: 0,
        high_five: 1,
        fist_bump: 0,
        thumbs_up: 0,
      },
      viewerReaction: null,
    };

    const feed = {
      items: [item],
      nextCursor:
        "2026-09-30T10:00:00.000Z|f0000000-0000-4000-8000-000000000001",
    };
    expect(communityFeedResponseSchema.parse(feed)).toEqual(feed);

    const emptyFeed = { items: [], nextCursor: null };
    expect(communityFeedResponseSchema.parse(emptyFeed)).toEqual(emptyFeed);
  });
});
