import type { UserId } from "./index";
import type { StoredBodyMeasurement } from "./body-measurement";
import type { StoredExercise } from "./exercise";
import type { StoredFoodEntry } from "./food-entry";
import type { StoredGoal } from "./goal";
import type { StoredProfile } from "./profile";
import type { StoredWorkout } from "./workout";
import type { StoredWorkoutSet } from "./workout-set";

/**
 * Account-level domain types (DATA-001).
 *
 * Pure: no database, no transport, no SDK. This module owns the
 * read-side envelope shape (`AccountExport`) and the high-level
 * deletion port (`AccountRepository`). The route layer is the
 * only place that constructs `AccountExport`; the adapter is the
 * only place that orchestrates the per-feature repositories.
 *
 * The export deliberately returns immutable DTOs shaped from the
 * per-feature `Stored*` types. Conversations, messages, and
 * memories are reserved for a follow-up segment once the
 * per-feature wire schemas exist; the in-memory `AccountExport`
 * sets these to empty arrays so the client can rely on the
 * envelope being exhaustive (every key is always present).
 */

export interface StoredConversationStub {
  readonly id: string;
  readonly title: string;
  readonly createdAt: Date;
}

/**
 * Read-side envelope: every user-owned record, gathered at
 * request time. The shape is exhaustive across every Phase 2
 * feature so a downstream consumer (the iOS export-and-delete UI)
 * can render the full record set without a second round-trip.
 */
export interface AccountExport {
  readonly userId: UserId;
  readonly generatedAt: Date;
  readonly profile: StoredProfile | null;
  readonly goals: ReadonlyArray<StoredGoal>;
  readonly foodEntries: ReadonlyArray<StoredFoodEntry>;
  readonly exercises: ReadonlyArray<StoredExercise>;
  readonly workouts: ReadonlyArray<StoredWorkout>;
  readonly workoutSets: ReadonlyArray<StoredWorkoutSet>;
  readonly bodyMeasurements: ReadonlyArray<StoredBodyMeasurement>;
  /**
   * Reserved for a follow-up segment (CONV-* / MEM-*). The
   * envelope shape is stable today; an empty array means "not yet
   * wired" so the client renders a "Coming soon" cell rather
   * than crashing.
   */
  readonly conversations: ReadonlyArray<StoredConversationStub>;
  readonly privateMedia: ReadonlyArray<{
    readonly id: string;
    readonly createdAt: Date;
  }>;
}

/**
 * Why-not-valid reasons for an account deletion request.
 */
export type AccountDeletionError =
  | { readonly kind: "confirmation_token_missing" }
  | { readonly kind: "confirmation_token_mismatch" }
  | { readonly kind: "confirmation_token_expired" };

/**
 * Repository port. The in-memory implementation orchestrates the
 * per-feature repositories; the eventual Supabase implementation
 * cascades through FK constraints and deletes the `auth.users`
 * row last.
 */
export interface AccountRepository {
  /**
   * Gather every user-owned record into a single export envelope.
   * Pure read; no side effects.
   */
  exportForUser(userId: UserId): Promise<AccountExport>;
  /**
   * Issue a short-lived confirmation token that the client must
   * echo back to `deleteUser` within `ttlSeconds`. Returns the
   * token value. The implementation is responsible for the TTL;
   * expired tokens are rejected at `deleteUser`.
   */
  issueDeletionChallenge(
    userId: UserId,
    options: { readonly ttlSeconds: number; readonly now: Date },
  ): Promise<string>;
  /**
   * Permanently delete every user-owned record. The token must
   * match a previously-issued challenge and not be expired;
   * otherwise the implementation returns the typed reason and
   * does NOT delete. On success the challenge is consumed and
   * every record is gone.
   */
  deleteUser(
    userId: UserId,
    options: { readonly confirmationToken: string; readonly now: Date },
  ): Promise<
    | { readonly deleted: true }
    | { readonly deleted: false; readonly reason: AccountDeletionError }
  >;
}
