/**
 * Onboarding wizard reducer (UX-001).
 *
 * Pure data, no React types. The reducer advances the user through
 * a fixed sequence of small screens and applies a final payload
 * (profile patch + optional goal create) when the user reaches the
 * last step. Tested in isolation so the screen can focus on
 * rendering, validation, and network handling.
 */

import { checkAdultBirthYear } from "@/lib/adult-age";

/**
 * Closed set of wizard steps. The user advances forward only; the
 * back action is implemented at the screen layer (the reducer just
 * knows how to roll back).
 */
export type OnboardingStep =
  | "welcome"
  | "displayName"
  | "units"
  | "baselineWeight"
  | "energyProfile"
  | "primaryGoal";

export const ONBOARDING_STEPS: ReadonlyArray<OnboardingStep> = [
  "welcome",
  "displayName",
  "units",
  "baselineWeight",
  "energyProfile",
  "primaryGoal",
];

export interface OnboardingForm {
  readonly displayName: string;
  readonly unitSystem: "metric" | "imperial";
  readonly baselineWeight: string;
  readonly height: string;
  readonly birthYear: string;
  /** Asked only for the birth year in which the user may be 17; never saved. */
  readonly turned18: boolean | null;
  readonly activityLevel:
    | "sedentary"
    | "lightly_active"
    | "moderately_active"
    | "very_active"
    | "extra_active"
    | null;
  readonly sexAtBirth: "male" | "female" | null;
  readonly goalKind: "cut" | "bulk" | "recomp" | "maintain" | null;
  readonly goalWeight: string;
  readonly goalStartDate: string;
  /** Optional deadline; onboarding never invents one. */
  readonly goalTargetDate: string | null;
}

/**
 * Default form values. The start date defaults to "today" computed at
 * construction time and there is no target date until the user sets one
 * in Goal settings; the screen layer calls `freshOnboardingForm()` on
 * mount.
 */
export const freshOnboardingForm = (now: Date): OnboardingForm => {
  const today = now.toISOString().slice(0, 10);
  return {
    displayName: "",
    unitSystem: "metric",
    baselineWeight: "",
    height: "",
    birthYear: "",
    turned18: null,
    activityLevel: null,
    sexAtBirth: null,
    goalKind: null,
    goalWeight: "",
    goalStartDate: today,
    goalTargetDate: null,
  };
};

/**
 * Per-step validators. Each returns the field-level error message
 * (or null when the field is acceptable for that step). The screen
 * layer is responsible for displaying the error and disabling the
 * Continue button when any error is present.
 *
 * The validators follow the rules in `packages/core/src/profile.ts`
 * and `packages/core/src/goal.ts` so the mobile UI cannot submit a
 * shape that the API will reject.
 */
export const validateWelcome = (_form: OnboardingForm): string | null => null;

export const validateDisplayName = (form: OnboardingForm): string | null => {
  const trimmed = form.displayName.trim();
  if (trimmed.length === 0) return "Display name cannot be blank.";
  if (trimmed.length > 80)
    return "Display name must be 80 characters or fewer.";
  return null;
};

export const parseNumericInput = (raw: string): number => {
  const normalized = raw.trim().replace(",", ".");
  return Number(normalized);
};

export const validateUnits = (_form: OnboardingForm): string | null => null;

const validateWeight = (
  raw: string,
  unitSystem: OnboardingForm["unitSystem"],
  label: string,
): string | null => {
  const value = parseNumericInput(raw);
  if (raw.trim().length === 0) return `Enter your ${label.toLowerCase()}.`;
  if (!Number.isFinite(value) || value <= 0)
    return `${label} must be a positive number.`;
  const kilograms = unitSystem === "imperial" ? value / 2.204_622_621_8 : value;
  if (kilograms < 30 || kilograms > 250) {
    return unitSystem === "imperial"
      ? `${label} must be between 66.1 and 551.2 lb.`
      : `${label} must be between 30 and 250 kg.`;
  }
  return null;
};

export const validateBaselineWeight = (form: OnboardingForm): string | null =>
  validateWeight(form.baselineWeight, form.unitSystem, "Baseline weight");

