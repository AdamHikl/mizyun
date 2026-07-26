const weeklyAdaptationPatterns: readonly RegExp[] = [
  /\b(?:review|check|adapt)\s+(?:my\s+)?(?:last\s+)?week\b/i,
  /\b(?:show|build|give me)\s+(?:my\s+)?weekly\s+(?:review|adaptation)\b/i,
  /\bshould\s+(?:my\s+)?(?:calories|plan|training)\s+change\b/i,
  /\b(?:zhodnoť|skontroluj|uprav)\s+(?:mi\s+)?(?:tento|minulý)\s+týždeň\b/i,
  /\b(?:ukáž|zostav)\s+(?:mi\s+)?týždenné\s+zhodnotenie\b/i,
];

export const isExplicitWeeklyAdaptationIntent = (text: string): boolean => {
  const normalized = text.trim();
  return (
    normalized.length >= 2 &&
    weeklyAdaptationPatterns.some((pattern) => pattern.test(normalized))
  );
};
