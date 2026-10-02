import type { ApiClient, ApiError } from "@mizyun/api-client";
import type { PublicCommunityProfileDto } from "@mizyun/contracts";
import type { Result } from "@mizyun/core";
import { randomUUID } from "expo-crypto";
import { scopeCommunityClient } from "../scoped-client";
import {
  fetchFollowers,
  fetchFollowing,
  fetchIncomingFollowRequests,
  fetchOutgoingFollowRequests,
  fetchBlockedUsers,
  fetchMutedUsers,
  respondToFollowRequest,
  requestFollow,
  unfollowUser,
  removeFollower,
  blockUser,
  unblockUser,
  setUserMuted,
  humanizeCommunityError,
} from "../community-client";

export type RelationshipList =
  "incoming" | "outgoing" | "followers" | "following" | "blocked" | "muted";
export type RelationshipAction =
  | "follow"
  | "approve"
  | "decline"
  | "cancel"
  | "unfollow"
  | "remove"
  | "block"
  | "unblock"
  | "mute"
  | "unmute";
export interface RelationshipRow {
  readonly user: PublicCommunityProfileDto;
  readonly relationshipId?: string;
  readonly outgoingFollowStatus?: "none" | "pending" | "approved";
}
export interface RelationshipState {
  readonly list: RelationshipList;
  readonly rows: readonly RelationshipRow[];
  readonly cursor: string | null;
  readonly loading: boolean;
  readonly pending: boolean;
  readonly error: string | null;
  readonly notice: string | null;
}

