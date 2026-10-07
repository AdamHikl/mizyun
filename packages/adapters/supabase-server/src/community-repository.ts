import crypto from "node:crypto";
import {
  CommunityMutationError,
  generateAvatarSymbol,
  type ActivityReactionsResult,
  type CommunityProfileStatus,
  type CommunityReactionKind,
  type CommunityRelationshipStatus,
  type CommunityReportReason,
  type CommunityRepository,
  type StoredCommunityBlock,
  type StoredCommunityInvitation,
  type StoredCommunityProfile,
  type StoredCommunityReaction,
  type StoredCommunityReport,
  type StoredFollowRelationship,
  type StoredModerationAppeal,
  type StoredSharedActivity,
  type SharedWorkoutDetails,
  type UserId,
  type WorkoutCategory,
} from "@mizyun/core";

import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

export interface CommunityInvitationRow extends Record<string, unknown> {
  readonly id: string;
  readonly token: string;
  readonly inviter_user_id: string;
  readonly expires_at: string;
  readonly revoked_at: string | null;
  readonly created_at: string;
}

export const communityInvitationFromRow = (
  row: CommunityInvitationRow,
): StoredCommunityInvitation => ({
  id: row.id,
  token: row.token,
  inviterUserId: row.inviter_user_id as UserId,
  expiresAt: new Date(row.expires_at),
  revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
  createdAt: new Date(row.created_at),
});

