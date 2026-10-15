import { recurringMealSuggestionFamilyKey } from "./recurring-meal-suggestion";

/**
 * Pure ranking for the log-meal "quick add" chips.
 *
 * Grouping decision: entries are grouped by normalised meal NAME (the same
 * family key the recurring-meal detector uses), not by the full nutrition
 * identity. A chip is a reuse shortcut; showing "Oatmeal 40 g" and
 * "Oatmeal 60 g" as two chips would waste scarce space and split the habit
 * signal. The chip reuses the most recent variant, which is the portion the
 * user most recently chose. Exact-identity splitting stays the job of the
 * recurring-meal detector, which must not blur portions.
 *
 * Score per entry in the window:
 *   timeWeight * recencyWeight
 *   timeWeight    = 1 within +-120 min of the current local time of day,
 *                   falling linearly to 0.2 at +-360 min, floor 0.2 beyond
 *                   (circular distance, so 23:50 is close to 00:10)
 *   recencyWeight = 0.6 + 0.4 * 0.5^(ageDays / 14)
 * A group's score is the sum over its entries, so frequency dominates.
 * Ties break by latest consumedAt, then family key, then entry id.
 */
export interface MealQuickAddEntry {
  readonly id: string;
  readonly name: string;
  readonly consumedAt: string;
  readonly confirmedByUser?: boolean;
  readonly deletedAt?: string | null;
  readonly details?: Readonly<Record<string, unknown>>;
}

export type MealQuickAddReason = "usual_now" | "frequent" | "recent";

export interface MealQuickAddSuggestion<T extends MealQuickAddEntry> {
  /** Most recent variant of the meal; reuse its name and nutrition. */
  readonly entry: T;
  readonly reason: MealQuickAddReason;
  readonly count: number;
  readonly score: number;
}

export interface MealQuickAddInput<T extends MealQuickAddEntry> {
  readonly entries: readonly T[];
  readonly referenceAt: Date;
  readonly timeZone: string;
  readonly limit: number;
}

export const MEAL_QUICK_ADD_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;
const NEAR_MINUTES = 120;
const FAR_MINUTES = 360;
const FUTURE_SKEW_MS = 5 * 60_000;

const formatters = new Map<string, Intl.DateTimeFormat>();
// Building a formatter per entry is slow on Hermes; reuse one per zone.
const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
    } catch {
      formatter = formatterFor("UTC");
    }
    formatters.set(timeZone, formatter);
  }
  return formatter;
};

const minuteOfDay = (at: number, timeZone: string): number => {
  const parts = formatterFor(timeZone).formatToParts(new Date(at));
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return (get("hour") % 24) * 60 + get("minute");
};

const circularDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b);
  return Math.min(d, 1440 - d);
};

const timeWeight = (distance: number): number =>
  distance <= NEAR_MINUTES
    ? 1
    : distance >= FAR_MINUTES
      ? 0.2
      : 1 - (0.8 * (distance - NEAR_MINUTES)) / (FAR_MINUTES - NEAR_MINUTES);

interface Group<T extends MealQuickAddEntry> {
  latest: T;
  latestAt: number;
  key: string;
  count: number;
  nearCount: number;
  score: number;
}

export const rankMealQuickAdd = <T extends MealQuickAddEntry>(
  input: MealQuickAddInput<T>,
): MealQuickAddSuggestion<T>[] => {
  const now = input.referenceAt.getTime();
  const limit = Math.floor(input.limit);
  if (!Number.isFinite(now) || !(limit > 0)) return [];
  const nowMinute = minuteOfDay(now, input.timeZone);
  const oldest = now - MEAL_QUICK_ADD_WINDOW_DAYS * DAY_MS;
  const groups = new Map<string, Group<T>>();

  for (const entry of input.entries) {
    if (
      entry.deletedAt ||
      entry.confirmedByUser === false ||
      entry.details?.recurringMeal != null
    )
      continue;
    const key = recurringMealSuggestionFamilyKey(entry.name ?? "");
    if (!key) continue;
    const at = Date.parse(entry.consumedAt);
    if (!Number.isFinite(at) || at < oldest || at > now + FUTURE_SKEW_MS)
      continue;
    const ageDays = Math.max(0, now - at) / DAY_MS;
    const distance = circularDistance(
      minuteOfDay(at, input.timeZone),
      nowMinute,
    );
    const weight =
      timeWeight(distance) * (0.6 + 0.4 * Math.pow(0.5, ageDays / 14));
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        latest: entry,
        latestAt: at,
        key,
        count: 1,
        nearCount: distance <= NEAR_MINUTES ? 1 : 0,
        score: weight,
      });
      continue;
    }
    group.count += 1;
    if (distance <= NEAR_MINUTES) group.nearCount += 1;
    group.score += weight;
    if (
      at > group.latestAt ||
      (at === group.latestAt && entry.id > group.latest.id)
    ) {
      group.latest = entry;
      group.latestAt = at;
    }
  }

  return [...groups.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.latestAt - a.latestAt ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) ||
        (a.latest.id < b.latest.id ? -1 : a.latest.id > b.latest.id ? 1 : 0),
    )
    .slice(0, limit)
    .map((g) => ({
      entry: g.latest,
      count: g.count,
      score: g.score,
      reason:
        g.nearCount >= 2 && g.nearCount * 2 >= g.count
          ? "usual_now"
          : g.count >= 2
            ? "frequent"
            : "recent",
    }));
};
