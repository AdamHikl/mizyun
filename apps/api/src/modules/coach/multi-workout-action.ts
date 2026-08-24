/**
 * AI-ACT-006 — multi-session workout plan intent detection and
 * parameter extraction.
 *
 * The Coach detects explicit multi-session requests ("3 day plan",
 * "Push Pull Legs split", "V-shape with 2-hour sessions") and asks
 * the deterministic training-prescription engine to build an ordered
 * list of N sessions. The LLM only extracts parameters; actual
 * exercise content is produced by the deterministic engine.
 *
 * Pattern matching handles the common cases fast and free; the LLM
 * extraction is a thin refinement layer for free-form text that does
 * not match the patterns cleanly. Both fail closed to safe defaults
 * (3 sessions, 60 minutes, unknown focus).
 */

import type { EquipmentOption, SessionFocus } from "@mizyun/core";

export type MultiWorkoutFocus =
  "ppl" | "upper_lower" | "full_body" | "general_hypertrophy" | "unknown";

export interface MultiWorkoutParams {
  readonly requestedSessions: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly sessionMinutes: 15 | 30 | 45 | 60 | 75 | 90 | 105 | 120;
  readonly focus: MultiWorkoutFocus;
  /**
   * Optional per-session focus distribution. When the user explicitly
   * asks for a count split ("two upper body and one lower body"),
   * this carries the resolved `SessionFocus[]` of length
   * `requestedSessions`. The deterministic engine uses it to bias
   * exercise selection per day and to label each session
   * ("Upper body" / "Lower body") instead of the generic "Session N".
   * Null when the user did not specify a distribution.
   */
  readonly sessionDistribution: readonly SessionFocus[] | null;
  readonly equipmentOverrides: readonly EquipmentOption[] | null;
  readonly confidence: "pattern" | "llm" | "default";
}

const multiWorkoutIntentPatterns: readonly RegExp[] = [
  // English: "3 day plan", "3-day plan", "3 days a week", "3 sessions per week"
  /\b(\d{1,2})[-\s]?day\b.*\b(plan|program|split|routine|schedule)\b/i,
  /\b(\d{1,2})[-\s]?days?\s+(a|per)\s+week\b/i,
  /\b(\d{1,2})\s+sessions?\s+(a|per)\s+week\b/i,
  /\bweekly\s+(plan|program|split|schedule)\b/i,
  // Splits
  /\b(?:push\s+pull\s+legs|ppl)\b/i,
  /\b(?:upper\s*\/?\s*lower)\b/i,
  /\b(?:bro\s+split)\b/i,
  // Body-shape / goal phrasing
  /\bv[-\s]?shape\b/i,
  /\b(?:build|gain|shape)\s+(?:a\s+)?(?:v[-\s]?shape|broad\s+back|wide\s+back|hourglass)\b/i,
  // Slovak: "3-dňový plán", "rozvrh na 3 dni"
  /\b(\d{1,2})[-\s]?dňov[ý]\s+(plán|program|rozvrh)\b/i,
];

const dayCountPattern =
  /\b(\d{1,2})\s*(?:[-\s]?day|days?\s+(?:a|per)\s+week|sessions?\s+(?:a|per)\s+week|dňov)/i;

const sessionMinutesPattern =
  // "each session 2 hours" / "every session 60 min" / "per session 90 minutes"
  // "90 min each" / "2 hours each" / "about 60 minutes each"
  // "each session to be around 150 minutes"
  /(?:(?:each|every|per)\s+session\s+(?:to\s+be\s+)?(?:about\s+|around\s+|roughly\s+)?(\d{1,3})\s*(?:min|minute|hour|hr)s?|\b(\d{1,3})\s*(?:min|minute|hour|hr)s?\s+(?:each|every|long|per\s+session))/i;

const hourToMinutes = (hours: number): number => Math.round(hours * 60);

const coerceSessionMinutes = (
  raw: number,
): MultiWorkoutParams["sessionMinutes"] => {
  if (raw <= 20) return 15;
  if (raw <= 30) return 30;
  if (raw <= 45) return 45;
  if (raw <= 60) return 60;
  if (raw <= 75) return 75;
  if (raw <= 90) return 90;
  if (raw <= 105) return 105;
  return 120;
};

const coerceSessionCount = (
  raw: number,
): MultiWorkoutParams["requestedSessions"] => {
  if (raw <= 1) return 1;
  if (raw === 2) return 2;
  if (raw === 3) return 3;
  if (raw === 4) return 4;
  if (raw === 5) return 5;
  if (raw === 6) return 6;
  return 7;
};

const detectFocus = (text: string): MultiWorkoutFocus => {
  const normalized = text.toLowerCase();
  if (/\b(?:push\s+pull\s+legs|ppl)\b/.test(normalized)) return "ppl";
  if (/\b(?:upper\s*\/?\s*lower)\b/.test(normalized)) return "upper_lower";
  if (/\b(?:bro\s+split|full\s+body|whole\s+body)\b/.test(normalized)) {
    return "full_body";
  }
  if (
    /\b(?:hypertrophy|muscle\s+mass|bulk|build\s+muscle)\b/.test(normalized)
  ) {
    return "general_hypertrophy";
  }
  if (/\b(?:v[-\s]?shape|wide\s+back|broad\s+back)\b/.test(normalized)) {
    return "general_hypertrophy";
  }
  return "unknown";
};

const WORD_NUMBERS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
};

const parseCount = (raw: string): number | null => {
  const trimmed = raw.trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return WORD_NUMBERS[trimmed] ?? null;
};

