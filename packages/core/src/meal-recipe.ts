import type { EnergyBreakdown } from "./energy";
import type { DailyFoodSummary } from "./food-entry";

export const MEAL_RECIPE_VERSION = "meal-recipe-v1" as const;
export const MEAL_RECIPE_RANKING_VERSION = "macro-balance-v1" as const;
export const MEAL_RECIPE_MIN_PORTION_GRAMS = 50;
export const MEAL_RECIPE_MAX_PORTION_GRAMS = 2000;
export const MEAL_RECIPE_MAX_RANK_RESULT_BYTES = 16_384;

export interface MealRecipeMacroGrams {
  readonly proteinG: number | null;
  readonly carbohydrateG: number | null;
  readonly fatG: number | null;
}
export interface MealRecipeSourceSnapshot {
  readonly localDate: string;
  readonly timeZone: string;
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly energyFormulaVersion: string;
  readonly goalRevision: string;
  readonly intakeRevision: string;
  readonly constraintsRevision: string;
  readonly profileRevision: string;
}
export type MealRecipeCoverage =
  "logged_so_far" | "confirmed_so_far" | "unknown";
export type MealRecipeContextReason =
  | "logged_so_far"
  | "confirmed_so_far"
  | "targets_unavailable"
  | "intake_unknown"
  | "source_incomplete"
  | "source_stale"
  | "no_remaining_gaps";
export interface MealRecipeMacroContext {
  readonly version: typeof MEAL_RECIPE_VERSION;
  readonly rankingVersion: typeof MEAL_RECIPE_RANKING_VERSION;
  readonly targets: MealRecipeMacroGrams;
  readonly consumed: MealRecipeMacroGrams;
  readonly remaining: MealRecipeMacroGrams;
  readonly positiveGaps: MealRecipeMacroGrams;
  readonly snapshot: MealRecipeSourceSnapshot;
  readonly coverage: MealRecipeCoverage;
  readonly state: "ready" | "unknown" | "stale" | "no_remaining_gaps";
  readonly reason: MealRecipeContextReason;
  readonly focus: readonly ("protein" | "carbohydrate" | "fat")[];
}
export interface MealRecipeContextInput {
  readonly energy: Pick<
    EnergyBreakdown,
    | "complete"
    | "formulaVersion"
    | "targetProteinG"
    | "targetCarbohydrateG"
    | "targetFatG"
  >;
  readonly summary: Pick<
    DailyFoodSummary,
    "date" | "entryCount" | "proteinG" | "carbohydrateG" | "fatG"
  > | null;
  readonly snapshot: MealRecipeSourceSnapshot;
  readonly coverage: MealRecipeCoverage;
  /** Exhausted read pages, not proof the person logged every meal. */
  readonly intakeReadComplete: boolean;
  readonly now: Date;
}
export type MealRecipePreparationState = "raw" | "cooked" | "as_sold";
/** Trusted, catalog-validated candidate. A provider output alone is insufficient. */
export interface MealRecipeCandidate {
  readonly recipeId: string;
  readonly name: string;
  readonly nutrition: MealRecipeMacroGrams;
  readonly portionGrams: number;
  readonly minimumPortionGrams: number;
  readonly maximumPortionGrams: number;
  readonly preparationState: MealRecipePreparationState;
  readonly nutritionPreparationState: MealRecipePreparationState;
  readonly availability: "confirmed" | "check_quantity" | "missing";
  readonly prepMinutes: number;
  readonly estimateQuality: "reference" | "estimated" | "unknown";
  readonly excluded: boolean;
}
export type MealRecipeRejectionReason =
  | "invalid_candidate"
  | "portion_out_of_bounds"
  | "preparation_mismatch"
  | "excluded"
  | "missing_ingredients";
export interface MealRecipeRankResult {
  readonly context: MealRecipeMacroContext;
  readonly ranked: readonly {
    readonly recipeId: string;
    readonly name: string;
    readonly fitLoss: number | null;
    readonly desiredMacros: MealRecipeMacroGrams;
    readonly reason: MealRecipeContextReason;
  }[];
  readonly rejected: readonly {
    readonly recipeId: string | null;
    readonly reason: MealRecipeRejectionReason;
  }[];
}

