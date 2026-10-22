import { type FontGrade, fontGradeFromRank } from "./bouldering-grades";
import type { SharedBoulderingDetails } from "./community";

export const BOULDER_RESULTS = ["flash", "sent", "not_yet"] as const;
export type BoulderResult = (typeof BOULDER_RESULTS)[number];

export const HOLD_COLOURS = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "black",
  "white",
  "grey",
  "other",
] as const;
export type HoldColour = (typeof HOLD_COLOURS)[number];

export const BOULDER_NOTE_MAX = 280;
export const BOULDER_GYM_NAME_MAX = 60;
export const BOULDER_ATTEMPTS_MAX = 99;

const isIntegerInRange = (value: number, min: number, max: number): boolean =>
  Number.isInteger(value) && value >= min && value <= max;

/** Flash is exactly one attempt; sent needs 2-99 when known; not_yet 1-99. */
export const validBoulderAttempts = (
  result: BoulderResult,
  attempts: number | null,
): boolean => {
  if (result === "flash") return attempts === 1;
  if (attempts === null) return true;
  return result === "sent"
    ? isIntegerInRange(attempts, 2, BOULDER_ATTEMPTS_MAX)
    : isIntegerInRange(attempts, 1, BOULDER_ATTEMPTS_MAX);
};

export const isBoulderSend = (result: BoulderResult): boolean =>
  result === "flash" || result === "sent";

export interface BoulderSessionCore {
  readonly version: 1;
  readonly gradeScale: "font";
  readonly recordingTimezone: string;
  readonly activityDate: string;
  readonly gymName: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

const isCalendarDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
};

export const hasBoulderingActivity = (
  details: Readonly<Record<string, unknown>>,
): boolean => details.activityType === "bouldering";

export const readBoulderSession = (
  details: Readonly<Record<string, unknown>>,
): BoulderSessionCore | null => {
  if (!hasBoulderingActivity(details)) return null;
  if (
    !hasExactKeys(details, [
      "activityType",
      "workoutLifecycle",
      "boulderSession",
    ])
  )
    return null;
  const lifecycle = details.workoutLifecycle;
  if (
    !isRecord(lifecycle) ||
    !hasExactKeys(lifecycle, ["kind"]) ||
    lifecycle.kind !== "session"
  )
    return null;
  const s = details.boulderSession;
  if (
    !isRecord(s) ||
    !hasExactKeys(s, [
      "version",
      "gradeScale",
      "recordingTimezone",
      "activityDate",
      "gymName",
    ])
  )
    return null;
  if (s.version !== 1 || s.gradeScale !== "font") return null;
  if (!isCalendarDate(s.activityDate)) return null;
  if (
    typeof s.recordingTimezone !== "string" ||
    s.recordingTimezone.length < 1 ||
    s.recordingTimezone.length > 100
  )
    return null;
  if (s.gymName !== null) {
    if (
      typeof s.gymName !== "string" ||
      s.gymName !== s.gymName.trim() ||
      s.gymName.length < 1 ||
      s.gymName.length > BOULDER_GYM_NAME_MAX
    )
      return null;
  }
  return {
    version: 1,
    gradeScale: "font",
    recordingTimezone: s.recordingTimezone,
    activityDate: s.activityDate,
    gymName: s.gymName,
  };
};

export interface BoulderAscentCore {
  readonly id: string;
  readonly sessionId: string;
  readonly gradeRank: number;
  readonly grade: FontGrade;
  readonly result: BoulderResult;
  readonly attempts: number | null;
}

export interface BoulderSessionSummary {
  readonly boulders: number;
  readonly sends: number;
  readonly flashes: number;
  /** Sum of known attempts only; unknown (null) attempts are never guessed. */
  readonly attempts: number;
  readonly attemptsComplete: boolean;
  readonly topGradeRank: number | null;
}

