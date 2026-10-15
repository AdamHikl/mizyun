import type { CalorieReviewWire } from "@mizyun/contracts";

import {
  kilogramsToDisplayWeight,
  weightUnitLabel,
  type WeightUnitSystem,
} from "@/lib/weight-units";

type Reason = CalorieReviewWire["reasons"][number];

/** Plain-language text for each review reason code. */
export const REVIEW_REASON_TEXT: Readonly<Record<Reason, string>> = {
  no_target:
    "There is no calorie target yet. Confirm your energy inputs and goal first.",
  goal_too_new:
    "Your goal is still new. Weekly adjustments start after a couple of weeks so the first trend is meaningful.",
  too_few_logged_days:
    "Too few days were logged this week to judge your intake. Log more days and the check-in can adjust.",
  adherence_out_of_range:
    "Your logged intake was far from your target, so changing the target would not help yet.",
  weight_trend_insufficient:
    "There are not enough weigh-ins to see a reliable weight trend yet.",
  within_band:
    "Your weight is changing within the range for your mode. No change needed.",
  below_band:
    "Your weight is changing more slowly than your mode's range, so the target is nudged to move you toward it.",
  above_band:
    "Your weight is changing faster than your mode's range, so the target is nudged to bring you back into it.",
  safety_floor:
    "The proposed target was limited so it does not drop below a safe minimum.",
  recent_adjustment:
    "You accepted a change recently. We'll wait two weeks for your weight trend to reflect it before suggesting another.",
  calibration_limit:
    "Weekly adjustments are capped so the total change stays modest.",
};

export const GENERIC_REASON_TEXT =
  "Your check-in has an additional note this app version cannot describe. Update the app for details.";

/** Safe for reason codes added by a newer server than this app. */
export const reasonText = (reason: string): string =>
  (REVIEW_REASON_TEXT as Readonly<Record<string, string | undefined>>)[
    reason
  ] ?? GENERIC_REASON_TEXT;

export const REVIEW_METHOD_TEXT: Readonly<
  Record<NonNullable<CalorieReviewWire["method"]>, string>
> = {
  adaptive_maintenance: "Based on your estimated maintenance from your logs.",
  rate_error: "Based on this week's rate of weight change.",
};

export const formatKcal = (value: number): string =>
  `${Math.round(value).toLocaleString("en-US")} kcal`;

export const formatSignedKcal = (value: number): string =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(Math.round(value)).toLocaleString("en-US")} kcal`;

const MINUS = "−";

export const formatSignedPercent = (value: number): string =>
  `${value > 0 ? "+" : value < 0 ? MINUS : ""}${Math.abs(value)
    .toFixed(2)
    .replace(/\.?0+$/, "")}%`;

export const formatSignedWeight = (
  kg: number,
  unitSystem: WeightUnitSystem,
): string => {
  const value = Math.abs(kilogramsToDisplayWeight(kg, unitSystem));
  const sign = kg > 0 ? "+" : kg < 0 ? MINUS : "";
  return `${sign}${value} ${weightUnitLabel(unitSystem)}`;
};

export const formatBand = (min: number, max: number): string => {
  const f = (v: number) => `${v > 0 ? "+" : v < 0 ? MINUS : ""}${Math.abs(v)}`;
  return `${f(min)} to ${f(max)}%`;
};

/** Observed weekly change against the mode band. */
export const observedVsBand = (
  review: CalorieReviewWire,
  unitSystem: WeightUnitSystem,
): { readonly value: string; readonly band: string } | null => {
  if (
    review.observedWeeklyPercent === null ||
    review.observedWeeklyChangeKg === null
  )
    return null;
  return {
    value: `${formatSignedWeight(review.observedWeeklyChangeKg, unitSystem)}/week (${formatSignedPercent(review.observedWeeklyPercent)})`,
    band: `${review.goalMode.label} range: ${formatBand(review.goalMode.minWeeklyPercent, review.goalMode.maxWeeklyPercent)} per week`,
  };
};

/**
 * Change to the visible daily target. Older servers omit
 * `targetChangeKcal`; then it equals the calibration change.
 */
export const visibleTargetChange = (review: CalorieReviewWire): number =>
  review.targetChangeKcal ?? review.deltaKcal;

export const reviewHeadline = (review: CalorieReviewWire): string => {
  if (review.status === "adjust") {
    return visibleTargetChange(review) > 0
      ? "Raise your calorie target?"
      : "Lower your calorie target?";
  }
  if (review.status === "hold") return "Keep your calorie target";
  return "Not enough data yet";
};
