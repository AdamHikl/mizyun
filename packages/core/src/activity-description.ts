import {
  getCatalogExerciseNames,
  type CatalogExercise,
} from "./exercise-catalog";
import {
  findCatalogExerciseByExactName,
  getCatalogTrackingMode,
  listTimedActivities,
  MAX_TRACKED_DURATION_SECONDS,
  type TrackedDistanceUnit,
} from "./exercise-tracking";

/**
 * What a typed activity name refers to. Running is saved as a run; a catalog
 * activity keeps its shared exercise history; anything else is a custom
 * activity saved under the typed name.
 */
export type ResolvedActivityName =
  | { readonly kind: "running"; readonly name: "Running" }
  | { readonly kind: "catalog"; readonly exercise: CatalogExercise }
  | { readonly kind: "custom"; readonly name: string }
  /** A catalog exercise logged with sets and reps, not as an activity. */
  | { readonly kind: "strength"; readonly exercise: CatalogExercise };

const RUNNING_WORDS = [
  "run",
  "runs",
  "running",
  "ran",
  "jog",
  "jogs",
  "jogging",
  "jogged",
  "treadmill run",
  "trail run",
  "trail running",
  "outdoor run",
  "outdoor running",
  "treadmill running",
  "running treadmill",
  "jogging treadmill",
  "trail running walking",
];

/** Words too common in other phrases to identify an activity in a sentence. */
const AMBIGUOUS_IN_DESCRIPTIONS = new Set(["row", "ride", "spin"]);

/** Everyday words for catalog activities, beside their catalog names. */
const ACTIVITY_WORDS: Readonly<Record<string, readonly string[]>> = {
  "exercise-swimming": ["swim", "swims", "swimming", "swam", "swum"],
  "exercise-outdoor-cycling": [
    "cycle",
    "cycled",
    "cycling",
    "bike",
    "biked",
    "biking",
    "bike ride",
    "ride",
    "rode",
  ],
  "stationary-bike": [
    "stationary bike",
    "exercise bike",
    "spin",
    "spinning",
    "spin class",
    "indoor cycling",
  ],
  "exercise-walking": ["walk", "walks", "walked", "walking"],
  "exercise-hiking": ["hike", "hikes", "hiked", "hiking"],
  "exercise-rowing-machine": [
    "row",
    "rowed",
    "rowing",
    "rower",
    "rowing machine",
    "erg",
  ],
  "exercise-elliptical-trainer": ["elliptical", "cross trainer"],
  "exercise-stair-climber": ["stairs", "stair climber", "stairmaster"],
  "exercise-ski-erg": ["skierg", "ski erg"],
  "exercise-jump-rope": [
    "jump rope",
    "jumping rope",
    "skipping",
    "skipping rope",
  ],
};

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

interface Vocabulary {
  readonly phrase: string;
  readonly resolve: () => ResolvedActivityName;
}

const vocabulary = (): readonly Vocabulary[] => {
  const entries: Vocabulary[] = RUNNING_WORDS.map((phrase) => ({
    phrase,
    resolve: () => ({ kind: "running", name: "Running" }),
  }));
  for (const exercise of listTimedActivities()) {
    const phrases = new Set(
      [
        ...getCatalogExerciseNames(exercise),
        ...(ACTIVITY_WORDS[exercise.id] ?? []),
      ].map(normalize),
    );
    for (const phrase of phrases) {
      entries.push({ phrase, resolve: () => ({ kind: "catalog", exercise }) });
    }
  }
  // Longest phrase first, so "stationary bike" wins over "bike".
  return entries.sort((a, b) => b.phrase.length - a.phrase.length);
};

/**
 * Resolve a typed activity name. An exact name or everyday word ("swim",
 * "jogging") maps to running or a catalog activity; any other non-empty text
 * is a custom activity with that name. Returns null for empty text.
 */
export const resolveActivityName = (
  raw: string,
): ResolvedActivityName | null => {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length === 0) return null;
  const key = normalize(name);
  const match = vocabulary().find((entry) => entry.phrase === key);
  if (match) return match.resolve();
  // Other catalog names keep their catalog tracking: timed ones (a plank, a
  // treadmill walk) log here, sets-and-reps ones belong in Log workout.
  const catalog = findCatalogExerciseByExactName(name);
  if (catalog) {
    return getCatalogTrackingMode(catalog) === "load_reps"
      ? { kind: "strength", exercise: catalog }
      : { kind: "catalog", exercise: catalog };
  }
  return { kind: "custom", name };
};

