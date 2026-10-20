import type { EnergySummary } from "@mizyun/contracts";

import {
  POUNDS_PER_KILOGRAM,
  weightUnitLabel,
  type WeightUnitSystem,
} from "@/lib/weight-units";

/**
 * Compact plain-language notes about how the calorie target was planned
 * (goal mode, weekly rate, projection, weight source, calibration, adaptive
 * maintenance). Every field is optional: an older server or cached summary
 * without the newer fields yields no notes, so the card renders as before.
 */

export interface EnergyPlanNotes {
  /** "Lean bulk · planned +0.2 kg/week" */
  readonly mode: string | null;
  readonly projection: string | null;
  /**
   * Shown as a warning when the user's own target date is earlier than the
   * safe pace allows; the card links it to Goal settings.
   */
  readonly unrealisticDate: string | null;
  readonly weightSource: string | null;
  readonly calibration: string | null;
  readonly adaptiveMaintenance: string | null;
}

const MINUS = "−";

export const formatIsoDateForDisplay = (iso: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) return iso;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
};

const signed = (value: number): string =>
  `${value > 0 ? "+" : value < 0 ? MINUS : ""}${Math.abs(value)}`;

export const energyPlanNotes = (
  summary: EnergySummary | null,
  unitSystem: WeightUnitSystem,
): EnergyPlanNotes => {
  const none: EnergyPlanNotes = {
    mode: null,
    projection: null,
    unrealisticDate: null,
    weightSource: null,
    calibration: null,
    adaptiveMaintenance: null,
  };
  if (summary === null) return none;

  const label = summary.goalMode?.label ?? null;
  let weekly: string | null = null;
  if (
    summary.targetWeeklyChangeKg != null &&
    summary.targetWeeklyChangeKg !== 0
  ) {
    // Weekly rates are small, so keep two decimals (the shared helper rounds
    // to one decimal, which suits body weight but not a rate).
    const display =
      summary.targetWeeklyChangeKg *
      (unitSystem === "imperial" ? POUNDS_PER_KILOGRAM : 1);
    weekly = `${signed(Number(display.toFixed(2)))} ${weightUnitLabel(unitSystem)}/week`;
  }
  const mode =
    label !== null && weekly !== null
      ? `${label} · planned ${weekly}`
      : label !== null
        ? label
        : weekly !== null
          ? `Planned ${weekly}`
          : null;

  const projectedDate = summary.projection?.projectedDate ?? null;
  const realistic = summary.projection?.targetDateRealistic;
  const projectedText =
    projectedDate !== null ? formatIsoDateForDisplay(projectedDate) : null;

  const calibration = summary.calibrationKcal ?? 0;
  const adaptive = summary.adaptiveMaintenance;

  return {
    mode,
    projection:
      projectedText !== null && realistic !== false
        ? `On track to reach your target weight around ${projectedText}.`
        : null,
    unrealisticDate:
      realistic === false && projectedText !== null
        ? `At this pace you'll reach your target weight around ${projectedText}, after your target date. Choose a later date or remove it.`
        : null,
    weightSource:
      summary.weightSource === "trend"
        ? "Based on your weight trend."
        : summary.weightSource === "latest"
          ? "Based on your latest weigh-in."
          : null,
    calibration:
      calibration !== 0
        ? `Includes ${signed(calibration)} kcal from weekly reviews.`
        : null,
    adaptiveMaintenance:
      adaptive?.status === "ready" && adaptive.maintenanceKcal != null
        ? `Estimated from your logs: ${adaptive.maintenanceKcal.toLocaleString("en-US")} kcal maintenance.`
        : null,
  };
};

export const hasEnergyPlanNotes = (notes: EnergyPlanNotes): boolean =>
  Object.values(notes).some((value) => value !== null);
