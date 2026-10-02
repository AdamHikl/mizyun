import type { ApiClient, ApiError } from "@mizyun/api-client";
import type { Result } from "@mizyun/core";
import type { CommunityComment, CommunityCommentPage } from "@mizyun/contracts";
import { scopeCommunityClient } from "../scoped-client";
import { humanizeCommunityError } from "../community-client";
import {
  fetchCommentPage,
  fetchCommentCandidates,
  fetchCommentPreferences,
  fetchCommentMentions,
  saveComment,
  removeComment,
  saveCommentPreferences,
  reportComment,
} from "./client";
import { communityCommentSettingsSchema } from "@mizyun/contracts";
import {
  getCommunityReadDeadline,
  invalidateCommunityReads,
} from "../state/read-cache";

interface CommentState extends CommunityCommentPage {
  privacyRevision: number;
  busy: boolean;
  error: string | null;
  notice: string | null;
  candidates: readonly CommunityComment["author"][];
  mentions: readonly {
    id: string;
    activityId: string;
    commentId: string;
    createdAt: string;
  }[];
}
const empty = (): CommentState => ({
  privacyRevision: 0,
  items: [],
  nextCursor: null,
  enabled: false,
  canManage: false,
  allowMentions: false,
  busy: false,
  error: null,
  notice: null,
  candidates: [],
  mentions: [],
});
export const COMMENT_AUTHORITY_LIFETIME_MS = 10_000;
/** Memory-only. No persisted social text, offline queue or automatic mutation replay. */
export class CommentsController {
  private state = empty();
  private revision = 0;
  private active = true;
  private pages = 1;
  private privacyRevision = 0;
  private leaseRevision = 0;
  private expiresAt: number | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  constructor(
    private raw: ApiClient,
    private principal: string | null,
    private activityId: string | null,
    private alive: () => boolean = () => true,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(state: CommentState) {
    this.state = { ...state, privacyRevision: this.privacyRevision };
    if (this.alive()) for (const listener of this.listeners) listener();
  }
  private clearExpiry() {
    if (this.expiryTimer !== undefined) clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    this.expiresAt = null;
    this.leaseRevision++;
  }
  private beginReadLease(
    expiresAt = Date.now() + COMMENT_AUTHORITY_LIFETIME_MS,
  ) {
    this.clearExpiry();
    this.expiresAt = expiresAt;
    const lease = this.leaseRevision;
    this.expiryTimer = setTimeout(
      () => {
        if (lease === this.leaseRevision) this.expire();
      },
      Math.max(0, expiresAt - Date.now()),
    );
    // Node-only test/runtime timer housekeeping; native timers are numeric.
    if (typeof this.expiryTimer === "object") this.expiryTimer.unref?.();
  }
  private consumeDeadline(value: unknown): boolean {
    const deadline = Math.min(
      this.expiresAt ?? Infinity,
      getCommunityReadDeadline(value) ?? Infinity,
    );
    if (Date.now() >= deadline) {
      this.expire();
      return false;
    }
    if (deadline !== this.expiresAt) this.beginReadLease(deadline);
    return true;
  }
  refresh() {
    invalidateCommunityReads();
    return this.load();
  }
  private expire() {
    const wasBusy = this.state.busy;
    this.clearExpiry();
    this.revision++;
    this.privacyRevision++;
    this.pages = 1;
    this.update({
      ...empty(),
      error: "Comments need a fresh check. Refresh before interacting.",
    });
    // Renew idle foreground content only after hiding the expired snapshot.
    // A stalled read/mutation stays retired; never retry a mutation silently.
    if (!wasBusy && this.active && this.alive()) void this.load();
  }
  pause() {
    this.clearExpiry();
    this.active = false;
    this.revision++;
    this.privacyRevision++;
    this.pages = 1;
    this.update(empty());
  }
  resume() {
    this.active = true;
  }
  switchAccount(principal: string | null) {
    this.clearExpiry();
    this.principal = principal;
    this.revision++;
    this.privacyRevision++;
    this.pages = 1;
    this.update(empty());
  }
  private scope(revision: number) {
    const current = () =>
      this.active &&
      this.alive() &&
      this.revision === revision &&
      (this.expiresAt === null || Date.now() < this.expiresAt);
    return {
      current,
      client: scopeCommunityClient(this.raw, this.principal, current),
    };
  }
  async load(more = false) {
    if (this.expiresAt !== null && Date.now() >= this.expiresAt) this.expire();
    if (
      !this.active ||
      !this.alive() ||
      this.state.busy ||
      !this.principal ||
      (more && (!this.state.nextCursor || this.pages >= 25))
    )
      return;
    const revision = ++this.revision;
    const { current, client } = this.scope(revision);
    const targetPages = more ? this.pages + 1 : 1;
    this.update({ ...empty(), busy: true });
    this.beginReadLease();
    if (!this.activityId) {
      const [inbox, preferences] = await Promise.all([
        fetchCommentMentions(client),
        fetchCommentPreferences(client),
      ]);
      if (!current()) return;
      if (!inbox.ok || !preferences.ok) {
        this.clearExpiry();
        this.update({
          ...empty(),
          error:
            "Comment updates are unavailable. Your private tracking stays available.",
        });
        return;
      }
      if (
        !this.consumeDeadline(inbox.value) ||
        !this.consumeDeadline(preferences.value)
      )
        return;
      this.update({
        ...empty(),
        mentions: inbox.value.items,
        allowMentions: preferences.value.allowMentions,
      });
      return;
    }
    const candidatesRead = fetchCommentCandidates(client, this.activityId).then(
      (response) => {
        if (current() && response.ok) this.consumeDeadline(response.value);
        return response;
      },
    );
    let cursor: string | undefined;
    let page: CommunityCommentPage | undefined;
    const items = new Map<string, CommunityComment>();
    // Reauthorize the entire displayed prefix before pagination. Never append
    // new text to an old page whose author/block/source authority may be gone.
    for (let index = 0; index < targetPages; index++) {
      const result = await fetchCommentPage(client, this.activityId, cursor);
      if (!current()) return;
      if (!result.ok) {
        // Retire the concurrently pending candidates check with this failed read.
        this.revision++;
        this.clearExpiry();
        this.update({
          ...empty(),
          error: humanizeCommunityError(result.error),
        });
        return;
      }
      if (!this.consumeDeadline(result.value)) return;
      page = result.value;
      for (const item of page.items) items.set(item.id, item);
      cursor = page.nextCursor ?? undefined;
      if (!cursor) break;
    }
    const candidates = await candidatesRead;
    if (!current()) return;
    if (!candidates.ok || !page) {
      this.clearExpiry();
      this.update({
        ...empty(),
        error: "Comments could not be checked. Refresh before interacting.",
      });
      return;
    }
    this.pages = targetPages;
    this.update({
      ...empty(),
      ...page,
      items: [...items.values()],
      candidates: candidates.value.items,
    });
  }
  private async mutate(
    action: (client: ApiClient) => Promise<Result<unknown, ApiError>>,
    notice: string,
  ): Promise<boolean> {
    if (this.expiresAt !== null && Date.now() >= this.expiresAt) {
      this.expire();
      return false;
    }
    if (!this.active || !this.alive() || !this.principal || this.state.busy)
      return false;
    const revision = ++this.revision;
    const principal = this.principal;
    const { current, client } = this.scope(revision);
    this.update({ ...this.state, busy: true, error: null, notice: null });
    const result = await action(client);
    if (!current()) return false;
    if (!result.ok) {
      this.clearExpiry();
      this.update({
        ...empty(),
        error: `${humanizeCommunityError(result.error)} This action was not confirmed; refresh or explicitly retry the same choice.`,
      });
      return false;
    }
    this.update({ ...empty(), notice });
    const refreshedRevision = this.revision + 1;
    await this.load();
    if (
      !this.active ||
      !this.alive() ||
      this.principal !== principal ||
      this.revision !== refreshedRevision
    )
      return false;
    this.update({ ...this.state, notice });
    return true;
  }
  submit(input: Parameters<typeof saveComment>[2]) {
    if (!this.activityId || !this.state.enabled) return Promise.resolve(false);
    return this.mutate(
      (client) => saveComment(client, this.activityId!, input),
      "Comment saved.",
    );
  }
  remove(id: string, version: number) {
    const item = this.state.items.find(
      (comment) => comment.id === id && comment.version === version,
    );
    if (
      !item ||
      (item.author.userId !== this.principal && !this.state.canManage)
    )
      return Promise.resolve(false);
    return this.mutate(
      (client) => removeComment(client, id, version),
      "Comment removed.",
    );
  }
  report(id: string, reason: string) {
    if (
      !this.state.items.some(
        (comment) =>
          comment.id === id && comment.author.userId !== this.principal,
      )
    )
      return Promise.resolve(false);
    return this.mutate(
      (client) => reportComment(client, id, reason),
      "Report saved. Community safety has your report.",
    );
  }
  preferences(allowMentions: boolean) {
    return this.mutate(
      (client) => saveCommentPreferences(client, allowMentions),
      allowMentions ? "Mention updates enabled." : "Mention updates stopped.",
    );
  }
  settings(enabled: boolean) {
    if (!this.activityId || (enabled && !this.state.canManage))
      return Promise.resolve(false);
    return this.mutate(
      (client) =>
        client.request({
          method: "PUT",
          path: `/v1/community/activities/${encodeURIComponent(this.activityId!)}/comments/settings`,
          body: { enabled },
          schema: communityCommentSettingsSchema,
        }),
      enabled
        ? "Comments opened for this workout."
        : "Comments closed for this workout.",
    );
  }
}
