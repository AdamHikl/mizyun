import {
  BOULDER_ATTEMPTS_MAX,
  BOULDER_NOTE_MAX,
  isFontGrade,
  validBoulderAttempts,
  type BoulderResult,
  type FontGrade,
  type HoldColour,
} from "@mizyun/core";
import {
  boulderAscentCreateSchema,
  boulderAscentUpdateSchema,
  type BoulderAscentCreate,
  type BoulderAscentRecord,
  type BoulderAscentUpdate,
} from "@mizyun/contracts";

/** Editable state of the log-a-boulder sheet. `result` starts unselected. */
export interface BoulderForm {
  readonly grade: FontGrade;
  readonly result: BoulderResult | null;
  /** Null means "attempts unknown" (allowed for Sent and Not yet). */
  readonly attempts: number | null;
  readonly holdColour: HoldColour | null;
  readonly note: string;
}

export const SENT_ATTEMPTS_START = 2;
export const NOT_YET_ATTEMPTS_START = 1;

export const blankBoulderForm = (grade: FontGrade): BoulderForm => ({
  grade,
  result: null,
  attempts: null,
  holdColour: null,
  note: "",
});

/** Flash fixes one attempt; Sent starts at 2; Not yet defaults to 1. */
export const selectBoulderResult = (
  form: BoulderForm,
  result: BoulderResult,
): BoulderForm => {
  if (result === "flash") return { ...form, result, attempts: 1 };
  if (result === "sent")
    return {
      ...form,
      result,
      attempts:
        form.result === "sent" && form.attempts !== null
          ? form.attempts
          : SENT_ATTEMPTS_START,
    };
  return {
    ...form,
    result,
    attempts:
      form.result === "not_yet" && form.attempts !== null
        ? form.attempts
        : NOT_YET_ATTEMPTS_START,
  };
};

export const attemptsBounds = (
  result: BoulderResult | null,
): { min: number; max: number } | null =>
  result === "sent"
    ? { min: 2, max: BOULDER_ATTEMPTS_MAX }
    : result === "not_yet"
      ? { min: 1, max: BOULDER_ATTEMPTS_MAX }
      : null;

/** The stepper is shown for Sent and Not yet only. */
export const showsAttemptsStepper = (result: BoulderResult | null): boolean =>
  attemptsBounds(result) !== null;

export const stepBoulderAttempts = (
  form: BoulderForm,
  delta: 1 | -1,
): BoulderForm => {
  const bounds = attemptsBounds(form.result);
  if (!bounds) return form;
  const current = form.attempts ?? bounds.min - (delta > 0 ? 1 : 0);
  const next = Math.min(bounds.max, Math.max(bounds.min, current + delta));
  return { ...form, attempts: next };
};

/** "Don't know" for Sent/Not yet; choosing it again restores the default. */
export const toggleUnknownAttempts = (form: BoulderForm): BoulderForm => {
  const bounds = attemptsBounds(form.result);
  if (!bounds) return form;
  return { ...form, attempts: form.attempts === null ? bounds.min : null };
};

/** Pre-fills "Try again" from a project: its grade and colour, no result. */
export const tryAgainForm = (
  project: { readonly grade: string; readonly holdColour: HoldColour | null },
  fallbackGrade: FontGrade,
): BoulderForm => ({
  ...blankBoulderForm(
    isFontGrade(project.grade) ? project.grade : fallbackGrade,
  ),
  holdColour: project.holdColour,
});

/** Results offered in the sheet: a linked project cannot be flashed. */
export const allowedBoulderResults = (
  linkedToProject: boolean,
): readonly BoulderResult[] =>
  linkedToProject ? ["sent", "not_yet"] : ["flash", "sent", "not_yet"];

/** Repeats the last boulder's grade and colour; the result is left unselected. */
export const sameAgainForm = (
  last: Pick<BoulderAscentRecord, "grade" | "holdColour">,
  fallbackGrade: FontGrade,
): BoulderForm => ({
  ...blankBoulderForm(isFontGrade(last.grade) ? last.grade : fallbackGrade),
  holdColour: last.holdColour,
});

export const formFromAscent = (
  ascent: BoulderAscentRecord,
  fallbackGrade: FontGrade,
): BoulderForm => ({
  grade: isFontGrade(ascent.grade) ? ascent.grade : fallbackGrade,
  result: ascent.result,
  attempts: ascent.result === "flash" ? 1 : ascent.attempts,
  holdColour: ascent.holdColour,
  note: ascent.note ?? "",
});

export const boulderFormError = (form: BoulderForm): string | null => {
  if (form.result === null) return "Choose Flash, Sent or Not yet.";
  if (!validBoulderAttempts(form.result, form.attempts))
    return form.result === "sent"
      ? `Sent needs 2–${BOULDER_ATTEMPTS_MAX} attempts, or choose Don't know.`
      : `Enter 1–${BOULDER_ATTEMPTS_MAX} attempts, or choose Don't know.`;
  if (form.note.trim().length > BOULDER_NOTE_MAX)
    return `Keep the note under ${BOULDER_NOTE_MAX} characters.`;
  return null;
};

export const canSaveBoulderForm = (form: BoulderForm): boolean =>
  boulderFormError(form) === null;

const fields = (form: BoulderForm, photoAssetId: string | null) => ({
  grade: form.grade,
  result: form.result,
  // A flash is always sent with attempts: 1.
  attempts: form.result === "flash" ? 1 : form.attempts,
  holdColour: form.holdColour,
  note: form.note.trim() === "" ? null : form.note.trim(),
  photoAssetId,
});

/**
 * Canonical create payload, parsed through the shared contract. `projectId`
 * links a "Try again" boulder to an open or archived project; a Flash can
 * never be linked (the server rejects it), so it is refused here too.
 */
export const boulderCreateBody = (
  form: BoulderForm,
  clientOperationId: string,
  projectId: string | null = null,
): BoulderAscentCreate | null => {
  if (boulderFormError(form) !== null) return null;
  if (projectId !== null && form.result === "flash") return null;
  const parsed = boulderAscentCreateSchema.safeParse({
    clientOperationId,
    ...fields(form, null),
    projectId,
  });
  return parsed.success ? parsed.data : null;
};

/** Canonical update payload; keeps or replaces the photo explicitly. */
export const boulderUpdateBody = (
  form: BoulderForm,
  ascent: Pick<BoulderAscentRecord, "revision">,
  clientOperationId: string,
  photoAssetId: string | null,
): BoulderAscentUpdate | null => {
  if (boulderFormError(form) !== null) return null;
  const parsed = boulderAscentUpdateSchema.safeParse({
    clientOperationId,
    expectedRevision: ascent.revision,
    ...fields(form, photoAssetId),
  });
  return parsed.success ? parsed.data : null;
};
