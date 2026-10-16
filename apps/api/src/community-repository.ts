import crypto from "node:crypto";
import {
  generateAvatarSymbol,
  CommunityMutationError,
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
  type MealActivityPublication,
  type BoulderingActivityPublication,
  type UserId,
  type WorkoutCategory,
} from "@mizyun/core";

export class InMemoryCommunityRepository implements CommunityRepository {
  readonly #publicationUsage = new Map<string, number>();
  #consumePublication(userId: UserId) {
    const key = `${userId}:${new Date().toISOString().slice(0, 10)}`;
    const count = this.#publicationUsage.get(key) ?? 0;
    if (count >= 20) throw new CommunityMutationError("rate_limited");
    this.#publicationUsage.set(key, count + 1);
  }
  readonly #reportUsage = new Map<string, number>();
  #consumeReport(userId: UserId) {
    const key = `${userId}:${new Date().toISOString().slice(0, 10)}`;
    const count = this.#reportUsage.get(key) ?? 0;
    if (count >= 10) throw new CommunityMutationError("rate_limited");
    this.#reportUsage.set(key, count + 1);
  }
  readonly #profiles = new Map<UserId, StoredCommunityProfile>();
  readonly #followCooldowns = new Map<string, Date>();
  readonly #followEvents: { userId: UserId; createdAt: Date }[] = [];
  readonly #followOperations = new Map<
    string,
    { targetUserId: UserId; relationshipId: string }
  >();
  readonly #mutes = new Map<
    string,
    { userId: UserId; targetUserId: UserId; createdAt: Date }
  >();
  readonly #relationships = new Map<string, StoredFollowRelationship>();
  readonly #blocks = new Map<string, StoredCommunityBlock>();
  readonly #activities = new Map<string, StoredSharedActivity>();
  readonly #reactions = new Map<string, StoredCommunityReaction>();
  readonly #reports = new Map<string, StoredCommunityReport>();
  readonly #reportReceipts = new Map<
    string,
    {
      id: string;
      userId: UserId;
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
    }
  >();
  readonly #sanctions = new Map<
    string,
    { userId: UserId; expiresAt: Date | null; reversed: boolean }
  >();
  #canReport(
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
  ): boolean {
    const targetUserId =
      targetType === "activity"
        ? this.#activities.get(targetId)?.userId
        : (targetId as UserId);
    if (
      !targetUserId ||
      targetUserId === userId ||
      this.#profiles.get(userId)?.status !== "active" ||
      this.#profiles.get(targetUserId)?.status !== "active" ||
      this.#blocked(userId, targetUserId)
    )
      return false;
    const related = [...this.#relationships.values()].some(
      (r) =>
        (r.followerUserId === userId && r.targetUserId === targetUserId) ||
        (r.followerUserId === targetUserId && r.targetUserId === userId),
    );
    const approved = [...this.#relationships.values()].some(
      (r) =>
        r.followerUserId === userId &&
        r.targetUserId === targetUserId &&
        r.status === "approved",
    );
    return targetType === "profile"
      ? Boolean(this.#profiles.get(targetUserId)?.isSearchable || related)
      : Boolean(approved && !this.#activities.get(targetId)?.revokedAt);
  }
  #rememberPair(a: UserId, b: UserId): void {
    for (const [userId, targetId] of [
      [a, b],
      [b, a],
    ] as const) {
      const id = crypto.randomUUID();
      this.#reportReceipts.set(id, {
        id,
        userId,
        targetType: "profile",
        targetId,
        expiresAt: new Date(Date.now() + 30 * 86400000),
      });
    }
  }
  #hasSanction(userId: UserId): boolean {
    return [...this.#sanctions.values()].some(
      (s) =>
        s.userId === userId &&
        !s.reversed &&
        (!s.expiresAt || s.expiresAt.getTime() > Date.now()),
    );
  }
  readonly #appeals = new Map<string, StoredModerationAppeal>();
  readonly #invitations = new Map<string, StoredCommunityInvitation>();
  readonly #invitationUsage = new Map<
    UserId,
    { utcDay: number; count: number }
  >();
  readonly #publicationOperations = new Map<
    string,
    {
      readonly fingerprint: string;
      readonly activityId: string;
      readonly version: number;
    }
  >();

  #requireActive(userId: UserId): StoredCommunityProfile {
    const profile = this.#profiles.get(userId);
    if (!profile || profile.status !== "active" || this.#hasSanction(userId))
      throw new CommunityMutationError("unavailable");
    return profile;
  }

  #blocked(userA: UserId, userB: UserId): boolean {
    return [...this.#blocks.values()].some(
      (block) =>
        (block.blockerUserId === userA && block.blockedUserId === userB) ||
        (block.blockerUserId === userB && block.blockedUserId === userA),
    );
  }

  #purgeReactions(activityId: string): void {
    for (const [key, reaction] of this.#reactions) {
      if (reaction.activityId === activityId) this.#reactions.delete(key);
    }
  }

  #purgeFollowerReactions(follower: UserId, author: UserId): void {
    for (const [key, reaction] of this.#reactions) {
      if (
        reaction.userId === follower &&
        this.#activities.get(reaction.activityId)?.userId === author
      )
        this.#reactions.delete(key);
    }
  }

  async getProfile(
    userId: UserId,
    _options?: { readonly accessToken?: string },
  ): Promise<StoredCommunityProfile | null> {
    return this.#profiles.get(userId) ?? null;
  }

  async getProfileByHandle(
    handle: string,
    _options?: { readonly accessToken?: string },
  ): Promise<StoredCommunityProfile | null> {
    const normalized = handle.trim().toLowerCase();
    for (const p of this.#profiles.values()) {
      if (p.handle.toLowerCase() === normalized) {
        return p;
      }
    }
    return null;
  }

  async isHandleAvailable(
    handle: string,
    userId: UserId,
    _options?: { readonly accessToken?: string },
  ): Promise<boolean> {
    const normalized = handle.trim().toLowerCase();
    return ![...this.#profiles.values()].some(
      (profile) => profile.handle === normalized && profile.userId !== userId,
    );
  }

  async saveProfile(
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
    _options?: { readonly accessToken?: string },
  ): Promise<StoredCommunityProfile> {
    if (this.#hasSanction(userId))
      throw new CommunityMutationError("unavailable");
    const normalizedHandle = profile.handle.trim().toLowerCase();
    const existing = this.#profiles.get(userId);
    if (
      existing?.status === "suspended" &&
      (!profile.enrollmentConsent ||
        ![...this.#sanctions.values()].some((s) => s.userId === userId))
    )
      throw new CommunityMutationError("unavailable");
    if (existing && existing.handle !== normalizedHandle)
      throw new CommunityMutationError("conflict");
    if (
      [...this.#profiles.values()].some(
        (p) => p.userId !== userId && p.handle === normalizedHandle,
      )
    )
      throw new CommunityMutationError("handle_taken");
    const now = new Date();
    const avatar =
      profile.avatarSymbol || generateAvatarSymbol(profile.displayName);

    const updated: StoredCommunityProfile = {
      userId,
      handle: normalizedHandle,
      displayName: profile.displayName.trim(),
      avatarSymbol: avatar,
      bio: profile.bio ? profile.bio.trim() : null,
      isSearchable: profile.isSearchable ?? false,
      status: "active",
      generation: existing
        ? existing.status !== "active"
          ? existing.generation + 1
          : existing.generation
        : 1,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    this.#profiles.set(userId, updated);
    return updated;
  }

  async withdrawProfile(
    userId: UserId,
    _options?: { readonly accessToken?: string },
  ): Promise<void> {
    const existing = this.#profiles.get(userId);
    if (existing) {
      this.#profiles.set(userId, {
        ...existing,
        status: existing.status === "suspended" ? "suspended" : "withdrawn",
        updatedAt: new Date(),
      });
    }

    for (const [key, mute] of this.#mutes) {
      if (mute.userId === userId || mute.targetUserId === userId)
        this.#mutes.delete(key);
    }
    for (const [id, invitation] of this.#invitations) {
      if (invitation.inviterUserId === userId && !invitation.revokedAt)
        this.#invitations.set(id, { ...invitation, revokedAt: new Date() });
    }
    for (const [key, reaction] of this.#reactions) {
      if (
        reaction.userId === userId ||
        this.#activities.get(reaction.activityId)?.userId === userId
      )
        this.#reactions.delete(key);
    }

    // Revoke all shared activities
    for (const [id, act] of this.#activities.entries()) {
      if (act.userId === userId && !act.revokedAt) {
        this.#activities.set(id, {
          ...act,
          revokedAt: new Date(),
        });
      }
    }

    // Sever all incoming & outgoing relationships in both directions
    for (const [id, rel] of this.#relationships.entries()) {
      if (rel.followerUserId === userId || rel.targetUserId === userId) {
        this.#rememberPair(rel.followerUserId, rel.targetUserId);
        this.#relationships.delete(id);
      }
    }
  }

  async searchProfiles(
    query: string,
    viewerUserId: UserId,
    _options?: { readonly accessToken?: string; readonly limit?: number },
  ): Promise<readonly StoredCommunityProfile[]> {
    const raw = query.trim().toLowerCase();
    const handleQuery = raw.startsWith("@") ? raw.slice(1) : raw;
    if (!handleQuery) return [];
    const limit = Math.min(_options?.limit ?? 20, 50);
    const results: StoredCommunityProfile[] = [];

    for (const p of this.#profiles.values()) {
      if (p.userId === viewerUserId) continue;
      if (!p.isSearchable || p.status !== "active") continue;
      if (await this.isBlockedBilateral(viewerUserId, p.userId)) continue;

      if (p.handle.toLowerCase() === handleQuery) {
        results.push(p);
        if (results.length >= limit) break;
      }
    }

    return results;
  }

  async getRelationship(
    followerUserId: UserId,
    targetUserId: UserId,
    _options?: { readonly accessToken?: string },
  ): Promise<StoredFollowRelationship | null> {
    for (const rel of this.#relationships.values()) {
      if (
        rel.followerUserId === followerUserId &&
        rel.targetUserId === targetUserId
      ) {
        return rel;
      }
    }
    return null;
  }

  async getRelationshipById(
    relationshipId: string,
    _options?: { readonly accessToken?: string },
  ): Promise<StoredFollowRelationship | null> {
    return this.#relationships.get(relationshipId) ?? null;
  }

  async getFollowers(
    userId: UserId,
    _options?: {
      readonly accessToken?: string;
      readonly limit?: number;
      readonly afterId?: string;
    },
  ): Promise<
    readonly {
      readonly relationship: StoredFollowRelationship;
      readonly profile: StoredCommunityProfile;
    }[]
  > {
    const list: {
      readonly relationship: StoredFollowRelationship;
      readonly profile: StoredCommunityProfile;
    }[] = [];

    for (const rel of this.#relationships.values()) {
      if (rel.targetUserId === userId && rel.status === "approved") {
        const prof = this.#profiles.get(rel.followerUserId);
        if (prof && prof.status === "active") {
          list.push({ relationship: rel, profile: prof });
        }
      }
    }
    return list
      .sort((a, b) => a.relationship.id.localeCompare(b.relationship.id))
      .filter(
        (item) => !_options?.afterId || item.relationship.id > _options.afterId,
      )
      .slice(0, _options?.limit ?? 50);
  }

  async getFollowing(
    userId: UserId,
    _options?: {
      readonly accessToken?: string;
      readonly limit?: number;
      readonly afterId?: string;
    },
  ): Promise<
    readonly {
      readonly relationship: StoredFollowRelationship;
      readonly profile: StoredCommunityProfile;
    }[]
  > {
    const list: {
      readonly relationship: StoredFollowRelationship;
      readonly profile: StoredCommunityProfile;
    }[] = [];

    for (const rel of this.#relationships.values()) {
      if (rel.followerUserId === userId && rel.status === "approved") {
        const prof = this.#profiles.get(rel.targetUserId);
        if (prof && prof.status === "active") {
          list.push({ relationship: rel, profile: prof });
        }
      }
    }
    return list
      .sort((a, b) => a.relationship.id.localeCompare(b.relationship.id))
      .filter(
        (item) => !_options?.afterId || item.relationship.id > _options.afterId,
      )
      .slice(0, _options?.limit ?? 50);
  }

  async getIncomingFollowRequests(
    userId: UserId,
    _options?: {
      readonly accessToken?: string;
      readonly limit?: number;
      readonly afterId?: string;
    },
  ): Promise<
    readonly {
      readonly relationship: StoredFollowRelationship;
      readonly profile: StoredCommunityProfile;
    }[]
  > {
    const list: {
      readonly relationship: StoredFollowRelationship;
      readonly profile: StoredCommunityProfile;
    }[] = [];

    for (const rel of this.#relationships.values()) {
      if (rel.targetUserId === userId && rel.status === "pending") {
        const prof = this.#profiles.get(rel.followerUserId);
        if (prof && prof.status === "active") {
          list.push({ relationship: rel, profile: prof });
        }
      }
    }
    return list
      .sort((a, b) => a.relationship.id.localeCompare(b.relationship.id))
      .filter(
        (item) => !_options?.afterId || item.relationship.id > _options.afterId,
      )
      .slice(0, _options?.limit ?? 50);
  }

  async getOutgoingFollowRequests(
    userId: UserId,
    _options?: {
      readonly accessToken?: string;
      readonly limit?: number;
      readonly afterId?: string;
    },
  ): Promise<
    readonly {
      readonly relationship: StoredFollowRelationship;
      readonly profile: StoredCommunityProfile;
    }[]
  > {
    const list: {
      readonly relationship: StoredFollowRelationship;
      readonly profile: StoredCommunityProfile;
    }[] = [];

    for (const rel of this.#relationships.values()) {
      if (rel.followerUserId === userId && rel.status === "pending") {
        const prof = this.#profiles.get(rel.targetUserId);
        if (prof && prof.status === "active") {
          list.push({ relationship: rel, profile: prof });
        }
      }
    }
    return list
      .sort((a, b) => a.relationship.id.localeCompare(b.relationship.id))
      .filter(
        (item) => !_options?.afterId || item.relationship.id > _options.afterId,
      )
      .slice(0, _options?.limit ?? 50);
  }

  async sendFollowRequest(
    followerUserId: UserId,
    targetUserId: UserId,
    _options?: {
      readonly accessToken?: string;
      readonly invitationToken?: string;
      readonly operationId?: string;
    },
  ): Promise<StoredFollowRelationship> {
    this.#requireActive(followerUserId);
    this.#requireActive(targetUserId);
    if (
      followerUserId === targetUserId ||
      this.#blocked(followerUserId, targetUserId)
    )
      throw new CommunityMutationError("unavailable");
    const operationKey = _options?.operationId
      ? `${followerUserId}:${_options.operationId}`
      : null;
    const prior = operationKey
      ? this.#followOperations.get(operationKey)
      : null;
    if (prior) {
      const result = this.#relationships.get(prior.relationshipId);
      if (!result || prior.targetUserId !== targetUserId)
        throw new CommunityMutationError("conflict");
      return result;
    }
    const existing = [...this.#relationships.values()].find(
      (rel) =>
        rel.followerUserId === followerUserId &&
        rel.targetUserId === targetUserId,
    );
    if (existing?.status === "pending" || existing?.status === "approved") {
      if (operationKey) {
        const now = new Date();
        if (
          this.#followEvents.filter(
            (e) =>
              e.userId === followerUserId &&
              e.createdAt.toISOString().slice(0, 10) ===
                now.toISOString().slice(0, 10),
          ).length >= 50 ||
          this.#followEvents.filter(
            (e) =>
              e.userId === followerUserId &&
              now.getTime() - e.createdAt.getTime() < 60000,
          ).length >= 10
        )
          throw new CommunityMutationError("rate_limited");
        this.#followEvents.push({ userId: followerUserId, createdAt: now });
        this.#followOperations.set(operationKey, {
          targetUserId,
          relationshipId: existing.id,
        });
      }
      return existing;
    }
    if (
      !this.#profiles.get(targetUserId)?.isSearchable &&
      ![...this.#relationships.values()].some(
        (rel) =>
          rel.followerUserId === targetUserId &&
          rel.targetUserId === followerUserId &&
          rel.status === "approved",
      )
    ) {
      const invitation = [...this.#invitations.values()].find(
        (inv) =>
          inv.token === _options?.invitationToken &&
          inv.inviterUserId === targetUserId &&
          !inv.revokedAt &&
          inv.expiresAt.getTime() > Date.now(),
      );
      if (!invitation) throw new CommunityMutationError("unavailable");
    }
    const now = new Date();
    if (
      (existing &&
        now.getTime() - existing.updatedAt.getTime() < 48 * 60 * 60 * 1000) ||
      (this.#followCooldowns
        .get(`${followerUserId}:${targetUserId}`)
        ?.getTime() ?? 0) > now.getTime()
    )
      throw new CommunityMutationError("rate_limited");
    if (
      [...this.#relationships.values()].filter(
        (rel) =>
          rel.followerUserId === followerUserId && rel.status === "pending",
      ).length >= 20 ||
      [...this.#relationships.values()].filter(
        (rel) => rel.targetUserId === targetUserId && rel.status === "pending",
      ).length >= 50 ||
      this.#followEvents.filter(
        (e) =>
          e.userId === followerUserId &&
          e.createdAt.toISOString().slice(0, 10) ===
            now.toISOString().slice(0, 10),
      ).length >= 50 ||
      this.#followEvents.filter(
        (e) =>
          e.userId === followerUserId &&
          now.getTime() - e.createdAt.getTime() < 60000,
      ).length >= 10
    )
      throw new CommunityMutationError("rate_limited");
    if (existing) this.#relationships.delete(existing.id);
    const id = crypto.randomUUID();
    const rel: StoredFollowRelationship = {
      id,
      followerUserId,
      targetUserId,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    this.#relationships.set(id, rel);
    this.#followEvents.push({ userId: followerUserId, createdAt: now });
    if (operationKey)
      this.#followOperations.set(operationKey, {
        targetUserId,
        relationshipId: id,
      });
    return rel;
  }

  async updateRelationshipStatus(
    relationshipId: string,
    actorUserId: UserId,
    status: CommunityRelationshipStatus,
    _options?: { readonly accessToken?: string },
  ): Promise<StoredFollowRelationship> {
    const rel = this.#relationships.get(relationshipId);
    if (!rel) {
      throw new CommunityMutationError("unavailable");
    }
    this.#requireActive(rel.followerUserId);
    this.#requireActive(rel.targetUserId);
    if (
      this.#blocked(rel.followerUserId, rel.targetUserId) ||
      (status === "canceled"
        ? actorUserId !== rel.followerUserId
        : actorUserId !== rel.targetUserId) ||
      status === "pending"
    )
      throw new CommunityMutationError("unavailable");
    if (rel.status === status) return rel;
    if (rel.status !== "pending") throw new CommunityMutationError("conflict");
    if (
      status === "approved" &&
      ([...this.#relationships.values()].filter(
        (r) =>
          r.followerUserId === rel.followerUserId && r.status === "approved",
      ).length >= 30 ||
        [...this.#relationships.values()].filter(
          (r) => r.targetUserId === rel.targetUserId && r.status === "approved",
        ).length >= 30)
    )
      throw new CommunityMutationError("rate_limited");
    const updated: StoredFollowRelationship = {
      ...rel,
      status,
      updatedAt: new Date(),
    };
    this.#relationships.set(relationshipId, updated);
    if (status === "canceled" || status === "declined")
      this.#followCooldowns.set(
        `${rel.followerUserId}:${rel.targetUserId}`,
        new Date(updated.updatedAt.getTime() + 48 * 3600000),
      );
    return updated;
  }

  async unfollow(
    followerUserId: UserId,
    targetUserId: UserId,
    _options?: {
      readonly accessToken?: string;
      readonly relationshipId?: string;
    },
  ): Promise<void> {
    for (const [id, rel] of this.#relationships.entries()) {
      if (
        rel.followerUserId === followerUserId &&
        rel.targetUserId === targetUserId &&
        (!_options?.relationshipId || rel.id === _options.relationshipId)
      ) {
        if (rel.status === "pending") {
          this.#followCooldowns.set(
            `${followerUserId}:${targetUserId}`,
            new Date(Date.now() + 48 * 3600000),
          );
          this.#relationships.set(id, {
            ...rel,
            status: "canceled",
            updatedAt: new Date(),
          });
        } else if (rel.status === "approved") {
          this.#purgeFollowerReactions(followerUserId, targetUserId);
          this.#rememberPair(rel.followerUserId, rel.targetUserId);
          this.#relationships.delete(id);
        }
      }
    }
  }

  async removeFollower(
    authorUserId: UserId,
    followerUserId: UserId,
    _options?: {
      readonly accessToken?: string;
      readonly relationshipId?: string;
    },
  ): Promise<void> {
    for (const [id, rel] of this.#relationships.entries()) {
      if (
        rel.followerUserId === followerUserId &&
        rel.targetUserId === authorUserId &&
        (!_options?.relationshipId || rel.id === _options.relationshipId)
      ) {
        if (rel.status === "approved") {
          this.#purgeFollowerReactions(followerUserId, authorUserId);
          this.#rememberPair(rel.followerUserId, rel.targetUserId);
          this.#relationships.delete(id);
        }
      }
    }
  }

  async blockUser(
    blockerUserId: UserId,
    blockedUserId: UserId,
    _options?: { readonly accessToken?: string },
  ): Promise<StoredCommunityBlock> {
    this.#requireActive(blockerUserId);
    if (blockerUserId === blockedUserId)
      throw new CommunityMutationError("unavailable");
    const existing = [...this.#blocks.values()].find(
      (b) =>
        b.blockerUserId === blockerUserId && b.blockedUserId === blockedUserId,
    );
    if (existing) return existing;
    const id = crypto.randomUUID();
    const now = new Date();
    const block: StoredCommunityBlock = {
      id,
      blockerUserId,
      blockedUserId,
      createdAt: now,
    };
    this.#blocks.set(id, block);

    // Sever all relationships both directions
    for (const [relId, rel] of this.#relationships.entries()) {
      if (
        (rel.followerUserId === blockerUserId &&
          rel.targetUserId === blockedUserId) ||
        (rel.followerUserId === blockedUserId &&
          rel.targetUserId === blockerUserId)
      ) {
        this.#rememberPair(rel.followerUserId, rel.targetUserId);
        this.#relationships.delete(relId);
      }
    }

    // Delete reactions in both directions
    for (const [reactId, react] of this.#reactions.entries()) {
      const activity = this.#activities.get(react.activityId);
      if (
        (react.userId === blockerUserId &&
          activity?.userId === blockedUserId) ||
        (react.userId === blockedUserId && activity?.userId === blockerUserId)
      ) {
        this.#reactions.delete(reactId);
      }
    }

    return block;
  }

  async unblockUser(
    blockerUserId: UserId,
    blockedUserId: UserId,
    _options?: { readonly accessToken?: string },
  ): Promise<void> {
    for (const [id, b] of this.#blocks.entries()) {
      if (
        b.blockerUserId === blockerUserId &&
        b.blockedUserId === blockedUserId
      ) {
        this.#blocks.delete(id);
      }
    }
  }

  async getBlockedUsers(
    userId: UserId,
    _options?: {
      readonly accessToken?: string;
      readonly limit?: number;
      readonly afterId?: string;
    },
  ): Promise<
    readonly {
      readonly block: StoredCommunityBlock;
      readonly profile: StoredCommunityProfile;
    }[]
  > {
    const list: {
      readonly block: StoredCommunityBlock;
      readonly profile: StoredCommunityProfile;
    }[] = [];

    for (const b of this.#blocks.values()) {
      if (b.blockerUserId === userId) {
        const prof = this.#profiles.get(b.blockedUserId);
        if (prof) {
          list.push({ block: b, profile: prof });
        }
      }
    }
    return list
      .sort((a, b) => a.block.id.localeCompare(b.block.id))
      .filter((item) => !_options?.afterId || item.block.id > _options.afterId)
      .slice(0, _options?.limit ?? 50);
  }

  async setMuted(
    userId: UserId,
    targetUserId: UserId,
    muted: boolean,
    _options?: { readonly accessToken?: string },
  ): Promise<void> {
    const key = `${userId}:${targetUserId}`;
    if (!muted) {
      this.#mutes.delete(key);
      return;
    }
    this.#requireActive(userId);
    this.#requireActive(targetUserId);
    if (
      this.#blocked(userId, targetUserId) ||
      ![...this.#relationships.values()].some(
        (r) =>
          r.followerUserId === userId &&
          r.targetUserId === targetUserId &&
          r.status === "approved",
      )
    )
      throw new CommunityMutationError("unavailable");
    if (!this.#mutes.has(key))
      this.#mutes.set(key, { userId, targetUserId, createdAt: new Date() });
  }
  async getMutedUsers(
    userId: UserId,
    options?: {
      readonly accessToken?: string;
      readonly limit?: number;
      readonly afterId?: string;
    },
  ): Promise<
    readonly {
      readonly profile: StoredCommunityProfile;
      readonly createdAt: Date;
    }[]
  > {
    return [...this.#mutes.values()]
      .filter(
        (m) =>
          m.userId === userId &&
          (!options?.afterId || m.targetUserId > options.afterId),
      )
      .sort((a, b) => a.targetUserId.localeCompare(b.targetUserId))
      .slice(0, options?.limit ?? 50)
      .flatMap((m) => {
        const profile = this.#profiles.get(m.targetUserId);
        return profile
          ? [
              {
                profile:
                  this.#blocked(userId, m.targetUserId) ||
                  profile.status !== "active"
                    ? {
                        ...profile,
                        handle: "unavailable",
                        displayName: "Unavailable member",
                        avatarSymbol: "?",
                        bio: null,
                      }
                    : profile,
                createdAt: m.createdAt,
              },
            ]
          : [];
      });
  }

  async isBlockedBilateral(
    userA: UserId,
    userB: UserId,
    _options?: { readonly accessToken?: string },
  ): Promise<boolean> {
    if (
      this.#profiles.get(userA)?.status !== "active" ||
      this.#profiles.get(userB)?.status !== "active"
    )
      return true;
    for (const b of this.#blocks.values()) {
      if (
        (b.blockerUserId === userA && b.blockedUserId === userB) ||
        (b.blockerUserId === userB && b.blockedUserId === userA)
      ) {
        return true;
      }
    }
    return false;
  }

  async createInvitation(
    inviterUserId: UserId,
    options?: {
      readonly accessToken?: string;
      readonly expiresInDays?: number;
    },
  ): Promise<StoredCommunityInvitation> {
    this.#requireActive(inviterUserId);
    if (
      [...this.#invitations.values()].filter(
        (inv) =>
          inv.inviterUserId === inviterUserId &&
          !inv.revokedAt &&
          inv.expiresAt.getTime() > Date.now(),
      ).length >= 20
    )
      throw new CommunityMutationError("rate_limited");
    const utcDay = Math.floor(Date.now() / 86_400_000);
    for (const [userId, usage] of this.#invitationUsage) {
      if (usage.utcDay < utcDay) this.#invitationUsage.delete(userId);
    }
    const issued = this.#invitationUsage.get(inviterUserId)?.count ?? 0;
    if (issued >= 20) throw new CommunityMutationError("rate_limited");
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(16).toString("base64url");
    const days = options?.expiresInDays ?? 7;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const invitation: StoredCommunityInvitation = {
      id,
      token,
      inviterUserId,
      expiresAt,
      revokedAt: null,
      createdAt: now,
    };
    this.#invitations.set(id, invitation);
    this.#invitationUsage.set(inviterUserId, { utcDay, count: issued + 1 });
    return invitation;
  }

  async resolveInvitation(
    token: string,
    viewerUserId: UserId,
    _options?: { readonly accessToken?: string },
  ): Promise<{
    readonly invitation: StoredCommunityInvitation;
    readonly profile: StoredCommunityProfile;
  } | null> {
    this.#requireActive(viewerUserId);
    const invitation = await this.getInvitationByToken(token);
    if (
      !invitation ||
      invitation.revokedAt ||
      invitation.expiresAt.getTime() <= Date.now()
    )
      return null;
    const profile = this.#profiles.get(invitation.inviterUserId);
    if (
      !profile ||
      profile.status !== "active" ||
      this.#blocked(viewerUserId, profile.userId)
    )
      return null;
    return { invitation, profile: { ...profile, bio: null } };
  }

  async getInvitationByToken(
    token: string,
    _options?: { readonly accessToken?: string },
  ): Promise<StoredCommunityInvitation | null> {
    for (const inv of this.#invitations.values()) {
      if (inv.token === token) {
        return inv;
      }
    }
    return null;
  }

  async getInvitationProfile(
    token: string,
    _options?: { readonly accessToken?: string },
  ): Promise<StoredCommunityProfile | null> {
    const invitation = [...this.#invitations.values()].find(
      (inv) => inv.token === token,
    );
    if (
      !invitation ||
      invitation.revokedAt ||
      invitation.expiresAt.getTime() <= Date.now()
    )
      return null;
    const profile = this.#profiles.get(invitation.inviterUserId);
    return profile?.status === "active" ? profile : null;
  }

  async getInvitationById(
    invitationId: string,
    _options?: { readonly accessToken?: string },
  ): Promise<StoredCommunityInvitation | null> {
    return this.#invitations.get(invitationId) ?? null;
  }

  async listInvitations(
    inviterUserId: UserId,
    _options?: { readonly accessToken?: string },
  ): Promise<readonly StoredCommunityInvitation[]> {
    const list: StoredCommunityInvitation[] = [];
    for (const inv of this.#invitations.values()) {
      if (inv.inviterUserId === inviterUserId) {
        list.push(inv);
      }
    }
    list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return list;
  }

  async revokeInvitation(
    invitationId: string,
    inviterUserId: UserId,
    _options?: { readonly accessToken?: string },
  ): Promise<void> {
    const inv = this.#invitations.get(invitationId);
    if (inv && inv.inviterUserId === inviterUserId) {
      this.#invitations.set(invitationId, {
        ...inv,
        revokedAt: new Date(),
      });
    }
  }

  async getActivityById(
    activityId: string,
    _options?: { readonly accessToken?: string },
  ): Promise<StoredSharedActivity | null> {
    return this.#activities.get(activityId) ?? null;
  }

  async getActivityByWorkoutId(
    workoutId: string,
    authorUserId: UserId,
    _options?: { readonly accessToken?: string },
  ): Promise<StoredSharedActivity | null> {
    for (const act of this.#activities.values()) {
      if (act.sourceWorkoutId === workoutId && act.userId === authorUserId) {
        return act;
      }
    }
    return null;
  }

  async getActivityByMealId(
    mealId: string,
    authorUserId: UserId,
    _options?: { readonly accessToken?: string },
  ): Promise<StoredSharedActivity | null> {
    return (
      [...this.#activities.values()].find(
        (a) => a.sourceMealId === mealId && a.userId === authorUserId,
      ) ?? null
    );
  }

  async publishMealActivity(
    userId: UserId,
    activity: MealActivityPublication,
    _options?: { readonly accessToken?: string },
  ): Promise<StoredSharedActivity> {
    const profile = this.#requireActive(userId);
    if (profile.generation !== activity.enrollmentGeneration)
      throw new CommunityMutationError("conflict");
    const operationKey = `${userId}:${activity.operationId}`;
    const { currentSourceMealDetails, currentSourceDay, ...confirmation } =
      activity;
    const fingerprint = JSON.stringify({
      activityKind: "meal",
      ...confirmation,
    });
    const operation = this.#publicationOperations.get(operationKey);
    if (operation) {
      const previous = this.#activities.get(operation.activityId);
      if (
        operation.fingerprint !== fingerprint ||
        !previous ||
        previous.revokedAt ||
        previous.version !== operation.version
      )
        throw new CommunityMutationError("conflict");
      return previous;
    }
    if (
      JSON.stringify(activity.mealDetails) !==
        JSON.stringify(currentSourceMealDetails) ||
      Math.abs(
        Date.parse(`${activity.sharedDay}T00:00:00Z`) -
          Date.parse(`${currentSourceDay}T00:00:00Z`),
      ) > 86400000 ||
      activity.sharedDay >
        new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    )
      throw new CommunityMutationError("conflict");
    const existing = await this.getActivityByMealId(
      activity.sourceMealId,
      userId,
    );
    if (
      (existing?.version ?? 0) !== activity.expectedVersion ||
      (existing?.revokedAt != null) !== activity.expectedRevoked
    )
      throw new CommunityMutationError("conflict");
    this.#consumePublication(userId);
    if (existing) this.#purgeReactions(existing.id);
    const shared: StoredSharedActivity = {
      id: existing?.id ?? crypto.randomUUID(),
      userId,
      activityKind: "meal",
      sourceWorkoutId: null,
      sourceMealId: activity.sourceMealId,
      category: "other",
      sharedDay: activity.sharedDay,
      durationSeconds: null,
      workoutDetails: null,
      mealDetails: activity.mealDetails,
      version: (existing?.version ?? 0) + 1,
      revokedAt: null,
      publishedAt:
        existing && !existing.revokedAt ? existing.publishedAt : new Date(),
    };
    this.#activities.set(shared.id, shared);
    this.#publicationOperations.set(operationKey, {
      fingerprint,
      activityId: shared.id,
      version: shared.version,
    });
    return shared;
  }

  async revokeActivitiesForMeal(
    mealId: string,
    authorUserId: UserId,
    _options?: { readonly accessToken?: string },
  ): Promise<void> {
    for (const [id, act] of this.#activities)
      if (act.sourceMealId === mealId && act.userId === authorUserId) {
        this.#purgeReactions(id);
        this.#activities.set(id, {
          ...act,
          revokedAt: act.revokedAt ?? new Date(),
        });
      }
  }

  async publishBoulderingActivity(
    userId: UserId,
    activity: BoulderingActivityPublication,
    _options?: { readonly accessToken?: string },
  ): Promise<StoredSharedActivity> {
    const profile = this.#requireActive(userId);
    if (profile.generation !== activity.enrollmentGeneration)
      throw new CommunityMutationError("conflict");
    const operationKey = `${userId}:${activity.operationId}`;
    const { currentSourceBoulderingDetails, ...confirmation } = activity;
    const fingerprint = JSON.stringify({
      activityKind: "bouldering",
      ...confirmation,
    });
    const operation = this.#publicationOperations.get(operationKey);
    if (operation) {
      const previous = this.#activities.get(operation.activityId);
      if (
        operation.fingerprint !== fingerprint ||
        !previous ||
        previous.revokedAt ||
        previous.version !== operation.version
      )
        throw new CommunityMutationError("conflict");
      return previous;
    }
    // Mirrors the SQL exact-match and local-day checks.
    if (
      JSON.stringify(activity.boulderingDetails) !==
        JSON.stringify(currentSourceBoulderingDetails) ||
      activity.sharedDay !== currentSourceBoulderingDetails.activityDate ||
      activity.sharedDay >
        new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    )
      throw new CommunityMutationError("conflict");
    const existing = await this.getActivityByWorkoutId(
      activity.sourceSessionId,
      userId,
    );
    if (existing && existing.activityKind !== "bouldering")
      throw new CommunityMutationError("conflict");
    if (
      (existing?.version ?? 0) !== activity.expectedVersion ||
      (existing?.revokedAt != null) !== activity.expectedRevoked
    )
      throw new CommunityMutationError("conflict");
    this.#consumePublication(userId);
    if (existing) this.#purgeReactions(existing.id);
    const shared: StoredSharedActivity = {
      id: existing?.id ?? crypto.randomUUID(),
      userId,
      activityKind: "bouldering",
      sourceWorkoutId: activity.sourceSessionId,
      sourceMealId: null,
      category: "other",
      sharedDay: activity.sharedDay,
      durationSeconds: null,
      workoutDetails: null,
      mealDetails: null,
      boulderingDetails: currentSourceBoulderingDetails,
      version: (existing?.version ?? 0) + 1,
      revokedAt: null,
      publishedAt:
        existing && !existing.revokedAt ? existing.publishedAt : new Date(),
    };
    this.#activities.set(shared.id, shared);
    this.#publicationOperations.set(operationKey, {
      fingerprint,
      activityId: shared.id,
      version: shared.version,
    });
    return shared;
  }

  async revokeActivitiesForBoulderingSession(
    sessionId: string,
    authorUserId: UserId,
    _options?: { readonly accessToken?: string },
  ): Promise<void> {
    for (const [id, act] of this.#activities)
      if (
        act.activityKind === "bouldering" &&
        act.sourceWorkoutId === sessionId &&
        act.userId === authorUserId &&
        !act.revokedAt
      ) {
        this.#purgeReactions(id);
        this.#activities.set(id, { ...act, revokedAt: new Date() });
      }
  }

  async publishActivity(
    userId: UserId,
    activity: {
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
      readonly enrollmentGeneration: number;
      readonly operationId: string;
    },
    _options?: { readonly accessToken?: string },
  ): Promise<StoredSharedActivity> {
    const profile = this.#requireActive(userId);
    if (profile.generation !== activity.enrollmentGeneration)
      throw new CommunityMutationError("conflict");
    const operationKey = `${userId}:${activity.operationId}`;
    const {
      currentSourceDurationSeconds,
      currentSourceDay,
      currentSourceWorkoutDetails,
      ...confirmation
    } = activity;
    const fingerprint = JSON.stringify(confirmation);
    const operation = this.#publicationOperations.get(operationKey);
    if (operation) {
      const previous = this.#activities.get(operation.activityId);
      if (
        operation.fingerprint !== fingerprint ||
        !previous ||
        previous.revokedAt ||
        previous.version !== operation.version
      )
        throw new CommunityMutationError("conflict");
      return previous;
    }
    if (
      activity.workoutDetails != null &&
      JSON.stringify(activity.workoutDetails) !==
        JSON.stringify(currentSourceWorkoutDetails)
    )
      throw new CommunityMutationError("conflict");
    if (
      activity.durationSeconds !== null &&
      currentSourceDurationSeconds !== undefined &&
      activity.durationSeconds !== currentSourceDurationSeconds
    )
      throw new CommunityMutationError("conflict");
    if (
      currentSourceDay &&
      (Math.abs(
        Date.parse(`${activity.sharedDay}T00:00:00Z`) -
          Date.parse(`${currentSourceDay}T00:00:00Z`),
      ) > 86400000 ||
        activity.sharedDay >
          new Date(Date.now() + 86400000).toISOString().slice(0, 10))
    )
      throw new CommunityMutationError("conflict");
    const now = new Date();

    // Idempotent: check if already exists for this workout & user
    for (const [id, act] of this.#activities.entries()) {
      if (
        act.sourceWorkoutId === activity.sourceWorkoutId &&
        act.userId === userId
      ) {
        // Mirrors the SQL wrapper: the strength path never touches bouldering.
        if (act.activityKind === "bouldering")
          throw new CommunityMutationError("conflict");
        if (
          (activity.expectedVersion ?? 0) !== act.version ||
          (activity.expectedRevoked ?? false) !== (act.revokedAt !== null)
        )
          throw new CommunityMutationError("conflict");
        this.#consumePublication(userId);
        // Invalidate existing reactions on re-publication per ADR-0030
        for (const [reactKey, react] of this.#reactions.entries()) {
          if (react.activityId === id) {
            this.#reactions.delete(reactKey);
          }
        }

        const updated: StoredSharedActivity = {
          ...act,
          category: activity.category,
          sharedDay: activity.sharedDay,
          durationSeconds: activity.durationSeconds,
          workoutDetails: activity.workoutDetails ?? null,
          version: act.version + 1,
          revokedAt: null,
          publishedAt: act.revokedAt ? now : act.publishedAt,
        };
        this.#activities.set(id, updated);
        this.#publicationOperations.set(operationKey, {
          fingerprint,
          activityId: id,
          version: updated.version,
        });
        return updated;
      }
    }

    if ((activity.expectedVersion ?? 0) !== 0 || activity.expectedRevoked)
      throw new CommunityMutationError("conflict");
    this.#consumePublication(userId);
    const id = crypto.randomUUID();
    const shared: StoredSharedActivity = {
      id,
      userId,
      sourceWorkoutId: activity.sourceWorkoutId,
      category: activity.category,
      sharedDay: activity.sharedDay,
      durationSeconds: activity.durationSeconds,
      workoutDetails: activity.workoutDetails ?? null,
      version: 1,
      publishedAt: now,
      revokedAt: null,
    };

    this.#activities.set(id, shared);
    this.#publicationOperations.set(operationKey, {
      fingerprint,
      activityId: id,
      version: shared.version,
    });
    return shared;
  }

  async updateActivity(
    activityId: string,
    authorUserId: UserId,
    updates: {
      readonly durationSeconds?: number | null;
      readonly expectedVersion?: number;
    },
    _options?: { readonly accessToken?: string },
  ): Promise<StoredSharedActivity> {
    const act = this.#activities.get(activityId);
    this.#requireActive(authorUserId);
    if (!act || act.userId !== authorUserId || act.revokedAt) {
      throw new CommunityMutationError("unavailable");
    }
    if (act.activityKind === "meal" || act.activityKind === "bouldering")
      throw new CommunityMutationError("conflict");
    if (act.version !== (updates.expectedVersion ?? 1))
      throw new CommunityMutationError("conflict");
    if (
      updates.durationSeconds === undefined ||
      updates.durationSeconds === act.durationSeconds
    )
      return act;
    this.#consumePublication(authorUserId);
    this.#purgeReactions(activityId);
    const updated: StoredSharedActivity = {
      ...act,
      version: act.version + 1,
      ...(updates.durationSeconds !== undefined
        ? { durationSeconds: updates.durationSeconds }
        : {}),
    };
    this.#activities.set(activityId, updated);
    return updated;
  }

  async revokeActivity(
    activityId: string,
    authorUserId: UserId,
    options?: {
      readonly accessToken?: string;
      readonly expectedVersion?: number;
    },
  ): Promise<void> {
    const act = this.#activities.get(activityId);
    if (
      act &&
      options?.expectedVersion !== undefined &&
      options.expectedVersion !== act.version
    )
      throw new CommunityMutationError("conflict");
    if (act && act.userId === authorUserId) {
      this.#purgeReactions(activityId);
      this.#activities.set(activityId, {
        ...act,
        revokedAt: new Date(),
      });
    }
  }

  async revokeActivitiesForWorkout(
    workoutId: string,
    authorUserId: UserId,
    _options?: { readonly accessToken?: string },
  ): Promise<void> {
    for (const [id, act] of this.#activities.entries()) {
      if (act.sourceWorkoutId === workoutId && act.userId === authorUserId) {
        this.#purgeReactions(id);
        this.#activities.set(id, {
          ...act,
          revokedAt: new Date(),
        });
      }
    }
  }

  async getFeed(
    viewerUserId: UserId,
    options?: {
      readonly accessToken?: string | undefined;
      readonly limit?: number | undefined;
      readonly beforeCursor?: string | null | undefined;
      readonly authorUserId?: UserId;
    },
  ): Promise<{
    readonly items: readonly StoredSharedActivity[];
    readonly nextCursor?: string | null | undefined;
  }> {
    this.#requireActive(viewerUserId);
    const limit = Math.max(1, Math.min(options?.limit ?? 20, 50));
    let beforeTime: Date | null = null;
    let beforeId: string | null = null;
    if (options?.beforeCursor) {
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
        throw new Error("Invalid community feed cursor");
      }
      beforeTime = new Date(parts[0]);
      beforeId = parts[1];
    }
    const candidateActivities: StoredSharedActivity[] = [];

    for (const act of this.#activities.values()) {
      if (act.revokedAt) continue;
      if (
        options?.authorUserId &&
        (act.userId !== options.authorUserId ||
          act.publishedAt.getTime() <= Date.now() - 365 * 86400000)
      )
        continue;
      const authorProfile = this.#profiles.get(act.userId);
      if (!authorProfile || authorProfile.status !== "active") continue;
      if (await this.isBlockedBilateral(viewerUserId, act.userId)) continue;
      if (this.#mutes.has(`${viewerUserId}:${act.userId}`)) continue;

      if (act.userId === viewerUserId) {
        candidateActivities.push(act);
      } else {
        const rel = await this.getRelationship(viewerUserId, act.userId);
        if (rel?.status === "approved") {
          candidateActivities.push({
            ...act,
            sourceWorkoutId: "00000000-0000-0000-0000-000000000000",
            sourceMealId: null,
          });
        }
      }
    }

    candidateActivities.sort((a, b) => {
      const timeDiff = b.publishedAt.getTime() - a.publishedAt.getTime();
      if (timeDiff !== 0) return timeDiff;
      return b.id.localeCompare(a.id);
    });

    const filtered =
      beforeTime && beforeId
        ? candidateActivities.filter((act) => {
            const actTime = act.publishedAt.getTime();
            const targetTime = beforeTime!.getTime();
            if (actTime < targetTime) return true;
            if (actTime === targetTime) return act.id < beforeId!;
            return false;
          })
        : candidateActivities;

    const items = filtered.slice(0, limit);
    const last = items[items.length - 1];
    const nextCursor =
      (options?.authorUserId
        ? filtered.length > limit
        : items.length === limit) && last
        ? `${last.publishedAt.toISOString()}|${last.id}`
        : undefined;

    return {
      items,
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  #computeReactionCountsAndViewerReaction(
    activityId: string,
    viewerUserId: UserId,
  ): {
    readonly reactionCounts: Record<CommunityReactionKind, number>;
    readonly viewerReaction: CommunityReactionKind | null;
  } {
    const counts: Record<CommunityReactionKind, number> = {
      clap: 0,
      fire: 0,
      high_five: 0,
      fist_bump: 0,
      thumbs_up: 0,
    };
    let viewerReaction: CommunityReactionKind | null = null;
    const activity = this.#activities.get(activityId);
    if (!activity || activity.revokedAt) {
      return { reactionCounts: counts, viewerReaction: null };
    }
    const authorProfile = this.#profiles.get(activity.userId);
    if (!authorProfile || authorProfile.status !== "active") {
      return { reactionCounts: counts, viewerReaction: null };
    }

    for (const react of this.#reactions.values()) {
      if (react.activityId !== activityId) continue;
      const reactorProfile = this.#profiles.get(react.userId);
      if (!reactorProfile || reactorProfile.status !== "active") continue;
      // Bilateral block suppression
      if (this.#blocked(viewerUserId, react.userId)) continue;
      if (this.#blocked(activity.userId, react.userId)) continue;
      // Reactor must still be approved follower
      const isApprovedFollower = [...this.#relationships.values()].some(
        (rel) =>
          rel.followerUserId === react.userId &&
          rel.targetUserId === activity.userId &&
          rel.status === "approved",
      );
      if (!isApprovedFollower) continue;

      counts[react.reaction] = (counts[react.reaction] ?? 0) + 1;
      if (react.userId === viewerUserId) {
        viewerReaction = react.reaction;
      }
    }

    return { reactionCounts: counts, viewerReaction };
  }

  async setReaction(
    activityId: string,
    userId: UserId,
    reaction: CommunityReactionKind | null,
    _options?: { readonly accessToken?: string },
  ): Promise<void> {
    const key = `${activityId}:${userId}`;
    if (reaction === null) {
      this.#reactions.delete(key);
      return;
    }
    this.#requireActive(userId);
    const activity = this.#activities.get(activityId);
    if (
      !activity ||
      activity.revokedAt ||
      activity.userId === userId ||
      this.#profiles.get(activity.userId)?.status !== "active" ||
      this.#blocked(userId, activity.userId) ||
      ![...this.#relationships.values()].some(
        (rel) =>
          rel.followerUserId === userId &&
          rel.targetUserId === activity.userId &&
          rel.status === "approved",
      )
    )
      throw new CommunityMutationError("unavailable");
    const now = new Date();
    const existing = this.#reactions.get(key);
    this.#reactions.set(key, {
      id: existing?.id ?? crypto.randomUUID(),
      activityId,
      userId,
      reaction,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async getReactionsForActivity(
    activityId: string,
    viewerUserId: UserId,
    _options?: { readonly accessToken?: string },
  ): Promise<ActivityReactionsResult> {
    this.#requireActive(viewerUserId);
    const activity = this.#activities.get(activityId);
    if (!activity || activity.revokedAt) {
      throw new CommunityMutationError("unavailable");
    }
    const authorProfile = this.#profiles.get(activity.userId);
    if (!authorProfile || authorProfile.status !== "active") {
      throw new CommunityMutationError("unavailable");
    }

    const isAuthor = activity.userId === viewerUserId;
    if (!isAuthor) {
      if (this.#blocked(viewerUserId, activity.userId)) {
        throw new CommunityMutationError("unavailable");
      }
      const isApproved = [...this.#relationships.values()].some(
        (rel) =>
          rel.followerUserId === viewerUserId &&
          rel.targetUserId === activity.userId &&
          rel.status === "approved",
      );
      if (!isApproved) {
        throw new CommunityMutationError("unavailable");
      }
    }

    const { reactionCounts, viewerReaction } =
      this.#computeReactionCountsAndViewerReaction(activityId, viewerUserId);

    let reactors:
      | {
          userId: UserId;
          handle: string;
          displayName: string;
          avatarSymbol: string;
          reaction: CommunityReactionKind;
          createdAt: Date;
        }[]
      | undefined = undefined;

    if (isAuthor) {
      reactors = [];
      for (const react of this.#reactions.values()) {
        if (react.activityId !== activityId) continue;
        const reactorProfile = this.#profiles.get(react.userId);
        if (!reactorProfile || reactorProfile.status !== "active") continue;
        if (this.#blocked(viewerUserId, react.userId)) continue;
        const isApproved = [...this.#relationships.values()].some(
          (rel) =>
            rel.followerUserId === react.userId &&
            rel.targetUserId === activity.userId &&
            rel.status === "approved",
        );
        if (!isApproved) continue;

        reactors.push({
          userId: react.userId,
          handle: reactorProfile.handle,
          displayName: reactorProfile.displayName,
          avatarSymbol: reactorProfile.avatarSymbol,
          reaction: react.reaction,
          createdAt: react.createdAt,
        });
      }
      reactors.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }

    return {
      activityId,
      reactionCounts,
      viewerReaction,
      ...(reactors !== undefined ? { reactors } : {}),
    };
  }

  async getReactionsForActivities(
    activityIds: readonly string[],
    viewerUserId: UserId,
    _options?: { readonly accessToken?: string },
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
    for (const activityId of activityIds) {
      result.set(
        activityId,
        this.#computeReactionCountsAndViewerReaction(activityId, viewerUserId),
      );
    }
    return result;
  }

  async issueReportReceipt(
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
    _options?: { readonly accessToken?: string },
  ): Promise<string> {
    if (!this.#canReport(userId, targetType, targetId))
      throw new CommunityMutationError("unavailable");
    const id = crypto.randomUUID();
    this.#reportReceipts.set(id, {
      id,
      userId,
      targetType,
      targetId,
      expiresAt: new Date(Date.now() + 30 * 86400000),
    });
    return id;
  }
  async listReportReceipts(
    userId: UserId,
    _options?: { readonly accessToken?: string },
  ) {
    return [...this.#reportReceipts.values()]
      .filter((r) => r.userId === userId && r.expiresAt.getTime() > Date.now())
      .slice(-100)
      .map(({ id, targetType, targetId, expiresAt }) => ({
        id,
        targetType,
        targetId,
        expiresAt,
      }));
  }
  async getModerationNotices(
    userId: UserId,
    _options?: { readonly accessToken?: string },
  ) {
    return [...this.#reports.values()]
      .filter(
        (r) =>
          r.decision &&
          r.decision !== "dismiss" &&
          (r.targetType === "profile"
            ? r.targetId === userId
            : this.#activities.get(r.targetId)?.userId === userId),
      )
      .slice(-100);
  }

  async createReport(
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
    _options?: { readonly accessToken?: string },
  ): Promise<StoredCommunityReport> {
    const receipt = report.interactionReceiptId
      ? this.#reportReceipts.get(report.interactionReceiptId)
      : [...this.#reportReceipts.values()].find(
          (r) =>
            r.userId === reporterUserId &&
            r.targetType === report.targetType &&
            r.targetId === report.targetId &&
            r.expiresAt.getTime() > Date.now(),
        );
    if (
      report.interactionReceiptId
        ? !receipt ||
          receipt.userId !== reporterUserId ||
          receipt.targetType !== report.targetType ||
          receipt.targetId !== report.targetId ||
          receipt.expiresAt.getTime() <= Date.now()
        : !receipt &&
          !this.#canReport(reporterUserId, report.targetType, report.targetId)
    )
      throw new CommunityMutationError("unavailable");
    const duplicate = [...this.#reports.values()].find(
      (r) =>
        r.reporterUserId === reporterUserId &&
        r.targetType === report.targetType &&
        r.targetId === report.targetId &&
        r.reason === report.reason &&
        (r.status === "submitted" || r.status === "under_review"),
    );
    if (duplicate) {
      const updated = {
        ...duplicate,
        notes: report.notes ?? duplicate.notes,
        updatedAt: new Date(),
      };
      this.#reports.set(updated.id, updated);
      return updated;
    }
    this.#consumeReport(reporterUserId);
    const id = crypto.randomUUID();
    const now = new Date();
    const r: StoredCommunityReport = {
      id,
      reporterUserId,
      targetType: report.targetType,
      targetId: report.targetId,
      reason: report.reason,
      notes: report.notes ?? null,
      status: "submitted",
      priority:
        report.reason === "harassment" ||
        report.reason === "unsafe_or_sexual_content"
          ? "urgent"
          : "normal",
      assignedTo: null,
      decision: null,
      decisionReason: null,
      staffNotes: null,
      actionTakenAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.#reports.set(id, r);
    return r;
  }

  async getReportsByReporter(
    reporterUserId: UserId,
    _options?: { readonly accessToken?: string },
  ): Promise<readonly StoredCommunityReport[]> {
    return [...this.#reports.values()]
      .filter((r) => r.reporterUserId === reporterUserId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getReportById(
    reportId: string,
    _options?: { readonly accessToken?: string },
  ): Promise<StoredCommunityReport | null> {
    return this.#reports.get(reportId) ?? null;
  }

  async getModerationQueue(options?: {
    readonly accessToken?: string;
    readonly status?: "submitted" | "under_review" | "resolved" | "dismissed";
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<readonly StoredCommunityReport[]> {
    const list = [...this.#reports.values()].filter((r) =>
      options?.status
        ? r.status === options.status
        : r.status === "submitted" || r.status === "under_review",
    );
    return list
      .sort((a, b) => {
        if (a.priority === "urgent" && b.priority !== "urgent") return -1;
        if (b.priority === "urgent" && a.priority !== "urgent") return 1;
        return a.createdAt.getTime() - b.createdAt.getTime();
      })
      .slice(
        options?.offset ?? 0,
        (options?.offset ?? 0) + (options?.limit ?? 100),
      );
  }

  async claimModerationReport(
    reportId: string,
    options?: {
      readonly accessToken?: string;
      readonly staffOperator?: string;
    },
  ): Promise<StoredCommunityReport> {
    const r = this.#reports.get(reportId);
    const operator = options?.staffOperator;
    if (
      !r ||
      !operator ||
      r.decision ||
      (r.assignedTo && r.assignedTo !== operator)
    )
      throw new CommunityMutationError("conflict");
    const subject =
      r.targetType === "profile"
        ? r.targetId
        : this.#activities.get(r.targetId)?.userId;
    if (operator === r.reporterUserId || operator === subject)
      throw new CommunityMutationError("access_denied");
    const updated = {
      ...r,
      status: "under_review" as const,
      assignedTo: operator,
      updatedAt: new Date(),
    };
    this.#reports.set(reportId, updated);
    return updated;
  }
  async getModerationAppeals(options?: {
    readonly accessToken?: string;
    readonly limit?: number;
    readonly offset?: number;
  }) {
    return [...this.#appeals.values()]
      .filter((a) => a.status === "pending")
      .slice(
        options?.offset ?? 0,
        (options?.offset ?? 0) + (options?.limit ?? 100),
      );
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
    _options?: { readonly accessToken?: string },
  ): Promise<StoredCommunityReport> {
    const report = this.#reports.get(reportId);
    if (!report) throw new CommunityMutationError("unavailable");
    if (report.decision) throw new CommunityMutationError("conflict");
    if (report.assignedTo && report.assignedTo !== action.staffOperator)
      throw new CommunityMutationError("conflict");

    const subject =
      report.targetType === "profile"
        ? (report.targetId as UserId)
        : this.#activities.get(report.targetId)?.userId;
    if (
      (action.decision === "suspend" || action.decision === "ban") &&
      !subject
    )
      throw new CommunityMutationError("unavailable");
    if (
      subject === action.staffOperator ||
      report.reporterUserId === action.staffOperator
    )
      throw new CommunityMutationError("access_denied");
    if (
      action.decision === "suspend" &&
      ![7, 14, 30].includes(action.suspensionDurationDays ?? 0)
    )
      throw new CommunityMutationError("invalid_input");
    const now = new Date();
    const updated: StoredCommunityReport = {
      ...report,
      status: action.decision === "dismiss" ? "dismissed" : "resolved",
      decision: action.decision,
      decisionReason: action.decisionReason,
      staffNotes: action.staffNotes ?? null,
      actionTakenAt: now,
      suspensionExpiresAt:
        action.decision === "suspend"
          ? new Date(
              now.getTime() + (action.suspensionDurationDays ?? 7) * 86400000,
            )
          : null,
      assignedTo: action.staffOperator,
      updatedAt: now,
    };
    this.#reports.set(reportId, updated);

    // Apply enforcement side effects
    if (action.decision === "remove" && report.targetType === "activity") {
      const act = this.#activities.get(report.targetId);
      if (act) {
        this.#activities.set(report.targetId, {
          ...act,
          revokedAt: now,
        });
        this.#purgeReactions(report.targetId);
      }
    } else if (
      action.decision === "remove" &&
      report.targetType === "profile"
    ) {
      const prof = this.#profiles.get(report.targetId as UserId);
      if (prof)
        this.#profiles.set(prof.userId, {
          ...prof,
          displayName: "Member",
          bio: null,
          updatedAt: now,
        });
    } else if (action.decision === "suspend" || action.decision === "ban") {
      const targetUserId =
        report.targetType === "profile"
          ? (report.targetId as UserId)
          : this.#activities.get(report.targetId)?.userId;
      if (!targetUserId) throw new CommunityMutationError("unavailable");
      this.#sanctions.set(reportId, {
        userId: targetUserId,
        expiresAt:
          action.decision === "ban"
            ? null
            : new Date(
                now.getTime() + (action.suspensionDurationDays ?? 7) * 86400000,
              ),
        reversed: false,
      });
      const prof = this.#profiles.get(targetUserId);
      if (prof) {
        this.#profiles.set(targetUserId, {
          ...prof,
          status: "withdrawn",
          isSearchable: false,
          updatedAt: now,
        });
      }
      if (action.decision === "ban" || action.decision === "suspend") {
        for (const [id, act] of this.#activities) {
          if (act.userId === targetUserId) {
            this.#activities.set(id, {
              ...act,
              revokedAt: now,
            });
            this.#purgeReactions(id);
          }
        }
      }
    }

    return updated;
  }

  async createModerationAppeal(
    appellantUserId: UserId,
    appeal: {
      readonly reportId: string;
      readonly reason: string;
    },
    _options?: { readonly accessToken?: string },
  ): Promise<StoredModerationAppeal> {
    const report = this.#reports.get(appeal.reportId);
    const subject =
      report?.targetType === "profile"
        ? report.targetId
        : this.#activities.get(report?.targetId ?? "")?.userId;
    if (
      !report ||
      subject !== appellantUserId ||
      !report.decision ||
      report.decision === "dismiss"
    )
      throw new CommunityMutationError("unavailable");
    const existing = [...this.#appeals.values()].find(
      (a) =>
        a.reportId === appeal.reportId && a.appellantUserId === appellantUserId,
    );
    if (existing) return existing;
    const id = crypto.randomUUID();
    const now = new Date();
    const item: StoredModerationAppeal = {
      id,
      reportId: appeal.reportId,
      appellantUserId,
      reason: appeal.reason,
      status: "pending",
      reviewedBy: null,
      reviewerNotes: null,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.#appeals.set(id, item);
    return item;
  }

  async getAppealById(
    appealId: string,
    _options?: { readonly accessToken?: string },
  ): Promise<StoredModerationAppeal | null> {
    return this.#appeals.get(appealId) ?? null;
  }

  async resolveModerationAppeal(
    appealId: string,
    resolution: {
      readonly status: "approved" | "rejected";
      readonly reviewerNotes?: string | null;
      readonly reviewedBy: string;
    },
    _options?: { readonly accessToken?: string },
  ): Promise<StoredModerationAppeal> {
    const appeal = this.#appeals.get(appealId);
    if (!appeal) throw new CommunityMutationError("unavailable");
    const original = this.#reports.get(appeal.reportId);
    if (
      appeal.status !== "pending" ||
      original?.assignedTo === resolution.reviewedBy ||
      original?.reporterUserId === resolution.reviewedBy ||
      appeal.appellantUserId === resolution.reviewedBy
    )
      throw new CommunityMutationError("conflict");

    const now = new Date();
    const updated: StoredModerationAppeal = {
      ...appeal,
      status: resolution.status,
      reviewerNotes: resolution.reviewerNotes ?? null,
      reviewedBy: resolution.reviewedBy,
      resolvedAt: now,
      updatedAt: now,
    };
    this.#appeals.set(appealId, updated);

    if (resolution.status === "approved") {
      const sanction = this.#sanctions.get(appeal.reportId);
      if (sanction)
        this.#sanctions.set(appeal.reportId, { ...sanction, reversed: true });
      // Reversal never republishes cards or reenrolls an account. Fresh user intent is required.
    }

    return updated;
  }

  async hasRecentInteraction(
    userId: UserId,
    targetUserId: UserId,
    windowDays = 30,
    _options?: { readonly accessToken?: string },
  ): Promise<boolean> {
    const cutoff =
      Date.now() + (30 - Math.min(30, Math.max(1, windowDays))) * 86400000;
    return [...this.#reportReceipts.values()].some(
      (r) =>
        r.userId === userId &&
        r.targetType === "profile" &&
        r.targetId === targetUserId &&
        r.expiresAt.getTime() > cutoff,
    );
  }

  async deleteAllForUser(
    userId: UserId,
    _options?: { readonly accessToken?: string },
  ): Promise<number> {
    const profile = this.#profiles.get(userId);
    if (profile)
      this.#profiles.set(userId, {
        ...profile,
        status: profile.status === "suspended" ? "suspended" : "withdrawn",
        isSearchable: false,
        updatedAt: new Date(),
      });
    for (const [key, react] of this.#reactions.entries()) {
      if (
        react.userId === userId ||
        this.#activities.get(react.activityId)?.userId === userId
      ) {
        this.#reactions.delete(key);
      }
    }
    for (const [id, act] of this.#activities.entries()) {
      if (act.userId === userId) {
        this.#activities.delete(id);
      }
    }
    for (const [id, rel] of this.#relationships.entries()) {
      if (rel.followerUserId === userId || rel.targetUserId === userId) {
        this.#rememberPair(rel.followerUserId, rel.targetUserId);
        this.#relationships.delete(id);
      }
    }
    for (const [id, invitation] of this.#invitations)
      if (invitation.inviterUserId === userId) this.#invitations.delete(id);
    for (const [id, report] of this.#reports)
      if (report.reporterUserId === userId) this.#reports.delete(id);
    // Account deletion removes stable subjects externally. Retain sanction and
    // operation tombstones until then, so partial cleanup cannot revive access.
    return 1;
  }
}
