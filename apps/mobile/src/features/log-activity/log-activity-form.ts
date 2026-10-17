import { runCreateSchema, type RunCreate } from "@mizyun/contracts";
import {
  getCatalogTrackingMode,
  trackedDistanceFromMetres,
  type LocalDate,
  type LocalTime,
  type ResolvedActivityName,
  metresFromTrackedDistance,
  parseDurationInput,
  resolveTrackedDistanceUnit,
  type CatalogExercise,
  type TrackedDistanceUnit,
} from "@mizyun/core";

/** Distance units offered by Log activity (shared with the workout card). */
export type ActivityDistanceUnit = TrackedDistanceUnit;

export const MAX_ACTIVITY_DISTANCE_METERS = 1_000_000;

/**
 * Swimming, rowing and SkiErg use m (metric) or yd (imperial); cycling,
 * walking, hiking and the rest use km or mi.
 */
export const activityDistanceUnit = (
  activity: Pick<CatalogExercise, "id" | "name">,
  unitSystem: "metric" | "imperial",
): ActivityDistanceUnit =>
  resolveTrackedDistanceUnit(
    { name: activity.name, metadata: { catalogId: activity.id } },
    unitSystem,
  );

export const activityTracksDistance = (
  activity: Pick<CatalogExercise, "id">,
): boolean => getCatalogTrackingMode(activity) === "duration_distance";

/** Runs and custom activities record distance in km or mi. */
export const resolvedDistance = (
  activity: ResolvedActivityName | null,
  unitSystem: "metric" | "imperial",
): { readonly tracksDistance: boolean; readonly unit: ActivityDistanceUnit } =>
  activity?.kind === "catalog"
    ? {
        tracksDistance: activityTracksDistance(activity.exercise),
        unit: activityDistanceUnit(activity.exercise, unitSystem),
      }
    : {
        // Strength exercises are refused, so they show no distance.
        tracksDistance: activity?.kind !== "strength",
        unit: unitSystem === "imperial" ? "mi" : "km",
      };

export const metersFromActivityDistance = metresFromTrackedDistance;

export interface ActivityFormInput {
  readonly minutes: string;
  readonly seconds: string;
  readonly distance: string;
  readonly unit: ActivityDistanceUnit;
  readonly tracksDistance: boolean;
}

export type ParsedActivityForm =
  | {
      readonly ok: true;
      readonly durationSeconds: number;
      readonly distanceMeters: number | null;
    }
  | { readonly ok: false; readonly message: string };

export const parseActivityForm = (
  form: ActivityFormInput,
): ParsedActivityForm => {
  const minutes = form.minutes.trim() || "0";
  const seconds = form.seconds.trim() || "0";
  if (!/^\d{1,4}$/.test(minutes) || !/^\d{1,2}$/.test(seconds)) {
    return {
      ok: false,
      message: "Enter whole minutes and seconds from 0 to 59.",
    };
  }
  if (Number(seconds) > 59) {
    return { ok: false, message: "Seconds must be from 0 to 59." };
  }
  const durationSeconds = parseDurationInput(`${minutes}:${seconds}`);
  if (durationSeconds === null || durationSeconds === "invalid") {
    return {
      ok: false,
      message: "Enter a duration longer than 0 and no more than 24 hours.",
    };
  }
  let distanceMeters: number | null = null;
  if (form.tracksDistance && form.distance.trim().length > 0) {
    const raw = form.distance.trim().replace(",", ".");
    const value = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : Number.NaN;
    const meters = Number.isFinite(value)
      ? metersFromActivityDistance(value, form.unit)
      : Number.NaN;
    if (
      !Number.isFinite(meters) ||
      meters <= 0 ||
      meters > MAX_ACTIVITY_DISTANCE_METERS
    ) {
      return {
        ok: false,
        message: `Enter a distance greater than 0 in ${form.unit}, or leave it blank.`,
      };
    }
    distanceMeters = meters;
  }
  return { ok: true, durationSeconds, distanceMeters };
};

export interface ActivityTimes {
  readonly startedAt: string;
  readonly completedAt: string;
}

export const toLocalDate = (date: Date): LocalDate => ({
  year: date.getFullYear(),
  month: date.getMonth() + 1,
  day: date.getDate(),
});

export const compareLocalDates = (a: LocalDate, b: LocalDate): number =>
  a.year - b.year || a.month - b.month || a.day - b.day;

export const sameLocalDate = (a: LocalDate, b: LocalDate): boolean =>
  compareLocalDates(a, b) === 0;

