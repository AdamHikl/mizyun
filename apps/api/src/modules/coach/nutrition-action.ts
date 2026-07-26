/**
 * AI-ACT-001 — conservative meal-logging intent detection.
 *
 * The Coach only diverts an explicit first-person logging statement or
 * command into the nutrition draft provider. General nutrition questions
 * continue through the grounded text Coach.
 */
const mealLoggingPatterns: readonly RegExp[] = [
  /^(?:please\s+)?(?:log|add|record)\b/i,
  /\bi\s+(?:ate|had|consumed)\b/i,
  /\bi['’]ve\s+(?:eaten|had)\b/i,
  /\b(?:zjedol|zjedla|jedol som|jedla som|mal som|mala som)\b/i,
  /^(?:prosím\s+)?(?:zapíš|pridaj|zaloguj)\b/i,
];

export const isExplicitMealLoggingIntent = (text: string): boolean => {
  const normalized = text.trim();
  return (
    normalized.length >= 2 &&
    mealLoggingPatterns.some((pattern) => pattern.test(normalized))
  );
};
