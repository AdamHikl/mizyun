import type { ApiClient, ApiError } from "@mizyun/api-client";
import {
  communityMessagingResponseSchema,
  type CommunityMessagingResponse,
  type CommunityProfileViewDto,
  type SharedActivityFeedItemDto,
} from "@mizyun/contracts";
import type { Result } from "@mizyun/core";
import { randomUUID } from "expo-crypto";
import { scopeCommunityClient } from "../scoped-client";
import {
  COMMUNITY_READ_LIFETIME_MS,
  getCommunityReadEpoch,
  getCommunityReadDeadline,
  invalidateCommunityReads,
} from "../state/read-cache";
import {
  fetchCommunityProfileView,
  fetchCommunityProfileActivities,
  requestFollow,
  respondToFollowRequest,
  unfollowUser,
  removeFollower,
  blockUser,
  setUserMuted,
  humanizeCommunityError,
} from "../community-client";

export type ProfileAction =
  | "follow"
  | "approve"
  | "decline"
  | "cancel"
  | "unfollow"
  | "remove"
  | "block"
  | "mute";
export interface ProfileViewState {
  readonly profile: CommunityProfileViewDto | null;
  readonly activities: readonly SharedActivityFeedItemDto[];
  readonly nextCursor: string | null;
  readonly loading: boolean;
  readonly pending: boolean;
  readonly error: string | null;
  readonly activityError: string | null;
  readonly notice: string | null;
  readonly canMessage: boolean;
}
const EMPTY: ProfileViewState = {
  profile: null,
  activities: [],
  nextCursor: null,
  loading: false,
  pending: false,
  error: null,
  activityError: null,
  notice: null,
  canMessage: false,
};

