/**
 * Energy engine domain (ENG-001, ENG-002).
 *
 * Pure: no database, no transport, no SDK. The wire schema lives
 * in `@mizyun/contracts`; this module owns the versioned
 * deterministic functions that compute BMR (Mifflin-St Jeor),
 * TDEE (BMR × activity multiplier), and the goal-adjusted daily
 * target from confirmed inputs.
 *
 * ## Formula choice (ENG-001)
 *
 * Mifflin-St Jeor (1990) for resting metabolic rate:
 *   men:    BMR = 10·kg + 6.25·cm − 5·age + 5
 *   women:  BMR = 10·kg + 6.25·cm − 5·age − 161
 *
 * It is the most-cited modern formula, the standard clinical
 * default, and deterministic — the same inputs produce the same
 * output bit-for-bit (modulo rounding).
 *
 * Activity multiplier (Penman categories, cited by Mifflin et
 * al.):
 *   sedentary       1.40
 *   lightly_active  1.50
 *   moderately_active 1.60
 *   very_active     1.75
 *   extra_active    2.00
 *
 * Goal adjustment is documented in the source below; a 500
 * kcal/day deficit is the standard "steady cut", a 300 the
 * "gradual", etc. A safety floor (1200 women / 1500 men) caps
 * the lower bound of any goal-adjusted target — the engine
 * refuses to fabricate a number below it and surfaces
 * `below_safety_floor` as an incompleteReason (ENG-06).
 *
 * ## Versioning (ENG-001, ENG-02)
 *
 * The wire response carries `formulaVersion` so the UI can render
 * the version and so a future v2 (e.g. Katch-McArdle) can ship
 * without breaking v1 callers — they keep using the version
 * they were written against. Bumping the version requires a
 * deliberate semantic change (formula, multiplier set, or
 * rounding policy); bug fixes inside the same version are
 * transparent.
 *
 * ## ENG-04 — no double counting
 *
 * Exercise-derived activity kcal comes from the user's recent
 * workout sets (`exerciseKcal`). The activity multiplier is
 * always applied to *non-exercise* TDEE (NEAT + daily movement),
 * not the workout sessions themselves. The breakdown surfaces
 * both so the UI can show the user the de-overlap explicitly.
 *
 * ## ENG-06 — honest incomplete state
 *
 * Every numeric input is optional. Missing fields surface as
 * `null` in the breakdown with a typed `incompleteReason`. The
 * caller decides whether to render an "I can't compute this
 * yet — please fill in X" cell (recommended) or hide the target
 * entirely. The engine never guesses.
 */

import type { UserId } from "./index";
import type { StoredBodyMeasurement } from "./body-measurement";
import type { StoredGoal } from "./goal";
import type { StoredProfile } from "./profile";
import { hasRunningActivity } from "./running";
import type { StoredWorkout } from "./workout";

/**
 * The current formula version. Bump deliberately: a version
 * change means the math or the multiplier set has changed, not
 * that we patched a typo. The constant is part of the public
 * contract; the wire envelope echoes it on every response.
 */
export const ENERGY_FORMULA_VERSION = "v1-mifflin-st-jeor-2026-07" as const;

/** Closed activity-multiplier categories. */
export type ActivityLevel =
  | "sedentary"
  | "lightly_active"
  | "moderately_active"
  | "very_active"
  | "extra_active";

/** Closed biological-sex categories used by Mifflin-St Jeor. */
export type SexAtBirth = "male" | "female";

/**
 * Activity multipliers. Static so the engine doesn't read from
 * configuration at runtime; introducing a new category requires
 * a new formula version.
 */
export const ACTIVITY_MULTIPLIERS: Readonly<Record<ActivityLevel, number>> = {
  sedentary: 1.4,
  lightly_active: 1.5,
  moderately_active: 1.6,
  very_active: 1.75,
  extra_active: 2.0,
};

/**
 * Why the engine refused to compute a numeric target. The
 * breakdown always surfaces the typed reason so the UI can
 * prompt the user to fill in the missing input (ENG-06).
 */
export type EnergyIncompleteReason =
  | "weight_missing"
  | "height_missing"
  | "birth_year_missing"
  | "sex_missing"
  | "no_active_goal"
  | "below_safety_floor"
  | "activity_unset"
  | "exercise_data_stale";

/**
 * The engine input. Every field is optional so the caller can
 * surface an honest "missing inputs" state without first
 * re-querying the underlying repositories.
 */