/** Display name for a resolved activity. */
export const resolvedActivityLabel = (
  activity: ResolvedActivityName,
): string =>
  activity.kind === "catalog" || activity.kind === "strength"
    ? activity.exercise.name
    : activity.name;

/** A local calendar date (month is 1–12). */
export interface LocalDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export interface LocalTime {
  readonly hour: number;
  readonly minute: number;
}

/** Fields a description could fill; null where it said nothing usable. */
export interface ActivityDescriptionDraft {
  readonly activity: ResolvedActivityName | null;
  readonly durationSeconds: number | null;
  readonly distance: {
    readonly value: number;
    readonly unit: TrackedDistanceUnit;
  } | null;
  readonly date: LocalDate | null;
  /** Start time on `date`. Null when only the day is known. */
  readonly startTime: LocalTime | null;
  /** True for "just", "now": the activity ended at the current time. */
  readonly endedNow: boolean;
  readonly environment: "treadmill" | "outdoor" | null;
  /** A short place note such as "In the ocean". */
  readonly note: string | null;
}

const WORD_NUMBERS: Readonly<Record<string, number>> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  ninety: 90,
};

const TENS: Readonly<Record<string, number>> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const UNITS = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
];

/**
 * Rewrite number forms the unit patterns cannot read: "twenty-five" → 25
 * and a thousands separator "1,500" → 1500 (a decimal comma such as "2,5"
 * is kept).
 */
const normalizeNumbers = (text: string): string =>
  text
    .replace(
      new RegExp(
        String.raw`\b(${Object.keys(TENS).join("|")})[\s-](${UNITS.join("|")})\b`,
        "g",
      ),
      (_, tens: string, unit: string) =>
        String((TENS[tens] ?? 0) + UNITS.indexOf(unit) + 1),
    )
    .replace(/\b(\d{1,3}),(\d{3})(?![\d]|[.,]\d)/g, "$1$2");

/** Pace such as "5 min/km", "4:50/km" or "8 minutes per mile" is not a duration. */
const PACE =
  /\b\d+(?:[:.]\d{2})?\s*(?:minutes?|mins?)?\s*(?:\/|per)\s*(?:km|kilomet(?:er|re)|mi|mile)s?\b/g;

const WORD_NUMBER = Object.keys(WORD_NUMBERS)
  .sort((a, b) => b.length - a.length)
  .join("|");

/**
 * A quantity followed by one of `units`. Digits may touch the unit ("10km");
 * a word number needs a space ("ten km") so "am" or "as" never count.
 */
const quantity = (units: string, flags = ""): RegExp =>
  new RegExp(
    String.raw`\b(?:(\d+(?:[.,]\d+)?)\s*|(${WORD_NUMBER})\s+)(?:${units})\b`,
    flags,
  );

const quantityValue = (match: RegExpExecArray | RegExpMatchArray): number => {
  const word = match[2];
  if (word !== undefined) return WORD_NUMBERS[word] ?? Number.NaN;
  return Number((match[1] ?? "").replace(",", "."));
};

const numberValue = (raw: string): number => {
  const word = WORD_NUMBERS[raw];
  return word ?? Number(raw.replace(",", "."));
};

/** "1h20", "1h 20m"; not "2h 30km", where 30 is a distance. */
const COMPACT_DURATION =
  /\b(\d+)\s*h\s*(\d{1,2})(?:\s*(?:m|mins?)\b|(?!\s*[a-z])\b)/;

/**
 * "for 20m" means minutes; "for 400m" is a distance, since nobody swims for
 * 400 minutes. Two digits or fewer read as minutes.
 */
const FOR_MINUTES = /\bfor\s+(\d{1,2})\s*m\b/;