/** Foreground-only target identity and caller-owned edges, retired within ten seconds. */
export class ProfileViewController {
  private state = EMPTY;
  private listeners = new Set<() => void>();
  private revision = 0;
  private active = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private deadline = 0;
  private epoch = -1;
  private pages = 1;
  private followOperation: string | undefined;
  constructor(
    private raw: ApiClient,
    private principal: string | null,
    private target: string,
    private isAlive: () => boolean = () => true,
  ) {}
  getState = (): ProfileViewState => (this.isAlive() ? this.state : EMPTY);
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<ProfileViewState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  captureIntent(): () => boolean {
    const revision = this.revision;
    return () =>
      this.active &&
      this.isAlive() &&
      revision === this.revision &&
      this.deadline > Date.now() &&
      this.epoch === getCommunityReadEpoch();
  }
  /** Receipt capture clears read cache but remains bound to its initially authorized target. */
  captureReceiptIntent(): () => boolean {
    const authorized = this.captureIntent()();
    const revision = this.revision;
    const deadline = this.deadline;
    return () =>
      authorized &&
      this.active &&
      this.isAlive() &&
      revision === this.revision &&
      Date.now() < deadline;
  }
  resume(): void {
    this.active = true;
  }
  pause(): void {
    this.active = false;
    this.revision++;
    clearTimeout(this.timer);
    this.deadline = 0;
    this.state = EMPTY;
    for (const listener of this.listeners) listener();
  }
  async load(more = false): Promise<void> {
    if (
      !this.active ||
      !this.isAlive() ||
      this.state.pending ||
      (more && !this.state.nextCursor)
    )
      return;
    const pages = more ? this.pages + 1 : 1;
    const revision = ++this.revision;
    let epoch = getCommunityReadEpoch();
    let deadline = Date.now() + COMMUNITY_READ_LIFETIME_MS;
    const armLoadingDeadline = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(
        () => {
          if (this.active && this.isAlive() && revision === this.revision) {
            this.revision++;
            this.deadline = 0;
            this.update({
              ...EMPTY,
              error: "Profile access timed out. Try again.",
            });
          }
        },
        Math.max(0, deadline - Date.now()),
      );
      if (typeof this.timer === "object")
        (this.timer as { unref?: () => void }).unref?.();
    };
    const bound = (value: unknown) => {
      deadline = Math.min(
        deadline,
        getCommunityReadDeadline(value) ?? deadline,
      );
      armLoadingDeadline();
    };
    clearTimeout(this.timer);
    const current = () =>
      this.active &&
      this.isAlive() &&
      revision === this.revision &&
      epoch === getCommunityReadEpoch() &&
      Date.now() < deadline;
    const client = scopeCommunityClient(this.raw, this.principal, current);
    this.update({ ...EMPTY, loading: true });
    armLoadingDeadline();
    const response = await fetchCommunityProfileView(client, this.target);
    if (!current()) {
      if (this.active && revision === this.revision) {
        clearTimeout(this.timer);
        this.update({
          ...EMPTY,
          error: response.ok
            ? "Community information changed. Try again."
            : humanizeCommunityError(response.error, "Profile unavailable."),
        });
      }
      return;
    }
    if (!response.ok) {
      clearTimeout(this.timer);
      this.update({
        ...EMPTY,
        error: humanizeCommunityError(response.error, "Profile unavailable."),
      });
      return;
    }
    bound(response.value);
    let profile = response.value;
    // The API client parses this schema in production; mocks cannot imply a complete graph.
    if (!profile.relationshipContext) {
      clearTimeout(this.timer);
      this.update({
        ...EMPTY,
        error: "Profile information is unavailable. Try again.",
      });
      return;
    }
    let canMessage = false;
    if (profile.relationshipWithViewer === "mutual") {
      const contacts = await client.request<CommunityMessagingResponse>({
        method: "POST",
        path: "/v1/community/messaging",
        body: { operation: "contacts" },
        schema: communityMessagingResponseSchema,
      });
      if (!current()) {
        // Optional messaging denial retires cached reads. Revalidate the identity
        // before showing it, without restarting the original authority deadline.
        if (!this.active || !this.isAlive() || revision !== this.revision)
          return;
        if (Date.now() >= deadline) {
          clearTimeout(this.timer);
          this.deadline = 0;
          this.update({
            ...EMPTY,
            error: "Profile access timed out. Try again.",
          });
          return;
        }
        epoch = getCommunityReadEpoch();
        const fresh = await fetchCommunityProfileView(client, this.target);
        if (!current() || !fresh.ok || !fresh.value.relationshipContext) {
          if (this.active && revision === this.revision)
            this.update({
              ...EMPTY,
              error: "Profile access changed. Try again.",
            });
          return;
        }
        bound(fresh.value);
        profile = fresh.value;
      }
      if (contacts.ok) bound(contacts.value);
      canMessage =
        profile.relationshipWithViewer === "mutual" &&
        contacts.ok &&
        !!contacts.value.contacts?.some(
          (contact) => contact.userId === this.target,
        );
    }
    const canRead =
      profile.relationshipWithViewer === "self" ||
      profile.relationshipContext.outgoing?.status === "approved";
    const items: SharedActivityFeedItemDto[] = [];
    let cursor: string | null = null;
    let activityError: string | null = null;
    let loadedPages = 0;
    if (canRead)
      for (let page = 0; page < pages; page++) {
        const result = await fetchCommunityProfileActivities(
          client,
          this.target,
          { limit: 20, ...(cursor ? { cursor } : {}) },
        );
        if (!current()) {
          if (this.active && revision === this.revision)
            this.update({
              ...EMPTY,
              error: "Profile access changed. Try again.",
            });
          return;
        }
        if (!result.ok) {
          activityError = humanizeCommunityError(
            result.error,
            "Shared activities unavailable.",
          );
          items.length = 0;
          cursor = null;
          break;
        }
        bound(result.value);
        loadedPages++;
        for (const item of result.value.items)
          if (!items.some((existing) => existing.id === item.id))
            items.push(item);
        cursor = result.value.nextCursor ?? null;
        if (!cursor) break;
      }
    if (!current()) {
      clearTimeout(this.timer);
      this.update({ ...EMPTY, error: "Profile access needs checking again." });
      return;
    }
    this.pages = loadedPages || 1;
    this.deadline = deadline;
    this.epoch = epoch;
    this.update({
      profile,
      activities: items,
      nextCursor: cursor,
      activityError,
      canMessage,
      loading: false,
    });
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        if (this.active && revision === this.revision) {
          this.revision++;
          this.deadline = 0;
          this.update({
            ...EMPTY,
            error: "Profile access needs checking again.",
          });
          void this.load();
        }
      },
      Math.max(0, deadline - Date.now()),
    );
    if (typeof this.timer === "object")
      (this.timer as { unref?: () => void }).unref?.();
  }
  async act(
    action: ProfileAction,
    displayed: CommunityProfileViewDto,
  ): Promise<void> {
    if (
      this.state.profile !== displayed ||
      this.state.pending ||
      this.state.loading ||
      !this.captureIntent()() ||
      displayed.relationshipWithViewer === "self"
    )
      return;
    const outgoing = displayed.relationshipContext.outgoing;
    const incoming = displayed.relationshipContext.incoming;
    if (
      (action === "follow" && outgoing) ||
      (["approve", "decline"].includes(action) &&
        incoming?.status !== "pending") ||
      (action === "cancel" && outgoing?.status !== "pending") ||
      (action === "unfollow" && outgoing?.status !== "approved") ||
      (action === "remove" && incoming?.status !== "approved")
    )
      return;
    const revision = ++this.revision;
    const current = () =>
      this.active && this.isAlive() && revision === this.revision;
    const client = scopeCommunityClient(this.raw, this.principal, current);
    clearTimeout(this.timer);
    this.deadline = 0;
    this.update({ ...EMPTY, pending: true });
    let result: Result<unknown, ApiError>;
    if (action === "follow") {
      this.followOperation ??= randomUUID();
      result = await requestFollow(
        client,
        this.target,
        undefined,
        this.followOperation,
      );
    } else if (action === "approve" || action === "decline")
      result = await respondToFollowRequest(client, incoming!.id, action);
    else if (action === "cancel")
      result = await respondToFollowRequest(client, outgoing!.id, action);
    else if (action === "unfollow")
      result = await unfollowUser(client, this.target, outgoing!.id);
    else if (action === "remove")
      result = await removeFollower(client, this.target, incoming!.id);
    else if (action === "block") result = await blockUser(client, this.target);
    else result = await setUserMuted(client, this.target, true);
    if (!current()) return;
    invalidateCommunityReads();
    this.update({ pending: false });
    if (!result.ok) {
      this.update({
        error: humanizeCommunityError(
          result.error,
          "Could not confirm this action. Refresh and try again.",
        ),
      });
      return;
    }
    if (action === "follow") this.followOperation = undefined;
    await this.load();
    if (this.active)
      this.update({
        notice:
          action === "approve"
            ? "Follower approved. Following them back requires a separate request."
            : action === "follow"
              ? "Follow request checked. Their approval is required."
              : "Saved.",
      });
  }
}
