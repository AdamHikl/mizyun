import { CommunityMutationError, validateContentSafety } from "./community";
import { isRoutineDetails } from "./workout-lifecycle";

export interface RoutineSnapshotExercise {
  readonly name: string;
  readonly sets: number;
  readonly repsMin: number;
  readonly repsMax: number;
  readonly loadKg: number | null;
  readonly restSeconds: number;
}
export interface RoutineSnapshot {
  readonly schemaVersion: "2026-10-01";
  readonly title: string;
  readonly exercises: readonly RoutineSnapshotExercise[];
}
export interface CommunityRoutineRepository {
  execute(
    operation: "preview" | "publish" | "list" | "get" | "import" | "unshare",
    args: Readonly<Record<string, unknown>>,
    accessToken: string,
  ): Promise<unknown>;
}
/** Custom and catalog exercises are copied as independent names, never foreign IDs. */
export function projectRoutineSnapshot(
  details: Readonly<Record<string, unknown>>,
  title: string,
): RoutineSnapshot {
  const plan = details.coachPlan;
  const raw =
    plan && typeof plan === "object"
      ? (plan as Record<string, unknown>).exercises
      : null;
  if (
    !isRoutineDetails(details) ||
    !Array.isArray(raw) ||
    raw.length < 1 ||
    raw.length > 30 ||
    !title.trim() ||
    title.trim().length > 80
  )
    throw new CommunityMutationError("invalid_input");
  if (!validateContentSafety(title).ok || /(https?:\/\/|www\.|@)/i.test(title))
    throw new CommunityMutationError("content_violation");
  const exercises = raw.map((item: unknown): RoutineSnapshotExercise => {
    if (!item || typeof item !== "object")
      throw new CommunityMutationError("invalid_input");
    const e = item as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name.trim() : "";
    if (!validateContentSafety(name).ok || /(https?:\/\/|www\.|@)/i.test(name))
      throw new CommunityMutationError("content_violation");
    const sets = e.targetSets ?? e.sets;
    const reps =
      typeof e.targetReps === "string"
        ? /^(\d{1,3})(?:-(\d{1,3}))?$/.exec(e.targetReps)
        : null;
    const repsMin = reps ? Number(reps[1]) : e.repsMin;
    const repsMax = reps ? Number(reps[2] ?? reps[1]) : e.repsMax;
    const restSeconds = e.restSeconds ?? 90;
    let loadKg: number | null = null;
    if (
      e.targetLoad !== undefined &&
      e.targetLoad !== null &&
      e.targetLoad !== ""
    ) {
      const load =
        typeof e.targetLoad === "string"
          ? /^(\d+(?:\.\d{1,3})?)\s*(kg|lb|lbs)$/i.exec(e.targetLoad.trim())
          : null;
      if (!load) throw new CommunityMutationError("invalid_input");
      loadKg =
        Math.round(
          Number(load[1]) *
            (load[2]!.toLowerCase() === "kg" ? 1 : 0.45359237) *
            1000,
        ) / 1000;
      if (loadKg > 1000) throw new CommunityMutationError("invalid_input");
    }
    if (
      !name ||
      name.length > 120 ||
      !Number.isInteger(sets) ||
      (sets as number) < 1 ||
      (sets as number) > 20 ||
      !Number.isInteger(repsMin) ||
      !Number.isInteger(repsMax) ||
      (repsMin as number) < 1 ||
      (repsMax as number) > 100 ||
      (repsMin as number) > (repsMax as number) ||
      !Number.isInteger(restSeconds) ||
      (restSeconds as number) < 0 ||
      (restSeconds as number) > 1800
    )
      throw new CommunityMutationError("invalid_input");
    return {
      name,
      sets: sets as number,
      repsMin: repsMin as number,
      repsMax: repsMax as number,
      loadKg,
      restSeconds: restSeconds as number,
    };
  });
  return { schemaVersion: "2026-10-01", title: title.trim(), exercises };
}
