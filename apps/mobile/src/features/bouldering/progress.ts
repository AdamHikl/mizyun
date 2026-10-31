import { fontGradeRank, isFontGrade, type HoldColour } from "@mizyun/core";
import type {
  BoulderGradeSendsResponse,
  BoulderProgressResponse,
  BoulderProgressWindowValue,
  BoulderProjectRecord,
} from "@mizyun/contracts";
import {
  formatBoulderDate,
  gradeSpoken,
  holdColourLabel,
} from "./presentation";

/**
 * Display models for the progress screen (BLD-04). All maths (pyramid,
 * personal bests, project counts) comes from the server/core; this file only
 * shapes it for the View-built charts and screen readers.
 */

export const PROGRESS_WINDOWS: readonly {
  value: BoulderProgressWindowValue;
  label: string;
  accessibilityLabel: string;
}[] = [
  { value: "30d", label: "30 days", accessibilityLabel: "Last 30 days" },
  { value: "90d", label: "90 days", accessibilityLabel: "Last 90 days" },
  { value: "all", label: "All", accessibilityLabel: "All time" },
];

export const PROGRESS_HELP_TEXT = "Every logged send counts.";
export const GYM_GRADES_NOTE =
  "Gym grades are set by each gym, so they vary between gyms.";

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

export const windowPhrase = (window: BoulderProgressWindowValue): string =>
  window === "30d"
    ? "in the last 30 days"
    : window === "90d"
      ? "in the last 90 days"
      : "yet";

export interface PyramidRowModel {
  readonly grade: string;
  readonly sends: number;
  readonly flashes: number;
  /** Bar width as a share of the widest bar (0..1). */
  readonly fraction: number;
  /** Share of this bar that is flashes (0..1). */
  readonly flashFraction: number;
  /** Visible count on every bar, e.g. "7 · 3 flash". */
  readonly countLabel: string;
  /** e.g. "6B: 7 sends, 3 flashes". */
  readonly accessibilityLabel: string;
}

/** Hardest grade at the top; grades without sends are omitted. */
export const pyramidRows = (
  pyramid: BoulderProgressResponse["pyramid"],
): PyramidRowModel[] => {
  const rows = [...pyramid]
    .filter((row) => row.sends > 0)
    .sort((a, b) => b.gradeRank - a.gradeRank);
  const widest = Math.max(1, ...rows.map((row) => row.sends));
  return rows.map((row) => {
    const flashes = Math.min(row.flashes, row.sends);
    return {
      grade: row.grade,
      sends: row.sends,
      flashes,
      fraction: row.sends / widest,
      flashFraction: row.sends > 0 ? flashes / row.sends : 0,
      countLabel:
        flashes > 0 ? `${row.sends} · ${flashes} flash` : String(row.sends),
      accessibilityLabel: `${gradeSpoken(row.grade)}: ${plural(
        row.sends,
        "send",
        "sends",
      )}, ${plural(flashes, "flash", "flashes")}`,
    };
  });
};

export const TIMELINE_SESSIONS = 20;

const gradeRank = (grade: string): number =>
  isFontGrade(grade) ? fontGradeRank(grade) : -1;

export interface TimelineColumnModel {
  readonly sessionId: string;
  readonly dateLabel: string;
  readonly grade: string | null;
  /** Bar height share (0..1); 0 for a session without sends. */
  readonly heightFraction: number;
  readonly personalBest: boolean;
  readonly accessibilityLabel: string;
}

/** Oldest to newest, at most the last 20 sessions. */
export const timelineColumns = (
  timeline: BoulderProgressResponse["timeline"],
): TimelineColumnModel[] => {
  const recent = timeline.slice(-TIMELINE_SESSIONS);
  const ranks = recent
    .map((entry) => (entry.topGrade ? gradeRank(entry.topGrade) : null))
    .filter((rank): rank is number => rank !== null && rank >= 0);
  const min = ranks.length ? Math.min(...ranks) : 0;
  const max = ranks.length ? Math.max(...ranks) : 0;
  const span = Math.max(1, max - min);
  return recent.map((entry) => {
    const date = formatBoulderDate(entry.activityDate);
    const rank = entry.topGrade ? gradeRank(entry.topGrade) : -1;
    const heightFraction =
      entry.topGrade && rank >= 0 ? 0.25 + ((rank - min) / span) * 0.75 : 0;
    return {
      sessionId: entry.sessionId,
      dateLabel: date,
      grade: entry.topGrade,
      heightFraction,
      personalBest: entry.personalBest && entry.topGrade !== null,
      accessibilityLabel: entry.topGrade
        ? `${date}: hardest send ${gradeSpoken(entry.topGrade)}${
            entry.personalBest ? ", personal best" : ""
          }`
        : `${date}: No sends`,
    };
  });
};

/** One sentence describing the whole timeline. */
export const timelineSummary = (
  columns: readonly TimelineColumnModel[],
): string => {
  if (columns.length === 0) return "No finished sessions.";
  const sent = columns.filter((c) => c.grade !== null);
  const pbs = columns.filter((c) => c.personalBest).length;
  const parts = [
    columns.length === 1
      ? "Hardest send in your latest session."
      : `Hardest send in each of the last ${columns.length} sessions.`,
  ];
  if (sent.length === 0) parts.push("No sends.");
  else {
    const hardest = sent.reduce((best, c) =>
      gradeRank(c.grade!) > gradeRank(best.grade!) ? c : best,
    );
    parts.push(
      `Hardest ${gradeSpoken(hardest.grade!)} on ${hardest.dateLabel}.`,
    );
  }
  if (pbs > 0) parts.push(`${plural(pbs, "personal best", "personal bests")}.`);
  const none = columns.length - sent.length;
  if (none > 0 && sent.length > 0)
    parts.push(`${plural(none, "session", "sessions")} with no sends.`);
  return parts.join(" ");
};