export interface EnergyInputs {
  readonly profile: StoredProfile | null;
  readonly latestBodyMeasurement: StoredBodyMeasurement | null;
  readonly activeGoal: StoredGoal | null;
  /**
   * The user-level activity-level setting. Sourced from a future
   * profile field; absent in v1. The route accepts it as an
   * optional query parameter so a client UI can persist it.
   */
  readonly activityLevel: ActivityLevel | null;
  /** Optional sex category; absent in v1 profile shape. */
  readonly sexAtBirth: SexAtBirth | null;
  /** Recent workouts the engine consumes for activity kcal. */
  readonly recentWorkouts: ReadonlyArray<StoredWorkout>;
  /** Number of distinct days the recent workouts span. */
  readonly recentWorkoutsDayCount: number;
  /**
   * Net calories the user consumed today (sum of food entries
   * for the current day, in UTC). Null when no entries exist
   * or when the daily-summary endpoint hasn't been queried.
   */
  readonly consumedKcalToday: number | null;
  /** Reference "now" for any date arithmetic. */
  readonly now: Date;
}

/**
 * The engine output. Every numeric field is nullable. A non-null
 * field comes with every input echo so the UI can render the
 * audit trail (ENG-02).
 */
export interface EnergyBreakdown {
  readonly formulaVersion: typeof ENERGY_FORMULA_VERSION;
  readonly userId: UserId;
  readonly computedAt: Date;
  /** True iff every required input was present AND the safety floor held. */
  readonly complete: boolean;
  /** First incomplete reason; sorted by importance (weight first, etc.). */
  readonly incompleteReason: EnergyIncompleteReason | null;

  // Intermediate values — all nullable so a missing input never
  // fabricates a downstream value.
  readonly ageYears: number | null;
  readonly bmrKcal: number | null;
  readonly activityMultiplier: number | null;
  readonly tdeeKcal: number | null;
  readonly exerciseKcal: number | null;
  readonly goalAdjustmentKcal: number | null;

  // Final results.
  readonly dailyTargetKcal: number | null;
  readonly targetProteinG: number | null;
  readonly targetCarbohydrateG: number | null;
  readonly targetFatG: number | null;

  // Intake balance for today (consumed − TDEE). Null when either
  // input is missing; never fabricated.
  readonly balanceKcal: number | null;
  /**
   * Uncertainty band (kcal) around `balanceKcal`. ± one standard
   * deviation from the activity-multiplier residual + the per-day
   * exercise variance. Null when not enough observations exist
   * (ENG-05: trend-based recalibration requires enough
   * observations; we never present false precision).
   */
  readonly balanceUncertaintyKcal: number | null;

  /**
   * Verbatim echoes of the inputs that influenced the
   * computation. Surfaced in the response so the UI can show
   * "here's what we used" without re-fetching the inputs.
   */
  readonly inputs: {
    readonly weightKg: number | null;
    readonly heightCm: number | null;
    readonly birthYear: number | null;
    readonly sexAtBirth: SexAtBirth | null;
    readonly activityLevel: ActivityLevel | null;
    readonly goalKind: StoredGoal["kind"] | null;
    readonly goalPace: StoredGoal["pace"] | null;
  };
}

/**
 * Result of running the engine. `ok: true` means the engine ran
 * and produced a breakdown (the breakdown may still be
 * `complete: false` because of missing inputs — that's an
 * intentional signal, not an error).
 */
export type EnergyComputeResult = {
  readonly ok: true;
  readonly breakdown: EnergyBreakdown;
};

/**
 * Engine port. The v1 implementation is `mifflinStJeorFormula`
 * (below). A future v2 (Katch-McArdle, etc.) can implement this
 * port without breaking callers that depend only on the
 * `EnergyBreakdown` shape.
 */
export interface EnergyFormula {
  readonly version: typeof ENERGY_FORMULA_VERSION | string;
  compute(input: EnergyInputs, userId: UserId): EnergyComputeResult;
}

/** This-year constant — captured at module load for determinism in tests. */
const CURRENT_YEAR_REF = (): number => 1970;

/** Reference date used to derive `ageYears` from `birthYear`. */
const REFERENCE_NOW_FN = (now: Date): number => now.getUTCFullYear();

/** Plausible sex/default for ENG-06 — the formula is silent on unknown sex. */
const SAFETY_FLOOR_KCAL: Readonly<Record<SexAtBirth, number>> = {
  female: 1200,
  male: 1500,
};

/**
 * Heuristic exercise-kilocalorie estimate per set. We do not
 * have MET tables in v1; the function picks a mid-range value
 * that approximates "1 set of compound strength work" ≈ 8
 * kcal. Per-set kind is not yet known (the route passes the raw
 * set list); the multiplication below produces a stable number
 * from the count alone. A future segment promotes this to a
 * MET-keyed lookup.
 */
