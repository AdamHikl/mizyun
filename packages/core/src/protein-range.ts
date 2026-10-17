import { proteinMultipliers } from "./coaching-plan";
import type { GoalKind } from "./goal";

export const PROTEIN_RANGE_VERSION = "v1-protein-range-2026-10" as const;

export interface DailyProteinRange {
  /** Lower end of a good daily range; null when body weight is unknown. */
  readonly lowG: number | null;
  readonly targetG: number;
}

export type ProteinProgressStatus = "unknown" | "building" | "in_range";

/**
 * Presents the existing daily protein target as a range. The lower end reuses
 * the coaching plan's minimum grams per kilogram and never exceeds the target,
 * so this changes how progress is framed, not the target itself.
 */
export const dailyProteinRange = (input: {
  readonly targetProteinG: number | null;
  readonly weightKg: number | null;
  readonly goalKind: GoalKind | null;
}): DailyProteinRange | null => {
  const { targetProteinG, weightKg, goalKind } = input;
  if (
    targetProteinG === null ||
    !Number.isFinite(targetProteinG) ||
    targetProteinG <= 0
  ) {
    return null;
  }
  const targetG = Math.round(targetProteinG);
  if (weightKg === null || !Number.isFinite(weightKg) || weightKg <= 0) {
    return { lowG: null, targetG };
  }
  const { min } = proteinMultipliers(goalKind ?? "maintain");
  return { lowG: Math.min(targetG, Math.round(weightKg * min)), targetG };
};

/** Unknown intake stays unknown; it is never treated as zero grams. */
export const proteinProgressStatus = (
  consumedG: number | null,
  range: DailyProteinRange | null,
): ProteinProgressStatus => {
  if (consumedG === null || !Number.isFinite(consumedG) || range === null) {
    return "unknown";
  }
  return consumedG >= (range.lowG ?? range.targetG) ? "in_range" : "building";
};