const fields = ["proteinG", "carbohydrateG", "fatG"] as const;
const weights = { proteinG: 4, carbohydrateG: 4, fatG: 9 } as const;
const labels = {
  proteinG: "protein",
  carbohydrateG: "carbohydrate",
  fatG: "fat",
} as const;
const emptyMacros = (): MealRecipeMacroGrams => ({
  proteinG: null,
  carbohydrateG: null,
  fatG: null,
});
const validGram = (n: number | null): n is number =>
  n !== null && Number.isFinite(n) && n >= 0 && n <= 10_000;
const knownMacros = (m: MealRecipeMacroGrams): boolean =>
  fields.every((field) => validGram(m[field]));
const sanitized = (m: MealRecipeMacroGrams): MealRecipeMacroGrams =>
  Object.fromEntries(
    fields.map((field) => [field, validGram(m[field]) ? m[field] : null]),
  ) as unknown as MealRecipeMacroGrams;
const energy = (m: MealRecipeMacroGrams): number =>
  fields.reduce((total, field) => total + weights[field] * (m[field] ?? 0), 0);
const mapMacros = (
  f: (field: (typeof fields)[number]) => number | null,
): MealRecipeMacroGrams =>
  Object.fromEntries(
    fields.map((field) => [field, f(field)]),
  ) as unknown as MealRecipeMacroGrams;

const gapKcal = (gaps: MealRecipeMacroGrams, field: (typeof fields)[number]) =>
  weights[field] * (gaps[field] ?? 0);
/**
 * A macro is in focus when its energy gap is at least 20% of the remaining
 * macro energy. Protein is also in focus whenever at least 20% of its target
 * is still open, even when fat's 9 kcal/g gives it a larger share of the
 * remaining energy. Ordered by energy gap, largest first.
 */
const focusFields = (
  targets: MealRecipeMacroGrams,
  gaps: MealRecipeMacroGrams,
): MealRecipeMacroContext["focus"] => {
  const proteinTarget = targets.proteinG ?? 0;
  const proteinOpen =
    proteinTarget > 0 && (gaps.proteinG ?? 0) / proteinTarget >= 0.2;
  const gapEnergy = energy(gaps);
  return fields
    .filter(
      (field) =>
        gapKcal(gaps, field) / gapEnergy >= 0.2 ||
        (field === "proteinG" && proteinOpen),
    )
    .sort(
      (a, b) =>
        gapKcal(gaps, b) - gapKcal(gaps, a) ||
        fields.indexOf(a) - fields.indexOf(b),
    )
    .map((field) => labels[field]);
};

const localDate = (now: Date, timeZone: string): string | null => {
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return null;
  }
};
const identityFields = [
  "localDate",
  "timeZone",
  "energyFormulaVersion",
  "goalRevision",
  "intakeRevision",
  "constraintsRevision",
  "profileRevision",
] as const;
const fresh = (
  snapshot: MealRecipeSourceSnapshot,
  now: Date,
  current: Pick<MealRecipeSourceSnapshot, (typeof identityFields)[number]>,
): boolean => {
  const generated = Date.parse(snapshot.generatedAt);
  const expires = Date.parse(snapshot.expiresAt);
  return (
    Number.isFinite(now.getTime()) &&
    Number.isFinite(generated) &&
    Number.isFinite(expires) &&
    generated <= now.getTime() &&
    expires > now.getTime() &&
    expires > generated &&
    localDate(now, snapshot.timeZone) === snapshot.localDate &&
    localDate(new Date(generated), snapshot.timeZone) === snapshot.localDate &&
    identityFields.every(
      (key) =>
        typeof snapshot[key] === "string" &&
        snapshot[key].length > 0 &&
        snapshot[key].length <= 128 &&
        snapshot[key] === current[key],
    )
  );
};

/** Shared temporal/day/revision validity for recipe fit and cooking authority. */
export const isMealRecipeSnapshotFresh = fresh;

