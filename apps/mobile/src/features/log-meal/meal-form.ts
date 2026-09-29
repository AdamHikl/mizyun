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

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isValidOperationId = (value: unknown): value is string =>
  typeof value === "string" && UUID_REGEX.test(value);

export const createOperationId = (): string => {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export interface MealFormStrings {
  readonly name: string;
  readonly calories: string;
  readonly protein: string;
  readonly carbs: string;
  readonly fat: string;
  readonly fibre?: string;
  readonly saturatedFat?: string;
  readonly totalSugars?: string;
  readonly sodium?: string;
  readonly cholesterol?: string;
}

export const ADVANCED_NUTRIENT_FIELDS = [
  "fibre",
  "saturatedFat",
  "totalSugars",
  "sodium",
  "cholesterol",
] as const;

export const advancedNutrientsFromForm = (form: MealFormStrings) => {
  const values = ADVANCED_NUTRIENT_FIELDS.map((field) =>
    parseOptionalNutritionNumber(form[field] ?? ""),
  );
  if (values.some((value) => !value.ok)) return null;
  const valueAt = (index: number): number | null => {
    const result = values[index];
    return result?.ok ? result.value : null;
  };
  return {
    fibreG: valueAt(0),
    saturatedFatG: valueAt(1),
    totalSugarsG: valueAt(2),
    sodiumMg: valueAt(3),
    cholesterolMg: valueAt(4),
  };
};

export const sameAdvancedNutrients = (
  previous: {
    readonly fibreG?: number | null;
    readonly saturatedFatG?: number | null;
    readonly totalSugarsG?: number | null;
    readonly sodiumMg?: number | null;
    readonly cholesterolMg?: number | null;
  },
  current: NonNullable<ReturnType<typeof advancedNutrientsFromForm>>,
): boolean =>
  (previous.fibreG ?? null) === current.fibreG &&
  (previous.saturatedFatG ?? null) === current.saturatedFatG &&
  (previous.totalSugarsG ?? null) === current.totalSugarsG &&
  (previous.sodiumMg ?? null) === current.sodiumMg &&
  (previous.cholesterolMg ?? null) === current.cholesterolMg;

/** An exact idempotent replay must be allowed to reconcile a lost response. */
export const needsFreshAdvancedGrant = (
  hasAdvancedInput: boolean,
  isExactRetry: boolean,
): boolean => hasAdvancedInput && !isExactRetry;

export interface RecoverableMealDraft extends MealFormStrings {
  readonly portionGrams?: string;
  readonly clientOperationId?: string;
  readonly consumedAt?: string;
  readonly submissionVersion?: number;
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
  const clientOpIdValid =
    record.clientOperationId === undefined ||
    isValidOperationId(record.clientOperationId);
  const portionGramsValid =
    record.portionGrams === undefined ||
    typeof record.portionGrams === "string";
  const consumedAtValid =
    record.consumedAt === undefined ||
    (typeof record.consumedAt === "string" &&
      !Number.isNaN(Date.parse(record.consumedAt)));
  const versionValid =
    record.submissionVersion === undefined ||
    typeof record.submissionVersion === "number";
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
  const advancedValid = ADVANCED_NUTRIENT_FIELDS.every(
    (field) => record[field] === undefined || typeof record[field] === "string",
  );
  return (
    stringsValid &&
    portionGramsValid &&
    clientOpIdValid &&
    consumedAtValid &&
    versionValid &&
    descriptionValid &&
    aiDraftValid &&
    proposalIdValid &&
    refineValid &&
    photoUriValid &&
    advancedValid
  );
};

export const isStaleMealTimestamp = (
  iso: string | null | undefined,
  now: Date = new Date(),
): boolean => {
  if (!iso) return true;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return true;
  const nowMs = now.getTime();
  const diffMs = nowMs - t;
  // If older than 4 hours or more than 5 minutes in future
  return diffMs > 4 * 60 * 60 * 1000 || diffMs < -5 * 60 * 1000;
};

export interface UpgradedMealDraft extends RecoverableMealDraft {
  readonly clientOperationId: string;
  readonly consumedAt: string;
  readonly submissionVersion: number;
}

export const upgradeLegacyMealDraft = (
  draft: RecoverableMealDraft,
  now: () => Date = () => new Date(),
): UpgradedMealDraft => {
  const currentDate = now();
  const isStale = isStaleMealTimestamp(draft.consumedAt, currentDate);
  const clientOperationId =
    !isStale && isValidOperationId(draft.clientOperationId)
      ? draft.clientOperationId
      : createOperationId();
  const consumedAt =
    !isStale && draft.consumedAt && !Number.isNaN(Date.parse(draft.consumedAt))
      ? draft.consumedAt
      : currentDate.toISOString();
  return {
    ...draft,
    clientOperationId,
    consumedAt,
    submissionVersion: 1,
  };
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
  fibre: editableNumber(entry.fibreG ?? null),
  saturatedFat: editableNumber(entry.saturatedFatG ?? null),
  totalSugars: editableNumber(entry.totalSugarsG ?? null),
  sodium: editableNumber(entry.sodiumMg ?? null),
  cholesterol: editableNumber(entry.cholesterolMg ?? null),
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

export const portionGramsStringFromDraft = (candidate: {
  readonly portionWeightG?: number | null | undefined;
}): string =>
  candidate.portionWeightG === null || candidate.portionWeightG === undefined
    ? ""
    : String(candidate.portionWeightG);
