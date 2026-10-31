import { boulderGradePyramid, type BoulderPyramidRow } from "@mizyun/core";
import type {
  BoulderAscentRecord,
  BoulderSessionRecord,
} from "@mizyun/contracts";

export interface SessionNextStep {
  readonly title: string;
  readonly subtitle: string;
  readonly href: "/bouldering/session";
}

/**
 * The one suggested step after a finished session, so "Done" is not the only
 * way forward. It opens the session screen without `start=1`, whose empty state
 * asks before it starts anything. A session still in progress has none.
 */
export const sessionNextStep = (
  session: Pick<BoulderSessionRecord, "completedAt">,
): SessionNextStep | null =>
  session.completedAt === null
    ? null
    : {
        title: "Log your next session",
        subtitle: "Start a new one when you're back at the wall",
        href: "/bouldering/session",
      };

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
