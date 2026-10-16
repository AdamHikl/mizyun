import {
  FONT_GRADES,
  HOLD_COLOURS,
  isFontGrade,
  type BoulderResult,
  type FontGrade,
  type HoldColour,
} from "@mizyun/core";
import type {
  BoulderAchievementRecord,
  BoulderSessionRecord,
  BoulderSessionSummaryRecord,
} from "@mizyun/contracts";
import type { IconName } from "@/components/ui";

/** Starting grade when neither this session nor recent history suggests one. */
export const DEFAULT_BOULDER_GRADE: FontGrade = "6A";

export const BOULDER_GRADES: readonly FontGrade[] = FONT_GRADES;

/** Screen readers otherwise skip or misread the "+" in Font grades. */
export const gradeSpoken = (grade: string): string =>
  grade.replace(/\+/g, " plus");

export const RESULT_LABELS: Record<BoulderResult, string> = {
  flash: "Flash",
  sent: "Sent",
  not_yet: "Not yet",
};

/** Icon and text are always shown together, so colour is never the only signal. */
export const RESULT_ICONS: Record<BoulderResult, IconName> = {
  flash: "sparkles",
  sent: "checkCircle",
  not_yet: "circle",
};

const attemptsText = (attempts: number): string =>
  `${attempts} ${attempts === 1 ? "attempt" : "attempts"}`;

/** "Flash", "Sent · 4 attempts", "Sent", "Not yet", "Not yet · 3 attempts". */
export const resultText = (
  result: BoulderResult,
  attempts: number | null,
): string => {
  if (result === "flash") return RESULT_LABELS.flash;
  if (attempts === null) return RESULT_LABELS[result];
  return `${RESULT_LABELS[result]} · ${attemptsText(attempts)}`;
};

export interface HoldColourStyle {
  readonly label: string;
  /** Swatch fill. Hold colours are physical tape colours, not theme tokens. */
  readonly swatch: string;
  /** Outline so white/black swatches stay visible in light and dark mode. */
  readonly outline: boolean;
}

export const HOLD_COLOUR_STYLES: Record<HoldColour, HoldColourStyle> = {
  red: { label: "Red", swatch: "#DC2626", outline: false },
  orange: { label: "Orange", swatch: "#EA580C", outline: false },
  yellow: { label: "Yellow", swatch: "#FACC15", outline: true },
  green: { label: "Green", swatch: "#16A34A", outline: false },
  blue: { label: "Blue", swatch: "#2563EB", outline: false },
  purple: { label: "Purple", swatch: "#7C3AED", outline: false },
  pink: { label: "Pink", swatch: "#EC4899", outline: false },
  black: { label: "Black", swatch: "#111827", outline: true },
  white: { label: "White", swatch: "#FFFFFF", outline: true },
  grey: { label: "Grey", swatch: "#9CA3AF", outline: true },
  other: { label: "Other colour", swatch: "transparent", outline: true },
};

export const HOLD_COLOUR_ORDER: readonly HoldColour[] = HOLD_COLOURS;

export const holdColourLabel = (colour: HoldColour | null): string | null =>
  colour === null ? null : HOLD_COLOUR_STYLES[colour].label;

/** One sentence for a boulder row, read by VoiceOver/TalkBack. */
export const ascentAccessibilityLabel = (
  ascent: {
    readonly grade: string;
    readonly result: BoulderResult;
    readonly attempts: number | null;
    readonly holdColour: HoldColour | null;
    readonly photoAssetId: string | null;
    readonly note: string | null;
  },
  pending: boolean,
): string =>
  [
    `Grade ${gradeSpoken(ascent.grade)}`,
    resultText(ascent.result, ascent.attempts),
    ascent.holdColour ? `${holdColourLabel(ascent.holdColour)} holds` : null,
    ascent.photoAssetId ? "has photo" : null,
    ascent.note ? `Note: ${ascent.note}` : null,
    pending ? "Saved on this device, waiting to sync" : null,
  ]
    .filter(Boolean)
    .join(". ");