/** Uses the Home energy engine's targets; never substitutes Coach targets or unknown intake. */
export const buildMealRecipeMacroContext = (
  input: MealRecipeContextInput,
): MealRecipeMacroContext => {
  const targets = sanitized({
    proteinG: input.energy.targetProteinG,
    carbohydrateG: input.energy.targetCarbohydrateG,
    fatG: input.energy.targetFatG,
  });
  const consumed = sanitized(input.summary ?? emptyMacros());
  const remaining = mapMacros((field) => {
    const t = targets[field];
    const c = consumed[field];
    return t === null || c === null ? null : t - c;
  });
  const positiveGaps = mapMacros((field) => {
    const n = remaining[field];
    return n === null ? null : Math.max(0, n);
  });
  let reason: MealRecipeContextReason;
  if (
    !fresh(input.snapshot, input.now, input.snapshot) ||
    input.energy.formulaVersion !== input.snapshot.energyFormulaVersion ||
    (input.summary !== null && input.summary.date !== input.snapshot.localDate)
  ) {
    reason = "source_stale";
  } else if (!input.intakeReadComplete) {
    reason = "source_incomplete";
  } else if (!input.energy.complete || !knownMacros(targets)) {
    reason = "targets_unavailable";
  } else if (
    input.coverage === "unknown" ||
    !knownMacros(consumed) ||
    input.summary === null ||
    !Number.isInteger(input.summary.entryCount) ||
    input.summary.entryCount < 0 ||
    (input.summary.entryCount === 0 && energy(consumed) !== 0)
  ) {
    reason = "intake_unknown";
  } else if (energy(positiveGaps) === 0) {
    reason = "no_remaining_gaps";
  } else {
    reason = input.coverage;
  }
  const state =
    reason === "source_stale"
      ? "stale"
      : reason === "no_remaining_gaps"
        ? "no_remaining_gaps"
        : reason === "logged_so_far" || reason === "confirmed_so_far"
          ? "ready"
          : "unknown";
  const focus = state === "ready" ? focusFields(targets, positiveGaps) : [];
  return {
    version: MEAL_RECIPE_VERSION,
    rankingVersion: MEAL_RECIPE_RANKING_VERSION,
    targets,
    consumed,
    remaining,
    positiveGaps,
    snapshot: { ...input.snapshot },
    coverage: input.coverage,
    state,
    reason,
    focus,
  };
};

const rejectCandidate = (
  c: MealRecipeCandidate,
): MealRecipeRejectionReason | null => {
  if (
    typeof c.recipeId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(c.recipeId) ||
    typeof c.name !== "string" ||
    !c.name.trim() ||
    c.name.length > 160 ||
    !Number.isInteger(c.prepMinutes) ||
    c.prepMinutes < 0 ||
    c.prepMinutes > 1440 ||
    !["confirmed", "check_quantity", "missing"].includes(c.availability) ||
    !["reference", "estimated", "unknown"].includes(c.estimateQuality) ||
    typeof c.excluded !== "boolean" ||
    fields.some(
      (field) => c.nutrition[field] !== null && !validGram(c.nutrition[field]),
    )
  )
    return "invalid_candidate";
  if (c.excluded) return "excluded";
  if (c.availability === "missing") return "missing_ingredients";
  if (
    !["raw", "cooked", "as_sold"].includes(c.preparationState) ||
    c.preparationState !== c.nutritionPreparationState
  )
    return "preparation_mismatch";
  if (
    !Number.isFinite(c.portionGrams) ||
    !Number.isFinite(c.minimumPortionGrams) ||
    !Number.isFinite(c.maximumPortionGrams) ||
    c.minimumPortionGrams < MEAL_RECIPE_MIN_PORTION_GRAMS ||
    c.maximumPortionGrams > MEAL_RECIPE_MAX_PORTION_GRAMS ||
    c.minimumPortionGrams > c.maximumPortionGrams ||
    c.portionGrams < c.minimumPortionGrams ||
    c.portionGrams > c.maximumPortionGrams
  )
    return "portion_out_of_bounds";
  if (
    fields.reduce((sum, field) => sum + (c.nutrition[field] ?? 0), 0) >
    c.portionGrams
  )
    return "invalid_candidate";
  if (knownMacros(c.nutrition) && energy(c.nutrition) === 0)
    return "invalid_candidate";
  return null;
};
const stableCompare = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

// JSON escapes lone surrogates; iteration counts actual UTF-8 scalar widths.
const utf8Bytes = (value: string): number => {
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
};

