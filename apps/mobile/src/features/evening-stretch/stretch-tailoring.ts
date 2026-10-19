import type { StretchSessionPlan } from "@mizyun/core";

import type { StretchProgress } from "./stretch-progress";

/**
 * When the stretch screen may ask for an AI-tailored plan (ADR-0076): Dev
 * builds only, accounts that already gave AI consent and confirmed adult
 * eligibility (nobody is prompted here), and only after finished training.
 */
export const shouldTailorStretch = (state: {
  readonly variantEnabled: boolean;
  readonly consentGranted: boolean;
  readonly confirmedAdult: boolean;
  readonly userId: string | null;
  readonly trained: boolean | null;
}): boolean =>
  state.variantEnabled &&
  state.consentGranted &&
  state.confirmedAdult &&
  state.userId !== null &&
  state.trained === true;

export type LoadedStretch =
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly plan: StretchSessionPlan;
      /** True when today's training could not be read. */
      readonly fallback: boolean;
      /** True once an AI-tailored plan replaced the deterministic one. */
      readonly tailored: boolean;
    };

/** A tailored plan replaces the list only before the session starts. */
export const applyTailoredPlan = (
  phase: StretchProgress["phase"],
  loaded: LoadedStretch,
  plan: StretchSessionPlan | null,
): LoadedStretch =>
  plan !== null && phase === "overview" && loaded.status === "ready"
    ? { ...loaded, plan, tailored: true }
    : loaded;
