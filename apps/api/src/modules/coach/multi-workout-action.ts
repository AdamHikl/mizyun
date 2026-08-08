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

export type MultiWorkoutFocus =
  "ppl" | "upper_lower" | "full_body" | "general_hypertrophy" | "unknown";

export interface MultiWorkoutParams {
  readonly requestedSessions: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly sessionMinutes: 15 | 30 | 45 | 60 | 75 | 90 | 105 | 120;
  readonly focus: MultiWorkoutFocus;
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
  /(?:(?:each|every|per)\s+session\s+(?:about\s+|around\s+|roughly\s+)?(\d{1,3})\s*(?:min|minute|hour|hr)s?|\b(\d{1,3})\s*(?:min|minute|hour|hr)s?\s+(?:each|every|long))/i;

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
  confidence: "default",
});