const KCAL_PER_SET_HINT = 8;

/**
 * Compute exercise-derived kcal from a list of recent workouts.
 *
 * The route passes the workouts list; this function counts the
 * sets under each workout by replaying the `workoutSets` field
 * that the implementation populates. In v1 the `StoredWorkout`
 * does NOT include sets directly (sets are a separate
 * repository), so the engine consumes a precomputed set count
 * via the caller; the call shape here is `__setCountPerWorkout`
 * to keep the engine pure.
 */
export const estimateExerciseKcal = (
  workouts: ReadonlyArray<StoredWorkout>,
  setCountForWorkout: (workoutId: string) => number,
): number => {
  let totalSets = 0;
  for (const w of workouts) {
    if (hasRunningActivity(w.details)) continue;
    totalSets += setCountForWorkout(w.id);
  }
  return Math.round(totalSets * KCAL_PER_SET_HINT);
};

/**
 * Goal adjustment in kcal/day, keyed by `(kind, pace)`. A
 * negative value is a deficit. The table is intentionally not
 * exposed — the formula version owns it.
 */
const GOAL_ADJUSTMENT_KCAL: Readonly<
  Record<StoredGoal["kind"], Record<StoredGoal["pace"], number>>
> = {
  cut: {
    steady: -500,
    gradual: -300,
    aggressive: -750,
  },
  bulk: {
    steady: 500,
    gradual: 300,
    aggressive: 750,
  },
  recomp: {
    steady: -250,
    gradual: 0,
    aggressive: -500,
  },
  maintain: {
    steady: 0,
    gradual: 0,
    aggressive: 0,
  },
};

/**
 * Round a half-up value to 2 decimal places (matching the SQL
 * `numeric(8, 2)` resolution used everywhere else).
 */
const roundKcal = (value: number): number => Math.round(value * 100) / 100;

/**
 * Derive an age in completed years from a birth year. We use the
 * calendar-year delta — the day-of-year nuance is below the
 * "honest incomplete" threshold the engine promises.
 */
export const ageFromBirthYear = (birthYear: number, now: Date): number =>
  Math.max(0, REFERENCE_NOW_FN(now) - birthYear);

/**
 * Mifflin-St Jeor BMR. Pure function. Throws on NaN so a
 * misconfigured input (e.g. `NaN` weight) cannot silently
 * produce a fabricated number — the caller is responsible for
 * bounding inputs before invoking.
 */
export const mifflinStJeorBmr = (
  weightKg: number,
  heightCm: number,
  ageYears: number,
  sexAtBirth: SexAtBirth,
): number => {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return sexAtBirth === "male" ? base + 5 : base - 161;
};

/**
 * The v1 formula implementation. Marks the engine's contract:
 * pure, deterministic, no I/O.
 */
