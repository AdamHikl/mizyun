import type { SharedBoulderingDetails as BoulderingDetails } from "@mizyun/contracts";

const count = (value: number, one: string, many: string) =>
  `${value} ${value === 1 ? one : many}`;

/** "Bouldering · Top grade 6C", or "Bouldering · No sends" (ADR-0067 card). */
export function boulderingCardTitle(
  details: BoulderingDetails | null | undefined,
): string {
  if (!details) return "Bouldering session";
  return details.topGrade
    ? `Bouldering · Top grade ${details.topGrade}`
    : "Bouldering · No sends";
}

/** "9 sends · 4 flashes". */
export function boulderingCardCounts(details: BoulderingDetails): string {
  return `${count(details.sends, "send", "sends")} · ${count(details.flashes, "flash", "flashes")}`;
}

/** One spoken sentence for the whole shared snapshot. */
export function boulderingCardSpoken(
  details: BoulderingDetails | null | undefined,
): string {
  if (!details) return "Bouldering session";
  const parts = [
    details.topGrade
      ? `Bouldering session, top grade ${details.topGrade}`
      : "Bouldering session, no sends",
    count(details.sends, "send", "sends"),
    count(details.flashes, "flash", "flashes"),
  ];
  if (details.gradeBreakdown?.length)
    parts.push(
      `sends by grade: ${details.gradeBreakdown
        .map((row) => `${row.grade}: ${count(row.sends, "send", "sends")}`)
        .join(", ")}`,
    );
  return parts.join(", ");
}
