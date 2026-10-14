import type { ApiClient } from "@mizyun/api-client";
import {
  communityFeedResponseSchema,
  communityProfileDtoSchema,
  type CommunityFeedResponse,
  type CommunityProfileDto,
  type SharedActivityFeedItemDto,
} from "@mizyun/contracts";
import {
  getCommunityReadDeadline,
  getCommunityReadEpoch,
  peekCommunityRead,
  subscribeCommunityReadFills,
} from "../state/read-cache";
import { scopeCommunityClient } from "../scoped-client";
import {
  fetchCommunityFeed,
  humanizeCommunityError,
} from "../community-client";

export interface FeedState {
  readonly items: readonly SharedActivityFeedItemDto[];
  readonly status:
    "unloaded" | "idle" | "loading" | "refreshing" | "loading_more" | "error";
  readonly error: string | null;
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export const INITIAL_FEED_STATE: FeedState = {
  items: [],
  status: "unloaded",
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
  #readDeadline: number | undefined;
  #readEpoch = -1;
  #readDay = "";
  #accessToken: string | null;
  #startedRead = false;
  #stopFillSubscription: (() => void) | undefined;

  canRetainForNavigation(): boolean {
    return (
      this.#state.status === "idle" &&
      this.#readDeadline !== undefined &&
      this.#readDeadline > Date.now() &&
      this.#readEpoch === getCommunityReadEpoch() &&
      this.#readDay === new Date().toDateString()
    );
  }

  /** Retire requests and action authority, but keep a completed valid snapshot. */
  suspend(): void {
    this.#active = false;
    this.#revision++;
    if (!this.canRetainForNavigation()) this.reset();
  }

  constructor(
    client: ApiClient,
    principalKey: string | null,
    isAlive: () => boolean = () => true,
    accessToken?: string | null,
  ) {
    this.#rawClient = client;
    this.#principalKey = principalKey;
    this.#isAlive = isAlive;
    this.#accessToken = accessToken ?? null;
    this.#hydrateInitialSnapshot();
  }

  #hydrateInitialSnapshot(): boolean {
    const principalKey = this.#principalKey;
    const accessToken = this.#accessToken;
    const client = this.#rawClient;
    if (
      !this.#startedRead &&
      this.#state.status === "unloaded" &&
      this.#active &&
      principalKey &&
      accessToken &&
      this.#isAlive()
    ) {
      const principal = { user: { id: principalKey }, accessToken };
      const membership = peekCommunityRead<CommunityProfileDto>(
        client,
        {
          method: "GET",
          path: "/v1/community/profile",
          schema: communityProfileDtoSchema,
          expectedUserId: principalKey,
        },
        principal,
      );
      const retained =
        membership?.status === "active" && membership.userId === principalKey
          ? peekCommunityRead<CommunityFeedResponse>(
              client,
              {
                method: "GET",
                path: "/v1/community/feed?limit=20",
                schema: communityFeedResponseSchema,
                expectedUserId: principalKey,
              },
              principal,
            )
          : undefined;
      if (retained) {
        this.#startedRead = true;
        this.#readDeadline = Math.min(
          getCommunityReadDeadline(membership)!,
          getCommunityReadDeadline(retained)!,
        );
        this.#readEpoch = getCommunityReadEpoch();
        this.#readDay = new Date().toDateString();
        this.#pages = 1;
        this.#state = {
          items: retained.items,
          status: "idle",
          error: null,
          nextCursor: retained.nextCursor ?? null,
          hasMore: !!retained.nextCursor,
        };
        return true;
      }
    }
    return false;
  }

  getSnapshot = (): FeedState => {
    this.#hydrateInitialSnapshot();
    return this.#state;
  };
  getState = (): FeedState => this.getSnapshot();

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    if (!this.#stopFillSubscription) {
      this.#stopFillSubscription = subscribeCommunityReadFills(
        this.#rawClient,
        () => {
          if (this.#hydrateInitialSnapshot()) this.#notify();
        },
      );
    }
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) {
        this.#stopFillSubscription?.();
        this.#stopFillSubscription = undefined;
      }
    };
  };

  #notify(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }

  reset(): void {
    this.#revision++;
    this.#readDeadline = undefined;
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
    this.#startedRead = true;
    const revision = ++this.#revision;
    const readEpoch = getCommunityReadEpoch();
    let readDeadline: number | undefined;
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
      const pageDeadline = getCommunityReadDeadline(result.value);
      readDeadline =
        page === 0
          ? pageDeadline
          : readDeadline !== undefined && pageDeadline !== undefined
            ? Math.min(readDeadline, pageDeadline)
            : undefined;
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
    this.#readDeadline = readDeadline;
    this.#readEpoch = readEpoch;
    this.#readDay = new Date().toDateString();
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
