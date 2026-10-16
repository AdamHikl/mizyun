import { boulderGradePyramid, type BoulderPyramidRow } from "@mizyun/core";
import type {
  BoulderAscentRecord,
  BoulderSessionRecord,
} from "@mizyun/contracts";

export interface GradeBar {
  readonly grade: string;
  readonly sends: number;
  readonly flashes: number;
  /** 0..1 share of the widest bar. */
  readonly fraction: number;
  readonly accessibilityLabel: string;
}

/** Per-grade send bars (hardest first) from the shared core pyramid rule. */
export const sessionGradeBars = (
  session: Pick<
    BoulderSessionRecord,
    "id" | "startedAt" | "completedAt" | "session"
  >,
  ascents: readonly BoulderAscentRecord[],
): GradeBar[] => {
  const rows: BoulderPyramidRow[] = boulderGradePyramid(
    [
      {
        sessionId: session.id,
        activityDate: session.session.activityDate,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        ascents,
      },
    ],
    "all",
    session.session.activityDate,
  );
  const widest = Math.max(1, ...rows.map((row) => row.sends));
  return rows.map((row) => ({
    grade: row.grade,
    sends: row.sends,
    flashes: row.flashes,
    fraction: row.sends / widest,
    accessibilityLabel: `${row.grade.replace(/\+/g, " plus")}: ${row.sends} ${
      row.sends === 1 ? "send" : "sends"
    }${row.flashes > 0 ? `, ${row.flashes} ${row.flashes === 1 ? "flash" : "flashes"}` : ""}`,
  }));
};
