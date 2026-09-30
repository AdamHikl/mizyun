import type { CommunityReactionKind } from "@mizyun/contracts";
import { SUPPORTED_REACTIONS } from "./constants";

export function defaultReactionCounts(): Record<CommunityReactionKind, number> {
  const counts = {} as Record<CommunityReactionKind, number>;
  for (const r of SUPPORTED_REACTIONS) {
    counts[r.kind] = 0;
  }
  return counts;
}

export interface OptimisticReactionResult {
  readonly viewerReaction: CommunityReactionKind | null;
  readonly reactionCounts: Record<CommunityReactionKind, number>;
}

/**
 * Immutably computes the next viewerReaction and reactionCounts for a toggle/replace intent.
 * - If target is already active, removes it (sets to null, decrements count).
 * - If target is different, decrements old active count (if any) and increments target count.
 */
export function computeOptimisticReaction(
  currentViewerReaction: CommunityReactionKind | null,
  currentCounts:
    | Partial<Record<CommunityReactionKind, number>>
    | Record<CommunityReactionKind, number>,
  targetReaction: CommunityReactionKind,
): OptimisticReactionResult {
  const nextCounts: Record<CommunityReactionKind, number> = {
    ...defaultReactionCounts(),
    ...currentCounts,
  };

  if (currentViewerReaction === targetReaction) {
    // Toggle off: removing active reaction
    nextCounts[targetReaction] = Math.max(
      0,
      (nextCounts[targetReaction] ?? 0) - 1,
    );
    return {
      viewerReaction: null,
      reactionCounts: nextCounts,
    };
  }

  // Replacing or adding reaction
  if (currentViewerReaction !== null) {
    nextCounts[currentViewerReaction] = Math.max(
      0,
      (nextCounts[currentViewerReaction] ?? 0) - 1,
    );
  }
  nextCounts[targetReaction] = (nextCounts[targetReaction] ?? 0) + 1;

  return {
    viewerReaction: targetReaction,
    reactionCounts: nextCounts,
  };
}

export function getTotalReactionCount(
  counts:
    | Partial<Record<CommunityReactionKind, number>>
    | Record<CommunityReactionKind, number>,
): number {
  return Object.values(counts).reduce(
    (sum, count) => sum + (typeof count === "number" ? count : 0),
    0,
  );
}
