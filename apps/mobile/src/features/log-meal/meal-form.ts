import {
  foodDraftCandidateSchema,
  type FoodDraftCandidate,
  type FoodEntry,
} from "@mizyun/contracts";

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

export interface RecoverableMealDraft extends MealFormStrings {
  readonly description?: string;
  readonly aiDraft?: FoodDraftCandidate;
  readonly sourceProposalId?: string;
  readonly refineInstruction?: string;
  readonly attachedPhotoUri?: string;
}

export const isRecoverableMealDraft = (
  value: unknown,
): value is RecoverableMealDraft => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const stringsValid = ["name", "calories", "protein", "carbs", "fat"].every(
    (field) => typeof record[field] === "string",
  );
  const descriptionValid =
    record.description === undefined || typeof record.description === "string";
  const aiDraftValid =
    record.aiDraft === undefined ||
    foodDraftCandidateSchema.safeParse(record.aiDraft).success;
  const proposalIdValid =
    record.sourceProposalId === undefined ||
    typeof record.sourceProposalId === "string";
  const refineValid =
    record.refineInstruction === undefined ||
    typeof record.refineInstruction === "string";
  const photoUriValid =
    record.attachedPhotoUri === undefined ||
    typeof record.attachedPhotoUri === "string";
  return (
    stringsValid &&
    descriptionValid &&
    aiDraftValid &&
    proposalIdValid &&
    refineValid &&
    photoUriValid
  );
};

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
 * Map a photo-draft candidate to the form's string state. If a
 * point estimate is null but a range was provided, use the range
 * midpoint so the form is populated with the estimated value.
 */
export const mealFormStringsFromDraft = (candidate: {
  readonly name: string | null;
  readonly caloriesKcal: number | null;
  readonly proteinG: number | null;
  readonly carbohydrateG: number | null;
  readonly fatG: number | null;
  readonly calorieRangeKcal?: {
    readonly low: number;
    readonly high: number;
  } | null;
  readonly proteinRangeG?: {
    readonly low: number;
    readonly high: number;
  } | null;
  readonly carbohydrateRangeG?: {
    readonly low: number;
    readonly high: number;
  } | null;
  readonly fatRangeG?: { readonly low: number; readonly high: number } | null;
}): MealFormStrings => {
  const calories =
    candidate.caloriesKcal ??
    (candidate.calorieRangeKcal
      ? Math.round(
          (candidate.calorieRangeKcal.low + candidate.calorieRangeKcal.high) /
            2,
        )
      : null);
  const protein =
    candidate.proteinG ??
    (candidate.proteinRangeG
      ? Math.round(
          ((candidate.proteinRangeG.low + candidate.proteinRangeG.high) / 2) *
            10,
        ) / 10
      : null);
  const carbs =
    candidate.carbohydrateG ??
    (candidate.carbohydrateRangeG
      ? Math.round(
          ((candidate.carbohydrateRangeG.low +
            candidate.carbohydrateRangeG.high) /
            2) *
            10,
        ) / 10
      : null);
  const fat =
    candidate.fatG ??
    (candidate.fatRangeG
      ? Math.round(
          ((candidate.fatRangeG.low + candidate.fatRangeG.high) / 2) * 10,
        ) / 10
      : null);

  return {
    name: candidate.name ?? "",
    calories: editableNumber(calories),
    protein: editableNumber(protein),
    carbs: editableNumber(carbs),
    fat: editableNumber(fat),
  };
};
