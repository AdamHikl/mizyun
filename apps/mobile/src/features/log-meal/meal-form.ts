import {
  foodDraftCandidateSchema,
  foodEntryCreateSchema,
  type FoodDraftCandidate,
  type FoodEntry,
} from "@mizyun/contracts";
import { nutritionForWeightFromPer100g } from "@mizyun/core";

import type { LogMealForm } from "./log-meal-data";

export type NutritionEntryBasis = "total" | "per100g";

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

/** Convert raw label inputs only at preview/submission, never cumulatively. */
export const mealNutritionForSubmission = (
  form: MealFormStrings,
  basis: NutritionEntryBasis,
  portionGrams: string,
) => {
  const calories = parseOptionalNutritionNumber(form.calories);
  const protein = parseOptionalNutritionNumber(form.protein);
  const carbs = parseOptionalNutritionNumber(form.carbs);
  const fat = parseOptionalNutritionNumber(form.fat);
  const weight = parseOptionalNutritionNumber(portionGrams);
  const advanced = advancedNutrientsFromForm(form);
  if (
    !weight.ok ||
    (weight.value !== null && weight.value <= 0) ||
    (basis === "per100g" && (weight.value === null || weight.value > 20_000))
  )
    return {
      ok: false as const,
      message:
        basis === "per100g"
          ? "Enter a food weight greater than 0 and no more than 20,000 g for values per 100 g."
          : "Portion weight must be greater than zero or blank.",
    };
  if (!calories.ok || !protein.ok || !carbs.ok || !fat.ok || advanced === null)
    return {
      ok: false as const,
      message: "Nutrient values must be non-negative numbers or blank.",
    };
  const nutrition = {
    caloriesKcal: calories.value,
    proteinG: protein.value,
    carbohydrateG: carbs.value,
    fatG: fat.value,
    ...advanced,
  };
  if (basis === "total")
    return { ok: true as const, nutrition, grams: weight.value };
  const scaled = nutritionForWeightFromPer100g(nutrition, weight.value!);
  if (!scaled.ok)
    return {
      ok: false as const,
      message:
        "The label values or calculated totals exceed the supported nutrient limits. Check the values and food weight.",
    };
  return {
    ok: true as const,
    nutrition: { ...nutrition, ...scaled.value },
    grams: weight.value,
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

/** Validate a route/draft calendar day without UTC parsing or rollover. */
export const parseMealDate = (value: unknown): string | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1000) return null;
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? value
    : null;
};

export const mealTimestampForDate = (
  date: string,
  now: Date = new Date(),
): string => {
  const [year, month, day] = date.split("-").map(Number);
  const local = new Date(year, month - 1, day, 12);
  return local.toDateString() === now.toDateString()
    ? now.toISOString()
    : local.toISOString();
};

export const mealTimestampMatchesDate = (
  timestamp: string | null | undefined,
  date: string,
): boolean => {
  if (!timestamp || !parseMealDate(date)) return false;
  return (
    new Date(timestamp).toDateString() ===
    new Date(mealTimestampForDate(date)).toDateString()
  );
};

export interface RecoverableMealDraft extends MealFormStrings {
  readonly preparedMeal?: LogMealForm;
  readonly submittedMeal?: LogMealForm;
  readonly submissionStatus?: "outcome_unknown";
  readonly mealDate?: string;
  readonly nutritionBasis?: NutritionEntryBasis;
  readonly portionGrams?: string;
  readonly clientOperationId?: string;
  readonly consumedAt?: string;
  readonly submissionVersion?: number;
  readonly description?: string;
  readonly aiDraft?: FoodDraftCandidate;
  readonly sourceProposalId?: string;
  readonly refineInstruction?: string;
  readonly keepPhoto?: boolean;
  readonly selectedPhotoUri?: string | null;
  readonly attachedPhotoUri?: string;
  readonly attachedPhotoUris?: readonly string[];
  readonly pendingPhotoDrafts?: readonly FoodDraftCandidate[];
}

export const sameMealDetails = (left: unknown, right: unknown): boolean => {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)]),
      );
    return value;
  };
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
};