export interface CommunityProfileRow extends Record<string, unknown> {
  readonly user_id: string;
  readonly handle: string;
  readonly display_name: string;
  readonly avatar_symbol: string;
  readonly bio: string | null;
  readonly is_searchable: boolean;
  readonly status: string;
  readonly generation: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface CommunityRelationshipRow extends Record<string, unknown> {
  readonly id: string;
  readonly follower_user_id: string;
  readonly target_user_id: string;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface CommunityMuteRow extends Record<string, unknown> {
  readonly user_id: string;
  readonly target_user_id: string;
  readonly created_at: string;
}

export interface CommunityBlockRow extends Record<string, unknown> {
  readonly id: string;
  readonly blocker_user_id: string;
  readonly blocked_user_id: string;
  readonly created_at: string;
}

export interface SharedActivityRow extends Record<string, unknown> {
  readonly id: string;
  readonly user_id: string;
  readonly source_workout_id: string;
  readonly category: string;
  readonly shared_day: string;
  readonly duration_seconds: number | null;
  readonly workout_details?: SharedWorkoutDetails | null;
  readonly version: number;
  readonly published_at: string;
  readonly revoked_at: string | null;
}

export interface CommunityReactionRow extends Record<string, unknown> {
  readonly id: string;
  readonly activity_id: string;
  readonly user_id: string;
  readonly reaction: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface CommunityReportRow extends Record<string, unknown> {
  readonly evidence_snapshot?: Record<string, unknown>;
  readonly id: string;
  readonly reporter_user_id: string | null;
  readonly target_type: string;
  readonly target_id: string;
  readonly reason: string;
  readonly notes: string | null;
  readonly status: string;
  readonly priority?: string;
  readonly assigned_to?: string | null;
  readonly decision?: string | null;
  readonly decision_reason?: string | null;
  readonly staff_notes?: string | null;
  readonly action_taken_at?: string | null;
  readonly suspension_expires_at?: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface CommunityModerationAppealRow extends Record<string, unknown> {
  readonly id: string;
  readonly report_id: string;
  readonly appellant_user_id: string;
  readonly reason: string;
  readonly status: string;
  readonly reviewed_by: string | null;
  readonly reviewer_notes: string | null;
  readonly resolved_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export const communityProfileFromRow = (
  row: CommunityProfileRow,
): StoredCommunityProfile => ({
  userId: row.user_id as UserId,
  handle: row.handle,
  displayName: row.display_name,
  avatarSymbol: row.avatar_symbol,
  bio: row.bio,
  isSearchable: row.is_searchable,
  status: row.status as CommunityProfileStatus,
  generation: row.generation,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

export const followRelationshipFromRow = (
  row: CommunityRelationshipRow,
): StoredFollowRelationship => ({
  id: row.id,
  followerUserId: row.follower_user_id as UserId,
  targetUserId: row.target_user_id as UserId,
  status: row.status as CommunityRelationshipStatus,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

export const communityBlockFromRow = (
  row: CommunityBlockRow,
): StoredCommunityBlock => ({
  id: row.id,
  blockerUserId: row.blocker_user_id as UserId,
  blockedUserId: row.blocked_user_id as UserId,
  createdAt: new Date(row.created_at),
});

export const sharedActivityFromRow = (
  row: SharedActivityRow,
): StoredSharedActivity => ({
  id: row.id,
  userId: row.user_id as UserId,
  sourceWorkoutId: row.source_workout_id,
  category: row.category as WorkoutCategory,
  sharedDay: row.shared_day,
  durationSeconds: row.duration_seconds,
  workoutDetails: row.workout_details ?? null,
  version: row.version,
  publishedAt: new Date(row.published_at),
  revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
});

export const communityReportFromRow = (
  row: CommunityReportRow,
): StoredCommunityReport => ({
  ...(row.evidence_snapshot ? { evidenceSnapshot: row.evidence_snapshot } : {}),
  id: row.id,
  reporterUserId: row.reporter_user_id as UserId | null,
  targetType: row.target_type as
    | "profile"
    | "activity"
    | "comment"
    | "group"
    | "group_post"
    | "routine"
    | "message"
    | "challenge"
    | "media",
  targetId: row.target_id,
  reason: row.reason as CommunityReportReason,
  notes: row.notes,
  status: row.status as "submitted" | "under_review" | "resolved" | "dismissed",
  priority: (row.priority as "normal" | "urgent") ?? "normal",
  assignedTo: row.assigned_to ?? null,
  decision:
    (row.decision as "warn" | "remove" | "suspend" | "ban" | "dismiss") ?? null,
  decisionReason: row.decision_reason ?? null,
  staffNotes: row.staff_notes ?? null,
  actionTakenAt: row.action_taken_at ? new Date(row.action_taken_at) : null,
  suspensionExpiresAt: row.suspension_expires_at
    ? new Date(row.suspension_expires_at)
    : null,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

export const communityModerationAppealFromRow = (
  row: CommunityModerationAppealRow,
): StoredModerationAppeal => ({
  id: row.id,
  reportId: row.report_id,
  appellantUserId: row.appellant_user_id as UserId,
  reason: row.reason,
  status: row.status as "pending" | "approved" | "rejected",
  reviewedBy: row.reviewed_by ?? null,
  reviewerNotes: row.reviewer_notes ?? null,
  resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

export interface SupabaseCommunityRepositoryOptions {
  readonly clientFor: (accessToken: string) => RepositorySupabaseClient;
}

export class SupabaseCommunityRepository implements CommunityRepository {
  readonly #clientFor: (accessToken: string) => RepositorySupabaseClient;

  constructor(options: SupabaseCommunityRepositoryOptions) {
    this.#clientFor = options.clientFor;
  }

  #throwDatabaseError(error: {
    readonly code?: string;
    readonly message: string;
  }): never {
    if (error.code === "P0001") {
      switch (error.message) {
        case "community_access_denied":
          throw new CommunityMutationError("access_denied");
        case "community_invalid_action":
        case "community_invalid_report":
          throw new CommunityMutationError("invalid_input");
        case "community_conflict":
          throw new CommunityMutationError("conflict");
        case "community_rate_limited":
          throw new CommunityMutationError("rate_limited");
        case "community_unavailable":
          throw new CommunityMutationError("unavailable");
        case "community_invalid_profile":
          throw new CommunityMutationError("invalid_profile");
        case "community_handle_taken":
          throw new CommunityMutationError("handle_taken");
      }
    }
    throw new RepositoryError("Community data operation failed");
  }

  async #rpcRows<TRow extends Record<string, unknown>>(
    name: string,
    args: Record<string, unknown>,
    options: { readonly accessToken: string },
  ): Promise<ReadonlyArray<TRow>> {
    const { data, error } = await this.#clientFor(
      options.accessToken,
    ).rpc<TRow>(name, args);
    if (error) this.#throwDatabaseError(error);
    return data ?? [];
  }

  async getProfile(
    userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<StoredCommunityProfile | null> {
    const rows = await this.#rpcRows<CommunityProfileRow>(
      "community_get_profile",
      { p_user_id: userId },
      options,
    );
    return rows[0] ? communityProfileFromRow(rows[0]) : null;
  }

  async getProfileByHandle(
    handle: string,
    options: { readonly accessToken: string },
  ): Promise<StoredCommunityProfile | null> {
    const rows = await this.#rpcRows<CommunityProfileRow>(
      "community_profile_by_handle",
      { p_handle: handle.trim().toLowerCase() },
      options,
    );
    return rows[0] ? communityProfileFromRow(rows[0]) : null;
  }

  async isHandleAvailable(
    handle: string,
    _userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<boolean> {
    const rows = await this.#rpcRows<
      { readonly available: boolean } & Record<string, unknown>
    >(
      "community_handle_available",
      { p_handle: handle.trim().toLowerCase() },
      options,
    );
    if (typeof rows[0]?.available !== "boolean")
      throw new RepositoryError(
        "Failed to check community handle availability",
      );
    return rows[0].available;
  }

  async searchProfiles(
    query: string,
    viewerUserId: UserId,
    options: { readonly accessToken: string; readonly limit?: number },
  ): Promise<readonly StoredCommunityProfile[]> {
    const raw = query.trim().toLowerCase();
    const handle = raw.startsWith("@") ? raw.slice(1) : raw;
    if (!handle) return [];
    const profile = await this.getProfileByHandle(handle, options);
    return profile &&
      profile.userId !== viewerUserId &&
      profile.isSearchable &&
      profile.status === "active"
      ? [profile]
      : [];
  }

  async saveProfile(
    _userId: UserId,
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
  ): Promise<StoredCommunityProfile> {
    const rows = await this.#rpcRows<CommunityProfileRow>(
      "community_save_profile",
      {
        p_handle: profile.handle.trim().toLowerCase(),
        p_display_name: profile.displayName.trim(),
        p_avatar_symbol:
          profile.avatarSymbol || generateAvatarSymbol(profile.displayName),
        p_bio: profile.bio?.trim() || null,
        p_is_searchable: profile.isSearchable ?? false,
        p_adult_declaration:
          profile.enrollmentConsent?.adultDeclaration ?? null,
        p_terms_version: profile.enrollmentConsent?.termsVersion ?? null,
      },
      options,
    );
    if (!rows[0]) throw new RepositoryError("Failed to save community profile");
    return communityProfileFromRow(rows[0]);
  }

  async withdrawProfile(
    _userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<void> {
    await this.#rpcRows("community_withdraw_profile", {}, options);
  }

  async getRelationship(
    followerUserId: UserId,
    targetUserId: UserId,
    options: { readonly accessToken: string },
  ): Promise<StoredFollowRelationship | null> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<CommunityRelationshipRow>("community_relationships")
      .select("*")
      .eq("follower_user_id", followerUserId)
      .eq("target_user_id", targetUserId)
      .maybeSingle();

    if (error) {
      this.#throwDatabaseError(error);
    }
    return data ? followRelationshipFromRow(data) : null;
  }

  async getRelationshipById(
    relationshipId: string,
    options: { readonly accessToken: string },
  ): Promise<StoredFollowRelationship | null> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<CommunityRelationshipRow>("community_relationships")
      .select("*")
      .eq("id", relationshipId)
      .maybeSingle();

    if (error) {
      this.#throwDatabaseError(error);
    }
    return data ? followRelationshipFromRow(data) : null;
  }

  async getFollowers(
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
  > {
    const client = this.#clientFor(options.accessToken);
    let query = client
      .from<CommunityRelationshipRow>("community_relationships")
      .select("*")
      .eq("target_user_id", userId)
      .eq("status", "approved")
      .order("id", { ascending: true })
      .limit(options.limit ?? 50);
    if (options.afterId) query = query.gt("id", options.afterId);
    const { data: rels, error: relError } = await query;

    if (relError) {
      this.#throwDatabaseError(relError);
    }
    if (!rels || rels.length === 0) return [];

    const results: {
      readonly relationship: StoredFollowRelationship;
      readonly profile: StoredCommunityProfile;
    }[] = [];

    for (const r of rels) {
      const prof = await this.getProfile(r.follower_user_id as UserId, options);
      if (prof && prof.status === "active") {
        results.push({
          relationship: followRelationshipFromRow(r),
          profile: prof,
        });
      }
    }
    return results;
  }

  async getFollowing(
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
  > {
    const client = this.#clientFor(options.accessToken);
    let query = client
      .from<CommunityRelationshipRow>("community_relationships")
      .select("*")
      .eq("follower_user_id", userId)
      .eq("status", "approved")
      .order("id", { ascending: true })
      .limit(options.limit ?? 50);
    if (options.afterId) query = query.gt("id", options.afterId);
    const { data: rels, error: relError } = await query;

    if (relError) {
      this.#throwDatabaseError(relError);
    }
    if (!rels || rels.length === 0) return [];

    const results: {
      readonly relationship: StoredFollowRelationship;
      readonly profile: StoredCommunityProfile;
    }[] = [];

    for (const r of rels) {
      const prof = await this.getProfile(r.target_user_id as UserId, options);
      if (prof && prof.status === "active") {
        results.push({
          relationship: followRelationshipFromRow(r),
          profile: prof,
        });
      }
    }
    return results;
  }

  async getIncomingFollowRequests(
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
  > {
    const client = this.#clientFor(options.accessToken);
    let query = client
      .from<CommunityRelationshipRow>("community_relationships")
      .select("*")
      .eq("target_user_id", userId)
      .eq("status", "pending")
      .order("id", { ascending: true })
      .limit(options.limit ?? 50);
    if (options.afterId) query = query.gt("id", options.afterId);
    const { data: rels, error: relError } = await query;

    if (relError) {
      this.#throwDatabaseError(relError);
    }
    if (!rels || rels.length === 0) return [];

    const results: {
      readonly relationship: StoredFollowRelationship;
      readonly profile: StoredCommunityProfile;
    }[] = [];

    for (const r of rels) {
      const prof = await this.getProfile(r.follower_user_id as UserId, options);
      if (prof && prof.status === "active") {
        results.push({
          relationship: followRelationshipFromRow(r),
          profile: prof,
        });
      }
    }
    return results;
  }

  async getOutgoingFollowRequests(
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
  > {
    const client = this.#clientFor(options.accessToken);
    let query = client
      .from<CommunityRelationshipRow>("community_relationships")
      .select("*")
      .eq("follower_user_id", userId)
      .eq("status", "pending")
      .order("id", { ascending: true })
      .limit(options.limit ?? 50);
    if (options.afterId) query = query.gt("id", options.afterId);
    const { data: rels, error: relError } = await query;

    if (relError) {
      this.#throwDatabaseError(relError);
    }
    if (!rels || rels.length === 0) return [];

    const results: {
      readonly relationship: StoredFollowRelationship;
      readonly profile: StoredCommunityProfile;
    }[] = [];

    for (const r of rels) {
      const prof = await this.getProfile(r.target_user_id as UserId, options);
      if (prof && prof.status === "active") {
        results.push({
          relationship: followRelationshipFromRow(r),
          profile: prof,
        });
      }
    }
    return results;
  }

  async sendFollowRequest(
    _followerUserId: UserId,
    targetUserId: UserId,
    options: {
      readonly accessToken: string;
      readonly invitationToken?: string;
      readonly operationId?: string;
    },
  ): Promise<StoredFollowRelationship> {
    const rows = await this.#rpcRows<CommunityRelationshipRow>(
      "community_request_follow",
      {
        p_target_user_id: targetUserId,
        p_invitation_token: options.invitationToken ?? null,
        ...(options.operationId ? { p_operation_id: options.operationId } : {}),
      },
      options,
    );
    if (!rows[0]) throw new RepositoryError("Failed to send follow request");
    return followRelationshipFromRow(rows[0]);
  }

  async updateRelationshipStatus(
    relationshipId: string,
    actorUserId: UserId,
    status: CommunityRelationshipStatus,
    options: { readonly accessToken: string },
  ): Promise<StoredFollowRelationship> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<CommunityRelationshipRow>("community_relationships")
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", relationshipId)
      .select("*")
      .single();

    if (error) this.#throwDatabaseError(error);
    if (!data) throw new RepositoryError("Failed to update relationship");
    return followRelationshipFromRow(data);
  }

  async unfollow(
    followerUserId: UserId,
    targetUserId: UserId,
    options: { readonly accessToken: string; readonly relationshipId?: string },
  ): Promise<void> {
    const relationship = await this.getRelationship(
      followerUserId,
      targetUserId,
      options,
    );
    if (
      !relationship ||
      (options.relationshipId && relationship.id !== options.relationshipId)
    )
      return;
    if (relationship.status === "pending") {
      await this.updateRelationshipStatus(
        relationship.id,
        followerUserId,
        "canceled",
        options,
      );
      return;
    }
    if (relationship.status !== "approved") return;
    const client = this.#clientFor(options.accessToken);
    let query = client
      .from<CommunityRelationshipRow>("community_relationships")
      .delete()
      .eq("follower_user_id", followerUserId)
      .eq("target_user_id", targetUserId);
    query = query.eq("id", relationship.id);
    const { error } = await query;

    if (error) {
      this.#throwDatabaseError(error);
    }
  }

  async removeFollower(
    authorUserId: UserId,
    followerUserId: UserId,
    options: { readonly accessToken: string; readonly relationshipId?: string },
  ): Promise<void> {
    const client = this.#clientFor(options.accessToken);
    let query = client
      .from<CommunityRelationshipRow>("community_relationships")
      .delete()
      .eq("follower_user_id", followerUserId)
      .eq("target_user_id", authorUserId);
    if (options.relationshipId) query = query.eq("id", options.relationshipId);
    const { error } = await query;

    if (error) {
      this.#throwDatabaseError(error);
    }
  }

  async blockUser(
    blockerUserId: UserId,
    blockedUserId: UserId,
    options: { readonly accessToken: string },
  ): Promise<StoredCommunityBlock> {
    const client = this.#clientFor(options.accessToken);

    // Transactionally create block and sever relationships in both directions
    const { data, error } = await client
      .from<CommunityBlockRow>("community_blocks")
      .insert({
        blocker_user_id: blockerUserId,
        blocked_user_id: blockedUserId,
      })
      .select("*")
      .single();

    if (error?.code === "23505") {
      const existing = await client
        .from<CommunityBlockRow>("community_blocks")
        .select("*")
        .eq("blocker_user_id", blockerUserId)
        .eq("blocked_user_id", blockedUserId)
        .maybeSingle();
      if (existing.error) this.#throwDatabaseError(existing.error);
      if (existing.data) return communityBlockFromRow(existing.data);
    }
    if (error) this.#throwDatabaseError(error);
    if (!data) throw new RepositoryError("Failed to block user");

    return communityBlockFromRow(data);
  }

  async unblockUser(
    blockerUserId: UserId,
    blockedUserId: UserId,
    options: { readonly accessToken: string },
  ): Promise<void> {
    const client = this.#clientFor(options.accessToken);
    const { error } = await client
      .from<CommunityBlockRow>("community_blocks")
      .delete()
      .eq("blocker_user_id", blockerUserId)
      .eq("blocked_user_id", blockedUserId);

    if (error) {
      this.#throwDatabaseError(error);
    }
  }

  async getBlockedUsers(
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
  > {
    const client = this.#clientFor(options.accessToken);
    let query = client
      .from<CommunityBlockRow>("community_blocks")
      .select("*")
      .eq("blocker_user_id", userId)
      .order("id", { ascending: true })
      .limit(options.limit ?? 50);
    if (options.afterId) query = query.gt("id", options.afterId);
    const { data: blocks, error: blockError } = await query;

    if (blockError) {
      this.#throwDatabaseError(blockError);
    }
    if (!blocks || blocks.length === 0) return [];

    const results: {
      readonly block: StoredCommunityBlock;
      readonly profile: StoredCommunityProfile;
    }[] = [];

    for (const b of blocks) {
      // A block deliberately hides the target's live profile. Keep its stable
      // identity so the owner can remove the block without rediscovering them.
      results.push({
        block: communityBlockFromRow(b),
        profile: {
          userId: b.blocked_user_id as UserId,
          handle: "unavailable",
          displayName: "User unavailable",
          avatarSymbol: "--",
          bio: null,
          isSearchable: false,
          status: "withdrawn",
          generation: 1,
          createdAt: new Date(b.created_at),
          updatedAt: new Date(b.created_at),
        },
      });
    }
    return results;
  }

  async setMuted(
    _userId: UserId,
    targetUserId: UserId,
    muted: boolean,
    options: { readonly accessToken: string },
  ): Promise<void> {
    await this.#rpcRows(
      "community_set_mute",
      { p_target_user_id: targetUserId, p_muted: muted },
      options,
    );
  }
  async getMutedUsers(
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
  > {
    let query = this.#clientFor(options.accessToken)
      .from<CommunityMuteRow>("community_mutes")
      .select("*")
      .eq("user_id", userId)
      .order("target_user_id", { ascending: true })
      .limit(options.limit ?? 50);
    if (options.afterId) query = query.gt("target_user_id", options.afterId);
    const { data, error } = await query;
    if (error) this.#throwDatabaseError(error);
    const items = [];
    for (const row of data ?? []) {
      const profile = await this.getProfile(
        row.target_user_id as UserId,
        options,
      );
      items.push({
        profile: profile ?? {
          userId: row.target_user_id as UserId,
          handle: "unavailable",
          displayName: "Unavailable member",
          avatarSymbol: "?",
          bio: null,
          isSearchable: false,
          status: "withdrawn" as const,
          generation: 1,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.created_at),
        },
        createdAt: new Date(row.created_at),
      });
    }
    return items;
  }

  async isBlockedBilateral(
    _callerUserId: UserId,
    otherUserId: UserId,
    options: { readonly accessToken: string },
  ): Promise<boolean> {
    const rows = await this.#rpcRows<
      { readonly is_unavailable: boolean } & Record<string, unknown>
    >("community_is_unavailable", { p_other_user_id: otherUserId }, options);
    if (!rows[0])
      throw new RepositoryError("Failed to check community availability");
    return rows[0].is_unavailable;
  }

  async createInvitation(
    _inviterUserId: UserId,
    options: { readonly accessToken: string; readonly expiresInDays?: number },
  ): Promise<StoredCommunityInvitation> {
    const rows = await this.#rpcRows<CommunityInvitationRow>(
      "community_create_invitation",
      {
        p_token: crypto.randomBytes(16).toString("base64url"),
        p_expires_in_days: options.expiresInDays ?? 7,
      },
      options,
    );
    if (!rows[0]) throw new RepositoryError("Failed to create invitation");
    return communityInvitationFromRow(rows[0]);
  }

  async resolveInvitation(
    token: string,
    _viewerUserId: UserId,
    options: { readonly accessToken: string },
  ): Promise<{
    readonly invitation: StoredCommunityInvitation;
    readonly profile: StoredCommunityProfile;
  } | null> {
    const rows = await this.#rpcRows<
      {
        readonly invitation: CommunityInvitationRow;
        readonly inviter: CommunityProfileRow;
      } & Record<string, unknown>
    >("community_resolve_invitation", { p_token: token }, options);
    const row = rows[0];
    return row
      ? {
          invitation: communityInvitationFromRow(row.invitation),
          profile: communityProfileFromRow(row.inviter),
        }
      : null;
  }

  async getInvitationByToken(
    token: string,
    options: { readonly accessToken: string },
  ): Promise<StoredCommunityInvitation | null> {
    const rows = await this.#rpcRows<
      {
        readonly invitation: CommunityInvitationRow;
        readonly inviter: CommunityProfileRow;
      } & Record<string, unknown>
    >("community_resolve_invitation", { p_token: token }, options);
    return rows[0]?.invitation
      ? communityInvitationFromRow(rows[0].invitation)
      : null;
  }

  async getInvitationProfile(
    token: string,
    options: { readonly accessToken: string },
  ): Promise<StoredCommunityProfile | null> {
    const rows = await this.#rpcRows<
      {
        readonly invitation: CommunityInvitationRow;
        readonly inviter: CommunityProfileRow;
      } & Record<string, unknown>
    >("community_resolve_invitation", { p_token: token }, options);
    return rows[0]?.inviter ? communityProfileFromRow(rows[0].inviter) : null;
  }

  async getInvitationById(
    invitationId: string,
    options: { readonly accessToken: string },
  ): Promise<StoredCommunityInvitation | null> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<CommunityInvitationRow>("community_invitations")
      .select("*")
      .eq("id", invitationId)
      .maybeSingle();

    if (error) {
      this.#throwDatabaseError(error);
    }
    return data ? communityInvitationFromRow(data) : null;
  }

  async listInvitations(
    inviterUserId: UserId,
    options: { readonly accessToken: string },
  ): Promise<readonly StoredCommunityInvitation[]> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<CommunityInvitationRow>("community_invitations")
      .select("*")
      .eq("inviter_user_id", inviterUserId)
      .order("created_at", { ascending: false });

    if (error) {
      this.#throwDatabaseError(error);
    }
    return (data ?? []).map(communityInvitationFromRow);
  }

  async revokeInvitation(
    invitationId: string,
    inviterUserId: UserId,
    options: { readonly accessToken: string },
  ): Promise<void> {
    const client = this.#clientFor(options.accessToken);
    const { error } = await client
      .from<CommunityInvitationRow>("community_invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", invitationId)
      .eq("inviter_user_id", inviterUserId);

    if (error) {
      this.#throwDatabaseError(error);
    }
  }

  async getActivityById(
    activityId: string,
    options: { readonly accessToken: string },
  ): Promise<StoredSharedActivity | null> {
    const rows = await this.#rpcRows<SharedActivityRow>(
      "community_get_activity",
      { p_activity_id: activityId },
      options,
    );
    return rows[0] ? sharedActivityFromRow(rows[0]) : null;
  }

  async getActivityByWorkoutId(
    workoutId: string,
    authorUserId: UserId,
    options: { readonly accessToken: string },
  ): Promise<StoredSharedActivity | null> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<SharedActivityRow>("shared_activities")
      .select("*")
      .eq("source_workout_id", workoutId)
      .eq("user_id", authorUserId)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      this.#throwDatabaseError(error);
    }
    return data ? sharedActivityFromRow(data) : null;
  }

  async publishActivity(
    _userId: UserId,
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
  ): Promise<StoredSharedActivity> {
    const rows = await this.#rpcRows<SharedActivityRow>(
      "community_publish_activity",
      {
        p_source_workout_id: activity.sourceWorkoutId,
        p_category: activity.category,
        p_shared_day: activity.sharedDay,
        p_duration_seconds: activity.durationSeconds,
        p_enrollment_generation: activity.enrollmentGeneration,
        p_operation_id: activity.operationId,
        p_expected_version: activity.expectedVersion ?? 0,
        p_expected_revoked: activity.expectedRevoked ?? false,
        p_workout_details: activity.workoutDetails ?? null,
      },
      options,
    );
    if (!rows[0])
      throw new RepositoryError("Failed to publish community activity");
    return sharedActivityFromRow(rows[0]);
  }

  async updateActivity(
    activityId: string,
    _authorUserId: UserId,
    updates: {
      readonly durationSeconds?: number | null;
      readonly expectedVersion?: number;
    },
    options: { readonly accessToken: string },
  ): Promise<StoredSharedActivity> {
    if (updates.durationSeconds === undefined) {
      const activity = await this.getActivityById(activityId, options);
      if (!activity)
        throw new RepositoryError("Community activity unavailable");
      return activity;
    }
    const rows = await this.#rpcRows<SharedActivityRow>(
      "community_update_activity",
      {
        p_activity_id: activityId,
        p_duration_seconds: updates.durationSeconds,
        p_expected_version: updates.expectedVersion ?? 1,
      },
      options,
    );
    if (!rows[0]) throw new RepositoryError("Failed to update shared activity");
    return sharedActivityFromRow(rows[0]);
  }

  async revokeActivity(
    activityId: string,
    authorUserId: UserId,
    options: {
      readonly accessToken: string;
      readonly expectedVersion?: number;
    },
  ): Promise<void> {
    if (options.expectedVersion !== undefined) {
      await this.#rpcRows(
        "community_unpublish_activity",
        {
          p_activity_id: activityId,
          p_expected_version: options.expectedVersion,
        },
        options,
      );
      return;
    }
    const client = this.#clientFor(options.accessToken);
    const { error } = await client
      .from<SharedActivityRow>("shared_activities")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", activityId)
      .eq("user_id", authorUserId);

    if (error) {
      this.#throwDatabaseError(error);
    }
  }

