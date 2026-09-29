import type { FoodEntry } from "@mizyun/contracts";

export interface BaseNutritionWithGrams {
  readonly caloriesKcal: number | null;
  readonly proteinG: number | null;
  readonly carbohydrateG: number | null;
  readonly fatG: number | null;
  readonly fibreG?: number | null;
  readonly saturatedFatG?: number | null;
  readonly totalSugarsG?: number | null;
  readonly sodiumMg?: number | null;
  readonly cholesterolMg?: number | null;
  readonly grams: number;
}

export interface ScaledNutrition {
  readonly caloriesKcal: number | null;
  readonly proteinG: number | null;
  readonly carbohydrateG: number | null;
  readonly fatG: number | null;
  readonly fibreG?: number | null;
  readonly saturatedFatG?: number | null;
  readonly totalSugarsG?: number | null;
  readonly sodiumMg?: number | null;
  readonly cholesterolMg?: number | null;
  readonly ratio: number;
}

/** Keep already recorded advanced values in sync after a portion change. */
export const scaledAdvancedPatchForExisting = (
  entry: Pick<
    FoodEntry,
    "fibreG" | "saturatedFatG" | "totalSugarsG" | "sodiumMg" | "cholesterolMg"
  >,
  scaled: ScaledNutrition,
) => ({
  ...(entry.fibreG == null ? {} : { fibreG: scaled.fibreG }),
  ...(entry.saturatedFatG == null
    ? {}
    : { saturatedFatG: scaled.saturatedFatG }),
  ...(entry.totalSugarsG == null ? {} : { totalSugarsG: scaled.totalSugarsG }),
  ...(entry.sodiumMg == null ? {} : { sodiumMg: scaled.sodiumMg }),
  ...(entry.cholesterolMg == null
    ? {}
    : { cholesterolMg: scaled.cholesterolMg }),
});

export interface MealGroupInfo {
  readonly id: string;
  readonly name: string;
}

/**
 * Common regex pattern to find weight in grams:
 * Matches "200g", "200 g", "200.5g", "200 grams", "200 gram"
 * either at start/end of string, surrounded by whitespace, or inside parentheses.
 */
const GRAMS_REGEX = /(?:^|[\s(])(\d+(?:\.\d+)?)\s*g(?:rams?|r)?(?=[\s)]|$)/i;

/**
 * Extracts a numeric portion weight in grams from a food's name.
 * For example:
 *   "Chicken breast 200g" -> 200
 *   "150.5 g White Rice"  -> 150.5
 *   "Oatmeal (80g)"       -> 80
 *   "Apple"               -> null
 */
