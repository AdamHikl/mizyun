import type { UserId } from "./index";

/** A schedule explicitly authorized by the user from a confirmed meal snapshot. */
export interface StoredRecurringMeal {
  readonly id: string;
  readonly userId: UserId;
  readonly name: string;
  readonly localTime: string;
  readonly timeZone: string;
  readonly weekdays: readonly number[];
  readonly enabled: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface RecurringMealCreate {
  readonly id: string;
  readonly sourceEntryId: string;
  readonly localTime: string;
  readonly timeZone: string;
  readonly weekdays: readonly number[];
}

export interface RecurringMealPatch {
  readonly sourceEntryId?: string | undefined;
  readonly localTime?: string | undefined;
  readonly timeZone?: string | undefined;
  readonly weekdays?: readonly number[] | undefined;
  readonly enabled?: boolean | undefined;
}

export class RecurringMealRepositoryError extends Error {
  constructor(readonly kind: "not_found" | "invalid" | "conflict") {
    super(`Recurring meal ${kind}`);
    this.name = "RecurringMealRepositoryError";
  }
}

export interface RecurringMealRepository {
  clearForUser?(
    userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<void>;
  exportForUser?(
    userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<{
    readonly schedules: readonly Record<string, unknown>[];
    readonly occurrences: readonly Record<string, unknown>[];
  }>;
  list(
    userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<readonly StoredRecurringMeal[]>;
  create(
    userId: UserId,
    input: RecurringMealCreate,
    options: { readonly accessToken: string },
  ): Promise<StoredRecurringMeal>;
  update(
    userId: UserId,
    id: string,
    patch: RecurringMealPatch,
    options: { readonly accessToken: string },
  ): Promise<StoredRecurringMeal | null>;
  stop(
    userId: UserId,
    id: string,
    options: { readonly accessToken: string },
  ): Promise<boolean>;
  skip(
    userId: UserId,
    id: string,
    localDate: string,
    options: { readonly accessToken: string },
  ): Promise<boolean>;
}

/** Calendar validation is independent of device clocks and UTC offsets. */
export const isRecurringMealLocalDate = (value: string): boolean => {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
};

export const recurringMealLocalDateAt = (
  at: Date,
  timeZone: string,
): string => {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const part = (type: string) =>
    parts.find((value) => value.type === type)!.value;
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
};

export const validateRecurringMealSchedule = (schedule: {
  readonly localTime: string;
  readonly timeZone: string;
  readonly weekdays: readonly number[];
}): boolean => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.localTime)) return false;
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)*$/.test(schedule.timeZone))
    return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: schedule.timeZone });
  } catch {
    return false;
  }
  return (
    schedule.weekdays.length > 0 &&
    schedule.weekdays.length <= 7 &&
    new Set(schedule.weekdays).size === schedule.weekdays.length &&
    schedule.weekdays.every(
      (day) => Number.isInteger(day) && day >= 0 && day <= 6,
    )
  );
};
