/** Font bouldering grade scale, ordered easiest to hardest. Rank is the index. */
export const FONT_GRADES = [
  "3",
  "4",
  "4+",
  "5",
  "5+",
  "6A",
  "6A+",
  "6B",
  "6B+",
  "6C",
  "6C+",
  "7A",
  "7A+",
  "7B",
  "7B+",
  "7C",
  "7C+",
  "8A",
  "8A+",
  "8B",
  "8B+",
  "8C",
  "8C+",
] as const;

export type FontGrade = (typeof FONT_GRADES)[number];

export const fontGradeRank = (code: FontGrade): number =>
  FONT_GRADES.indexOf(code);

export const fontGradeFromRank = (rank: number): FontGrade | null =>
  Number.isInteger(rank) && rank >= 0 && rank < FONT_GRADES.length
    ? (FONT_GRADES[rank] ?? null)
    : null;

export const isFontGrade = (value: unknown): value is FontGrade =>
  typeof value === "string" &&
  (FONT_GRADES as readonly string[]).includes(value);

/** Trim and uppercase so "6a+" becomes "6A+"; anything off-scale is null. */
export const normaliseFontGrade = (input: string): FontGrade | null => {
  const candidate = input.trim().toUpperCase();
  return isFontGrade(candidate) ? candidate : null;
};