export const summariseBoulderSession = (
  ascents: readonly BoulderAscentCore[],
): BoulderSessionSummary => {
  let sends = 0;
  let flashes = 0;
  let attempts = 0;
  let attemptsComplete = true;
  let topGradeRank: number | null = null;
  for (const ascent of ascents) {
    if (isBoulderSend(ascent.result)) {
      sends += 1;
      if (topGradeRank === null || ascent.gradeRank > topGradeRank)
        topGradeRank = ascent.gradeRank;
    }
    if (ascent.result === "flash") flashes += 1;
    const known = ascent.result === "flash" ? 1 : ascent.attempts;
    if (known === null) attemptsComplete = false;
    else attempts += known;
  }
  return {
    boulders: ascents.length,
    sends,
    flashes,
    attempts,
    attemptsComplete,
    topGradeRank,
  };
};

export interface BoulderSessionHistoryEntry {
  readonly sessionId: string;
  readonly activityDate: string;
  readonly completedAt: string | null;
  readonly startedAt: string;
  readonly ascents: readonly BoulderAscentCore[];
}

export type BoulderAchievement =
  | { readonly kind: "first_session" }
  | {
      readonly kind: "personal_best";
      readonly gradeRank: number;
      readonly grade: FontGrade;
    }
  | {
      readonly kind: "first_flash";
      readonly gradeRank: number;
      readonly grade: FontGrade;
    };

const maxRank = (ranks: readonly number[]): number | null =>
  ranks.length === 0 ? null : Math.max(...ranks);

const sendRanks = (entry: BoulderSessionHistoryEntry): number[] =>
  entry.ascents.filter((a) => isBoulderSend(a.result)).map((a) => a.gradeRank);

const flashRanks = (entry: BoulderSessionHistoryEntry): number[] =>
  entry.ascents.filter((a) => a.result === "flash").map((a) => a.gradeRank);

export const boulderSessionAchievements = (
  current: BoulderSessionHistoryEntry,
  history: readonly BoulderSessionHistoryEntry[],
): BoulderAchievement[] => {
  const earlier = history.filter(
    (entry) =>
      entry.completedAt !== null &&
      entry.sessionId !== current.sessionId &&
      entry.startedAt < current.startedAt,
  );
  if (earlier.length === 0) return [{ kind: "first_session" }];
  const achievements: BoulderAchievement[] = [];
  const currentTop = maxRank(sendRanks(current));
  const earlierTop = maxRank(earlier.flatMap(sendRanks));
  if (currentTop !== null && (earlierTop === null || currentTop > earlierTop)) {
    const grade = fontGradeFromRank(currentTop);
    if (grade)
      achievements.push({
        kind: "personal_best",
        gradeRank: currentTop,
        grade,
      });
  }
  const hardestFlash = maxRank(flashRanks(current));
  if (
    hardestFlash !== null &&
    !earlier.some((entry) => flashRanks(entry).includes(hardestFlash))
  ) {
    const grade = fontGradeFromRank(hardestFlash);
    if (grade)
      achievements.push({
        kind: "first_flash",
        gradeRank: hardestFlash,
        grade,
      });
  }
  return achievements;
};

export type BoulderProgressWindow = "30d" | "90d" | "all";

const WINDOW_DAYS: Record<Exclude<BoulderProgressWindow, "all">, number> = {
  "30d": 30,
  "90d": 90,
};

/** Pure date arithmetic on YYYY-MM-DD strings (UTC math, no local clock). */
const shiftDate = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export interface BoulderPyramidRow {
  readonly gradeRank: number;
  readonly grade: FontGrade;
  readonly sends: number;
  readonly flashes: number;
}

