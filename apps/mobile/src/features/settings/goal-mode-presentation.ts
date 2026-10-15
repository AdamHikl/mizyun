import type { GoalKind, GoalPace } from "@mizyun/contracts";
import {
  GOAL_MODES,
  goalModeFor,
  weeklyChangeKgForPercent,
} from "@mizyun/core";

import {
  POUNDS_PER_KILOGRAM,
  weightUnitLabel,
  type WeightUnitSystem,
} from "@/lib/weight-units";

/**
 * Presentation of rate-based goal modes. Names and bands come from
 * `@mizyun/core` (`GOAL_MODES`); this module only formats them. The stored
 * goal keeps its `kind` and `pace`.
 */

/** Slowest to fastest, matching the order of `GOAL_MODES`. */
const PACE_ORDER: readonly GoalPace[] = ["gradual", "steady", "aggressive"];

export const goalKindHasPace = (kind: GoalKind): boolean =>
  kind === "cut" || kind === "bulk";

const trimNumber = (value: number, decimals: number): string => {
  const fixed = Number(value.toFixed(decimals));
  // Never show a non-zero rate as 0.
  return String(fixed === 0 && value !== 0 ? Number(value.toFixed(2)) : fixed);
};

/**
 * Magnitude band ("0.25\u20130.5 %/week"). The mode name already says
 * whether the weight goes up or down, so no sign is shown.
 */
const band = (
  min: number,
  max: number,
  unit: string,
  decimals: number,
  scale = 1,
): string => {
  const a = Math.abs(min) * scale;
  const b = Math.abs(max) * scale;
  return `${trimNumber(Math.min(a, b), decimals)}\u2013${trimNumber(Math.max(a, b), decimals)} ${unit}`;
};

export const formatPercentBand = (min: number, max: number): string =>
  band(min, max, "%/week", 2);

/** Weekly change band in the user's unit for a known weight. */
export const formatWeightBand = (
  minPercent: number,
  maxPercent: number,
  weightKg: number,
  unitSystem: WeightUnitSystem,
): string => {
  const factor = unitSystem === "imperial" ? POUNDS_PER_KILOGRAM : 1;
  return `~${band(
    weeklyChangeKgForPercent(minPercent, weightKg),
    weeklyChangeKgForPercent(maxPercent, weightKg),
    `${weightUnitLabel(unitSystem)}/week`,
    1,
    factor,
  )}`;
};

export interface PaceChoice {
  readonly pace: GoalPace;
  readonly modeLabel: string;
  /** Chip text, e.g. "Lean bulk · ~0.1–0.2 kg/week". */
  readonly label: string;
  /** Accessible detail with the percentage band as well. */
  readonly detail: string;
  readonly note: string | null;
}

const PACE_NOTES: Readonly<Record<string, string>> = {
  "bulk:gradual":
    "Slower gain keeps fat gain low, but no plan can guarantee muscle-only gain. Protein and progressive training matter most.",
  "bulk:aggressive": "Most of the extra weight is likely to be fat.",
  "cut:aggressive":
    "Harder to keep muscle at this pace. Consider the standard cut.",
};

/** Mode choices for a goal kind (empty for recomp and maintain). */
export const paceChoicesFor = (
  kind: GoalKind,
  weightKg: number | null,
  unitSystem: WeightUnitSystem,
): readonly PaceChoice[] => {
  if (!goalKindHasPace(kind)) return [];
  return PACE_ORDER.map((pace) => {
    const mode = goalModeFor(kind, pace);
    const percent = formatPercentBand(
      mode.minWeeklyPercent,
      mode.maxWeeklyPercent,
    );
    const rate =
      weightKg !== null && weightKg > 0
        ? formatWeightBand(
            mode.minWeeklyPercent,
            mode.maxWeeklyPercent,
            weightKg,
            unitSystem,
          )
        : null;
    return {
      pace,
      modeLabel: mode.label,
      label: rate === null ? mode.label : `${mode.label} · ${rate}`,
      detail: rate === null ? percent : `${rate} (${percent})`,
      note: PACE_NOTES[`${kind}:${pace}`] ?? null,
    };
  });
};

/** Every mode label, for tests and callers that need the full list. */
export const allGoalModeLabels = (): readonly string[] =>
  GOAL_MODES.map((mode) => mode.label);
