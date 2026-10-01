import type { UserId } from "./index";

export class CommunityMutationError extends Error {
  constructor(
    readonly code:
      | "unavailable"
      | "conflict"
      | "rate_limited"
      | "handle_taken"
      | "invalid_profile"
      | "content_violation"
      | "unauthorized"
      | "not_found"
      | "access_denied"
      | "invalid_input",
  ) {
    super(`Community mutation rejected: ${code}`);
    this.name = "CommunityMutationError";
  }
}

export type WorkoutCategory =
  | "strength"
  | "running"
  | "cycling"
  | "hiit"
  | "mobility"
  | "walking"
  | "other";

export type CommunityReactionKind =
  "clap" | "fire" | "high_five" | "fist_bump" | "thumbs_up";

export type CommunityRelationshipStatus =
  "none" | "pending" | "approved" | "declined" | "canceled";

export type CommunityReportReason =
  | "harassment"
  | "offensive_content"
  | "impersonation"
  | "spam"
  | "unsafe_or_sexual_content"
  | "other";

export type CommunityProfileStatus = "active" | "withdrawn" | "suspended";

export interface StoredCommunityProfile {
  readonly userId: UserId;
  readonly handle: string;
  readonly displayName: string;
  readonly avatarSymbol: string;
  readonly bio: string | null;
  readonly isSearchable: boolean;
  readonly status: CommunityProfileStatus;
  readonly generation: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface StoredFollowRelationship {
  readonly id: string;
  readonly followerUserId: UserId;
  readonly targetUserId: UserId;
  readonly status: CommunityRelationshipStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface StoredCommunityBlock {
  readonly id: string;
  readonly blockerUserId: UserId;
  readonly blockedUserId: UserId;
  readonly createdAt: Date;
}

export interface SharedWorkoutDetails {
  readonly exercises: readonly {
    readonly name: string;
    readonly sets: readonly {
      readonly setType: "normal" | "warmup" | "drop" | "failure";
      readonly repetitions: number | null;
      readonly loadKg: number | null;
      readonly durationSeconds: number | null;
    }[];
  }[];
}

export interface StoredSharedActivity {
  readonly id: string;
  readonly userId: UserId;
  readonly sourceWorkoutId: string;
  readonly category: WorkoutCategory;
  readonly sharedDay: string;
  readonly durationSeconds: number | null;
  readonly workoutDetails?: SharedWorkoutDetails | null;
  readonly version: number;
  readonly publishedAt: Date;
  readonly revokedAt: Date | null;
}

export interface StoredCommunityReaction {
  readonly id: string;
  readonly activityId: string;
  readonly userId: UserId;
  readonly reaction: CommunityReactionKind;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface StoredCommunityReport {
  readonly suspensionExpiresAt?: Date | null;
  readonly evidenceSnapshot?: Readonly<Record<string, unknown>>;
  readonly id: string;
  readonly reporterUserId: UserId | null;
  readonly targetType:
    | "profile"
    | "activity"
    | "comment"
    | "group"
    | "group_post"
    | "routine"
    | "message"
    | "challenge"
    | "media";
  readonly targetId: string;
  readonly reason: CommunityReportReason;
  readonly notes: string | null;
  readonly status: "submitted" | "under_review" | "resolved" | "dismissed";
  readonly priority: "normal" | "urgent";
  readonly assignedTo?: string | null;
  readonly decision?: "warn" | "remove" | "suspend" | "ban" | "dismiss" | null;
  readonly decisionReason?: string | null;
  readonly staffNotes?: string | null;
  readonly actionTakenAt?: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface StoredModerationAppeal {
  readonly id: string;
  readonly reportId: string;
  readonly appellantUserId: UserId;
  readonly reason: string;
  readonly status: "pending" | "approved" | "rejected";
  readonly reviewedBy: string | null;
  readonly reviewerNotes: string | null;
  readonly resolvedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface StoredCommunityInvitation {
  readonly id: string;
  readonly token: string;
  readonly inviterUserId: UserId;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

export type CommunityValidationError =
  | { readonly kind: "handle_too_short"; readonly length: number }
  | { readonly kind: "handle_too_long"; readonly length: number }
  | { readonly kind: "handle_invalid_characters"; readonly handle: string }
  | { readonly kind: "handle_reserved"; readonly handle: string }
  | { readonly kind: "display_name_empty" }
  | { readonly kind: "display_name_too_long"; readonly length: number }
  | { readonly kind: "self_follow_prohibited" }
  | { readonly kind: "self_block_prohibited" }
  | { readonly kind: "underage_ineligible" };

export const normalizeCommunityHandle = (handle: string): string => {
  return handle.trim().toLowerCase();
};

export const generateAvatarSymbol = (displayName: string): string => {
  const trimmed = displayName.trim();
  if (!trimmed) return "MZ";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = Array.from(parts[0] ?? "")[0] ?? "";
    const second = Array.from(parts[1] ?? "")[0] ?? "";
    return `${first}${second}`.toUpperCase();
  }
  return Array.from(trimmed).slice(0, 2).join("").toUpperCase();
};

export interface PublicCommunityProfile {
  readonly userId: UserId;
  readonly handle: string;
  readonly displayName: string;
  readonly avatarSymbol: string;
  readonly bio: string | null;
  readonly createdAt: Date;
}

export const toPublicCommunityProfile = (
  profile: StoredCommunityProfile,
): PublicCommunityProfile => ({
  userId: profile.userId,
  handle: profile.handle,
  displayName: profile.displayName,
  avatarSymbol: profile.avatarSymbol,
  bio: profile.bio,
  createdAt: profile.createdAt,
});

export const isAdultEligibleForCommunity = (
  birthYear: number | null | undefined,
  currentYear: number = new Date().getUTCFullYear(),
): boolean => {
  if (
    typeof birthYear !== "number" ||
    !Number.isInteger(birthYear) ||
    birthYear < 1900 ||
    birthYear > currentYear
  ) {
    return false;
  }
  return currentYear - birthYear >= 19;
};

export const canSendFollowRequest = (params: {
  existingStatus: CommunityRelationshipStatus | null;
  isBlocked: boolean;
  followerUserId: UserId;
  targetUserId: UserId;
}): boolean => {
  if (params.followerUserId === params.targetUserId) {
    return false;
  }
  if (params.isBlocked) {
    return false;
  }
  if (
    params.existingStatus === "approved" ||
    params.existingStatus === "pending"
  ) {
    return false;
  }
  return true;
};

export const canApproveFollowRequest = (params: {
  existingStatus: CommunityRelationshipStatus;
  actorUserId: UserId;
  targetUserId: UserId;
  isBlocked: boolean;
}): boolean => {
  if (params.isBlocked) {
    return false;
  }
  if (params.actorUserId !== params.targetUserId) {
    return false;
  }
  return params.existingStatus === "pending";
};

export const canDeclineFollowRequest = (params: {
  existingStatus: CommunityRelationshipStatus;
  actorUserId: UserId;
  targetUserId: UserId;
}): boolean => {
  if (params.actorUserId !== params.targetUserId) {
    return false;
  }
  return params.existingStatus === "pending";
};

export const canViewSharedActivity = (params: {
  viewerUserId: UserId;
  authorUserId: UserId;
  isBlocked: boolean;
  relationshipStatus: CommunityRelationshipStatus | null;
  isRevoked: boolean;
  authorStatus: CommunityProfileStatus;
}): boolean => {
  if (params.isRevoked) {
    return false;
  }
  if (params.authorStatus !== "active") {
    return false;
  }
  if (params.isBlocked) {
    return false;
  }
  if (params.viewerUserId === params.authorUserId) {
    return true;
  }
  return params.relationshipStatus === "approved";
};

export const canReactToActivity = (params: {
  canView: boolean;
  cardIsRevoked: boolean;
  isAuthor?: boolean;
}): boolean => {
  return params.canView && !params.cardIsRevoked && !params.isAuthor;
};

export interface ActivityReactionsResult {
  readonly activityId: string;
  readonly reactionCounts: Record<CommunityReactionKind, number>;
  readonly viewerReaction: CommunityReactionKind | null;
  readonly reactors?: readonly {
    readonly userId: UserId;
    readonly handle: string;
    readonly displayName: string;
    readonly avatarSymbol: string;
    readonly reaction: CommunityReactionKind;
    readonly createdAt: Date;
  }[];
}

export const isInvitationValid = (
  invitation: StoredCommunityInvitation,
  now: Date = new Date(),
): boolean => {
  if (invitation.revokedAt !== null) {
    return false;
  }
  return invitation.expiresAt.getTime() > now.getTime();
};

export interface CommunityRepository {
  getProfile(
    userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<StoredCommunityProfile | null>;

  getProfileByHandle(
    handle: string,
    options: { readonly accessToken: string },
  ): Promise<StoredCommunityProfile | null>;

  isHandleAvailable(
    handle: string,
    userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<boolean>;

  saveProfile(
    userId: UserId,
    profile: {
      readonly handle: string;
      readonly displayName: string;
      readonly avatarSymbol?: string;
      readonly bio?: string | null;
      readonly isSearchable?: boolean;
      readonly enrollmentConsent?: {
        readonly adultDeclaration: true;
        readonly termsVersion: string;
      };
    },
    options: { readonly accessToken: string },
  ): Promise<StoredCommunityProfile>;

  withdrawProfile(
    userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<void>;

  searchProfiles(
    query: string,
    viewerUserId: UserId,
    options: { readonly accessToken: string; readonly limit?: number },
  ): Promise<readonly StoredCommunityProfile[]>;

  getRelationship(
    followerUserId: UserId,
    targetUserId: UserId,
    options: { readonly accessToken: string },
  ): Promise<StoredFollowRelationship | null>;

  getRelationshipById(
    relationshipId: string,
    options: { readonly accessToken: string },
  ): Promise<StoredFollowRelationship | null>;

  getFollowers(
    userId: UserId,
    options: {
      readonly accessToken: string;
      readonly limit?: number;
      readonly afterId?: string;
    },
  ): Promise<
    readonly {
      readonly relationship: StoredFollowRelationship;
      readonly profile: StoredCommunityProfile;
    }[]
  >;

  getFollowing(
    userId: UserId,
    options: {
      readonly accessToken: string;
      readonly limit?: number;
      readonly afterId?: string;
    },
  ): Promise<
    readonly {
      readonly relationship: StoredFollowRelationship;
      readonly profile: StoredCommunityProfile;
    }[]
  >;

  getIncomingFollowRequests(
    userId: UserId,
    options: {
      readonly accessToken: string;
      readonly limit?: number;
      readonly afterId?: string;
    },
  ): Promise<
    readonly {
      readonly relationship: StoredFollowRelationship;
      readonly profile: StoredCommunityProfile;
    }[]
  >;

  getOutgoingFollowRequests(
    userId: UserId,
    options: {
      readonly accessToken: string;
      readonly limit?: number;
      readonly afterId?: string;
    },
  ): Promise<
    readonly {
      readonly relationship: StoredFollowRelationship;
      readonly profile: StoredCommunityProfile;
    }[]
  >;

  sendFollowRequest(
    followerUserId: UserId,
    targetUserId: UserId,
    options: {
      readonly accessToken: string;
      readonly invitationToken?: string;
      readonly operationId?: string;
    },
  ): Promise<StoredFollowRelationship>;

  updateRelationshipStatus(
    relationshipId: string,
    actorUserId: UserId,
    status: CommunityRelationshipStatus,
    options: { readonly accessToken: string },
  ): Promise<StoredFollowRelationship>;

  unfollow(
    followerUserId: UserId,
    targetUserId: UserId,
    options: { readonly accessToken: string },
  ): Promise<void>;

  removeFollower(
    authorUserId: UserId,
    followerUserId: UserId,
    options: { readonly accessToken: string },
  ): Promise<void>;

  blockUser(
    blockerUserId: UserId,
    blockedUserId: UserId,
    options: { readonly accessToken: string },
  ): Promise<StoredCommunityBlock>;

  unblockUser(
    blockerUserId: UserId,
    blockedUserId: UserId,
    options: { readonly accessToken: string },
  ): Promise<void>;

  getBlockedUsers(
    userId: UserId,
    options: {
      readonly accessToken: string;
      readonly limit?: number;
      readonly afterId?: string;
    },
  ): Promise<
    readonly {
      readonly block: StoredCommunityBlock;
      readonly profile: StoredCommunityProfile;
    }[]
  >;

  setMuted(
    userId: UserId,
    targetUserId: UserId,
    muted: boolean,
    options: { readonly accessToken: string },
  ): Promise<void>;
  getMutedUsers(
    userId: UserId,
    options: {
      readonly accessToken: string;
      readonly limit?: number;
      readonly afterId?: string;
    },
  ): Promise<
    readonly {
      readonly profile: StoredCommunityProfile;
      readonly createdAt: Date;
    }[]
  >;

  isBlockedBilateral(
    userA: UserId,
    userB: UserId,
    options: { readonly accessToken: string },
  ): Promise<boolean>;

  createInvitation(
    inviterUserId: UserId,
    options: { readonly accessToken: string; readonly expiresInDays?: number },
  ): Promise<StoredCommunityInvitation>;

  resolveInvitation(
    token: string,
    viewerUserId: UserId,
    options: { readonly accessToken: string },
  ): Promise<{
    readonly invitation: StoredCommunityInvitation;
    readonly profile: StoredCommunityProfile;
  } | null>;

  getInvitationByToken(
    token: string,
    options: { readonly accessToken: string },
  ): Promise<StoredCommunityInvitation | null>;

  getInvitationProfile(
    token: string,
    options: { readonly accessToken: string },
  ): Promise<StoredCommunityProfile | null>;

  getInvitationById(
    invitationId: string,
    options: { readonly accessToken: string },
  ): Promise<StoredCommunityInvitation | null>;

  listInvitations(
    inviterUserId: UserId,
    options: { readonly accessToken: string },
  ): Promise<readonly StoredCommunityInvitation[]>;

  revokeInvitation(
    invitationId: string,
    inviterUserId: UserId,
    options: { readonly accessToken: string },
  ): Promise<void>;

  getActivityById(
    activityId: string,
    options: { readonly accessToken: string },
  ): Promise<StoredSharedActivity | null>;

  getActivityByWorkoutId(
    workoutId: string,
    authorUserId: UserId,
    options: { readonly accessToken: string },
  ): Promise<StoredSharedActivity | null>;

  publishActivity(
    userId: UserId,
    activity: {
      readonly enrollmentGeneration: number;
      readonly operationId: string;
      readonly sourceWorkoutId: string;
      readonly expectedVersion?: number;
      readonly expectedRevoked?: boolean;
      readonly category: WorkoutCategory;
      readonly sharedDay: string;
      readonly durationSeconds: number | null;
      /** API-validated current source duration; real DB rechecks its own source. */
      readonly currentSourceDurationSeconds?: number | null;
      readonly currentSourceDay?: string;
      readonly workoutDetails?: SharedWorkoutDetails | null;
      readonly currentSourceWorkoutDetails?: SharedWorkoutDetails | null;
    },
    options: { readonly accessToken: string },
  ): Promise<StoredSharedActivity>;

  updateActivity(
    activityId: string,
    authorUserId: UserId,
    updates: {
      readonly durationSeconds?: number | null;
      readonly expectedVersion?: number;
    },
    options: { readonly accessToken: string },
  ): Promise<StoredSharedActivity>;

  revokeActivity(
    activityId: string,
    authorUserId: UserId,
    options: {
      readonly accessToken: string;
      readonly expectedVersion?: number;
    },
  ): Promise<void>;

  revokeActivitiesForWorkout(
    workoutId: string,
    authorUserId: UserId,
    options: { readonly accessToken: string },
  ): Promise<void>;

  getFeed(
    viewerUserId: UserId,
    options: {
      readonly accessToken: string;
      readonly limit?: number | undefined;
      readonly beforeCursor?: string | null | undefined;
    },
  ): Promise<{
    readonly items: readonly StoredSharedActivity[];
    readonly nextCursor?: string | null | undefined;
  }>;

  setReaction(
    activityId: string,
    userId: UserId,
    reaction: CommunityReactionKind | null,
    options: { readonly accessToken: string },
  ): Promise<void>;

  getReactionsForActivity(
    activityId: string,
    viewerUserId: UserId,
    options: { readonly accessToken: string },
  ): Promise<ActivityReactionsResult>;

  getReactionsForActivities(
    activityIds: readonly string[],
    viewerUserId: UserId,
    options: { readonly accessToken: string },
  ): Promise<
    Map<
      string,
      {
        readonly reactionCounts: Record<CommunityReactionKind, number>;
        readonly viewerReaction: CommunityReactionKind | null;
      }
    >
  >;

  issueReportReceipt(
    userId: UserId,
    targetType:
      | "profile"
      | "activity"
      | "comment"
      | "group"
      | "group_post"
      | "routine"
      | "message"
      | "challenge"
      | "media",
    targetId: string,
    options?: { readonly accessToken?: string },
  ): Promise<string>;

  listReportReceipts(
    userId: UserId,
    options?: { readonly accessToken?: string },
  ): Promise<
    readonly {
      readonly id: string;
      readonly targetType:
        | "profile"
        | "activity"
        | "comment"
        | "group"
        | "group_post"
        | "routine"
        | "message"
        | "challenge"
        | "media";
      readonly targetId: string;
      readonly expiresAt: Date;
    }[]
  >;

  getModerationNotices(
    userId: UserId,
    options?: { readonly accessToken?: string },
  ): Promise<readonly StoredCommunityReport[]>;

  createReport(
    reporterUserId: UserId,
    report: {
      readonly targetType:
        | "profile"
        | "activity"
        | "comment"
        | "group"
        | "group_post"
        | "routine"
        | "message"
        | "challenge"
        | "media";
      readonly targetId: string;
      readonly reason: CommunityReportReason;
      readonly notes?: string | null;
      readonly priority?: "normal" | "urgent";
      readonly interactionReceiptId?: string;
    },
    options?: { readonly accessToken?: string },
  ): Promise<StoredCommunityReport>;

  getReportsByReporter(
    reporterUserId: UserId,
    options?: { readonly accessToken?: string },
  ): Promise<readonly StoredCommunityReport[]>;

  getReportById(
    reportId: string,
    options?: { readonly accessToken?: string },
  ): Promise<StoredCommunityReport | null>;

  getModerationQueue(options?: {
    readonly accessToken?: string;
    readonly status?: "submitted" | "under_review" | "resolved" | "dismissed";
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<readonly StoredCommunityReport[]>;

  claimModerationReport(
    reportId: string,
    options?: {
      readonly accessToken?: string;
      readonly staffOperator?: string;
    },
  ): Promise<StoredCommunityReport>;
  getModerationAppeals(options?: {
    readonly accessToken?: string;
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<readonly StoredModerationAppeal[]>;

  applyModerationAction(
    reportId: string,
    action: {
      readonly decision: "warn" | "remove" | "suspend" | "ban" | "dismiss";
      readonly decisionReason: string;
      readonly staffNotes?: string | null;
      readonly staffOperator: string;
      readonly suspensionDurationDays?: number | null;
    },
    options?: { readonly accessToken?: string },
  ): Promise<StoredCommunityReport>;

  createModerationAppeal(
    appellantUserId: UserId,
    appeal: {
      readonly reportId: string;
      readonly reason: string;
    },
    options?: { readonly accessToken?: string },
  ): Promise<StoredModerationAppeal>;

  getAppealById(
    appealId: string,
    options?: { readonly accessToken?: string },
  ): Promise<StoredModerationAppeal | null>;

  resolveModerationAppeal(
    appealId: string,
    resolution: {
      readonly status: "approved" | "rejected";
      readonly reviewerNotes?: string | null;
      readonly reviewedBy: string;
    },
    options?: { readonly accessToken?: string },
  ): Promise<StoredModerationAppeal>;

  hasRecentInteraction(
    userId: UserId,
    targetUserId: UserId,
    windowDays?: number,
    options?: { readonly accessToken?: string },
  ): Promise<boolean>;

  deleteAllForUser(
    userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<number>;
}

export type ContentViolationCategory =
  | "harassment"
  | "body_shaming"
  | "dangerous_fitness"
  | "scam_spam"
  | "impersonation"
  | "sexual_content"
  | "illegal_content";

export interface ContentSafetyResult {
  readonly ok: boolean;
  readonly violationCategory?: ContentViolationCategory;
  readonly reason?: string;
}

const PROHIBITED_PATTERNS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly category: ContentViolationCategory;
  readonly reason: string;
}> = [
  {
    pattern: /\b(?:kill\s+yourself|kys|die\s+in\s+a\s+fire|hate\s+speech)\b/i,
    category: "harassment",
    reason: "Severe harassment or threat detected",
  },
  {
    pattern:
      /\b(?:pro-?ana|thinspo|bonespo|fat\s*pig|anorexia\s*tips|starvation\s*challenge)\b/i,
    category: "body_shaming",
    reason: "Body shaming or eating disorder promotion prohibited",
  },
  {
    pattern:
      /\b(?:dry\s*fast(?:ing)?\s*(?:for\s*\d+\s*days)?|dnp\s*(?:cycle|burn)|no\s*water\s*(?:for\s*\d+\s*days)|anabolic\s*steroids?\s*source)\b/i,
    category: "dangerous_fitness",
    reason: "Dangerous fitness or extreme dehydration advice prohibited",
  },
  {
    pattern:
      /\b(?:buy\s*followers|free\s*crypto|telegram\s*@\w+|whatsapp\s*\+?\d{8,}|invest\s*guaranteed\s*return|cashapp\s*flip)\b/i,
    category: "scam_spam",
    reason: "Commercial spam, scam, or external fraud pattern detected",
  },
  {
    pattern:
      /\b(?:mizyun\s*(?:support|admin|staff|official)|official\s*mizyun)\b/i,
    category: "impersonation",
    reason: "Impersonation of official Mizyun operators prohibited",
  },
  {
    pattern: /\b(?:csam|csae|child\s*porn|pedophil|underage\s*nude)\b/i,
    category: "sexual_content",
    reason: "Prohibited sexual exploitation or abuse pattern detected",
  },
];

export const validateContentSafety = (
  text: string | null | undefined,
): ContentSafetyResult => {
  if (!text || text.trim().length === 0) {
    return { ok: true };
  }
  const normalized = text.normalize("NFKC").toLowerCase();
  for (const rule of PROHIBITED_PATTERNS) {
    if (rule.pattern.test(normalized)) {
      return {
        ok: false,
        violationCategory: rule.category,
        reason: rule.reason,
      };
    }
  }
  return { ok: true };
};

export const MAX_REPORTS_PER_DAY = 10;
export const RECENT_INTERACTION_WINDOW_DAYS = 30;

export interface RedactedReportForSubject {
  readonly id: string;
  readonly targetType:
    | "profile"
    | "activity"
    | "comment"
    | "group"
    | "group_post"
    | "routine"
    | "message"
    | "challenge"
    | "media";
  readonly targetId: string;
  readonly reason: CommunityReportReason;
  readonly status: "submitted" | "under_review" | "resolved" | "dismissed";
  readonly createdAt: Date;
}

export const redactReportForSubject = (
  report: StoredCommunityReport,
): RedactedReportForSubject => ({
  id: report.id,
  targetType: report.targetType,
  targetId: report.targetId,
  reason: report.reason,
  status: report.status,
  createdAt: report.createdAt,
});