export const boulderGradePyramid = (
  history: readonly BoulderSessionHistoryEntry[],
  window: BoulderProgressWindow,
  today: string,
): BoulderPyramidRow[] => {
  const cutoff =
    window === "all" ? null : shiftDate(today, -WINDOW_DAYS[window]);
  const rows = new Map<number, { sends: number; flashes: number }>();
  for (const entry of history) {
    if (cutoff !== null && entry.activityDate <= cutoff) continue;
    for (const ascent of entry.ascents) {
      if (!isBoulderSend(ascent.result)) continue;
      const row = rows.get(ascent.gradeRank) ?? { sends: 0, flashes: 0 };
      row.sends += 1;
      if (ascent.result === "flash") row.flashes += 1;
      rows.set(ascent.gradeRank, row);
    }
  }
  const out: BoulderPyramidRow[] = [];
  for (const [gradeRank, row] of rows) {
    const grade = fontGradeFromRank(gradeRank);
    if (grade) out.push({ gradeRank, grade, ...row });
  }
  return out.sort((a, b) => b.gradeRank - a.gradeRank);
};

export interface BoulderGradeSend<
  A extends Pick<BoulderAscentCore, "gradeRank" | "result"> = BoulderAscentCore,
> {
  readonly sessionId: string;
  readonly activityDate: string;
  readonly ascent: A;
}

/**
 * The sends behind one pyramid row: same window and send rule as
 * `boulderGradePyramid`, so the list always matches the row's count.
 * Newest session first; within a session, in log order.
 */
export const boulderGradeSends = <
  A extends Pick<BoulderAscentCore, "gradeRank" | "result">,
>(
  history: readonly (Omit<BoulderSessionHistoryEntry, "ascents"> & {
    readonly ascents: readonly A[];
  })[],
  window: BoulderProgressWindow,
  today: string,
  gradeRank: number,
): BoulderGradeSend<A>[] => {
  const cutoff =
    window === "all" ? null : shiftDate(today, -WINDOW_DAYS[window]);
  return history
    .filter((entry) => cutoff === null || entry.activityDate > cutoff)
    .sort(
      (a, b) =>
        b.activityDate.localeCompare(a.activityDate) ||
        b.startedAt.localeCompare(a.startedAt) ||
        b.sessionId.localeCompare(a.sessionId),
    )
    .flatMap((entry) =>
      entry.ascents
        .filter(
          (ascent) =>
            ascent.gradeRank === gradeRank && isBoulderSend(ascent.result),
        )
        .map((ascent) => ({
          sessionId: entry.sessionId,
          activityDate: entry.activityDate,
          ascent,
        })),
    );
};

export interface BoulderTimelineEntry {
  readonly sessionId: string;
  readonly activityDate: string;
  readonly topGradeRank: number | null;
  readonly topGrade: FontGrade | null;
  readonly personalBest: boolean;
}

export const boulderHardestSendTimeline = (
  history: readonly BoulderSessionHistoryEntry[],
  limit = 20,
): BoulderTimelineEntry[] => {
  const completed = history
    .filter((entry) => entry.completedAt !== null)
    .sort(
      (a, b) =>
        a.activityDate.localeCompare(b.activityDate) ||
        a.startedAt.localeCompare(b.startedAt),
    );
  let best: number | null = null;
  const all = completed.map((entry): BoulderTimelineEntry => {
    const top = maxRank(sendRanks(entry));
    const personalBest = top !== null && best !== null && top > best;
    if (top !== null && (best === null || top > best)) best = top;
    return {
      sessionId: entry.sessionId,
      activityDate: entry.activityDate,
      topGradeRank: top,
      topGrade: top === null ? null : fontGradeFromRank(top),
      personalBest,
    };
  });
  return limit <= 0 ? [] : all.slice(-limit);
};

// Projects (ADR-0066 §6, BLD-04).

export const BOULDER_PROJECT_STATUSES = ["open", "sent", "archived"] as const;
export type BoulderProjectStatus = (typeof BOULDER_PROJECT_STATUSES)[number];

/** Projects not tried for longer than this are grouped as "Older than 6 weeks". */
export const BOULDER_PROJECT_OLDER_DAYS = 42;