/** Reject corrupt frozen bodies rather than silently changing retry semantics. */
export const isFrozenMealForm = (value: unknown): value is LogMealForm => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "clientOperationId",
    "name",
    "consumedAt",
    "caloriesKcal",
    "proteinG",
    "carbohydrateG",
    "fatG",
    "fibreG",
    "saturatedFatG",
    "totalSugarsG",
    "sodiumMg",
    "cholesterolMg",
    "details",
    "healthExportFirstParty",
    "healthExportTimeBasis",
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return false;
  if (
    !isValidOperationId(record.clientOperationId) ||
    typeof record.consumedAt !== "string"
  )
    return false;
  if (
    !["caloriesKcal", "proteinG", "carbohydrateG", "fatG"].every(
      (key) => record[key] === null || typeof record[key] === "number",
    )
  )
    return false;
  if (
    record.healthExportFirstParty !== undefined &&
    typeof record.healthExportFirstParty !== "boolean"
  )
    return false;
  if (
    record.healthExportTimeBasis !== undefined &&
    record.healthExportTimeBasis !== "observed" &&
    record.healthExportTimeBasis !== "date_only"
  )
    return false;
  const validJson = (item: unknown, depth = 0): boolean => {
    if (depth > 12) return false;
    if (item === null || typeof item === "string" || typeof item === "boolean")
      return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (Array.isArray(item))
      return item.every((child) => validJson(child, depth + 1));
    if (
      item &&
      typeof item === "object" &&
      Object.getPrototypeOf(item) === Object.prototype
    )
      return Object.values(item).every((child) => validJson(child, depth + 1));
    return false;
  };
  if (record.details !== undefined && !validJson(record.details)) return false;
  const { healthExportFirstParty, healthExportTimeBasis, ...payload } = record;
  try {
    if (JSON.stringify(value).length > 64_000) return false;
    return foodEntryCreateSchema.safeParse(payload).success;
  } catch {
    return false;
  }
};

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
  const basisValid =
    record.nutritionBasis === undefined ||
    record.nutritionBasis === "total" ||
    record.nutritionBasis === "per100g";
  const consumedAtValid =
    record.consumedAt === undefined ||
    (typeof record.consumedAt === "string" &&
      !Number.isNaN(Date.parse(record.consumedAt)));
  const mealDateValid =
    record.mealDate === undefined || parseMealDate(record.mealDate) !== null;
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
  const photosValid =
    record.attachedPhotoUris === undefined ||
    (Array.isArray(record.attachedPhotoUris) &&
      record.attachedPhotoUris.length <= 3 &&
      record.attachedPhotoUris.every((uri) => typeof uri === "string"));
  const pendingValid =
    record.pendingPhotoDrafts === undefined ||
    (Array.isArray(record.pendingPhotoDrafts) &&
      record.pendingPhotoDrafts.length <= 2 &&
      record.pendingPhotoDrafts.every(
        (draft) => foodDraftCandidateSchema.safeParse(draft).success,
      ));
  const advancedValid = ADVANCED_NUTRIENT_FIELDS.every(
    (field) => record[field] === undefined || typeof record[field] === "string",
  );
  return (
    stringsValid &&
    (record.preparedMeal === undefined ||
      (isFrozenMealForm(record.preparedMeal) &&
        record.preparedMeal.clientOperationId === record.clientOperationId)) &&
    (record.submissionStatus === undefined ||
      record.submissionStatus === "outcome_unknown") &&
    (record.submittedMeal === undefined
      ? record.submissionStatus === undefined
      : record.submissionStatus === "outcome_unknown" &&
        isFrozenMealForm(record.submittedMeal) &&
        record.submittedMeal.clientOperationId === record.clientOperationId &&
        record.submittedMeal.consumedAt === record.consumedAt) &&
    portionGramsValid &&
    basisValid &&
    clientOpIdValid &&
    consumedAtValid &&
    mealDateValid &&
    versionValid &&
    descriptionValid &&
    aiDraftValid &&
    proposalIdValid &&
    refineValid &&
    photoUriValid &&
    photosValid &&
    pendingValid &&
    advancedValid &&
    (record.keepPhoto === undefined || typeof record.keepPhoto === "boolean") &&
    (record.selectedPhotoUri === undefined ||
      record.selectedPhotoUri === null ||
      typeof record.selectedPhotoUri === "string")
  );
};

