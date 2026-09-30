import type { UserId } from "./index";

export class CommunityMutationError extends Error {
  constructor(
    readonly code:
      | "unavailable"
      | "conflict"
      | "rate_limited"
      | "handle_taken"
      | "invalid_profile",
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
  "harassment" | "offensive_content" | "impersonation" | "spam" | "other";

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

export interface StoredSharedActivity {
  readonly id: string;
  readonly userId: UserId;
  readonly sourceWorkoutId: string;
  readonly category: WorkoutCategory;
  readonly sharedDay: string;
  readonly durationSeconds: number | null;
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
  readonly id: string;
  readonly reporterUserId: UserId;
  readonly targetType: "profile" | "activity";
  readonly targetId: string;
  readonly reason: CommunityReportReason;
  readonly notes: string | null;
  readonly status: "submitted" | "under_review" | "resolved" | "dismissed";
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
}): boolean => {
  return params.canView && !params.cardIsRevoked;
};

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
      readonly limit?: number;
      readonly beforeCursor?: string;
    },
  ): Promise<{
    readonly items: readonly StoredSharedActivity[];
    readonly nextCursor?: string;
  }>;

  setReaction(
    activityId: string,
    userId: UserId,
    reaction: CommunityReactionKind | null,
    options: { readonly accessToken: string },
  ): Promise<void>;

  createReport(
    reporterUserId: UserId,
    report: {
      readonly targetType: "profile" | "activity";
      readonly targetId: string;
      readonly reason: CommunityReportReason;
      readonly notes?: string | null;
    },
    options: { readonly accessToken: string },
  ): Promise<StoredCommunityReport>;

  deleteAllForUser(
    userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<number>;
}