export interface BoulderProjectLinkedAscent {
  readonly id: string;
  readonly sessionId: string;
  readonly result: BoulderResult;
  readonly attempts: number | null;
  /** ISO instant. */
  readonly loggedAt: string;
  readonly sequence: number;
}

export interface BoulderProjectSummary {
  /** Sum of known attempts (a flash is one); unknown attempts are never guessed. */
  readonly attempts: number;
  readonly attemptsComplete: boolean;
  /** Distinct sessions with a linked boulder. */
  readonly sessions: number;
  /**
   * Distinct sessions with a linked boulder logged at or before the sending
   * boulder, including the sending session; null when not sent.
   */
  readonly sentAfterSessions: number | null;
  /** Latest linked boulder, or null when nothing is linked. */
  readonly lastTriedAt: string | null;
}

/** Orders like the database: `logged_at`, then `sequence`. */
const compareLinked = (
  a: BoulderProjectLinkedAscent,
  b: BoulderProjectLinkedAscent,
): number =>
  Date.parse(a.loggedAt) - Date.parse(b.loggedAt) || a.sequence - b.sequence;

export const summariseBoulderProject = (
  linkedAscents: readonly BoulderProjectLinkedAscent[],
  sentAscentId: string | null,
): BoulderProjectSummary => {
  let attempts = 0;
  let attemptsComplete = true;
  let lastTried: BoulderProjectLinkedAscent | null = null;
  const sessions = new Set<string>();
  for (const ascent of linkedAscents) {
    const known = ascent.result === "flash" ? 1 : ascent.attempts;
    if (known === null) attemptsComplete = false;
    else attempts += known;
    sessions.add(ascent.sessionId);
    if (lastTried === null || compareLinked(ascent, lastTried) > 0)
      lastTried = ascent;
  }
  const sending =
    sentAscentId === null
      ? undefined
      : linkedAscents.find((ascent) => ascent.id === sentAscentId);
  const sentAfterSessions = sending
    ? new Set(
        linkedAscents
          .filter((ascent) => compareLinked(ascent, sending) <= 0)
          .map((ascent) => ascent.sessionId),
      ).size
    : null;
  return {
    attempts,
    attemptsComplete,
    sessions: sessions.size,
    sentAfterSessions,
    lastTriedAt: lastTried?.loggedAt ?? null,
  };
};

export const isOlderBoulderProject = (
  lastTriedAt: string,
  now: Date,
): boolean =>
  now.getTime() - Date.parse(lastTriedAt) >
  BOULDER_PROJECT_OLDER_DAYS * 24 * 60 * 60 * 1000;

/**
 * ADR-0067 Community snapshot of a completed session; mirrors SQL
 * `community_bouldering_details`. Only the session's local day, the hardest
 * send, send and flash counts and (opt-in) sends per grade, hardest first.
 */
export const boulderingShareDetails = (
  activityDate: string,
  ascents: readonly Pick<BoulderAscentCore, "grade" | "gradeRank" | "result">[],
  includeGradeBreakdown: boolean,
): SharedBoulderingDetails => {
  const sends = ascents.filter((ascent) => isBoulderSend(ascent.result));
  const byRank = new Map<number, { grade: FontGrade; sends: number }>();
  for (const ascent of sends) {
    const entry = byRank.get(ascent.gradeRank);
    if (entry) entry.sends += 1;
    else byRank.set(ascent.gradeRank, { grade: ascent.grade, sends: 1 });
  }
  const ranks = [...byRank.keys()].sort((a, b) => b - a);
  return {
    activityDate,
    topGrade: ranks.length ? byRank.get(ranks[0]!)!.grade : null,
    sends: sends.length,
    flashes: ascents.filter((ascent) => ascent.result === "flash").length,
    gradeBreakdown: includeGradeBreakdown
      ? ranks.map((rank) => ({ ...byRank.get(rank)! }))
      : null,
  };
};
