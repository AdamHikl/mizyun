import {
  applyFirstMealReminders,
  captureFirstMealReminderOwner,
  type FirstMealReminderSettings,
} from "../log-meal/first-meal-reminders";
import {
  fetchFoodDay,
  isoLocalDate,
  type FoodDayResult,
} from "../log-meal/meal-lifecycle-data";

/** Resolve suppression before enabling/changing a reminder, including first opt-in. */
export async function saveFirstMealReminderPreferences(
  userId: string,
  settings: FirstMealReminderSettings,
  ports: {
    readDay: typeof fetchFoodDay;
    apply: typeof applyFirstMealReminders;
    now(): Date;
    capture?(userId: string): () => boolean;
  } = {
    readDay: fetchFoodDay,
    apply: applyFirstMealReminders,
    now: () => new Date(),
    capture: captureFirstMealReminderOwner,
  },
) {
  const isCurrent = ports.capture?.(userId) ?? (() => true);
  if (!isCurrent())
    return { ok: false as const, reason: "unavailable" as const };
  const now = ports.now();
  let day: FoodDayResult | null = null;
  if (settings.enabled) {
    try {
      day = await ports.readDay(isoLocalDate(now));
    } catch {
      return { ok: false as const, reason: "unavailable" as const };
    }
    const after = ports.now();
    if (
      !isCurrent() ||
      day.message !== null ||
      day.summary === null ||
      isoLocalDate(after) !== isoLocalDate(now) ||
      after.getTimezoneOffset() !== now.getTimezoneOffset()
    )
      return { ok: false as const, reason: "unavailable" as const };
  }
  try {
    return await ports.apply(userId, settings, {
      todayLogged: day === null ? undefined : day.summary!.entryCount > 0,
      now: ports.now,
    });
  } catch {
    return { ok: false as const, reason: "unavailable" as const };
  }
}
