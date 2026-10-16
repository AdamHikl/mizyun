import type { ApiError, RequestOptions } from "@mizyun/api-client";
import {
  communityProfileDtoSchema,
  type CommunityProfileDto,
  type SharedActivityFeedItemDto,
} from "@mizyun/contracts";
import { tolerantCommunityFeedResponseSchema } from "../activity-feed-schema";
import { isAdultEligibleForCommunity, type Result } from "@mizyun/core";

/**
 * Presentation-only memory of the last authorized Community Feed segment.
 *
 * It is never authority: actions, cache peeks, deadlines and epochs ignore it.
 * It lets the Feed render the last first page read-only while membership and
 * the feed are rechecked (stale-while-revalidate, approved 2026-10-14).
 * Memory only, one principal, bounded to one first page.
 */
export interface CommunityDisplaySnapshot {
  readonly userId: string;
  readonly profile: CommunityProfileDto;
  readonly items: readonly SharedActivityFeedItemDto[];
}

export const COMMUNITY_DISPLAY_FEED_PATH = "/v1/community/feed?limit=20";
const PROFILE_PATH = "/v1/community/profile";
const MAX_ITEMS = 20;
const MAX_BYTES = 128_000;
const DENIAL_CODES = new Set([
  "AUTHENTICATION_REQUIRED",
  "INVALID_ACCESS_TOKEN",
  "FORBIDDEN",
  "COMMUNITY_AGE_RESTRICTED",
  "COMMUNITY_NOT_ENROLLED",
  "COMMUNITY_BLOCKED",
]);

let owner: string | null = null;
let profile: CommunityProfileDto | null = null;
// No cursor is retained: a stale snapshot must never seed pagination.
let feed: { items: readonly SharedActivityFeedItemDto[] } | null = null;
let snapshot: CommunityDisplaySnapshot | null = null;
let generation = 0;
const listeners = new Set<() => void>();

function publish(): void {
  const next =
    owner !== null && profile !== null && feed !== null
      ? { userId: owner, profile, ...feed }
      : null;
  if (next === null && snapshot === null) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

export function clearCommunityDisplaySnapshot(): void {
  generation++;
  owner = null;
  profile = null;
  feed = null;
  publish();
}

/** Principal changes and sign-out retire the snapshot; token rotation does not. */
export function setCommunityDisplayPrincipal(userId: string | null): void {
  if (userId === null || (owner !== null && owner !== userId))
    clearCommunityDisplaySnapshot();
}

export function subscribeCommunityDisplaySnapshot(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Returns a stable object for render, only for the same adult-eligible user. */
export function readCommunityDisplaySnapshot(
  userId: string | null,
  birthYear: number | null | undefined,
  now: Date = new Date(),
): CommunityDisplaySnapshot | undefined {
  if (
    !snapshot ||
    userId === null ||
    snapshot.userId !== userId ||
    snapshot.profile.userId !== userId ||
    snapshot.profile.status !== "active" ||
    !isAdultEligibleForCommunity(birthYear, now.getUTCFullYear())
  )
    return undefined;
  return snapshot;
}

function isDenial(error: ApiError, membershipRead: boolean): boolean {
  if (error.kind === "context_changed")
    return error.cause ? isDenial(error.cause, membershipRead) : false;
  if (
    error.kind === "no_session" ||
    error.kind === "session_expired" ||
    error.kind === "not_configured"
  )
    return true;
  if (error.kind !== "http_error") return false;
  if (error.status === 401 || error.status === 403) return true;
  // The Community kill switch answers gated reads with a generic 503. A
  // membership/feed 503 therefore fails closed rather than keeping old content.
  if (membershipRead && error.status === 503) return true;
  if (DENIAL_CODES.has(error.code)) return true;
  // Absent, blocked or ineligible membership/feed reads retire the snapshot.
  return (
    membershipRead &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  );
}

/** Community writes and account lifecycle writes may change visibility. */
export function affectsCommunityDisplay(options: RequestOptions): boolean {
  const path = options.path.split("?")[0]!;
  return path.startsWith("/v1/community/") || path.startsWith("/v1/account");
}

/** A read that overlaps a clear (write, denial, principal) never records. */
export function getCommunityDisplayGeneration(): number {
  return generation;
}

/**
 * Records successful authorized reads and retires the snapshot on denial.
 * Network, timeout and parse failures keep it read-only.
 */
export function observeCommunityDisplayRead(
  options: RequestOptions,
  principal: string | null,
  result: Result<unknown, ApiError>,
  startedGeneration: number,
): void {
  const membershipRead = options.path === PROFILE_PATH;
  const feedRead = options.path === COMMUNITY_DISPLAY_FEED_PATH;
  if (!result.ok) {
    if (isDenial(result.error, membershipRead || feedRead))
      clearCommunityDisplaySnapshot();
    return;
  }
  if (!membershipRead && !feedRead) return;
  const userId = options.expectedUserId;
  if (
    options.method !== "GET" ||
    startedGeneration !== generation ||
    !userId ||
    userId !== principal ||
    options.isCurrent?.() === false
  )
    return;
  if (owner !== null && owner !== userId) clearCommunityDisplaySnapshot();
  if (membershipRead) {
    const parsed = communityProfileDtoSchema.safeParse(result.value);
    if (
      !parsed.success ||
      parsed.data.status !== "active" ||
      parsed.data.userId !== userId
    ) {
      clearCommunityDisplaySnapshot();
      return;
    }
    owner = userId;
    profile = parsed.data;
    publish();
    return;
  }
  const parsed = tolerantCommunityFeedResponseSchema.safeParse(result.value);
  if (!parsed.success) return;
  const next = {
    items: parsed.data.items.slice(0, MAX_ITEMS),
  };
  if ((JSON.stringify(next)?.length ?? MAX_BYTES + 1) > MAX_BYTES) {
    feed = null;
    publish();
    return;
  }
  owner = userId;
  feed = next;
  publish();
}
