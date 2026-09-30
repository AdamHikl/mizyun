import type { CommunityReactionKind } from "@mizyun/contracts";
import type { ScopedCommunityClient } from "../community-client";
import {
  humanizeCommunityError,
  setActivityReaction,
} from "../community-client";
import {
  computeOptimisticReaction,
  defaultReactionCounts,
  getTotalReactionCount,
} from "./reaction-state";

export interface ReactionBarState {
  readonly viewerReaction: CommunityReactionKind | null;
  readonly reactionCounts: Record<CommunityReactionKind, number>;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly isModalOpen: boolean;
}

export interface ReactionBarControllerOptions {
  readonly activityId: string;
  readonly authorUserId: string;
  readonly viewerUserId: string;
  readonly initialReactionCounts?:
    | Partial<Record<CommunityReactionKind, number>>
    | Record<CommunityReactionKind, number>;
  readonly initialViewerReaction: CommunityReactionKind | null;
  readonly scopedClient?: ScopedCommunityClient;
  readonly onReactionChanged?: (
    newViewerReaction: CommunityReactionKind | null,
    newCounts: Record<CommunityReactionKind, number>,
  ) => void;
  readonly disabled?: boolean;
  readonly onUnavailable?: () => void;
}

export class ReactionBarController {
  #revision = 0;
  #active = true;
  #options: ReactionBarControllerOptions;
  #state: ReactionBarState;
  #listeners = new Set<(state: ReactionBarState) => void>();

  constructor(options: ReactionBarControllerOptions) {
    this.#options = options;
    this.#state = {
      viewerReaction: options.initialViewerReaction,
      reactionCounts: {
        ...defaultReactionCounts(),
        ...options.initialReactionCounts,
      },
      isPending: false,
      error: null,
      isModalOpen: false,
    };
  }

  get state(): ReactionBarState {
    return this.#state;
  }

  get isAuthor(): boolean {
    return this.#options.viewerUserId === this.#options.authorUserId;
  }

  get totalReactions(): number {
    return getTotalReactionCount(this.#state.reactionCounts);
  }

  updateOptions(options: ReactionBarControllerOptions): void {
    const activityChanged =
      this.#options.activityId !== options.activityId ||
      this.#options.viewerUserId !== options.viewerUserId ||
      this.#options.authorUserId !== options.authorUserId;
    this.#options = options;
    if (activityChanged) {
      this.#revision++;
      this.#state = {
        viewerReaction: options.initialViewerReaction,
        reactionCounts: {
          ...defaultReactionCounts(),
          ...options.initialReactionCounts,
        },
        isPending: false,
        error: null,
        isModalOpen: false,
      };
      this.#notify();
    }
  }

  retire(): void {
    this.#revision++;
    this.#active = false;
  }

  resume(): void {
    this.#active = true;
  }

  subscribe(listener: (state: ReactionBarState) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  openReactorsModal(): void {
    this.#state = { ...this.#state, isModalOpen: true };
    this.#notify();
  }

  closeReactorsModal(): void {
    this.#state = { ...this.#state, isModalOpen: false };
    this.#notify();
  }

  async toggleReaction(kind: CommunityReactionKind): Promise<boolean> {
    if (!this.#active || this.#options.disabled) {
      return false;
    }

    // Author cannot react to own workout
    if (this.isAuthor) {
      if (this.totalReactions > 0) {
        this.openReactorsModal();
      }
      return false;
    }

    // In-flight request protection / rapid tap defense: drop subsequent taps while pending
    if (this.#state.isPending) {
      return false;
    }

    const revision = this.#revision;
    const prevReaction = this.#state.viewerReaction;
    const prevCounts = { ...this.#state.reactionCounts };

    // Compute optimistic state
    const optimistic = computeOptimisticReaction(
      prevReaction,
      prevCounts,
      kind,
    );

    // Apply optimistic updates immediately
    this.#state = {
      ...this.#state,
      viewerReaction: optimistic.viewerReaction,
      reactionCounts: optimistic.reactionCounts,
      error: null,
      isPending: !!this.#options.scopedClient,
    };
    this.#notify();
    this.#options.onReactionChanged?.(
      optimistic.viewerReaction,
      optimistic.reactionCounts,
    );

    if (!this.#options.scopedClient) {
      return true;
    }

    try {
      const res = await setActivityReaction(
        this.#options.scopedClient,
        this.#options.activityId,
        optimistic.viewerReaction,
      );

      if (revision !== this.#revision) return false;
      if (res.ok) {
        this.#state = {
          ...this.#state,
          viewerReaction: res.value.viewerReaction,
          reactionCounts: {
            ...defaultReactionCounts(),
            ...res.value.reactionCounts,
          },
          isPending: false,
        };
        this.#notify();
        this.#options.onReactionChanged?.(
          res.value.viewerReaction,
          this.#state.reactionCounts,
        );
        return true;
      }

      if (
        res.error.kind === "no_session" ||
        res.error.kind === "session_expired" ||
        (res.error.kind === "http_error" &&
          [401, 403, 404].includes(res.error.status))
      ) {
        this.retire();
        this.#state = {
          viewerReaction: null,
          reactionCounts: defaultReactionCounts(),
          isPending: false,
          isModalOpen: false,
          error: "This activity is unavailable until access is checked again.",
        };
        this.#notify();
        this.#options.onUnavailable?.();
        return false;
      }

      // Rollback on failure
      this.#state = {
        ...this.#state,
        viewerReaction: prevReaction,
        reactionCounts: prevCounts,
        isPending: false,
        error: humanizeCommunityError(res.error, "Could not update reaction."),
      };
      this.#notify();
      this.#options.onReactionChanged?.(prevReaction, prevCounts);
      return false;
    } catch {
      if (revision !== this.#revision) return false;
      // Rollback on unexpected error
      this.#state = {
        ...this.#state,
        viewerReaction: prevReaction,
        reactionCounts: prevCounts,
        isPending: false,
        error: "Network error. Could not update reaction.",
      };
      this.#notify();
      this.#options.onReactionChanged?.(prevReaction, prevCounts);
      return false;
    }
  }

  #notify(): void {
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}
