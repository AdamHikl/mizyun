import { workoutSetTypeSchema, type WorkoutSetType } from "@mizyun/contracts";

/** Invalid entries fall back in place so later set ordinals never shift. */
export function readPlannedSetTypes(
  value: unknown,
): readonly WorkoutSetType[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value.slice(0, 20).map((type) => {
    const parsed = workoutSetTypeSchema.safeParse(type);
    return parsed.success ? parsed.data : "normal";
  });
}

export function resizePlannedSetTypes(
  types: readonly WorkoutSetType[] | undefined,
  count: number,
): readonly WorkoutSetType[] {
  return Array.from(
    { length: Math.max(1, Math.min(20, Math.floor(count))) },
    (_, index) => types?.[index] ?? "normal",
  );
}

/** Sequence is one-based; unplanned and extra sets default to normal, so a completed warmup never carries over. */
export function plannedSetTypeForSequence(
  types: readonly WorkoutSetType[] | undefined,
  sequence: number,
): WorkoutSetType {
  return types?.[sequence - 1] ?? "normal";
}
