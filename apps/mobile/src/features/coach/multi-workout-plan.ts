import type { CoachMultiWorkoutPlanProposal } from "@mizyun/contracts";

import { apiClient } from "@/composition/api-client";
import { startWorkoutWith } from "@/features/log-workout/log-workout-data";

/**
 * AI-ACT-006 — multi-workout plan lifecycle on the mobile side.
 *
 * The Coach's deterministic engine returns an ordered list of
 * pre-scheduled sessions. "Save all" creates one real workout per
 * session via the existing `startWorkout` route, with the session
 * label as the workout name and the auto-scheduled `targetDay` as
 * the `startedAt` timestamp. Each workout is empty (no sets yet) —
 * the user opens it via the existing MOB-WO-001 surface to add
 * exercises, reorder them, change weights, log sets, etc.
 *
 * Failures are per-session: a 4xx on one workout does not stop
 * the rest from being created. The caller renders the result and
 * lets the user retry the failed one.
 */

export interface SavedSession {
  readonly session: CoachMultiWorkoutPlanProposal["sessions"][number];
  readonly result: import("@/features/log-workout/log-workout-data").StartWorkoutResult;
}

export interface MultiWorkoutPlanSaveResult {
  readonly ok: boolean;
  readonly saved: readonly SavedSession[];
  readonly firstWorkoutId: string | null;
}

const targetDayToStartedAt = (targetDay: string): string => {
  // The Coach pre-schedules sessions to a local calendar day in
  // the user's timezone. The wire schema only carries the date
  // (YYYY-MM-DD), so we pick noon UTC as a stable, editable
  // timestamp the user can change once they open the workout.
  const [year, month, day] = targetDay
    .split("-")
    .map((part) => Number.parseInt(part, 10));
  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    year < 2000 ||
    year > 2100
  ) {
    return new Date().toISOString();
  }
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).toISOString();
};

const sessionNotes = (
  session: CoachMultiWorkoutPlanProposal["sessions"][number],
  proposal: CoachMultiWorkoutPlanProposal,
): string => {
  const focusTag =
    session.focus === null || session.focus.length === 0
      ? ""
      : ` · focus ${session.focus}`;
  return [
    `Coach plan · ${proposal.prescriptionVersion} · ${session.targetDay}${focusTag}`,
    `Volume action: ${proposal.volumeAction}`,
    `Suggested exercises: ${session.exercises.length}`,
  ].join("\n");
};

export const saveMultiWorkoutPlanWith = async (
  client: typeof apiClient,
  proposal: CoachMultiWorkoutPlanProposal,
): Promise<MultiWorkoutPlanSaveResult> => {
  const saved: SavedSession[] = [];
  let firstWorkoutId: string | null = null;
  for (const session of proposal.sessions) {
    const startedAt = targetDayToStartedAt(session.targetDay);
    const result = await startWorkoutWith(
      client,
      session.label,
      sessionNotes(session, proposal),
      () => new Date(startedAt),
      {
        coachPlan: {
          proposalId: proposal.id,
          prescriptionVersion: proposal.prescriptionVersion,
          sessionIndex: session.index,
          targetDay: session.targetDay,
          estimatedMinutes: session.estimatedMinutes,
          exercises: session.exercises.map((exercise) => ({
            catalogId: exercise.catalogId,
            name: exercise.name,
            movementPattern: exercise.movementPattern,
            sets: exercise.sets,
            repsMin: exercise.repsMin,
            repsMax: exercise.repsMax,
            durationMinutes: exercise.durationMinutes,
            restSeconds: exercise.restSeconds,
          })),
        },
      },
    );
    saved.push({ session, result });
    if (result.ok && firstWorkoutId === null) {
      firstWorkoutId = result.workout.id;
    }
  }
  return {
    ok: saved.every((entry) => entry.result.ok),
    saved,
    firstWorkoutId,
  };
};

export const saveMultiWorkoutPlan = (
  proposal: CoachMultiWorkoutPlanProposal,
): Promise<MultiWorkoutPlanSaveResult> =>
  saveMultiWorkoutPlanWith(apiClient, proposal);