const parseDuration = (text: string): number | null => {
  // "an hour and a half", "one and a half hours"
  const andHalf =
    /\b(an?|one|\d+)\s+(?:hours?|hrs?)\s+and\s+a\s+half\b/.exec(text) ??
    /\b(an?|one|\d+)\s+and\s+a\s+half\s+(?:hours?|hrs?)\b/.exec(text);
  if (andHalf?.[1]) return (numberValue(andHalf[1]) + 0.5) * 3600;
  if (/\bhalf\s+(?:an\s+)?hour\b/.test(text)) return 1800;
  if (/\b(?:a\s+)?quarter\s+(?:of\s+)?(?:an\s+)?hour\b/.test(text)) return 900;
  // "1:20:00" or "45:30" written as a clock duration after "for".
  const clock = /\b(?:for|in)\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\b/.exec(text);
  if (clock?.[1] && clock[2]) {
    const [a, b, c] = [
      Number(clock[1]),
      Number(clock[2]),
      Number(clock[3] ?? "0"),
    ];
    if (b <= 59 && c <= 59)
      return clock[3] ? a * 3600 + b * 60 + c : a * 60 + b;
  }
  let total = 0;
  let found = false;
  const units: ReadonlyArray<readonly [RegExp, number]> = [
    [quantity("hours?|hrs?|h", "g"), 3600],
    [quantity("minutes?|mins?", "g"), 60],
    [quantity("seconds?|secs?|s", "g"), 1],
  ];
  for (const [pattern, factor] of units) {
    for (const match of text.matchAll(pattern)) {
      const value = quantityValue(match);
      if (!Number.isFinite(value)) continue;
      total += value * factor;
      found = true;
    }
  }
  // "1h20", "1h 20m": a bare m after hours means minutes.
  const compact = COMPACT_DURATION.exec(text);
  if (compact?.[1] && compact[2]) {
    total = Number(compact[1]) * 3600 + Number(compact[2]) * 60;
    found = true;
  }
  const forMinutes = FOR_MINUTES.exec(text);
  if (forMinutes?.[1] && !compact) {
    total += Number(forMinutes[1]) * 60;
    found = true;
  }
  if (!found) return null;
  const seconds = Math.round(total);
  return seconds > 0 && seconds <= MAX_TRACKED_DURATION_SECONDS
    ? seconds
    : null;
};

const DISTANCE_UNITS: ReadonlyArray<readonly [string, TrackedDistanceUnit]> = [
  ["kilometres|kilometers|kilometre|kilometer|kms|km|k", "km"],
  ["miles|mile|mi", "mi"],
  ["metres|meters|metre|meter|m", "m"],
  ["yards|yard|yds|yd", "yd"],
];

const parseDistance = (text: string): ActivityDescriptionDraft["distance"] => {
  if (/\bhalf\s+marathon\b/.test(text)) return { value: 21.0975, unit: "km" };
  if (/\bmarathon\b/.test(text)) return { value: 42.195, unit: "km" };
  for (const [words, unit] of DISTANCE_UNITS) {
    const match = quantity(words).exec(text);
    if (!match) continue;
    const value = quantityValue(match);
    if (Number.isFinite(value) && value > 0) return { value, unit };
  }
  return null;
};

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const toLocalDate = (date: Date): LocalDate => ({
  year: date.getFullYear(),
  month: date.getMonth() + 1,
  day: date.getDate(),
});

const sameDay = (a: LocalDate | null, b: LocalDate): boolean =>
  a !== null && a.year === b.year && a.month === b.month && a.day === b.day;

const daysBefore = (now: Date, days: number): LocalDate =>
  toLocalDate(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - days),
  );

/** "oct", "sept" and "october" name a month; "decided" does not. */
const monthIndex = (word: string): number =>
  word.length < 3 ? -1 : MONTHS.findIndex((month) => month.startsWith(word));

/** A month/day without a year is the most recent one not after today. */
const pastMonthDay = (
  now: Date,
  month: number,
  day: number,
): LocalDate | null => {
  if (month < 0 || day < 1 || day > 31) return null;
  let year = now.getFullYear();
  const candidate = new Date(year, month, day);
  if (candidate.getMonth() !== month) return null;
  if (candidate > now) year -= 1;
  return { year, month: month + 1, day };
};

const parseDate = (text: string, now: Date): LocalDate | null => {
  if (/\bday before yesterday\b/.test(text)) return daysBefore(now, 2);
  if (/\b(?:yesterday|last night)\b/.test(text)) return daysBefore(now, 1);
  if (/\b(?:today|tonight|this (?:morning|afternoon|evening))\b/.test(text))
    return toLocalDate(now);
  const ago = /\b(\d{1,3}|[a-z]+)\s+days?\s+ago\b/.exec(text);
  if (ago?.[1]) {
    const days = numberValue(ago[1]);
    if (Number.isInteger(days) && days > 0) return daysBefore(now, days);
  }
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso?.[1] && iso[2] && iso[3]) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (date.getMonth() === Number(iso[2]) - 1) return toLocalDate(date);
  }
  const dayMonth =
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\b/.exec(text);
  if (dayMonth?.[1] && dayMonth[2] && monthIndex(dayMonth[2]) >= 0) {
    return pastMonthDay(now, monthIndex(dayMonth[2]), Number(dayMonth[1]));
  }
  const monthDay = /\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b/.exec(text);
  if (monthDay?.[1] && monthDay[2] && monthIndex(monthDay[1]) >= 0) {
    return pastMonthDay(now, monthIndex(monthDay[1]), Number(monthDay[2]));
  }
  const weekday = new RegExp(
    String.raw`\b(?:on|last)?\s*(${WEEKDAYS.join("|")})\b`,
  ).exec(text);
  if (weekday?.[1]) {
    const target = WEEKDAYS.indexOf(weekday[1]);
    // The most recent such day before today.
    const back = (now.getDay() - target + 7) % 7 || 7;
    return daysBefore(now, back);
  }
  return null;
};