  async revokeActivitiesForWorkout(
    workoutId: string,
    authorUserId: UserId,
    options: { readonly accessToken: string },
  ): Promise<void> {
    const client = this.#clientFor(options.accessToken);
    const { error } = await client
      .from<SharedActivityRow>("shared_activities")
      .update({ revoked_at: new Date().toISOString() })
      .eq("source_workout_id", workoutId)
      .eq("user_id", authorUserId);

    if (error) {
      this.#throwDatabaseError(error);
    }
  }

  async getFeed(
    _viewerUserId: UserId,
    options: {
      readonly accessToken: string;
      readonly limit?: number | undefined;
      readonly beforeCursor?: string | null | undefined;
      readonly authorUserId?: UserId;
    },
  ): Promise<{
    readonly items: readonly StoredSharedActivity[];
    readonly nextCursor?: string | null | undefined;
  }> {
    const limit = Math.max(1, Math.min(options.limit ?? 20, 50));
    let beforeTime: string | null = null;
    let beforeId: string | null = null;
    if (options.beforeCursor) {
      const parts = options.beforeCursor.split("|");
      if (
        parts.length !== 2 ||
        !parts[0] ||
        !parts[1] ||
        !Number.isFinite(Date.parse(parts[0])) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          parts[1],
        )
      ) {
        throw new RepositoryError("Invalid community feed cursor");
      }
      beforeTime = parts[0];
      beforeId = parts[1];
    }
    const rows = await this.#rpcRows<SharedActivityRow>(
      options.authorUserId ? "community_author_activities" : "community_feed",
      {
        ...(options.authorUserId
          ? { p_author_user_id: options.authorUserId }
          : {}),
        p_limit: options.authorUserId ? limit + 1 : limit,
        p_before_time: beforeTime,
        p_before_id: beforeId,
      },
      options,
    );
    const items = (options.authorUserId ? rows.slice(0, limit) : rows).map(
      sharedActivityFromRow,
    );
    const last = items[items.length - 1];
    const nextCursor =
      (options.authorUserId ? rows.length > limit : items.length === limit) &&
      last
        ? `${last.publishedAt.toISOString()}|${last.id}`
        : undefined;
    return { items, ...(nextCursor ? { nextCursor } : {}) };
  }

  async setReaction(
    activityId: string,
    userId: UserId,
    reaction: CommunityReactionKind | null,
    options: { readonly accessToken: string },
  ): Promise<void> {
    const client = this.#clientFor(options.accessToken);

    if (reaction === null) {
      const { error } = await client
        .from<CommunityReactionRow>("community_reactions")
        .delete()
        .eq("activity_id", activityId)
        .eq("user_id", userId);

      if (error) {
        this.#throwDatabaseError(error);
      }
      return;
    }

    const { error } = await client
      .from<CommunityReactionRow>("community_reactions")
      .upsert(
        {
          activity_id: activityId,
          user_id: userId,
          reaction,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "activity_id,user_id" },
      );

    if (error) {
      this.#throwDatabaseError(error);
    }
  }

  async getReactionsForActivity(
    activityId: string,
    viewerUserId: UserId,
    options: { readonly accessToken: string },
  ): Promise<ActivityReactionsResult> {
    const client = this.#clientFor(options.accessToken);
    const activity = await this.getActivityById(activityId, options);
    if (!activity || activity.revokedAt) {
      throw new CommunityMutationError("unavailable");
    }
    const isAuthor = activity.userId === viewerUserId;

    const { data, error } = await client
      .from<CommunityReactionRow>("community_reactions")
      .select("*")
      .eq("activity_id", activityId);

    if (error) this.#throwDatabaseError(error);

    const counts: Record<CommunityReactionKind, number> = {
      clap: 0,
      fire: 0,
      high_five: 0,
      fist_bump: 0,
      thumbs_up: 0,
    };
    let viewerReaction: CommunityReactionKind | null = null;
    const reactors: {
      userId: UserId;
      handle: string;
      displayName: string;
      avatarSymbol: string;
      reaction: CommunityReactionKind;
      createdAt: Date;
    }[] = [];

    for (const row of data ?? []) {
      const reactionKind = row.reaction as CommunityReactionKind;
      if (counts[reactionKind] === undefined) continue;

      const isBlocked = await this.isBlockedBilateral(
        viewerUserId,
        row.user_id as UserId,
        options,
      );
      if (isBlocked) continue;

      counts[reactionKind] = (counts[reactionKind] ?? 0) + 1;
      if (row.user_id === viewerUserId) {
        viewerReaction = reactionKind;
      }

      if (isAuthor) {
        const reactorProfile = await this.getProfile(
          row.user_id as UserId,
          options,
        );
        if (reactorProfile && reactorProfile.status === "active") {
          reactors.push({
            userId: row.user_id as UserId,
            handle: reactorProfile.handle,
            displayName: reactorProfile.displayName,
            avatarSymbol: reactorProfile.avatarSymbol,
            reaction: reactionKind,
            createdAt: new Date(row.created_at as string),
          });
        }
      }
    }

    reactors.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return {
      activityId,
      reactionCounts: counts,
      viewerReaction,
      ...(isAuthor ? { reactors } : {}),
    };
  }

  async getReactionsForActivities(
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
  > {
    const result = new Map<
      string,
      {
        readonly reactionCounts: Record<CommunityReactionKind, number>;
        readonly viewerReaction: CommunityReactionKind | null;
      }
    >();

    // Each read still reauthorizes the card and filters blocked reactors.
    // A denied/failed read rejects the page; never substitute stale counts.
    for (let offset = 0; offset < activityIds.length; offset += 5) {
      const batch = await Promise.all(
        activityIds.slice(offset, offset + 5).map(async (id) => ({
          id,
          reactions: await this.getReactionsForActivity(
            id,
            viewerUserId,
            options,
          ),
        })),
      );
      for (const { id, reactions } of batch) {
        result.set(id, {
          reactionCounts: reactions.reactionCounts,
          viewerReaction: reactions.viewerReaction,
        });
      }
    }

    return result;
  }

  async issueReportReceipt(
    _userId: UserId,
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
    options: { readonly accessToken: string },
  ): Promise<string> {
    const rows = await this.#rpcRows<{ id: string } & Record<string, unknown>>(
      "community_issue_report_receipt",
      { p_target_type: targetType, p_target_id: targetId },
      options,
    );
    if (!rows[0]) throw new RepositoryError("Receipt unavailable");
    return rows[0].id;
  }

  async listReportReceipts(
    _userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<
    readonly {
      id: string;
      targetType:
        | "profile"
        | "activity"
        | "comment"
        | "group"
        | "group_post"
        | "routine"
        | "message"
        | "challenge"
        | "media";
      targetId: string;
      expiresAt: Date;
    }[]
  > {
    const rows = await this.#rpcRows<
      {
        id: string;
        target_type:
          | "profile"
          | "activity"
          | "comment"
          | "group"
          | "group_post"
          | "routine"
          | "message"
          | "challenge"
          | "media";
        target_id: string;
        expires_at: string;
      } & Record<string, unknown>
    >("community_report_receipts_for_caller", {}, options);
    return rows.map((r) => ({
      id: r.id,
      targetType: r.target_type,
      targetId: r.target_id,
      expiresAt: new Date(r.expires_at),
    }));
  }

  async getModerationNotices(
    _userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<readonly StoredCommunityReport[]> {
    return (
      await this.#rpcRows<CommunityReportRow>(
        "community_moderation_notices",
        {},
        options,
      )
    ).map(communityReportFromRow);
  }

  async createReport(
    _reporterUserId: UserId,
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
      readonly interactionReceiptId?: string | null;
    },
    options: { readonly accessToken: string },
  ): Promise<StoredCommunityReport> {
    const rows = await this.#rpcRows<CommunityReportRow>(
      "community_submit_report",
      {
        p_target_type: report.targetType,
        p_target_id: report.targetId,
        p_reason: report.reason,
        p_notes: report.notes ?? null,
        p_interaction_receipt_id: report.interactionReceiptId ?? null,
      },
      options,
    );
    if (!rows[0]) throw new RepositoryError("Failed to create report");
    return communityReportFromRow(rows[0]);
  }

  async getReportsByReporter(
    reporterUserId: UserId,
    options: { readonly accessToken: string },
  ): Promise<readonly StoredCommunityReport[]> {
    const { data, error } = await this.#clientFor(options.accessToken)
      .from<CommunityReportRow>("community_reports")
      .select(
        "id,reporter_user_id,target_type,target_id,reason,notes,status,priority,decision,decision_reason,action_taken_at,suspension_expires_at,created_at,updated_at",
      )
      .eq("reporter_user_id", reporterUserId)
      .order("created_at", { ascending: false });
    if (error) this.#throwDatabaseError(error);
    return (data ?? []).map(communityReportFromRow);
  }
  async getReportById(
    reportId: string,
    options: { readonly accessToken: string },
  ): Promise<StoredCommunityReport | null> {
    const rows = await this.#rpcRows<CommunityReportRow>(
      "community_get_report",
      { p_report_id: reportId },
      options,
    );
    return rows[0] ? communityReportFromRow(rows[0]) : null;
  }

  async getModerationQueue(options?: {
    readonly accessToken?: string;
    readonly status?: "submitted" | "under_review" | "resolved" | "dismissed";
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<readonly StoredCommunityReport[]> {
    if (!options?.accessToken)
      throw new RepositoryError("Authentication required");
    return (
      await this.#rpcRows<CommunityReportRow>(
        "community_moderation_queue",
        {
          p_status: options.status ?? null,
          p_limit: options.limit ?? 50,
          p_offset: options.offset ?? 0,
        },
        { accessToken: options.accessToken },
      )
    ).map(communityReportFromRow);
  }
  async claimModerationReport(
    reportId: string,
    options?: { readonly accessToken?: string },
  ): Promise<StoredCommunityReport> {
    if (!options?.accessToken)
      throw new RepositoryError("Authentication required");
    const rows = await this.#rpcRows<CommunityReportRow>(
      "community_claim_report",
      { p_report_id: reportId },
      { accessToken: options.accessToken },
    );
    if (!rows[0]) throw new RepositoryError("Report not found");
    return communityReportFromRow(rows[0]);
  }
  async getModerationAppeals(options?: {
    readonly accessToken?: string;
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<readonly StoredModerationAppeal[]> {
    if (!options?.accessToken)
      throw new RepositoryError("Authentication required");
    return (
      await this.#rpcRows<CommunityModerationAppealRow>(
        "community_moderation_appeals_queue",
        { p_limit: options.limit ?? 50, p_offset: options.offset ?? 0 },
        { accessToken: options.accessToken },
      )
    ).map(communityModerationAppealFromRow);
  }
  async applyModerationAction(
    reportId: string,
    action: {
      readonly decision: "warn" | "remove" | "suspend" | "ban" | "dismiss";
      readonly decisionReason: string;
      readonly staffNotes?: string | null;
      readonly staffOperator: string;
      readonly suspensionDurationDays?: number | null;
    },
    options?: { readonly accessToken?: string },
  ): Promise<StoredCommunityReport> {
    if (!options?.accessToken)
      throw new RepositoryError("Authentication required");
    const rows = await this.#rpcRows<CommunityReportRow>(
      "community_apply_moderation_action",
      {
        p_report_id: reportId,
        p_decision: action.decision,
        p_decision_reason: action.decisionReason,
        p_staff_notes: action.staffNotes ?? null,
        p_suspension_duration_days: action.suspensionDurationDays ?? null,
      },
      { accessToken: options.accessToken },
    );
    if (!rows[0]) throw new RepositoryError("Report not found");
    return communityReportFromRow(rows[0]);
  }
  async createModerationAppeal(
    _appellantUserId: UserId,
    appeal: { readonly reportId: string; readonly reason: string },
    options?: { readonly accessToken?: string },
  ): Promise<StoredModerationAppeal> {
    if (!options?.accessToken)
      throw new RepositoryError("Authentication required");
    const rows = await this.#rpcRows<CommunityModerationAppealRow>(
      "community_create_moderation_appeal",
      { p_report_id: appeal.reportId, p_reason: appeal.reason },
      { accessToken: options.accessToken },
    );
    if (!rows[0]) throw new RepositoryError("Failed to create appeal");
    return {
      ...communityModerationAppealFromRow(rows[0]),
      reviewedBy: null,
      reviewerNotes: null,
    };
  }
  async getAppealById(
    appealId: string,
    options: { readonly accessToken: string },
  ): Promise<StoredModerationAppeal | null> {
    const rows = await this.#rpcRows<CommunityModerationAppealRow>(
      "community_get_appeal",
      { p_appeal_id: appealId },
      options,
    );
    return rows[0] ? communityModerationAppealFromRow(rows[0]) : null;
  }
  async resolveModerationAppeal(
    appealId: string,
    resolution: {
      readonly status: "approved" | "rejected";
      readonly reviewerNotes?: string | null;
      readonly reviewedBy: string;
    },
    options?: { readonly accessToken?: string },
  ): Promise<StoredModerationAppeal> {
    if (!options?.accessToken)
      throw new RepositoryError("Authentication required");
    const rows = await this.#rpcRows<CommunityModerationAppealRow>(
      "community_resolve_moderation_appeal",
      {
        p_appeal_id: appealId,
        p_status: resolution.status,
        p_reviewer_notes: resolution.reviewerNotes ?? null,
      },
      { accessToken: options.accessToken },
    );
    if (!rows[0]) throw new RepositoryError("Appeal not found");
    return communityModerationAppealFromRow(rows[0]);
  }

  async hasRecentInteraction(
    userId: UserId,
    targetUserId: UserId,
    windowDays: number = 30,
    options?: { readonly accessToken?: string },
  ): Promise<boolean> {
    if (!options?.accessToken) return false;
    try {
      const rows = await this.#rpcRows<
        { readonly result: boolean } & Record<string, unknown>
      >(
        "community_has_recent_interaction",
        {
          p_caller: userId,
          p_target_id: targetUserId,
          p_target_type: "profile",
          p_window_days: windowDays,
        },
        { accessToken: options.accessToken },
      );
      return Boolean(rows[0]?.result);
    } catch {
      return false;
    }
  }

  async deleteAllForUser(
    _userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<number> {
    const rows = await this.#rpcRows<
      { readonly deleted_count: number } & Record<string, unknown>
    >("community_delete_all_for_user", {}, options);
    if (!rows[0]) throw new RepositoryError("Failed to delete community data");
    return Number(rows[0].deleted_count);
  }
}