/** Recovery reviews the immutable submitted values, even if autosaved edits differ. */
export const mealDraftForReconciliation = (
  draft: RecoverableMealDraft,
): RecoverableMealDraft => {
  const frozen = draft.submittedMeal;
  if (!frozen) return draft;
  const ai = foodDraftCandidateSchema.safeParse(frozen.details?.aiDraft);
  return {
    ...draft,
    fibre: "",
    saturatedFat: "",
    totalSugars: "",
    sodium: "",
    cholesterol: "",
    ...mealFormStringsFromDraft(frozen),
    nutritionBasis: "total",
    portionGrams:
      typeof frozen.details?.grams === "number"
        ? String(frozen.details.grams)
        : "",
    description:
      typeof frozen.details?.mealDescription === "string"
        ? frozen.details.mealDescription
        : "",
    aiDraft: ai.success ? ai.data : undefined,
    sourceProposalId:
      ai.success &&
      typeof (frozen.details?.aiDraft as Record<string, unknown>)
        .sourceProposalId === "string"
        ? ((frozen.details?.aiDraft as Record<string, unknown>)
            .sourceProposalId as string)
        : undefined,
    refineInstruction: "",
  };
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
  const isStale =
    draft.submittedMeal || draft.preparedMeal
      ? false
      : draft.mealDate &&
          mealTimestampMatchesDate(draft.consumedAt, draft.mealDate)
        ? false
        : isStaleMealTimestamp(draft.consumedAt, currentDate);
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
  readonly fibreG?: number | null;
  readonly saturatedFatG?: number | null;
  readonly totalSugarsG?: number | null;
  readonly sodiumMg?: number | null;
  readonly cholesterolMg?: number | null;
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
    // Missing fields from older providers are not instructions to erase a
    // user's label values. Explicit null means the estimate is unknown.
    ...(candidate.fibreG === undefined
      ? {}
      : { fibre: editableNumber(candidate.fibreG) }),
    ...(candidate.saturatedFatG === undefined
      ? {}
      : { saturatedFat: editableNumber(candidate.saturatedFatG) }),
    ...(candidate.totalSugarsG === undefined
      ? {}
      : { totalSugars: editableNumber(candidate.totalSugarsG) }),
    ...(candidate.sodiumMg === undefined
      ? {}
      : { sodium: editableNumber(candidate.sodiumMg) }),
    ...(candidate.cholesterolMg === undefined
      ? {}
      : { cholesterol: editableNumber(candidate.cholesterolMg) }),
  };
};

/** Refinement preserves omitted label values; a replacement starts unknown. */
export const mergeMealDraftIntoForm = (
  current: MealFormStrings,
  candidate: Parameters<typeof mealFormStringsFromDraft>[0],
  advancedEnabled: boolean,
  mode: "refine" | "replace" = "refine",
): MealFormStrings => {
  const strings = mealFormStringsFromDraft(candidate);
  const { fibre, saturatedFat, totalSugars, sodium, cholesterol, ...macros } =
    strings;
  return {
    ...current,
    ...(mode === "replace"
      ? {
          fibre: "",
          saturatedFat: "",
          totalSugars: "",
          sodium: "",
          cholesterol: "",
        }
      : {}),
    ...macros,
    ...(advancedEnabled
      ? {
          ...(fibre === undefined ? {} : { fibre }),
          ...(saturatedFat === undefined ? {} : { saturatedFat }),
          ...(totalSugars === undefined ? {} : { totalSugars }),
          ...(sodium === undefined ? {} : { sodium }),
          ...(cholesterol === undefined ? {} : { cholesterol }),
        }
      : {}),
  };
};

/** Drop unpublished Pro estimates when access changes before review. */
export const mealDraftForAdvancedAccess = (
  candidate: FoodDraftCandidate,
  advancedEnabled: boolean,
): FoodDraftCandidate => {
  if (advancedEnabled) return candidate;
  const {
    fibreG,
    saturatedFatG,
    totalSugarsG,
    sodiumMg,
    cholesterolMg,
    ...base
  } = candidate;
  return base;
};

/** Refine what is on screen, including edits made after the AI response. */
export const mealDraftFromCurrentForm = (
  candidate: FoodDraftCandidate,
  form: MealFormStrings,
  portionGrams: string,
  advancedEnabled: boolean,
): FoodDraftCandidate | null => {
  const calories = parseOptionalNutritionNumber(form.calories);
  const protein = parseOptionalNutritionNumber(form.protein);
  const carbs = parseOptionalNutritionNumber(form.carbs);
  const fat = parseOptionalNutritionNumber(form.fat);
  const portion = parseOptionalNutritionNumber(portionGrams);
  const advanced = advancedNutrientsFromForm(form);
  if (
    !calories.ok ||
    !protein.ok ||
    !carbs.ok ||
    !fat.ok ||
    !portion.ok ||
    (portion.value !== null && portion.value <= 0) ||
    (advancedEnabled && advanced === null)
  )
    return null;
  const base = mealDraftForAdvancedAccess(candidate, false);
  return {
    ...base,
    name: form.name.trim() || candidate.name,
    caloriesKcal: calories.value,
    proteinG: protein.value,
    carbohydrateG: carbs.value,
    fatG: fat.value,
    portionWeightG: portion.value,
    calorieRangeKcal: null,
    proteinRangeG: null,
    carbohydrateRangeG: null,
    fatRangeG: null,
    ...(advancedEnabled && advanced !== null ? advanced : {}),
  };
};

export const portionGramsStringFromDraft = (candidate: {
  readonly portionWeightG?: number | null | undefined;
}): string =>
  candidate.portionWeightG === null || candidate.portionWeightG === undefined
    ? ""
    : String(candidate.portionWeightG);