/** Lower loss fits better. Missing/stale context preserves ordinary recipe discovery.
 * Throws RangeError for >100 candidates or an output exceeding the wire byte limit.
 * Composition must normalize that explicit failure; never silently truncate rejections.
 */
export const rankMealRecipeCandidates = (
  original: MealRecipeMacroContext,
  candidates: readonly MealRecipeCandidate[],
  freshness: {
    readonly now: Date;
    readonly current: Pick<
      MealRecipeSourceSnapshot,
      (typeof identityFields)[number]
    >;
  },
): MealRecipeRankResult => {
  if (candidates.length > 100)
    throw new RangeError("At most 100 recipe candidates");
  const context: MealRecipeMacroContext = fresh(
    original.snapshot,
    freshness.now,
    freshness.current,
  )
    ? original
    : { ...original, state: "stale", reason: "source_stale", focus: [] };
  const rejected: {
    recipeId: string | null;
    reason: MealRecipeRejectionReason;
  }[] = [];
  const accepted = [];
  for (const candidate of candidates) {
    const rejection = rejectCandidate(candidate);
    if (rejection) {
      rejected.push({
        recipeId:
          typeof candidate.recipeId === "string" &&
          /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(candidate.recipeId)
            ? candidate.recipeId
            : null,
        reason: rejection,
      });
      continue;
    }
    const m = candidate.nutrition;
    const canScore =
      context.state === "ready" &&
      knownMacros(m) &&
      candidate.estimateQuality !== "unknown";
    let desiredMacros = emptyMacros();
    let fitLoss: number | null = null;
    if (canScore) {
      const portionEnergy = energy(m);
      const alpha = Math.min(1, portionEnergy / energy(context.positiveGaps));
      desiredMacros = mapMacros(
        (field) => alpha * context.positiveGaps[field]!,
      );
      fitLoss =
        fields.reduce((loss, field) => {
          const value = m[field]!;
          const mismatch = Math.abs(value - desiredMacros[field]!);
          const overshoot = Math.max(0, value - context.positiveGaps[field]!);
          return loss + weights[field] * (mismatch + 2 * overshoot);
        }, 0) / Math.max(portionEnergy, 1);
    }
    accepted.push({ candidate, desiredMacros, fitLoss });
  }
  const quality = { reference: 0, estimated: 1, unknown: 2 } as const;
  accepted.sort(
    (a, b) =>
      (a.fitLoss === null ? 1 : 0) - (b.fitLoss === null ? 1 : 0) ||
      (a.fitLoss ?? 0) - (b.fitLoss ?? 0) ||
      (a.candidate.availability === "confirmed" ? 0 : 1) -
        (b.candidate.availability === "confirmed" ? 0 : 1) ||
      a.candidate.prepMinutes - b.candidate.prepMinutes ||
      quality[a.candidate.estimateQuality] -
        quality[b.candidate.estimateQuality] ||
      stableCompare(a.candidate.recipeId, b.candidate.recipeId) ||
      a.candidate.portionGrams - b.candidate.portionGrams ||
      stableCompare(a.candidate.name, b.candidate.name) ||
      energy(a.candidate.nutrition) - energy(b.candidate.nutrition) ||
      fields.reduce(
        (diff, field) =>
          diff ||
          (a.candidate.nutrition[field] ?? -1) -
            (b.candidate.nutrition[field] ?? -1),
        0,
      ),
  );
  const seen = new Set<string>();
  const result: MealRecipeRankResult = {
    context,
    ranked: accepted
      .filter(({ candidate }) => {
        if (seen.has(candidate.recipeId)) return false;
        seen.add(candidate.recipeId);
        return true;
      })
      .slice(0, 20)
      .map(({ candidate, fitLoss, desiredMacros }) => ({
        recipeId: candidate.recipeId,
        name: candidate.name,
        fitLoss,
        desiredMacros,
        reason: context.reason,
      })),
    rejected,
  };
  if (utf8Bytes(JSON.stringify(result)) > MEAL_RECIPE_MAX_RANK_RESULT_BYTES)
    throw new RangeError("Recipe ranking exceeds the 16 KiB response limit");
  return result;
};
