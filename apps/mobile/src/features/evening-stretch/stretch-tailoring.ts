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

/**
 * Longest the list is held back for a tailored plan; after it the
 * deterministic plan is shown and a late tailored plan still replaces it.
 */
export const TAILOR_WAIT_MS = 15_000;

export type LoadedStretch =
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly plan: StretchSessionPlan;
      /** True when today's training could not be read. */
      readonly fallback: boolean;
      /** True once an AI-tailored plan replaced the deterministic one. */
      readonly tailored: boolean;
      /**
       * True while the list is held back for a tailored plan, so the
       * deterministic list is never shown and then swapped.
       */
      readonly awaitingTailor: boolean;
    };

/** Show the deterministic plan (tailoring failed, timed out or is not allowed). */
export const stopAwaitingTailor = (loaded: LoadedStretch): LoadedStretch =>
  loaded.status === "ready" && loaded.awaitingTailor
    ? { ...loaded, awaitingTailor: false }
    : loaded;

/** A tailored plan replaces the list only before the session starts. */
export const applyTailoredPlan = (
  phase: StretchProgress["phase"],
  loaded: LoadedStretch,
  plan: StretchSessionPlan | null,
): LoadedStretch =>
  plan !== null && phase === "overview" && loaded.status === "ready"
    ? { ...loaded, plan, tailored: true, awaitingTailor: false }
    : stopAwaitingTailor(loaded);