export const extractGramsFromName = (name: string): number | null => {
  const match = name.match(GRAMS_REGEX);
  if (match === null || match[1] === undefined) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/**
 * Updates or replaces the grams in a food's name string if it was previously present.
 * For example:
 *   "Chicken breast 200g" with newGrams 250 -> "Chicken breast 250g"
 *   "Rice (150 g)" with newGrams 100        -> "Rice (100g)"
 * If no grams were in the name originally, the original name is preserved untouched.
 */
export const updateGramsInName = (name: string, newGrams: number): string => {
  const match = name.match(GRAMS_REGEX);
  if (match === null || match[1] === undefined) return name;
  const formattedGrams = Number.isInteger(newGrams)
    ? String(newGrams)
    : String(Math.round(newGrams * 10) / 10);

  return name.replace(
    new RegExp(`(^|[\\s(])(${match[1]}\\s*g(?:rams?|r)?)(?=[\\s)]|$)`, "i"),
    `$1${formattedGrams}g`,
  );
};

const roundMacro = (value: number | null, ratio: number): number | null => {
  if (value === null) return null;
  const scaled = value * ratio;
  return Math.round(scaled * 10) / 10;
};

const roundCalories = (value: number | null, ratio: number): number | null => {
  if (value === null) return null;
  return Math.round(value * ratio);
};

/**
 * Pure mathematical scaling function.
 * Given a food's baseline nutrition and baseline grams, calculates the
 * scaled calories and macros for targetGrams.
 */
export const scaleNutrition = (
  base: BaseNutritionWithGrams,
  targetGrams: number,
): ScaledNutrition => {
  if (base.grams <= 0 || targetGrams <= 0 || !Number.isFinite(targetGrams)) {
    return {
      caloriesKcal: base.caloriesKcal,
      proteinG: base.proteinG,
      carbohydrateG: base.carbohydrateG,
      fatG: base.fatG,
      fibreG: base.fibreG,
      saturatedFatG: base.saturatedFatG,
      totalSugarsG: base.totalSugarsG,
      sodiumMg: base.sodiumMg,
      cholesterolMg: base.cholesterolMg,
      ratio: 1,
    };
  }

  const ratio = targetGrams / base.grams;

  return {
    caloriesKcal: roundCalories(base.caloriesKcal, ratio),
    proteinG: roundMacro(base.proteinG, ratio),
    carbohydrateG: roundMacro(base.carbohydrateG, ratio),
    fatG: roundMacro(base.fatG, ratio),
    fibreG: roundMacro(base.fibreG ?? null, ratio),
    saturatedFatG: roundMacro(base.saturatedFatG ?? null, ratio),
    totalSugarsG: roundMacro(base.totalSugarsG ?? null, ratio),
    sodiumMg: roundCalories(base.sodiumMg ?? null, ratio),
    cholesterolMg: roundCalories(base.cholesterolMg ?? null, ratio),
    ratio,
  };
};

/**
 * Establishing a previously unknown portion weight must not reinterpret the
 * saved nutrition totals as values per 100g. Scale only when a real baseline
 * weight was already recorded.
 */
export const scaleNutritionFromKnownPortion = (
  base: Omit<BaseNutritionWithGrams, "grams"> & {
    readonly grams: number | null;
  },
  targetGrams: number,
): ScaledNutrition =>
  base.grams === null
    ? {
        caloriesKcal: base.caloriesKcal,
        proteinG: base.proteinG,
        carbohydrateG: base.carbohydrateG,
        fatG: base.fatG,
        fibreG: base.fibreG,
        saturatedFatG: base.saturatedFatG,
        totalSugarsG: base.totalSugarsG,
        sodiumMg: base.sodiumMg,
        cholesterolMg: base.cholesterolMg,
        ratio: 1,
      }
    : scaleNutrition({ ...base, grams: base.grams }, targetGrams);

/**
 * Reads a food entry's recorded grams, checking `details.grams` first,
 * then parsing from `entry.name`.
 */
export const getEntryGrams = (entry: FoodEntry): number | null => {
  const detailsGrams = entry.details?.grams;
  if (
    typeof detailsGrams === "number" &&
    Number.isFinite(detailsGrams) &&
    detailsGrams > 0
  ) {
    return detailsGrams;
  }
  return extractGramsFromName(entry.name);
};

/**
 * Reads the meal group info (id and name) from `entry.details`, if grouped.
 */
export const getEntryMealGroup = (entry: FoodEntry): MealGroupInfo | null => {
  const details = entry.details;
  if (typeof details !== "object" || details === null) return null;

  const groupObj = (details as Record<string, unknown>).mealGroup;
  if (
    typeof groupObj === "object" &&
    groupObj !== null &&
    typeof (groupObj as Record<string, unknown>).id === "string" &&
    typeof (groupObj as Record<string, unknown>).name === "string"
  ) {
    const id = (groupObj as Record<string, unknown>).id as string;
    const name = (groupObj as Record<string, unknown>).name as string;
    if (id.trim().length > 0 && name.trim().length > 0) {
      return { id: id.trim(), name: name.trim() };
    }
  }

  const id = (details as Record<string, unknown>).mealGroupId;
  const name = (details as Record<string, unknown>).mealGroupName;
  if (
    typeof id === "string" &&
    id.trim().length > 0 &&
    typeof name === "string" &&
    name.trim().length > 0
  ) {
    return { id: id.trim(), name: name.trim() };
  }

  return null;
};

/**
 * Returns a new details object with the meal group attached (or removed if null).
 */
export const withMealGroup = (
  existingDetails: Readonly<Record<string, unknown>> | undefined,
  group: MealGroupInfo | null,
): Record<string, unknown> => {
  const next = { ...(existingDetails ?? {}) };
  if (group === null) {
    delete next.mealGroup;
    delete next.mealGroupId;
    delete next.mealGroupName;
  } else {
    next.mealGroupId = group.id;
    next.mealGroupName = group.name;
    next.mealGroup = { id: group.id, name: group.name };
  }
  return next;
};

/**
 * Returns a new details object with the grams recorded.
 */
export const withMealGrams = (
  existingDetails: Readonly<Record<string, unknown>> | undefined,
  grams: number | null,
): Record<string, unknown> => {
  const next = { ...(existingDetails ?? {}) };
  if (grams === null || grams <= 0) {
    delete next.grams;
  } else {
    next.grams = Number.isInteger(grams) ? grams : Math.round(grams * 10) / 10;
  }
  return next;
};
