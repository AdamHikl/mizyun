/**
 * Pure detector for the "Save as routine" suggestion: the user keeps
 * repeating the same set of exercises in one-time workouts but has no
 * routine for it. The result is only a suggestion; the caller must ask the
 * user before creating anything.
 */

export const ROUTINE_SUGGESTION_MIN_SESSIONS = 3;
export const ROUTINE_SUGGESTION_MIN_EXERCISES = 2;
export const ROUTINE_SUGGESTION_WINDOW_DAYS = 28;
export const ROUTINE_SUGGESTION_DISMISS_DAYS = 30;

export interface RoutineSuggestionSession {
  readonly id: string;
  /** ISO timestamp the workout was completed. Incomplete sessions are ignored. */
  readonly completedAt: string | null;
  /** Opaque stable exercise identifiers in performed order. */
  readonly exerciseKeys: readonly string[];
}

export interface RoutineSuggestionRoutine {
  readonly exerciseKeys: readonly string[];
}

export interface RoutineSuggestionInput {
  /** Completed one-time workouts. The caller filters out routine sessions. */
  readonly sessions: readonly RoutineSuggestionSession[];
  readonly existingRoutines: readonly RoutineSuggestionRoutine[];
  readonly now: Date;
  /** Signatures the user dismissed and whose snooze has not expired. */
  readonly dismissedSignatures?: ReadonlySet<string>;
  /** Alternative to `dismissedSignatures` for stores that keep hashed keys. */
  readonly isDismissed?: (signature: string) => boolean;
}

export interface RoutineSuggestion {
  readonly signature: string;
  /** Exercise keys in the order of the most recent matching session. */
  readonly exerciseKeys: readonly string[];
  readonly sessionIds: readonly string[];
  readonly latestSessionId: string;
  readonly latestCompletedAt: string;
}

/** Order-insensitive, duplicate-insensitive identity of an exercise set. */
export const routineExerciseSetSignature = (keys: readonly string[]): string =>
  [...new Set(keys)].sort().join("|");

const distinctInOrder = (keys: readonly string[]): string[] => [
  ...new Set(keys),
];

export const detectRoutineSuggestion = (
  input: RoutineSuggestionInput,
): RoutineSuggestion | null => {
  const nowMs = input.now.getTime();
  if (Number.isNaN(nowMs)) return null;
  const windowStart = nowMs - ROUTINE_SUGGESTION_WINDOW_DAYS * 86_400_000;
  const routineSignatures = new Set(
    input.existingRoutines.map((r) =>
      routineExerciseSetSignature(r.exerciseKeys),
    ),
  );

  const groups = new Map<
    string,
    { sessions: { id: string; at: number; at_iso: string; keys: string[] }[] }
  >();
  const seenIds = new Set<string>();
  for (const session of input.sessions) {
    if (session.completedAt === null || seenIds.has(session.id)) continue;
    const at = new Date(session.completedAt).getTime();
    if (Number.isNaN(at) || at < windowStart || at > nowMs) continue;
    const keys = distinctInOrder(session.exerciseKeys);
    if (keys.length < ROUTINE_SUGGESTION_MIN_EXERCISES) continue;
    seenIds.add(session.id);
    const signature = routineExerciseSetSignature(keys);
    const group = groups.get(signature) ?? { sessions: [] };
    group.sessions.push({
      id: session.id,
      at,
      at_iso: session.completedAt,
      keys,
    });
    groups.set(signature, group);
  }

  let best: RoutineSuggestion | null = null;
  let bestCount = 0;
  for (const [signature, group] of groups) {
    if (group.sessions.length < ROUTINE_SUGGESTION_MIN_SESSIONS) continue;
    if (routineSignatures.has(signature)) continue;
    if (input.dismissedSignatures?.has(signature)) continue;
    if (input.isDismissed?.(signature)) continue;
    const ordered = [...group.sessions].sort(
      (a, b) => b.at - a.at || a.id.localeCompare(b.id),
    );
    const latest = ordered[0];
    if (latest === undefined) continue;
    const candidate: RoutineSuggestion = {
      signature,
      exerciseKeys: latest.keys,
      sessionIds: ordered.map((s) => s.id),
      latestSessionId: latest.id,
      latestCompletedAt: latest.at_iso,
    };
    const better =
      best === null ||
      group.sessions.length > bestCount ||
      (group.sessions.length === bestCount &&
        (latest.at > new Date(best.latestCompletedAt).getTime() ||
          (latest.at === new Date(best.latestCompletedAt).getTime() &&
            signature < best.signature)));
    if (better) {
      best = candidate;
      bestCount = group.sessions.length;
    }
  }
  return best;
};
