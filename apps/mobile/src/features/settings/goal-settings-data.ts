import type { ApiClient } from "@mizyun/api-client";
import {
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

export interface GoalSettingsForm {
  readonly kind: GoalKind;
  readonly targetWeight: string;
  readonly pace: GoalPace;
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
    };
  }
  return {
    kind: goal.kind,
    targetWeight: String(
      kilogramsToDisplayWeight(goal.target.weightKg, unitSystem),
    ),
    pace: goal.pace,
  };
};

export const validateGoalSettingsForm = (
  form: GoalSettingsForm,
  unitSystem: WeightUnitSystem,
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

export const saveGoalSettings = async (
  client: ApiClient,
  activeGoal: Goal | null,
  form: GoalSettingsForm,
  unitSystem: WeightUnitSystem,
): Promise<
  | { readonly ok: true; readonly goal: Goal }
  | { readonly ok: false; readonly message: string }
> => {
  const validation = validateGoalSettingsForm(form, unitSystem);
  if (!validation.ok) {
    return { ok: false, message: validation.message };
  }

  const targetWeightKg = validation.targetWeightKg;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const ninetyDays = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // If there's an active goal with the SAME kind, update via PUT /v1/goals/:id
  if (activeGoal !== null && activeGoal.kind === form.kind) {
    const patchBody = goalPatchSchema.parse({
      target: { weightKg: targetWeightKg },
      pace: form.pace,
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
    targetDate: ninetyDays,
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