/**
 * Best-effort extraction of an explicit upper/lower session split
 * from the user's free-text request.
 *
 * Matches both digit-form ("2 upper body and 1 lower body day")
 * and word-form ("two upper and one lower"). Returns null when the
 * text does not contain an explicit count split, when the counts
 * do not sum to `requestedSessions`, or when only one side is
 * mentioned (in which case the engine's default rotation is more
 * honest than guessing the rest).
 *
 * The returned array is ordered `[upper, upper, ..., lower, lower, ...]`
 * to match the natural reading order of the request and so the
 * first day is the priority the user named first.
 */
export const extractSessionDistribution = (
  text: string,
  requestedSessions: number,
): readonly SessionFocus[] | null => {
  const normalized = text.toLowerCase();
  const upperMatch = normalized.match(
    /\b(\d+|[a-z]+)\s+upper(?:\s+body)?(?:\s+days?)?\b/,
  );
  const lowerMatch = normalized.match(
    /\b(\d+|[a-z]+)\s+lower(?:\s+body)?(?:\s+days?)?\b/,
  );
  if (upperMatch === null || lowerMatch === null) return null;
  const upperCount = parseCount(upperMatch[1] ?? "");
  const lowerCount = parseCount(lowerMatch[1] ?? "");
  if (upperCount === null || lowerCount === null) return null;
  if (upperCount <= 0 || lowerCount <= 0) return null;
  if (upperCount + lowerCount !== requestedSessions) return null;
  const distribution: SessionFocus[] = [];
  for (let i = 0; i < upperCount; i += 1) distribution.push("upper");
  for (let i = 0; i < lowerCount; i += 1) distribution.push("lower");
  return distribution;
};

/**
 * Returns true if the user's text looks like a multi-session
 * workout plan request (vs. a single workout). Conservative: only
 * matches explicit phrases; ambiguous messages fall through to the
 * regular grounded-text Coach or the single-workout AI-ACT-002 path.
 */
export const isMultiWorkoutProposalIntent = (text: string): boolean => {
  const normalized = text.trim();
  if (normalized.length < 2) return false;
  return multiWorkoutIntentPatterns.some((pattern) => pattern.test(normalized));
};

export const extractEquipmentOverrides = (
  text: string,
): readonly EquipmentOption[] | null => {
  const normalized = text.toLowerCase();
  const options: EquipmentOption[] = [];
  if (/\b(?:dumbbell|dumbbells)\b/.test(normalized)) {
    options.push("dumbbells");
  }
  if (/\b(?:barbell|barbells)\b/.test(normalized)) {
    options.push("barbell");
  }
  if (/\b(?:cable|cables|cable\s+machine)\b/.test(normalized)) {
    options.push("cable_machine");
  }
  if (/\b(?:pull[-\s]?up\s+bar|pullup\s+bar|pullups?)\b/.test(normalized)) {
    options.push("pullup_bar");
  }
  if (/\b(?:bench)\b/.test(normalized)) {
    options.push("bench");
  }
  if (/\b(?:rack|squat\s+rack)\b/.test(normalized)) {
    options.push("rack");
  }
  if (/\b(?:bands?|resistance\s+bands?)\b/.test(normalized)) {
    options.push("resistance_bands");
  }
  if (/\b(?:bodyweight)\b/.test(normalized)) {
    options.push("bodyweight");
  }
  return options.length > 0 ? options : null;
};

/**
 * Pure pattern-based parameter extraction. Always runs, even if the
 * LLM extraction is enabled (the pattern result is the safety net
 * the LLM result is validated against).
 */
export const extractMultiWorkoutParamsFromText = (
  text: string,
): MultiWorkoutParams | null => {
  if (!isMultiWorkoutProposalIntent(text)) return null;

  const dayMatch = text.match(dayCountPattern);
  const requestedSessions: MultiWorkoutParams["requestedSessions"] =
    dayMatch === null || dayMatch[1] === undefined
      ? 3
      : coerceSessionCount(Number.parseInt(dayMatch[1], 10));

  const minutesMatch = text.match(sessionMinutesPattern);
  let sessionMinutes: MultiWorkoutParams["sessionMinutes"] = 60;
  if (minutesMatch !== null) {
    const rawText = minutesMatch[1] ?? minutesMatch[2] ?? "";
    if (rawText.length > 0) {
      const raw = Number.parseInt(rawText, 10);
      const normalized = /hour|hr/i.test(minutesMatch[0])
        ? hourToMinutes(raw)
        : raw;
      sessionMinutes = coerceSessionMinutes(normalized);
    }
  }

  return {
    requestedSessions,
    sessionMinutes,
    focus: detectFocus(text),
    sessionDistribution: extractSessionDistribution(text, requestedSessions),
    equipmentOverrides: extractEquipmentOverrides(text),
    confidence: "pattern",
  };
};

/**
 * Fallback used when neither the pattern match nor the LLM extraction
 * returns a usable result. Keeps the deterministic engine in business
 * with the user's profile defaults.
 */
export const defaultMultiWorkoutParams = (profileFallback: {
  readonly trainingDaysPerWeek: number | null;
  readonly sessionDurationMinutes: number | null;
}): MultiWorkoutParams => ({
  requestedSessions: coerceSessionCount(
    profileFallback.trainingDaysPerWeek ?? 3,
  ),
  sessionMinutes: coerceSessionMinutes(
    profileFallback.sessionDurationMinutes ?? 60,
  ),
  focus: "unknown",
  sessionDistribution: null,
  equipmentOverrides: null,
  confidence: "default",
});
