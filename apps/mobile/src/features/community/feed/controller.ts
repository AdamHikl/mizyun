import type { ApiClient } from "@mizyun/api-client";
import type { SharedActivityFeedItemDto } from "@mizyun/contracts";
import { scopeCommunityClient } from "../scoped-client";
import {
  fetchCommunityFeed,
  humanizeCommunityError,
} from "../community-client";

export interface FeedState {
  readonly items: readonly SharedActivityFeedItemDto[];
  readonly status: "idle" | "loading" | "refreshing" | "loading_more" | "error";
  readonly error: string | null;
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export const INITIAL_FEED_STATE: FeedState = {
  items: [],
  status: "idle",
  error: null,
  nextCursor: null,
  hasMore: false,
};

export class FeedController {
  readonly #rawClient: ApiClient;
  #principalKey: string | null;
  #isAlive: () => boolean;
  #state: FeedState = INITIAL_FEED_STATE;
  #listeners = new Set<() => void>();
  #revision = 0;

  constructor(
    client: ApiClient,
    principalKey: string | null,
    isAlive: () => boolean = () => true,
  ) {
    this.#rawClient = client;
    this.#principalKey = principalKey;
    this.#isAlive = isAlive;
  }

  getSnapshot = (): FeedState => this.#state;
  getState = (): FeedState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  #notify(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }

  reset(): void {
    this.#revision++;
    this.#state = INITIAL_FEED_STATE;
    this.#pages = 0;
    if (this.#isAlive()) {
      this.#notify();
    }
  }

  switchAccount(principalKey: string | null): void {
    this.#principalKey = principalKey;
    this.reset();
  }

  #active = true;
  #pages = 0;

  pause(): void {
    this.#active = false;
    this.reset();
    this.#notify();
  }

  resume(): void {
    this.#active = true;
  }

  async load(): Promise<void> {
    if (this.#state.status === "loading" || this.#state.status === "refreshing")
      return;
    await this.#readPages(1, "loading");
  }

  async refresh(): Promise<void> {
    if (this.#state.status === "refreshing") return;
    await this.#readPages(1, "refreshing");
  }

  async loadMore(): Promise<void> {
    if (this.#state.status !== "idle" || !this.#state.hasMore) return;
    // Re-read the visible prefix too: earlier cards may have been revoked remotely.
    await this.#readPages(this.#pages + 1, "loading_more");
  }

  async #readPages(pages: number, status: FeedState["status"]): Promise<void> {
    if (!this.#active || !this.#isAlive()) return;
    const revision = ++this.#revision;
    const isCurrent = () =>
      this.#active && this.#isAlive() && this.#revision === revision;
    const scoped = scopeCommunityClient(
      this.#rawClient,
      this.#principalKey,
      isCurrent,
    );
    // Health cards are unavailable while authority is being checked, including offline.
    this.#state = { ...INITIAL_FEED_STATE, status };
    this.#notify();
    const items: SharedActivityFeedItemDto[] = [];
    const ids = new Set<string>();
    let cursor: string | null = null;
    let loadedPages = 0;
    for (let page = 0; page < pages; page++) {
      const result = await fetchCommunityFeed(scoped, {
        limit: 20,
        ...(cursor ? { cursor } : {}),
      });
      if (!isCurrent()) return;
      if (!result.ok) {
        this.#state = {
          ...INITIAL_FEED_STATE,
          status: "error",
          error: humanizeCommunityError(result.error),
        };
        this.#notify();
        return;
      }
      loadedPages++;
      for (const item of result.value.items) {
        if (!ids.has(item.id)) {
          ids.add(item.id);
          items.push(item);
        }
      }
      cursor = result.value.nextCursor ?? null;
      if (!cursor) break;
    }
    this.#pages = loadedPages;
    this.#state = {
      items,
      nextCursor: cursor,
      hasMore: !!cursor,
      status: "idle",
      error: null,
    };
    this.#notify();
  }
}
