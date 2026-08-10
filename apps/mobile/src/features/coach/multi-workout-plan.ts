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

/**
 * The proposal carries focus values as code-internal strings
 * (`"general_hypertrophy"`, `"ppl"`, `"upper_lower"`,
 * `"full_body"`, plus the per-session `"upper"` / `"lower"` /
 * `"full"` set by the AI-ACT-006 distribution work). The mobile
 * UI should never display those raw values to the user. This
 * mapper returns a human-friendly label, or `null` when the focus
 * is missing / unknown.
 */
export const humanFocusLabel = (focus: string | null): string | null => {
  if (focus === null || focus.length === 0) return null;
  switch (focus) {
    case "general_hypertrophy":
      return "Upper-body emphasis";
    case "ppl":
      return "Push · Pull · Legs";
    case "upper_lower":
      return "Upper / Lower";
    case "full_body":
      return "Full body";
    case "upper":
      return "Upper body";
    case "lower":
      return "Lower body";
    case "full":
      return "Full body";
    case "unknown":
      return null;
    default:
      // Future-proof: humanise snake_case into Title Case rather
      // than leaking an unmapped code value to the user.
      return focus
        .split("_")
        .map((part) =>
          part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1),
        )
        .join(" ");
  }
};

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
  const focusLabel = humanFocusLabel(session.focus);
  const focusTag = focusLabel === null ? "" : ` · focus ${focusLabel}`;
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