/**
 * Pre-selected grade: the last grade logged in this session, else the most
 * frequently sent recent grade (ties go to the harder grade), else 6A.
 */
export const initialBoulderGrade = (
  sessionAscents: readonly {
    readonly grade: string;
    readonly sequence: number;
  }[],
  recentPyramid: readonly {
    readonly grade: string;
    readonly sends: number;
  }[] = [],
): FontGrade => {
  const last = [...sessionAscents].sort((a, b) => b.sequence - a.sequence)[0];
  if (last && isFontGrade(last.grade)) return last.grade;
  let best: { grade: FontGrade; sends: number } | null = null;
  for (const row of recentPyramid) {
    if (!isFontGrade(row.grade) || row.sends <= 0) continue;
    if (
      best === null ||
      row.sends > best.sends ||
      (row.sends === best.sends &&
        FONT_GRADES.indexOf(row.grade) > FONT_GRADES.indexOf(best.grade))
    )
      best = { grade: row.grade, sends: row.sends };
  }
  return best?.grade ?? DEFAULT_BOULDER_GRADE;
};

export const achievementText = (achievement: BoulderAchievementRecord) => {
  switch (achievement.kind) {
    case "personal_best":
      return `New personal best: ${achievement.grade}`;
    case "first_flash":
      return `First flash at ${achievement.grade}`;
    case "first_session":
      return "First session logged";
  }
};

export const achievementSpoken = (achievement: BoulderAchievementRecord) =>
  gradeSpoken(achievementText(achievement));

export interface SummaryStat {
  readonly key: "sends" | "flashes" | "attempts" | "top";
  readonly label: string;
  readonly value: string;
  readonly accessibilityLabel: string;
}

/** Display strings for the server-computed summary; no maths happens here. */
export const summaryStats = (
  summary: BoulderSessionSummaryRecord,
): SummaryStat[] => [
  {
    key: "sends",
    label: "Sends",
    value: String(summary.sends),
    accessibilityLabel: `${summary.sends} ${summary.sends === 1 ? "send" : "sends"}`,
  },
  {
    key: "flashes",
    label: "Flashes",
    value: String(summary.flashes),
    accessibilityLabel: `${summary.flashes} ${summary.flashes === 1 ? "flash" : "flashes"}`,
  },
  {
    key: "attempts",
    label: "Attempts",
    value: String(summary.attempts),
    accessibilityLabel: summary.attemptsComplete
      ? `${summary.attempts} attempts`
      : `${summary.attempts} known attempts; attempts unknown for some boulders`,
  },
  {
    key: "top",
    label: "Top grade",
    value: summary.topGrade ?? "No sends",
    accessibilityLabel: summary.topGrade
      ? `Top grade ${gradeSpoken(summary.topGrade)}`
      : "No sends yet",
  },
];

export const ATTEMPTS_UNKNOWN_NOTE = "Attempts unknown for some boulders.";

export const formatBoulderDate = (activityDate: string): string => {
  const date = new Date(`${activityDate}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return activityDate;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
};

/** Workouts history row: "Top 6C · 9 sends" or "No sends · 4 boulders". */
export const sessionHistorySubtitle = (
  session: Pick<BoulderSessionRecord, "summary" | "session">,
): string => {
  const { summary } = session;
  const parts = [formatBoulderDate(session.session.activityDate)];
  if (summary.topGrade) {
    parts.push(`Top ${summary.topGrade}`);
    parts.push(`${summary.sends} ${summary.sends === 1 ? "send" : "sends"}`);
  } else {
    parts.push("No sends");
    parts.push(
      `${summary.boulders} ${summary.boulders === 1 ? "boulder" : "boulders"}`,
    );
  }
  return parts.join(" · ");
};

export const sessionTitle = (
  session: Pick<BoulderSessionRecord, "session">,
): string =>
  session.session.gymName
    ? `Bouldering · ${session.session.gymName}`
    : "Bouldering";

export const PENDING_SYNC_TEXT = "Saved on this device · Waiting to sync";
