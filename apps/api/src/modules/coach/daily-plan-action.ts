const dailyPlanPatterns: readonly RegExp[] = [
  /\bwhat\s+should\s+i\s+do\s+today\b/i,
  /\b(?:show|build|give me)\s+(?:my\s+)?daily\s+plan\b/i,
  /\bwhat(?:'s| is)\s+left\s+(?:for\s+)?today\b/i,
  /čo\s+mám\s+dnes\s+(?:urobiť|jesť|cvičiť)/i,
  /\b(?:ukáž|zostav)\s+(?:mi\s+)?dnešný\s+plán\b/i,
];

export const isExplicitDailyPlanIntent = (text: string): boolean => {
  const normalized = text.trim();
  return (
    normalized.length >= 2 &&
    dailyPlanPatterns.some((pattern) => pattern.test(normalized))
  );
};