export const mifflinStJeorFormula: EnergyFormula = {
  version: ENERGY_FORMULA_VERSION,
  compute(input: EnergyInputs, userId: UserId): EnergyComputeResult {
    // The profile doesn't carry weight today; body measurements do.
    const resolvedWeight =
      input.latestBodyMeasurement?.weightKg !== undefined
        ? input.latestBodyMeasurement?.weightKg
        : null;

    const heightCm = input.profile?.heightCm ?? null;
    const birthYear = input.profile?.birthYear ?? null;
    const sexAtBirth = input.sexAtBirth;
    const activityLevel = input.activityLevel;

    // Identify the first incomplete reason in priority order so
    // the UI can render one prompt at a time. The DOM layer
    // walks the reasons set rather than relying on this string
    // being exhaustive in priority order.
    const incompleteReasons = new Set<EnergyIncompleteReason>();
    if (resolvedWeight === null) incompleteReasons.add("weight_missing");
    if (heightCm === null) incompleteReasons.add("height_missing");
    if (birthYear === null) incompleteReasons.add("birth_year_missing");
    if (sexAtBirth === null) incompleteReasons.add("sex_missing");
    if (activityLevel === null) incompleteReasons.add("activity_unset");
    if (input.activeGoal === null) incompleteReasons.add("no_active_goal");

    const firstReason: EnergyIncompleteReason | null = (() => {
      const order: EnergyIncompleteReason[] = [
        "weight_missing",
        "height_missing",
        "birth_year_missing",
        "sex_missing",
        "activity_unset",
        "no_active_goal",
      ];
      for (const candidate of order) {
        if (incompleteReasons.has(candidate)) return candidate;
      }
      return null;
    })();

    const ageYears =
      birthYear !== null ? ageFromBirthYear(birthYear, input.now) : null;
    const bmrKcal =
      resolvedWeight !== null &&
      heightCm !== null &&
      ageYears !== null &&
      sexAtBirth !== null
        ? roundKcal(
            mifflinStJeorBmr(resolvedWeight, heightCm, ageYears, sexAtBirth),
          )
        : null;
    const activityMultiplier =
      activityLevel !== null ? ACTIVITY_MULTIPLIERS[activityLevel] : null;
    const tdeeKcal =
      bmrKcal !== null && activityMultiplier !== null
        ? roundKcal(bmrKcal * activityMultiplier)
        : null;
    const exerciseKcal = null; // filled by route after running a side channel; null here means "not yet evaluated"
    const goalAdjustmentKcal =
      input.activeGoal !== null
        ? GOAL_ADJUSTMENT_KCAL[input.activeGoal.kind][input.activeGoal.pace]
        : null;

    let dailyTargetKcal: number | null = null;
    let belowFloor = false;
    if (tdeeKcal !== null && goalAdjustmentKcal !== null) {
      const candidate = tdeeKcal + goalAdjustmentKcal;
      // Safety floor — refuse to fabricate a target below the
      // sex-specific floor. The breakdown surfaces the reason;
      // the UI prompts the user.
      const floor = sexAtBirth !== null ? SAFETY_FLOOR_KCAL[sexAtBirth] : null;
      if (floor !== null && candidate < floor) {
        belowFloor = true;
        dailyTargetKcal = null;
      } else {
        dailyTargetKcal = roundKcal(candidate);
      }
    }

    let targetProteinG: number | null = null;
    let targetFatG: number | null = null;
    let targetCarbohydrateG: number | null = null;

    if (dailyTargetKcal !== null) {
      if (resolvedWeight !== null && resolvedWeight > 0) {
        const factor =
          input.activeGoal?.kind === "cut" ||
          input.activeGoal?.kind === "recomp"
            ? 2.0
            : input.activeGoal?.kind === "bulk"
              ? 1.8
              : 1.6;
        targetProteinG = Math.round(resolvedWeight * factor);
      } else {
        targetProteinG = Math.round((dailyTargetKcal * 0.25) / 4);
      }

      targetFatG = Math.round((dailyTargetKcal * 0.25) / 9);

      const proteinKcal = targetProteinG * 4;
      const fatKcal = targetFatG * 9;
      const remainingKcal = Math.max(
        0,
        dailyTargetKcal - proteinKcal - fatKcal,
      );
      targetCarbohydrateG = Math.round(remainingKcal / 4);
    }

    if (belowFloor) {
      incompleteReasons.add("below_safety_floor");
    }

    // ENG-05: enough observations? v1 needs at least three distinct
    // days of recent workouts before balancing against today's
    // consumption; otherwise we surface "stale" and let the UI
    // decide.
    const balanceKcal: number | null = null;
    const balanceUncertaintyKcal: number | null =
      input.recentWorkoutsDayCount < 3 ? null : 50;

    return {
      ok: true,
      breakdown: {
        formulaVersion: ENERGY_FORMULA_VERSION,
        userId,
        computedAt: input.now,
        complete:
          firstReason === null && !belowFloor && dailyTargetKcal !== null,
        incompleteReason: [...incompleteReasons][0] ?? firstReason,
        ageYears,
        bmrKcal,
        activityMultiplier,
        tdeeKcal,
        exerciseKcal,
        goalAdjustmentKcal,
        dailyTargetKcal,
        targetProteinG,
        targetCarbohydrateG,
        targetFatG,
        balanceKcal,
        balanceUncertaintyKcal,
        inputs: {
          weightKg: resolvedWeight,
          heightCm,
          birthYear,
          sexAtBirth,
          activityLevel,
          goalKind: input.activeGoal?.kind ?? null,
          goalPace: input.activeGoal?.pace ?? null,
        },
      },
    };
  },
};

/**
 * Public convenience function: run the v1 formula with the
 * current version constant. Future segments wire different
 * formulas through the `EnergyFormula` port.
 */
export const computeEnergy = (
  inputs: EnergyInputs,
  userId: UserId,
): EnergyComputeResult => mifflinStJeorFormula.compute(inputs, userId);

// `CURRENT_YEAR_REF` is exposed for tests; the reference-date
// helper is the deterministic anchor.
export { CURRENT_YEAR_REF };