/** `YYYY-MM-DD` for a local date, as the run contract stores it. */
export const isoLocalDate = (date: LocalDate): string =>
  `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;

const atLocal = (date: LocalDate, hour: number, minute: number): Date =>
  new Date(date.year, date.month - 1, date.day, hour, minute, 0, 0);

/** "Today", "Yesterday", or a short weekday date. */
export const localDateLabel = (date: LocalDate, today: LocalDate): string => {
  const yesterday = toLocalDate(
    new Date(today.year, today.month - 1, today.day - 1),
  );
  if (sameLocalDate(date, today)) return "Today";
  if (sameLocalDate(date, yesterday)) return "Yesterday";
  return atLocal(date, 12, 0).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(date.year !== today.year ? { year: "numeric" } : {}),
  });
};

/** Monday-first weeks for a month; days outside it are null. */
export const calendarMonth = (
  year: number,
  month: number,
): {
  readonly title: string;
  readonly weeks: ReadonlyArray<ReadonlyArray<LocalDate | null>>;
} => {
  const first = new Date(year, month - 1, 1);
  const days = new Date(year, month, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells: (LocalDate | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, index) => ({
      year,
      month,
      day: index + 1,
    })),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (LocalDate | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return {
    title: first.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    }),
    weeks,
  };
};

/**
 * Parse an optional start time: "19:00", "19.00", "7pm", "7:30 am".
 * Returns null for empty text and "invalid" for anything else unreadable.
 */
export const parseTimeInput = (raw: string): LocalTime | null | "invalid" => {
  const text = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (text.length === 0) return null;
  const match = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/.exec(text);
  if (!match?.[1]) return "invalid";
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const period = match[3];
  if (!match[2] && !period) return "invalid";
  if (period) {
    if (hour < 1 || hour > 12) return "invalid";
    if (period === "pm" && hour < 12) hour += 12;
    if (period === "am" && hour === 12) hour = 0;
  }
  return hour <= 23 && minute <= 59 ? { hour, minute } : "invalid";
};

export const formatTimeInput = (time: LocalTime): string =>
  `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;

/**
 * Start and end instants for a finished activity. A start time places it
 * exactly. Without one, today ends now and an earlier day is recorded as
 * starting at local noon (moved earlier if it would end after `now`). These
 * day-only times are estimates, one reason the workouts are not exported to
 * Health.
 */
export const activityTimes = (
  now: Date,
  date: LocalDate,
  startTime: LocalTime | null,
  durationSeconds: number,
):
  | ({ readonly ok: true } & ActivityTimes)
  | { readonly ok: false; readonly message: string } => {
  const durationMs = durationSeconds * 1000;
  if (compareLocalDates(date, toLocalDate(now)) > 0) {
    return { ok: false, message: "Choose today or an earlier date." };
  }
  if (startTime) {
    const start = atLocal(date, startTime.hour, startTime.minute);
    if (start.getTime() + durationMs > now.getTime()) {
      return {
        ok: false,
        message:
          "That would end in the future. Check the date, start time and duration.",
      };
    }
    return {
      ok: true,
      startedAt: start.toISOString(),
      completedAt: new Date(start.getTime() + durationMs).toISOString(),
    };
  }
  if (sameLocalDate(date, toLocalDate(now))) {
    return {
      ok: true,
      startedAt: new Date(now.getTime() - durationMs).toISOString(),
      completedAt: now.toISOString(),
    };
  }
  // A long activity on an earlier day must not end in the future.
  const endMs = Math.min(
    atLocal(date, 12, 0).getTime() + durationMs,
    now.getTime(),
  );
  return {
    ok: true,
    startedAt: new Date(endMs - durationMs).toISOString(),
    completedAt: new Date(endMs).toISOString(),
  };
};

/** Distance field text for a drafted distance, in the field's unit. */
export const distanceFieldText = (
  distance: { readonly value: number; readonly unit: TrackedDistanceUnit },
  unit: TrackedDistanceUnit,
): string =>
  String(
    trackedDistanceFromMetres(
      metresFromTrackedDistance(distance.value, distance.unit),
      unit,
    ),
  );

/**
 * The device time zone, used to record a run's calendar date. Null when the
 * runtime cannot name it: a guessed zone could disagree with the local date.
 */
export const deviceTimeZone = (): string | null => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
};

/**
 * Date and start time for an activity that just ended: it started
 * `durationSeconds` ago, rounded down to the minute so it never ends in the
 * future, and may begin on the previous day.
 */
export const endedNowStart = (
  now: Date,
  durationSeconds: number,
): { readonly date: LocalDate; readonly startTime: LocalTime } => {
  const start = new Date(now.getTime() - durationSeconds * 1000);
  start.setSeconds(0, 0);
  return {
    date: toLocalDate(start),
    startTime: { hour: start.getHours(), minute: start.getMinutes() },
  };
};

/**
 * Body for `POST /v1/runs`. A start time makes it an exact run; otherwise
 * the run keeps day precision like a run logged without a time.
 */
export const runCreateBody = (input: {
  readonly operationId: string;
  readonly now: Date;
  readonly date: LocalDate;
  readonly startTime: LocalTime | null;
  readonly durationSeconds: number;
  readonly distanceMeters: number | null;
  readonly environment: "outdoor" | "treadmill" | "unspecified";
  readonly notes: string;
  readonly timeZone: string;
}):
  | { readonly ok: true; readonly body: RunCreate }
  | { readonly ok: false; readonly message: string } => {
  const times = activityTimes(
    input.now,
    input.date,
    input.startTime,
    input.durationSeconds,
  );
  if (!times.ok) return times;
  const notes = input.notes.trim();
  const parsed = runCreateSchema.safeParse({
    clientOperationId: input.operationId,
    activityDate: isoLocalDate(input.date),
    recordingTimezone: input.timeZone,
    startedAt: input.startTime ? times.startedAt : null,
    durationSeconds: input.durationSeconds,
    distanceMeters: input.distanceMeters,
    environment: input.environment,
    name: "Run",
    notes: notes.length > 0 ? notes : null,
  });
  return parsed.success
    ? { ok: true, body: parsed.data }
    : {
        ok: false,
        message: parsed.error.issues[0]?.message ?? "Check your run details.",
      };
};
