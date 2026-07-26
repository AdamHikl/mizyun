const workoutProposalPatterns: readonly RegExp[] = [
  /\b(?:build|create|plan|give me)\s+(?:my\s+)?(?:today['’]s\s+)?workout\b/i,
  /\bwhat\s+should\s+i\s+(?:train|work out)\s+today\b/i,
  /\b(?:zostav|vytvor|naplánuj)\s+(?:mi\s+)?(?:dnešný\s+)?tréning\b/i,
  /čo\s+mám\s+dnes\s+cvičiť/i,
];

export const isExplicitWorkoutProposalIntent = (text: string): boolean => {
  const normalized = text.trim();
  return (
    normalized.length >= 2 &&
    workoutProposalPatterns.some((pattern) => pattern.test(normalized))
  );
};
