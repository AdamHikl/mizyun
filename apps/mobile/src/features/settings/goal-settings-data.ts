import type { ApiClient } from "@mizyun/api-client";
import {
  bodyMeasurementListResponseSchema,
  goalCreateSchema,
  goalPatchSchema,
  goalResponseSchema,
  type Goal,
  type GoalKind,
  type GoalPace,
  type GoalResponse,
} from "@mizyun/contracts";

import {
  displayWeightToKilograms,
  kilogramsToDisplayWeight,
  type WeightUnitSystem,
} from "@/lib/weight-units";

import { goalKindHasPace } from "./goal-mode-presentation";

export interface GoalSettingsForm {
  readonly kind: GoalKind;
  readonly targetWeight: string;
  readonly pace: GoalPace;
  /** Optional deadline as a local `YYYY-MM-DD`; null means no target date. */
  readonly targetDate: string | null;
}

export type GoalSettingsValidation =
  | { readonly ok: true; readonly targetWeightKg: number }
  | { readonly ok: false; readonly message: string };

export const goalSettingsFormFromGoal = (
  goal: Goal | null,
  unitSystem: WeightUnitSystem,
): GoalSettingsForm => {
  if (goal === null) {
    return {
      kind: "cut",
      targetWeight: "",
      pace: "steady",
      targetDate: null,
    };
  }
  return {
    kind: goal.kind,
    targetWeight: String(
      kilogramsToDisplayWeight(goal.target.weightKg, unitSystem),
    ),
    pace: goal.pace,
    targetDate: goal.targetDate ?? null,
  };
};

/** Today's local calendar day as `YYYY-MM-DD`. */
export const localIsoDate = (now: Date): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;

/** Recomp and maintain have no projection, so they never keep a date. */
const effectiveTargetDate = (form: GoalSettingsForm): string | null =>
  goalKindHasPace(form.kind) ? form.targetDate : null;

/**
 * The stored date a save would keep as-is: only an update of the same
 * goal kind keeps it, since a kind change creates a new goal from today.
 */
export const keptStoredTargetDate = (
  activeGoal: Goal | null,
  form: GoalSettingsForm,
): string | null =>
  activeGoal !== null && activeGoal.kind === form.kind
    ? (activeGoal.targetDate ?? null)
    : null;

export const validateGoalSettingsForm = (
  form: GoalSettingsForm,
  unitSystem: WeightUnitSystem,
  now: Date = new Date(),
  keptTargetDate: string | null = null,
): GoalSettingsValidation => {
  const weightDisplay = Number(form.targetWeight.trim().replace(",", "."));
  if (!Number.isFinite(weightDisplay) || weightDisplay <= 0) {
    return { ok: false, message: "Enter a valid target weight." };
  }
  const weightKg = displayWeightToKilograms(weightDisplay, unitSystem);
  if (weightKg < 30 || weightKg > 250) {
    return {
      ok: false,
      message: "Target weight must be between 30 and 250 kg.",
    };
  }
  // Reject a newly chosen date in the past. A stored date that has
  // passed (often the old invented 90-day default) is left alone so it
  // never blocks a pace or weight change; the card flags it instead.
  const targetDate = effectiveTargetDate(form);
  if (
    targetDate !== null &&
    targetDate !== keptTargetDate &&
    targetDate < localIsoDate(now)
  ) {
    return {
      ok: false,
      message: "Your target date has passed. Choose a new date or remove it.",
    };
  }
  return { ok: true, targetWeightKg: weightKg };
};

export const loadActiveGoal = async (
  client: ApiClient,
): Promise<Goal | null> => {
  const result = await client.request<GoalResponse>({
    method: "GET",
    path: "/v1/goals/active",
    schema: goalResponseSchema,
  });
  if (result.ok) {
    return result.value.goal;
  }
  return null;
};

/** Latest recorded body weight in kg, or null when unknown or unreachable. */
export const loadCurrentWeightKg = async (
  client: ApiClient,
): Promise<number | null> => {
  const result = await client.request({
    method: "GET",
    // Shares the cached body history read; newest first.
    path: "/v1/body-measurements?limit=200",
    schema: bodyMeasurementListResponseSchema,
  });
  if (!result.ok) return null;
  const parsed = bodyMeasurementListResponseSchema.safeParse(result.value);
  const weight = parsed.success
    ? parsed.data.bodyMeasurements[0]?.weightKg
    : undefined;
  return typeof weight === "number" && weight > 0 ? weight : null;
};

export const saveGoalSettings = async (
  client: ApiClient,
  activeGoal: Goal | null,
  form: GoalSettingsForm,
  unitSystem: WeightUnitSystem,
): Promise<
  | { readonly ok: true; readonly goal: Goal }
  | { readonly ok: false; readonly message: string }
> => {
  const now = new Date();
  const validation = validateGoalSettingsForm(
    form,
    unitSystem,
    now,
    keptStoredTargetDate(activeGoal, form),
  );
  if (!validation.ok) {
    return { ok: false, message: validation.message };
  }

  const targetWeightKg = validation.targetWeightKg;
  const targetDate = effectiveTargetDate(form);
  const today = localIsoDate(now);

  // If there's an active goal with the SAME kind, update via PUT /v1/goals/:id
  if (activeGoal !== null && activeGoal.kind === form.kind) {
    // Send the date only when it changed; null clears a stored date.
    const patchBody = goalPatchSchema.parse({
      target: { weightKg: targetWeightKg },
      pace: form.pace,
      ...(targetDate !== (activeGoal.targetDate ?? null) ? { targetDate } : {}),
    });
    const result = await client.request<GoalResponse>({
      method: "PUT",
      path: `/v1/goals/${activeGoal.id}`,
      body: patchBody,
      schema: goalResponseSchema,
    });
    if (result.ok) {
      return { ok: true, goal: result.value.goal };
    }
    return { ok: false, message: "Could not update your active goal." };
  }

  // If there's an active goal with a DIFFERENT kind, archive old first, then create new
  if (activeGoal !== null) {
    await client.request<GoalResponse>({
      method: "PUT",
      path: `/v1/goals/${activeGoal.id}`,
      body: { status: "archived" },
      schema: goalResponseSchema,
    });
  }

  const createBody = goalCreateSchema.parse({
    kind: form.kind,
    pace: form.pace,
    target: { weightKg: targetWeightKg },
    startsOn: today,
    ...(targetDate !== null ? { targetDate } : {}),
  });

  const result = await client.request<GoalResponse>({
    method: "POST",
    path: "/v1/goals",
    body: createBody,
    schema: goalResponseSchema,
  });

  if (result.ok) {
    return { ok: true, goal: result.value.goal };
  }
  return { ok: false, message: "Could not save your new goal." };
};
