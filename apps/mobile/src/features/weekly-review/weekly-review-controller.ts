import type { ApiClient } from "@mizyun/api-client";
import type { CalorieAdjustmentDecision } from "@mizyun/contracts";

import {
  decideWeeklyReview,
  fetchLiveTargetKcal,
  fetchWeeklyReview,
  isPendingProposal,
  type WeeklyReviewSnapshot,
} from "./weekly-review-data";

export type WeeklyReviewPhase = "loading" | "ready" | "error";

export interface WeeklyReviewState {
  readonly phase: WeeklyReviewPhase;
  readonly snapshot: WeeklyReviewSnapshot | null;
  /** Decision currently being submitted; null when idle. */
  readonly submitting: CalorieAdjustmentDecision["decision"] | null;
  /** Current daily target from the live energy summary, when known. */
  readonly liveTargetKcal: number | null;
  /** Accessible, user-facing error or notice text. */
  readonly message: string | null;
  /** Set once this controller saw the user's own decision succeed. */
  readonly outcome: CalorieAdjustmentDecision["decision"] | null;
}

export interface WeeklyReviewControllerDeps {
  readonly client: ApiClient;
  readonly userId: string;
  readonly utcOffsetMinutes: () => number;
  /** False once the owning screen or account is retired. */
  readonly isCurrent: () => boolean;
  /** Called after an accepted/declined decision so callers can refresh. */
  readonly onDecided?: (
    decision: CalorieAdjustmentDecision["decision"],
  ) => void;
}

export const MESSAGES = {
  loadFailed: "The weekly check-in could not be loaded. Try again.",
  uncertain:
    "We could not confirm your choice and it may not have been saved. Showing the latest state.",
  failed: "Your choice could not be saved. Try again.",
  stale:
    "This check-in changed since you opened it. Here is the current state.",
} as const;

/**
 * Framework-free state holder for the weekly review. A single in-flight
 * decision is enforced synchronously so a double tap cannot submit twice.
 */
export class WeeklyReviewController {
  private current: WeeklyReviewState = {
    phase: "loading",
    snapshot: null,
    submitting: null,
    liveTargetKcal: null,
    message: null,
    outcome: null,
  };
  private readonly listeners = new Set<() => void>();
  private inFlight = false;
  private loadSeq = 0;

  constructor(private readonly deps: WeeklyReviewControllerDeps) {}

  get userId(): string {
    return this.deps.userId;
  }

  get state(): WeeklyReviewState {
    return this.current;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<WeeklyReviewState>): void {
    this.current = { ...this.current, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  async load(options: { readonly keepMessage?: boolean } = {}): Promise<void> {
    const seq = ++this.loadSeq;
    if (this.current.snapshot === null) this.set({ phase: "loading" });
    const result = await fetchWeeklyReview(
      this.deps.client,
      this.deps.utcOffsetMinutes(),
      {
        expectedUserId: this.deps.userId,
        isCurrent: this.deps.isCurrent,
      },
    );
    if (seq !== this.loadSeq || !this.deps.isCurrent()) return;
    if (result.kind === "error") {
      this.set({
        phase: this.current.snapshot === null ? "error" : "ready",
        message: MESSAGES.loadFailed,
      });
      return;
    }
    this.set({
      phase: "ready",
      snapshot: result.snapshot,
      ...(options.keepMessage ? {} : { message: null }),
    });
    if (isPendingProposal(result.snapshot.proposal)) {
      const live = await fetchLiveTargetKcal(
        this.deps.client,
        this.deps.utcOffsetMinutes(),
        { expectedUserId: this.deps.userId, isCurrent: this.deps.isCurrent },
      );
      if (seq === this.loadSeq && this.deps.isCurrent()) {
        this.set({ liveTargetKcal: live });
      }
    }
  }

  async decide(decision: CalorieAdjustmentDecision["decision"]): Promise<void> {
    const proposal = this.current.snapshot?.proposal ?? null;
    if (this.inFlight || !isPendingProposal(proposal)) return;
    this.inFlight = true;
    this.set({ submitting: decision, message: null });
    try {
      const result = await decideWeeklyReview(
        this.deps.client,
        proposal.id,
        decision,
        {
          expectedUserId: this.deps.userId,
          isCurrent: this.deps.isCurrent,
        },
      );
      if (!this.deps.isCurrent()) return;
      switch (result.kind) {
        case "decided": {
          const snapshot = this.current.snapshot;
          this.set({
            snapshot: {
              review: snapshot?.review ?? result.proposal.review,
              proposal: result.proposal,
            },
            outcome: decision,
            message: null,
          });
          this.deps.onDecided?.(decision);
          return;
        }
        case "stale":
          this.set({ message: MESSAGES.stale });
          await this.load({ keepMessage: true });
          // The proposal may now be decided elsewhere: refresh dashboards.
          this.deps.onDecided?.(decision);
          return;
        case "offline": {
          // No server response: the write may or may not have landed.
          this.set({ message: MESSAGES.uncertain });
          await this.load({ keepMessage: true });
          const after = this.current.snapshot?.proposal;
          if (after?.status === "accepted" || after?.status === "declined") {
            this.set({
              outcome: after.status === "accepted" ? "accept" : "decline",
              message: null,
            });
            this.deps.onDecided?.(decision);
          }
          return;
        }
        case "error":
          this.set({ message: MESSAGES.failed });
          return;
      }
    } finally {
      this.inFlight = false;
      if (this.deps.isCurrent()) this.set({ submitting: null });
    }
  }
}