const parseTime = (text: string): LocalTime | null => {
  const clock =
    /\b(?:at|around|from)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a m|p m)?\b/.exec(
      text,
    );
  if (clock?.[1]) {
    let hour = Number(clock[1]);
    const minute = Number(clock[2] ?? "0");
    const period = clock[3]?.replace(" ", "");
    // A bare "at 7" is ambiguous; it needs minutes or am/pm.
    if (!clock[2] && !period) return null;
    if (period === "pm" && hour < 12) hour += 12;
    if (period === "am" && hour === 12) hour = 0;
    if (hour <= 23 && minute <= 59) return { hour, minute };
  }
  const bare = /\b(\d{1,2})\s*(am|pm)\b/.exec(text);
  if (bare?.[1] && bare[2]) {
    let hour = Number(bare[1]);
    if (bare[2] === "pm" && hour < 12) hour += 12;
    if (bare[2] === "am" && hour === 12) hour = 0;
    if (hour <= 23) return { hour, minute: 0 };
  }
  if (/\bthis morning\b/.test(text)) return { hour: 8, minute: 0 };
  if (/\b(?:this|in the) afternoon\b/.test(text))
    return { hour: 14, minute: 0 };
  if (/\b(?:this|in the) evening\b|\btonight\b|\blast night\b/.test(text))
    return { hour: 19, minute: 0 };
  return null;
};

const PLACES = [
  "ocean",
  "sea",
  "lake",
  "river",
  "pool",
  "park",
  "gym",
  "mountains",
  "forest",
  "woods",
  "beach",
];

const parseNote = (text: string): string | null => {
  const place = new RegExp(
    String.raw`\b(in|at|on|by|along) the (${PLACES.join("|")})\b`,
  ).exec(text);
  if (!place?.[1] || !place[2]) return null;
  const preposition = place[1];
  return `${preposition.charAt(0).toUpperCase()}${preposition.slice(1)} the ${place[2]}`;
};

/** The activity mentioned first; at one position the longer phrase wins. */
const findActivity = (text: string): ResolvedActivityName | null => {
  const padded = ` ${normalize(text)} `;
  let best: { readonly at: number; readonly entry: Vocabulary } | null = null;
  for (const entry of vocabulary()) {
    if (AMBIGUOUS_IN_DESCRIPTIONS.has(entry.phrase)) continue;
    const at = padded.indexOf(` ${entry.phrase} `);
    if (at < 0) continue;
    // Entries are longest first, so a tie keeps the longer phrase.
    if (!best || at < best.at) best = { at, entry };
  }
  return best ? best.entry.resolve() : null;
};

/**
 * Draft activity details from a plain-language description such as "I ran
 * for 45 minutes and 10km, yesterday at 19:00". Pure and on-device: nothing
 * is sent anywhere. Every field is a suggestion the user reviews before
 * saving; anything not understood is left null.
 */
export const draftActivityFromDescription = (
  description: string,
  now: Date,
): ActivityDescriptionDraft => {
  const text = normalizeNumbers(
    description.toLowerCase().replace(/\s+/g, " ").trim(),
  );
  const measured = text.replace(PACE, " ");
  const activity = findActivity(text);
  const durationSeconds = parseDuration(measured);
  const distance = parseDistance(
    measured.replace(COMPACT_DURATION, " ").replace(FOR_MINUTES, " "),
  );
  const startTime = parseTime(text);
  const justNow = startTime === null && /\b(?:just|now)\b/.test(text);
  const named = parseDate(text, now);
  // "Just" means today only when no other day was named.
  const date = named ?? (justNow ? toLocalDate(now) : null);
  const endedNow = justNow && sameDay(date, toLocalDate(now));
  const environment = /\btreadmill\b/.test(text)
    ? "treadmill"
    : /\b(?:outside|outdoors?|trail)\b/.test(text)
      ? "outdoor"
      : null;
  return {
    activity,
    durationSeconds,
    distance,
    date,
    startTime,
    endedNow,
    environment,
    note: parseNote(text),
  };
};
