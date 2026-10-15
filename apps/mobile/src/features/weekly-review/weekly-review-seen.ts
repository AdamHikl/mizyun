import * as SecureStore from "expo-secure-store";

/**
 * Per-user record of weekly-review proposals whose pop-up was already shown,
 * so choosing "Later" does not re-open the sheet on every Home focus. The
 * list is bounded; old week ids are irrelevant because proposals are one per
 * goal per ISO week.
 */

export interface WeeklyReviewSeenStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync?(key: string): Promise<unknown>;
}

const MAX_SEEN = 24;

export const weeklyReviewSeenKey = (userId: string): string =>
  `mizyun.weekly-review-seen.${userId}`;

export const loadSeenProposalIds = async (
  userId: string,
  store: WeeklyReviewSeenStore = SecureStore,
): Promise<readonly string[]> => {
  try {
    const raw = await store.getItemAsync(weeklyReviewSeenKey(userId));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
};

export const markProposalSeen = async (
  userId: string,
  proposalId: string,
  store: WeeklyReviewSeenStore = SecureStore,
): Promise<void> => {
  try {
    const current = await loadSeenProposalIds(userId, store);
    if (current.includes(proposalId)) return;
    const next = [...current, proposalId].slice(-MAX_SEEN);
    await store.setItemAsync(weeklyReviewSeenKey(userId), JSON.stringify(next));
  } catch {
    // Best effort: the in-memory session set still prevents nagging.
  }
};

export const clearWeeklyReviewSeen = async (
  userId: string,
  store: WeeklyReviewSeenStore = SecureStore,
): Promise<void> => {
  try {
    if (typeof store.deleteItemAsync === "function") {
      await store.deleteItemAsync(weeklyReviewSeenKey(userId));
    } else {
      await store.setItemAsync(weeklyReviewSeenKey(userId), "[]");
    }
  } catch {
    // Best-effort cleanup during account deletion or logout.
  }
};

/** In-memory, per-owner set for the current app session. */
const sessionSeen = new Map<string, Set<string>>();

export const hasSeenThisSession = (
  userId: string,
  proposalId: string,
): boolean => sessionSeen.get(userId)?.has(proposalId) ?? false;

export const markSeenThisSession = (
  userId: string,
  proposalId: string,
): void => {
  const set = sessionSeen.get(userId) ?? new Set<string>();
  set.add(proposalId);
  sessionSeen.set(userId, set);
};

export const resetWeeklyReviewSessionSeen = (): void => sessionSeen.clear();

/**
 * Decide whether the Home pop-up should open for this proposal: pending and
 * not yet seen in this session or in persisted state.
 */
export const shouldShowWeeklyReviewPopup = async (
  userId: string,
  proposal: { readonly id: string; readonly status: string } | null,
  store: WeeklyReviewSeenStore = SecureStore,
): Promise<boolean> => {
  if (proposal === null || proposal.status !== "pending") return false;
  if (hasSeenThisSession(userId, proposal.id)) return false;
  const persisted = await loadSeenProposalIds(userId, store);
  return !persisted.includes(proposal.id);
};

/**
 * Resolve whether to open the pop-up for a pending proposal, re-checking the
 * owner after every await so an account switch or unmount mid-check can
 * never open (or mark) another account's sheet. Returns the id to open.
 */
export const resolvePopupToOpen = async (
  userId: string,
  proposal: { readonly id: string; readonly status: string },
  isCurrent: () => boolean,
  store: WeeklyReviewSeenStore = SecureStore,
): Promise<string | null> => {
  const show = await shouldShowWeeklyReviewPopup(userId, proposal, store);
  if (!show || !isCurrent()) return null;
  // Record before showing so a crash or "Later" never re-prompts.
  markSeenThisSession(userId, proposal.id);
  await markProposalSeen(userId, proposal.id, store);
  return isCurrent() ? proposal.id : null;
};