export const validateEnergyProfile = (
  form: OnboardingForm,
  now: Date = new Date(),
): string | null => {
  const height = parseNumericInput(form.height);
  if (!Number.isFinite(height) || height <= 0) return "Enter a valid height.";
  const heightCm = form.unitSystem === "imperial" ? height * 2.54 : height;
  if (heightCm < 50 || heightCm > 260)
    return "Height is outside the supported adult range.";
  const age = checkAdultBirthYear(
    form.birthYear,
    form.turned18,
    now.getUTCFullYear(),
  );
  if (age.kind !== "ok") return age.message;
  if (form.activityLevel === null) return "Choose an activity level.";
  if (form.sexAtBirth === null)
    return "Choose a sex-at-birth input for the formula.";
  return null;
};

export const validatePrimaryGoal = (form: OnboardingForm): string | null => {
  if (form.goalKind === null) return "Choose a goal kind.";
  return validateWeight(form.goalWeight, form.unitSystem, "Goal weight");
};

export const validateStep = (
  step: OnboardingStep,
  form: OnboardingForm,
): string | null => {
  switch (step) {
    case "welcome":
      return validateWelcome(form);
    case "displayName":
      return validateDisplayName(form);
    case "units":
      return validateUnits(form);
    case "baselineWeight":
      return validateBaselineWeight(form);
    case "energyProfile":
      return validateEnergyProfile(form);
    case "primaryGoal":
      return validatePrimaryGoal(form);
  }
};

export const stepIndex = (step: OnboardingStep): number =>
  ONBOARDING_STEPS.indexOf(step);

export const nextStep = (step: OnboardingStep): OnboardingStep | null => {
  const idx = stepIndex(step);
  if (idx < 0 || idx + 1 >= ONBOARDING_STEPS.length) return null;
  return ONBOARDING_STEPS[idx + 1];
};

export const previousStep = (step: OnboardingStep): OnboardingStep | null => {
  const idx = stepIndex(step);
  if (idx <= 0) return null;
  return ONBOARDING_STEPS[idx - 1];
};

/**
 * The screen commits each step's form field via these patches. The
 * reducer state machine for the wizard is implicit in `step` — the
 * form is a single record that the user edits across steps.
 */
export type OnboardingPatch =
  | { readonly field: "displayName"; readonly value: string }
  | { readonly field: "unitSystem"; readonly value: "metric" | "imperial" }
  | { readonly field: "baselineWeight"; readonly value: string }
  | { readonly field: "height"; readonly value: string }
  | { readonly field: "birthYear"; readonly value: string }
  | { readonly field: "turned18"; readonly value: boolean }
  | {
      readonly field: "activityLevel";
      readonly value: OnboardingForm["activityLevel"];
    }
  | {
      readonly field: "sexAtBirth";
      readonly value: OnboardingForm["sexAtBirth"];
    }
  | { readonly field: "goalKind"; readonly value: OnboardingForm["goalKind"] }
  | { readonly field: "goalWeight"; readonly value: string }
  | { readonly field: "goalStartDate"; readonly value: string }
  | { readonly field: "goalTargetDate"; readonly value: string | null };

export const applyOnboardingPatch = (
  form: OnboardingForm,
  patch: OnboardingPatch,
): OnboardingForm => {
  switch (patch.field) {
    case "displayName":
      return { ...form, displayName: patch.value };
    case "unitSystem":
      return patch.value === form.unitSystem
        ? form
        : {
            ...form,
            unitSystem: patch.value,
            baselineWeight: "",
            height: "",
            goalWeight: "",
          };
    case "baselineWeight":
      return { ...form, baselineWeight: patch.value };
    case "height":
      return { ...form, height: patch.value };
    case "birthYear":
      return patch.value === form.birthYear
        ? form
        : { ...form, birthYear: patch.value, turned18: null };
    case "turned18":
      return { ...form, turned18: patch.value };
    case "activityLevel":
      return { ...form, activityLevel: patch.value };
    case "sexAtBirth":
      return { ...form, sexAtBirth: patch.value };
    case "goalKind":
      return { ...form, goalKind: patch.value };
    case "goalWeight":
      return { ...form, goalWeight: patch.value };
    case "goalStartDate":
      return { ...form, goalStartDate: patch.value };
    case "goalTargetDate":
      return { ...form, goalTargetDate: patch.value };
  }
};
