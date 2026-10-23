import {
  summariseFoodEntries,
  type DailyFoodSummary,
  type StoredFoodEntry,
} from "@mizyun/core";

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * One cached formatter per zone. Profiles only pass a shape check, so a zone
 * Intl rejects (RangeError) falls back to UTC instead of failing the Coach.
 */
const formatterFor = (
  cache: Map<string, Intl.DateTimeFormat>,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat => {
  const cached = cache.get(timeZone);
  if (cached !== undefined) return cached;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", { ...options, timeZone });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    formatter = new Intl.DateTimeFormat("en-US", {
      ...options,
      timeZone: "UTC",
    });
  }
  cache.set(timeZone, formatter);
  return formatter;
};

const partsOf = (
  formatter: Intl.DateTimeFormat,
  date: Date,
): ((type: Intl.DateTimeFormatPartTypes) => string) => {
  const parts = formatter.formatToParts(date);
  return (type) => parts.find((part) => part.type === type)?.value ?? "";
};

/** Calendar day (YYYY-MM-DD) of an instant in the given IANA time zone. */
export const localDayIso = (date: Date, timeZone: string): string => {
  const value = partsOf(
    formatterFor(dayFormatters, timeZone, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
    date,
  );
  return `${value("year")}-${value("month")}-${value("day")}`;
};

/**
 * #310: the model reads times literally, so meal times go out as local wall
 * time with the UTC offset (2026-09-10T12:30:00+02:00), not as UTC.
 */
export const localIsoWithOffset = (date: Date, timeZone: string): string => {
  const value = partsOf(
    formatterFor(timeFormatters, timeZone, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    }),
    date,
  );
  const offset = value("timeZoneName").replace(/^GMT/, "") || "+00:00";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}:${value("second")}${offset}`;
};

/**
 * #316: daily food totals bucketed by the user's calendar day. Core
 * `summariseFoodEntries` buckets by a fixed UTC offset, which is wrong across
 * DST, so each entry is pinned to noon UTC of its local day before summing.
 */
export const summariseFoodEntriesByLocalDay = (
  entries: ReadonlyArray<StoredFoodEntry>,
  options: {
    readonly from: string;
    readonly to: string;
    readonly timeZone: string;
  },
): ReadonlyArray<DailyFoodSummary> =>
  summariseFoodEntries(
    entries.map((entry) => ({
      ...entry,
      consumedAt: new Date(
        `${localDayIso(entry.consumedAt, options.timeZone)}T12:00:00.000Z`,
      ),
    })),
    { from: options.from, to: options.to },
  );