/** Memory-only owner graph. Retiring a controller invalidates reads and mutations. */
export class RelationshipsController {
  private state: RelationshipState = {
    list: "incoming",
    rows: [],
    cursor: null,
    loading: false,
    pending: false,
    error: null,
    notice: null,
  };
  private listeners = new Set<() => void>();
  private active = true;
  private revision = 0;
  private client: ApiClient;
  constructor(
    client: ApiClient,
    principalKey: string | null,
    isCurrent: () => boolean = () => true,
    initialList: RelationshipList = "incoming",
  ) {
    this.state = { ...this.state, list: initialList };
    const scoped = scopeCommunityClient(
      client,
      principalKey,
      () => this.active && isCurrent(),
    );
    this.client = {
      status: () => scoped.status(),
      request: (options) => {
        const revision = this.revision;
        return scoped.request({
          ...options,
          isCurrent: () =>
            this.active &&
            revision === this.revision &&
            (options.isCurrent?.() ?? true),
        });
      },
    };
  }
  getState = (): RelationshipState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  captureIntent(): () => boolean {
    const revision = this.revision;
    return () => this.active && revision === this.revision;
  }
  resume(): void {
    this.active = true;
  }
  pause(): void {
    this.revision++;
    this.update({
      rows: [],
      cursor: null,
      loading: false,
      pending: false,
      error: null,
      notice: null,
    });
    this.active = false;
  }
  destroy(): void {
    this.active = false;
    this.revision++;
    this.listeners.clear();
    this.state = { ...this.state, rows: [], cursor: null };
  }
  private update(patch: Partial<RelationshipState>): void {
    if (!this.active) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  async load(
    list: RelationshipList = this.state.list,
    more = false,
  ): Promise<void> {
    if (
      !this.active ||
      this.state.pending ||
      (more && (this.state.loading || !this.state.cursor))
    )
      return;
    const revision = ++this.revision;
    let oldRows = more ? this.state.rows : [];
    const page = {
      limit: 20,
      ...(more && this.state.cursor ? { cursor: this.state.cursor } : {}),
    };
    this.update({
      list,
      rows: oldRows,
      cursor: more ? this.state.cursor : null,
      loading: true,
      error: null,
    });
    let result: Result<
      { items: RelationshipRow[]; nextCursor?: string | null },
      ApiError
    >;
    if (list === "blocked") {
      const response = await fetchBlockedUsers(this.client, page);
      result = response.ok
        ? {
            ok: true,
            value: {
              items: response.value.items.map((item) => ({
                user: item.blockedUser,
              })),
              nextCursor: response.value.nextCursor,
            },
          }
        : response;
    } else if (list === "muted") {
      const response = await fetchMutedUsers(this.client, page);
      result = response.ok
        ? {
            ok: true,
            value: {
              items: response.value.items.map((item) => ({ user: item.user })),
              nextCursor: response.value.nextCursor,
            },
          }
        : response;
    } else {
      const loaders = {
        incoming: fetchIncomingFollowRequests,
        outgoing: fetchOutgoingFollowRequests,
        followers: fetchFollowers,
        following: fetchFollowing,
      };
      result = await loaders[list](this.client, page);
      if (list === "followers" && result.ok) {
        // Owner graph caps are 30 approved and 20 outgoing pending. Read both
        // completely before offering a new request; an unavailable state fails closed.
        const [following, outgoing] = await Promise.all([
          fetchFollowing(this.client, { limit: 50 }),
          fetchOutgoingFollowRequests(this.client, { limit: 50 }),
        ]);
        if (!following.ok) result = following;
        else if (!outgoing.ok) result = outgoing;
        else if (following.value.nextCursor || outgoing.value.nextCursor)
          result = { ok: false, error: { kind: "network_error", cause: null } };
        else {
          const approved = new Set(
            following.value.items.map((item) => item.user.userId),
          );
          const pending = new Set(
            outgoing.value.items.map((item) => item.user.userId),
          );
          result = {
            ok: true,
            value: {
              ...result.value,
              items: result.value.items.map((item) => ({
                ...item,
                outgoingFollowStatus: approved.has(item.user.userId)
                  ? "approved"
                  : pending.has(item.user.userId)
                    ? "pending"
                    : "none",
              })),
            },
          };
          // Refresh reverse states on previously loaded pages too.
          oldRows = oldRows.map((item) => ({
            ...item,
            outgoingFollowStatus: approved.has(item.user.userId)
              ? "approved"
              : pending.has(item.user.userId)
                ? "pending"
                : "none",
          }));
        }
      }
    }
    if (!this.active || revision !== this.revision) return;
    if (!result.ok) {
      this.update({
        loading: false,
        rows: [],
        cursor: null,
        error: humanizeCommunityError(
          result.error,
          "Could not load your friends. Try again.",
        ),
      });
      return;
    }
    const rows = new Map(oldRows.map((row) => [row.user.userId, row]));
    for (const row of result.value.items) rows.set(row.user.userId, row);
    this.update({
      loading: false,
      rows: [...rows.values()],
      cursor: result.value.nextCursor ?? null,
    });
  }
  async act(action: RelationshipAction, row: RelationshipRow): Promise<void> {
    if (
      !this.active ||
      this.state.pending ||
      this.state.loading ||
      !this.state.rows.some(
        (item) =>
          item.user.userId === row.user.userId &&
          item.relationshipId === row.relationshipId,
      )
    )
      return;
    if (
      action === "follow" &&
      (this.state.list !== "followers" ||
        !this.state.rows.some(
          (item) =>
            item.user.userId === row.user.userId &&
            item.outgoingFollowStatus === "none",
        ))
    )
      return;
    const revision = ++this.revision;
    const list = this.state.list;
    this.update({ pending: true, error: null, notice: null });
    let result: Result<unknown, ApiError>;
    if (action === "follow") {
      result = await requestFollow(
        this.client,
        row.user.userId,
        undefined,
        randomUUID(),
      );
    } else if (
      action === "approve" ||
      action === "decline" ||
      action === "cancel"
    ) {
      if (!row.relationshipId) {
        this.update({
          pending: false,
          error: "Refresh this request before responding.",
        });
        return;
      }
      result = await respondToFollowRequest(
        this.client,
        row.relationshipId,
        action,
      );
    } else if (action === "unfollow" || action === "remove") {
      if (!row.relationshipId) {
        this.update({
          pending: false,
          error: "Refresh this relationship before removing it.",
        });
        return;
      }
      result =
        action === "unfollow"
          ? await unfollowUser(this.client, row.user.userId, row.relationshipId)
          : await removeFollower(
              this.client,
              row.user.userId,
              row.relationshipId,
            );
    } else if (action === "block")
      result = await blockUser(this.client, row.user.userId);
    else if (action === "unblock")
      result = await unblockUser(this.client, row.user.userId);
    else
      result = await setUserMuted(
        this.client,
        row.user.userId,
        action === "mute",
      );
    if (!this.active || revision !== this.revision) return;
    if (!result.ok) {
      this.update({
        pending: false,
        rows: [],
        cursor: null,
        error: humanizeCommunityError(
          result.error,
          "Could not save. Refresh and try again.",
        ),
      });
      return;
    }
    this.update({
      pending: false,
      notice:
        action === "follow"
          ? (result.value as { status: string }).status === "approved"
            ? "You already follow this friend."
            : (result.value as { status: string }).status === "pending"
              ? "Request sent. Your friend must approve before you can see their shared workouts."
              : "This request ended. Refresh before trying again."
          : action === "approve"
            ? "Follower approved. Following them back requires a separate request."
            : action === "unblock"
              ? "Unblocked. Previous follows and requests were not restored."
              : action === "mute"
                ? "Muted. Your follow and their access are unchanged."
                : action === "unmute"
                  ? "Unmuted."
                  : "Saved.",
    });
    await this.load(list);
  }
}
