export interface CommunityChallengesRepository {
  execute(
    operation: string,
    args: Readonly<Record<string, unknown>>,
    accessToken: string,
  ): Promise<Record<string, unknown>>;
}
/** Equal credit for deliberate workouts and rest. Missing declarations are not zero effort. */
export function challengeProgress(
  days: readonly { day: string; kind: "workout" | "rest"; valid: boolean }[],
): number | null {
  const unique = new Set(days.filter((d) => d.valid).map((d) => d.day));
  return days.length === 0 ? null : unique.size;
}
export function challengeLocalDay(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return ["year", "month", "day"]
    .map((k) => parts.find((p) => p.type === k)!.value)
    .join("-");
}
