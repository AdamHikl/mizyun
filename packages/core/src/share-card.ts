/**
 * Shareable session card (ADR-0082, #334). Builds the only data a card image
 * may show from a completed bouldering session or workout. The output is
 * assembled field by field from an allowlist, so anything else on the input
 * (food, body weight, measurements, photos, notes, coach text, workout names,
 * times of day, handles of non-members) can never reach the card.
 */
import { POUNDS_TO_KG_MULTIPLIER } from "./progressive-overload";

/** Every top-level key a card may carry, in render order. */
export const SHARE_CARD_FIELDS = [
  "kind",
  "title",
  "dateLabel",
  "gymName",
  "stats",
  "rows",
  "moreRows",
  "handle",
  "accessibilityLabel",
] as const;

export const SHARE_CARD_MAX_ROWS = 6;
export const SHARE_CARD_GYM_NAME_MAX = 40;
export const SHARE_CARD_LABEL_MAX = 40;

export type ShareCardKind = "bouldering" | "workout";

export interface ShareCardStat {
  readonly label: string;
  readonly value: string;
  readonly spoken: string;
}

export interface ShareCardRow {
  readonly label: string;
  readonly value: string;
  readonly spoken: string;
  /** 0..1 bar length for grade rows; null when the row has no bar. */
  readonly fraction: number | null;
  readonly highlight: boolean;
}

export interface ShareCardContent {
  readonly kind: ShareCardKind;
  readonly title: string;
  readonly dateLabel: string;
  readonly gymName: string | null;
  readonly stats: readonly ShareCardStat[];
  readonly rows: readonly ShareCardRow[];
  /** Rows left off the card because of {@link SHARE_CARD_MAX_ROWS}. */
  readonly moreRows: number;
  readonly handle: string | null;
  readonly accessibilityLabel: string;
}

export interface ShareCardOptions {
  /** Typed by the user for this share; never read from the session. */
  readonly gymName?: string | null;
  /**
   * A Community handle is shown only for an enrolled member who switched it
   * on for this card.
   */
  readonly handle?: {
    readonly communityMember: boolean;
    readonly include: boolean;
    readonly handle: string | null | undefined;
  };
  readonly locale?: string;
}

export interface BoulderShareCardInput {
  /** The session's local calendar day, YYYY-MM-DD. */
  readonly activityDate: string;
  readonly sends: number;
  readonly flashes: number;
  readonly topGrade: string | null;
  /** Sends per grade, any order; sorted hardest first by `gradeRank`. */
  readonly grades: ReadonlyArray<{
    readonly grade: string;
    readonly gradeRank: number;
    readonly sends: number;
    readonly flashes: number;
  }>;
}

export interface WorkoutShareCardSet {
  readonly setType: string;
  readonly loadKg: number | null;
  readonly repetitions: number | null;
}