// Projects.

export const projectName = (
  project: { readonly grade: string; readonly holdColour: HoldColour | null },
  spoken = false,
): string => {
  const grade = spoken ? gradeSpoken(project.grade) : project.grade;
  const colour = holdColourLabel(project.holdColour);
  return colour ? `${grade} · ${colour}` : grade;
};

export const triedInSessionsText = (sessions: number): string =>
  `Tried in ${plural(sessions, "session", "sessions")}`;

export const sentAfterText = (sessions: number): string =>
  `Sent after ${plural(sessions, "session", "sessions")}`;

export const projectAttemptsText = (
  project: Pick<BoulderProjectRecord, "attempts" | "attemptsComplete">,
): string =>
  project.attemptsComplete
    ? plural(project.attempts, "attempt", "attempts")
    : `${project.attempts}+ attempts`;

export const projectSubtitle = (project: BoulderProjectRecord): string =>
  project.status === "sent" && project.sentAfterSessions !== null
    ? `${sentAfterText(project.sentAfterSessions)} · ${projectAttemptsText(project)}`
    : `${projectAttemptsText(project)} · ${triedInSessionsText(project.sessions)}`;

export const projectAccessibilityLabel = (
  project: BoulderProjectRecord,
): string =>
  [
    `Project ${projectName(project, true)}`,
    project.attemptsComplete
      ? plural(project.attempts, "attempt", "attempts")
      : `${project.attempts} known attempts`,
    project.status === "sent" && project.sentAfterSessions !== null
      ? sentAfterText(project.sentAfterSessions)
      : triedInSessionsText(project.sessions),
    project.status === "archived" ? "Archived" : null,
  ]
    .filter(Boolean)
    .join(". ");

export interface ProjectGroups {
  /** Open and tried within the last six weeks. */
  readonly open: BoulderProjectRecord[];
  /** Open but not tried for more than six weeks ("Older than 6 weeks"). */
  readonly older: BoulderProjectRecord[];
  readonly sent: BoulderProjectRecord[];
  readonly archived: BoulderProjectRecord[];
}

/** Groups keep the server order (most recently tried first). */
export const groupProjects = (
  projects: readonly BoulderProjectRecord[],
): ProjectGroups => ({
  open: projects.filter((p) => p.status === "open" && !p.older),
  older: projects.filter((p) => p.status === "open" && p.older),
  sent: projects.filter((p) => p.status === "sent"),
  archived: projects.filter((p) => p.status === "archived"),
});

/** Applies one changed project to a list (archive/reopen result). */
export const replaceProject = (
  projects: readonly BoulderProjectRecord[],
  next: BoulderProjectRecord,
): BoulderProjectRecord[] =>
  projects.map((project) => (project.id === next.id ? next : project));

/** Projects this session sent, for "Sent after N sessions" on the summary. */
export const projectsSentInSession = (
  projects: readonly BoulderProjectRecord[],
  sessionAscentIds: readonly string[],
): BoulderProjectRecord[] => {
  const ids = new Set(sessionAscentIds);
  return projects.filter(
    (project) =>
      project.status === "sent" &&
      project.sentAscentId !== null &&
      ids.has(project.sentAscentId) &&
      project.sentAfterSessions !== null,
  );
};

/** Open projects first for "Try again", recently tried before older ones. */
export const tryAgainProjects = (
  projects: readonly BoulderProjectRecord[],
): BoulderProjectRecord[] => {
  const groups = groupProjects(projects);
  return [...groups.open, ...groups.older];
};

// Grade drill-down: the sends behind one "Sends by grade" row.

type GradeSend = BoulderGradeSendsResponse["sends"][number];

export interface GradeSessionGroup {
  readonly sessionId: string;
  /** e.g. "Thu, Oct 22 · North Wall". */
  readonly title: string;
  readonly sends: readonly GradeSend[];
}

/** Keeps the server's newest-first order and groups consecutive sends by session. */
export const groupGradeSends = (
  sends: readonly GradeSend[],
): GradeSessionGroup[] => {
  const groups: { sessionId: string; title: string; sends: GradeSend[] }[] = [];
  for (const send of sends) {
    const last = groups[groups.length - 1];
    if (last && last.sessionId === send.ascent.sessionId) {
      last.sends.push(send);
      continue;
    }
    const date = formatBoulderDate(send.activityDate);
    groups.push({
      sessionId: send.ascent.sessionId,
      title: send.gymName ? `${date} · ${send.gymName}` : date,
      sends: [send],
    });
  }
  return groups;
};

/** "3 sends in the last 90 days · 2 flashes" (the row's own numbers). */
export const gradeSendsSummary = (
  sends: readonly GradeSend[],
  window: BoulderProgressWindowValue,
): string => {
  const flashes = sends.filter((s) => s.ascent.result === "flash").length;
  const head = `${plural(sends.length, "send", "sends")} ${
    window === "all" ? "in all" : windowPhrase(window)
  }`;
  return flashes > 0
    ? `${head} · ${plural(flashes, "flash", "flashes")}`
    : head;
};

export const gradeScreenTitle = (grade: string): string => `${grade} sends`;
