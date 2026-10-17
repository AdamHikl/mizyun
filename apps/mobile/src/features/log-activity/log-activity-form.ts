import {
  getCatalogTrackingMode,
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

/**
 * Today ends now; an earlier day is recorded as starting at local noon so the
 * date is stable, moved earlier if it would otherwise end after `now`.
 * `dayOffset` 0 is today. The times are estimates, which is one reason these
 * workouts are not exported to Health.
 */
export const activityTimes = (
  now: Date,
  dayOffset: number,
  durationSeconds: number,
): ActivityTimes => {
  if (dayOffset <= 0) {
    return {
      startedAt: new Date(now.getTime() - durationSeconds * 1000).toISOString(),
      completedAt: now.toISOString(),
    };
  }
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - dayOffset,
    12,
    0,
    0,
    0,
  );
  // A long activity on an earlier day must not end in the future.
  const endMs = Math.min(
    start.getTime() + durationSeconds * 1000,
    now.getTime(),
  );
  return {
    startedAt: new Date(endMs - durationSeconds * 1000).toISOString(),
    completedAt: new Date(endMs).toISOString(),
  };
};

export const recentDayLabels = (
  now: Date,
  count = 7,
): ReadonlyArray<{ readonly offset: number; readonly label: string }> =>
  Array.from({ length: count }, (_, offset) => {
    const day = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - offset,
    );
    return {
      offset,
      label:
        offset === 0
          ? "Today"
          : offset === 1
            ? "Yesterday"
            : day.toLocaleDateString(undefined, {
                weekday: "short",
                day: "numeric",
                month: "short",
              }),
    };
  });