export interface WorkoutShareCardInput {
  /** The workout's local calendar day, YYYY-MM-DD. */
  readonly activityDate: string;
  readonly durationSeconds: number | null;
  readonly unitSystem: "metric" | "imperial";
  readonly exercises: ReadonlyArray<{
    readonly name: string;
    readonly sets: ReadonlyArray<WorkoutShareCardSet>;
  }>;
  /** Exercise names the caller has established as a new personal best. */
  readonly personalRecords?: ReadonlyArray<string>;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HANDLE = /^[A-Za-z0-9_]{3,30}$/;
// Control and invisible formatting characters (bidi overrides, zero width).
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;

const cleanText = (value: string, max: number): string => {
  const text = value.replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();
  const chars = Array.from(text);
  return chars.length > max
    ? `${chars
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`
    : text;
};

/** The user's gym name for a card, or null when blank. */
export const shareCardGymName = (
  value: string | null | undefined,
): string | null => {
  if (typeof value !== "string") return null;
  const text = cleanText(value, SHARE_CARD_GYM_NAME_MAX);
  return text === "" ? null : text;
};

const cardHandle = (options: ShareCardOptions): string | null => {
  const handle = options.handle;
  if (!handle?.communityMember || !handle.include) return null;
  return typeof handle.handle === "string" && HANDLE.test(handle.handle)
    ? `@${handle.handle}`
    : null;
};

/** Medium date in UTC so the calendar day never shifts with the time zone. */
export const shareCardDateLabel = (
  activityDate: string,
  locale = "en",
): string => {
  const match = DATE.exec(activityDate);
  if (!match) return "";
  const date = new Date(`${activityDate}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
};

const count = (value: number): number =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

const gradeSpoken = (grade: string) => grade.replace(/\+/g, " plus");

const finish = (
  card: Omit<ShareCardContent, "accessibilityLabel">,
): ShareCardContent => {
  const parts = [
    card.title,
    card.dateLabel,
    card.gymName ? `at ${card.gymName}` : null,
    ...card.stats.map((stat) => stat.spoken),
    ...card.rows.map((row) => row.spoken),
    card.moreRows > 0 ? plural(card.moreRows, "more row", "more rows") : null,
    card.handle ? `Shared by ${card.handle}` : null,
    "Made with Mizyun",
  ].filter((part): part is string => typeof part === "string" && part !== "");
  // Rebuilt key by key so the output shape is exactly SHARE_CARD_FIELDS.
  return {
    kind: card.kind,
    title: card.title,
    dateLabel: card.dateLabel,
    gymName: card.gymName,
    stats: card.stats.map(({ label, value, spoken }) => ({
      label,
      value,
      spoken,
    })),
    rows: card.rows.map(({ label, value, spoken, fraction, highlight }) => ({
      label,
      value,
      spoken,
      fraction,
      highlight,
    })),
    moreRows: card.moreRows,
    handle: card.handle,
    accessibilityLabel: parts.join(". "),
  };
};

/** Card content for a completed bouldering session (ADR-0067 fields). */
export const boulderShareCard = (
  input: BoulderShareCardInput,
  options: ShareCardOptions = {},
): ShareCardContent => {
  const sends = count(input.sends);
  const flashes = count(input.flashes);
  const grades = input.grades
    .map((row) => ({
      grade: cleanText(String(row.grade), 8),
      gradeRank: Number(row.gradeRank),
      sends: count(row.sends),
      flashes: count(row.flashes),
    }))
    .filter((row) => row.sends > 0 && row.grade !== "")
    .sort((a, b) => b.gradeRank - a.gradeRank);
  const widest = Math.max(1, ...grades.map((row) => row.sends));
  const shown = grades.slice(0, SHARE_CARD_MAX_ROWS);
  const top =
    typeof input.topGrade === "string" && input.topGrade.trim() !== ""
      ? cleanText(input.topGrade, 8)
      : null;
  return finish({
    kind: "bouldering",
    title: "Bouldering session",
    dateLabel: shareCardDateLabel(input.activityDate, options.locale),
    gymName: shareCardGymName(options.gymName),
    stats: [
      {
        label: "Top grade",
        value: top ?? "—",
        spoken: top ? `Top grade ${gradeSpoken(top)}` : "No top grade",
      },
      {
        label: "Sends",
        value: String(sends),
        spoken: plural(sends, "send", "sends"),
      },
      {
        label: "Flashes",
        value: String(flashes),
        spoken: plural(flashes, "flash", "flashes"),
      },
    ],
    rows: shown.map((row) => ({
      label: row.grade,
      value:
        row.flashes > 0
          ? `${row.sends} · ${plural(row.flashes, "flash", "flashes")}`
          : String(row.sends),
      spoken: `${gradeSpoken(row.grade)}: ${plural(row.sends, "send", "sends")}${
        row.flashes > 0 ? `, ${plural(row.flashes, "flash", "flashes")}` : ""
      }`,
      fraction: row.sends / widest,
      highlight: top !== null && row.grade === top,
    })),
    moreRows: grades.length - shown.length,
    handle: cardHandle(options),
  });
};

const toDisplayLoad = (kg: number, unitSystem: "metric" | "imperial") => {
  const value = unitSystem === "imperial" ? kg / POUNDS_TO_KG_MULTIPLIER : kg;
  return Math.round(value * 10) / 10;
};

const formatNumber = (value: number, locale: string | undefined) =>
  new Intl.NumberFormat(locale ?? "en", { maximumFractionDigits: 1 }).format(
    value,
  );

export const shareCardDuration = (seconds: number | null): string | null => {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 60)
    return null;
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0
    ? `${hours} h ${String(rest).padStart(2, "0")} min`
    : `${minutes} min`;
};

const isWorkingSet = (set: WorkoutShareCardSet) => set.setType !== "warmup";

/**
 * Card content for a completed strength workout: exercise names, working
 * sets, working-set volume, each exercise's top set and duration. The
 * workout's name and notes are not on the card because users type anything
 * there, including body weight.
 */
export const workoutShareCard = (
  input: WorkoutShareCardInput,
  options: ShareCardOptions = {},
): ShareCardContent => {
  const unit = input.unitSystem === "imperial" ? "lb" : "kg";
  const records = new Set(
    (input.personalRecords ?? []).map((name) => name.trim().toLowerCase()),
  );
  let workingSets = 0;
  let volumeKg = 0;
  const rows: ShareCardRow[] = [];
  for (const exercise of input.exercises) {
    const name = cleanText(String(exercise.name), SHARE_CARD_LABEL_MAX);
    const sets = exercise.sets.filter(isWorkingSet);
    if (name === "" || sets.length === 0) continue;
    workingSets += sets.length;
    let top: { loadKg: number; reps: number | null } | null = null;
    for (const set of sets) {
      const load =
        typeof set.loadKg === "number" &&
        Number.isFinite(set.loadKg) &&
        set.loadKg > 0
          ? set.loadKg
          : null;
      const reps =
        typeof set.repetitions === "number" &&
        Number.isFinite(set.repetitions) &&
        set.repetitions > 0
          ? Math.floor(set.repetitions)
          : null;
      if (load !== null && reps !== null) volumeKg += load * reps;
      if (
        load !== null &&
        (top === null ||
          load > top.loadKg ||
          (load === top.loadKg && (reps ?? 0) > (top.reps ?? 0)))
      )
        top = { loadKg: load, reps };
    }
    const pr = records.has(name.toLowerCase()) && top !== null;
    const setsText = plural(sets.length, "set", "sets");
    const topText = top
      ? `${formatNumber(toDisplayLoad(top.loadKg, input.unitSystem), options.locale)} ${unit}${
          top.reps !== null ? ` × ${top.reps}` : ""
        }`
      : null;
    rows.push({
      label: name,
      value: [pr ? "PR" : null, topText ?? setsText]
        .filter(Boolean)
        .join(" · "),
      spoken: `${name}: ${setsText}${
        topText
          ? `, top set ${topText.replace(" × ", " for ")}${top?.reps ? " reps" : ""}`
          : ""
      }${pr ? ", personal record" : ""}`,
      fraction: null,
      highlight: pr,
    });
  }
  const volume = toDisplayLoad(volumeKg, input.unitSystem);
  const volumeText = `${formatNumber(Math.round(volume), options.locale)} ${unit}`;
  const duration = shareCardDuration(input.durationSeconds);
  const stats: ShareCardStat[] = [
    {
      label: "Exercises",
      value: String(rows.length),
      spoken: plural(rows.length, "exercise", "exercises"),
    },
    {
      label: "Sets",
      value: String(workingSets),
      spoken: plural(workingSets, "working set", "working sets"),
    },
  ];
  if (volume > 0)
    stats.push({
      label: "Volume",
      value: volumeText,
      spoken: `${volumeText} volume`,
    });
  if (duration)
    stats.push({
      label: "Time",
      value: duration,
      spoken: `Duration ${duration}`,
    });
  const shown = rows.slice(0, SHARE_CARD_MAX_ROWS);
  return finish({
    kind: "workout",
    title: "Workout",
    dateLabel: shareCardDateLabel(input.activityDate, options.locale),
    gymName: shareCardGymName(options.gymName),
    stats,
    rows: shown,
    moreRows: rows.length - shown.length,
    handle: cardHandle(options),
  });
};
