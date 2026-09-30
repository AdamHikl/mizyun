import type { ApiClient } from "@mizyun/api-client";
import { scopeCommunityClient } from "../scoped-client";
import { humanizeCommunityError } from "../community-client";
import {
  fetchCommunityInbox,
  readCommunityNotification,
  resolveCommunityNotification,
  type CommunityNotificationEvent,
  type CommunityNotificationDestination,
} from "./notification-client";

export interface InboxState {
  items: readonly CommunityNotificationEvent[];
  nextCursor: string | null;
  busy: boolean;
  error: string | null;
}
const empty = (): InboxState => ({
  items: [],
  nextCursor: null,
  busy: false,
  error: null,
});
/** In-memory only. A failed revalidation clears references and cursors. */
export class InboxController {
  private state = empty();
  private revision = 0;
  private active = true;
  private listeners = new Set<() => void>();
  constructor(
    private rawClient: ApiClient,
    private principal: string | null,
    private alive: () => boolean = () => true,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(state: InboxState) {
    this.state = state;
    if (this.alive()) for (const listener of this.listeners) listener();
  }
  pause() {
    this.active = false;
    this.reset();
  }
  resume() {
    this.active = true;
  }
  reset() {
    this.revision++;
    this.update(empty());
  }
  switchAccount(principal: string | null) {
    this.principal = principal;
    this.reset();
  }
  async load(more = false) {
    if (
      !this.active ||
      !this.alive() ||
      (more && (this.state.busy || !this.state.nextCursor))
    )
      return;
    const revision = ++this.revision;
    const valid = () =>
      this.active && this.alive() && this.revision === revision;
    const previous = more ? this.state.items : [];
    const cursor = more ? (this.state.nextCursor ?? undefined) : undefined;
    this.update({ items: previous, nextCursor: null, busy: true, error: null });
    const result = await fetchCommunityInbox(
      scopeCommunityClient(this.rawClient, this.principal, valid),
      cursor,
    );
    if (!valid()) return;
    if (!result.ok) {
      this.update({ ...empty(), error: humanizeCommunityError(result.error) });
      return;
    }
    const items = new Map(previous.map((item) => [item.id, item]));
    for (const item of result.value.items) items.set(item.id, item);
    this.update({
      items: [...items.values()],
      nextCursor: result.value.nextCursor,
      busy: false,
      error: null,
    });
  }
  async open(id: string): Promise<CommunityNotificationDestination | null> {
    if (!this.active || !this.alive() || this.state.busy) return null;
    const revision = ++this.revision;
    const valid = () =>
      this.active && this.alive() && this.revision === revision;
    const client = scopeCommunityClient(this.rawClient, this.principal, valid);
    this.update({ ...this.state, busy: true, error: null });
    // Never route from cached event target IDs: the server reauthorizes each tap.
    const result = await resolveCommunityNotification(client, id);
    if (!valid()) return null;
    if (!result.ok) {
      this.update({
        ...empty(),
        error: "This Community update is unavailable. Refresh your inbox.",
      });
      return null;
    }
    const read = await readCommunityNotification(client, id);
    if (!valid()) return null;
    this.update({
      ...this.state,
      busy: false,
      items: this.state.items.map((item) =>
        item.id === id && read.ok
          ? { ...item, readAt: read.value.readAt }
          : item,
      ),
      error: read.ok
        ? null
        : "Read status was not saved. You can retry after refreshing.",
    });
    return result.value;
  }
}
export function notificationDestinationPath(
  destination: CommunityNotificationDestination,
): string | null {
  if (destination.destination === "activity")
    return destination.targetId
      ? `/community/activity/${encodeURIComponent(destination.targetId)}`
      : null;
  return destination.destination === "relationships"
    ? "/community/relationships"
    : "/community/safety";
}
