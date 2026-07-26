import type { FoodEntry } from "@mizyun/contracts";

export type OptionalNumberResult =
  { readonly ok: true; readonly value: number | null } | { readonly ok: false };

export const parseOptionalNutritionNumber = (
  raw: string,
): OptionalNumberResult => {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed.length === 0) return { ok: true, value: null };
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0
    ? { ok: true, value }
    : { ok: false };
};

export interface MealFormStrings {
  readonly name: string;
  readonly calories: string;
  readonly protein: string;
  readonly carbs: string;
  readonly fat: string;
}

const editableNumber = (value: number | null): string =>
  value === null ? "" : String(value);

export const mealFormStringsFromEntry = (
  entry: FoodEntry,
): MealFormStrings => ({
  name: entry.name,
  calories: editableNumber(entry.caloriesKcal),
  protein: editableNumber(entry.proteinG),
  carbs: editableNumber(entry.carbohydrateG),
  fat: editableNumber(entry.fatG),
});

/**
 * Map a photo-draft candidate to the form's string state. The
 * model is allowed to return `null` for any field; we leave the
 * form field blank in that case so the user fills it in
 * manually rather than us writing a misleading default.
 */
export const mealFormStringsFromDraft = (candidate: {
  name: string | null;
  caloriesKcal: number | null;
  proteinG: number | null;
  carbohydrateG: number | null;
  fatG: number | null;
}): MealFormStrings => ({
  name: candidate.name ?? "",
  calories: editableNumber(candidate.caloriesKcal),
  protein: editableNumber(candidate.proteinG),
  carbs: editableNumber(candidate.carbohydrateG),
  fat: editableNumber(candidate.fatG),
});
