import {
  updateLoggingDraft,
  loadRequiredLoggingDraft,
  isMealCompletionReceipt,
  type SecureKeyValueStore,
} from "../logging-draft-storage";
import {
  createOperationId,
  isFrozenMealForm,
  isRecoverableMealDraft,
  isValidOperationId,
  type RecoverableMealDraft,
} from "./meal-form";
import type { LogMealForm } from "./log-meal-data";

export interface SelectedRecipeMeal {
  readonly name: string;
  readonly caloriesKcal: number | null;
  readonly proteinG: number | null;
  readonly carbohydrateG: number | null;
  readonly fatG: number | null;
  readonly grams?: number | null;
  readonly assumptions?: readonly string[];
}
export type MealDraftHandoffResult =
  | { readonly status: "ready" | "resolved"; readonly operationId: string }
  | { readonly status: "collision" | "unavailable" | "context_changed" };

/** Selection stages an ordinary editable form; only its Save submits intake. */
export const stageRecipeMealDraft = async (
  owner: string,
  selected: SelectedRecipeMeal,
  options: {
    readonly replace: boolean;
    readonly isCurrent: () => boolean;
    readonly operationId?: string;
    readonly requireExisting?: boolean;
    readonly store?: SecureKeyValueStore;
  },
): Promise<MealDraftHandoffResult> => {
  if (!owner || !options.isCurrent()) return { status: "context_changed" };
  if (
    options.operationId !== undefined &&
    !isValidOperationId(options.operationId)
  )
    return { status: "unavailable" };
  const operationId = options.operationId ?? createOperationId();
  const consumedAt = new Date().toISOString();
  const grams = selected.grams ?? null;
  if (
    grams !== null &&
    (!Number.isFinite(grams) || grams <= 0 || grams > 20_000)
  )
    return { status: "unavailable" };
  if (
    selected.assumptions !== undefined &&
    (!Array.isArray(selected.assumptions) ||
      selected.assumptions.length > 6 ||
      !selected.assumptions.every(
        (value) => typeof value === "string" && value.length <= 160,
      ))
  )
    return { status: "unavailable" };
  const description = selected.assumptions?.join("\n") ?? "";
  const preparedMeal: LogMealForm = {
    clientOperationId: operationId,
    name: selected.name.trim(),
    caloriesKcal: selected.caloriesKcal,
    proteinG: selected.proteinG,
    carbohydrateG: selected.carbohydrateG,
    fatG: selected.fatG,
    consumedAt,
    healthExportFirstParty: false,
    healthExportTimeBasis: "observed",
    ...(grams === null && !description
      ? {}
      : {
          details: {
            ...(grams === null ? {} : { grams }),
            ...(description ? { mealDescription: description } : {}),
          },
        }),
  };
  if (!isFrozenMealForm(preparedMeal)) return { status: "unavailable" };
  const numberString = (value: number | null) =>
    value === null ? "" : String(value);
  const draft: RecoverableMealDraft = {
    name: preparedMeal.name,
    calories: numberString(selected.caloriesKcal),
    protein: numberString(selected.proteinG),
    carbs: numberString(selected.carbohydrateG),
    fat: numberString(selected.fatG),
    portionGrams: numberString(grams),
    nutritionBasis: "total",
    clientOperationId: operationId,
    consumedAt,
    submissionVersion: 1,
    preparedMeal,
    description,
  };
  // Keep this handoff below the conservative native SecureStore value budget.
  if (new TextEncoder().encode(JSON.stringify(draft)).length > 1_800)
    return { status: "unavailable" };
  try {
    const result = await updateLoggingDraft<MealDraftHandoffResult>(
      owner,
      "meal",
      async (existing) => {
        const completed = await loadRequiredLoggingDraft(
          owner,
          "meal-completed",
          isMealCompletionReceipt,
          options.store,
        );
        if (
          options.operationId &&
          completed?.operationIds.includes(options.operationId)
        )
          return {
            result: { status: "resolved", operationId: options.operationId },
          };
        if (existing !== null) {
          if (!isRecoverableMealDraft(existing))
            return { result: { status: "unavailable" } };
          if (
            options.operationId &&
            existing.clientOperationId === options.operationId
          )
            return {
              result: { status: "ready", operationId: options.operationId },
            };
          // A saved form is user work even when only advanced fields or date/mode
          // choices are filled. Never infer that an unrelated draft is disposable.
          if (existing.submittedMeal || !options.replace)
            return { result: { status: "collision" } };
        }
        if (options.requireExisting)
          return { result: { status: "unavailable" } };
        return { result: { status: "ready", operationId }, value: draft };
      },
      options.store,
      options.isCurrent,
    );
    return options.isCurrent() ? result : { status: "context_changed" };
  } catch {
    return { status: options.isCurrent() ? "unavailable" : "context_changed" };
  }
};
