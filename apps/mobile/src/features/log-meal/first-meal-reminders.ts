import * as Notifications from "expo-notifications";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export interface FirstMealReminderSettings {
  readonly enabled: boolean;
  readonly hour: number;
  readonly minute: number;
  readonly routineLabel?: string | null;
  readonly promptDismissed?: boolean;
  readonly notificationIds: readonly string[];
  readonly lastReconciledDate?: string | null;
  readonly todayLoggedDate?: string | null;
}

export const DEFAULT_FIRST_MEAL_REMINDERS: FirstMealReminderSettings = {
  enabled: false,
  hour: 8,
  minute: 30,
  routineLabel: null,
  promptDismissed: false,
  notificationIds: [],
  lastReconciledDate: null,
};

export interface ReminderStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync?(key: string): Promise<unknown>;
}

export interface FirstMealReminderScheduler {
  ensureChannel(): Promise<void>;
  getPermission(): Promise<"granted" | "denied" | "undetermined">;
  requestPermission(): Promise<"granted" | "denied" | "undetermined">;
  scheduleAtDate(
    date: Date,
    payload: {
      readonly title: string;
      readonly body: string;
      readonly data: Record<string, unknown>;
    },
    identifier: string,
  ): Promise<string>;
  cancel(id: string): Promise<void>;
}

const keyFor = (userId: string): string =>
  `mizyun.first-meal-reminders.${userId}`;

const queues = new Map<string, Promise<unknown>>();
const lifecycle = new Map<string, { generation: number; active: boolean }>();
const identity = (userId: string) =>
  lifecycle.get(userId) ?? { generation: 0, active: false };
const enqueue = <T>(userId: string, work: () => Promise<T>): Promise<T> => {
  const next = (queues.get(userId) ?? Promise.resolve())
    .catch(() => {})
    .then(work);
  queues.set(userId, next);
  void next
    .finally(() => {
      if (queues.get(userId) === next) queues.delete(userId);
    })
    .catch(() => {});
  return next;
};

/** Called only at a current authenticated account boundary, not by screens. */
export const activateFirstMealReminders = (userId: string): void => {
  const current = identity(userId);
  lifecycle.set(userId, { generation: current.generation + 1, active: true });
};

/** Capture synchronously before a settings read to reject old account generations. */
export const captureFirstMealReminderOwner = (
  userId: string,
): (() => boolean) => {
  const captured = identity(userId);
  return () =>
    captured.active &&
    identity(userId).active &&
    identity(userId).generation === captured.generation;
};

export const isFirstMealReminderSettings = (
  value: unknown,
): value is FirstMealReminderSettings => {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Partial<FirstMealReminderSettings>;
  return (
    typeof c.enabled === "boolean" &&
    Number.isInteger(c.hour) &&
    (c.hour as number) >= 0 &&
    (c.hour as number) <= 23 &&
    Number.isInteger(c.minute) &&
    (c.minute as number) >= 0 &&
    (c.minute as number) <= 59 &&
    (c.routineLabel === undefined ||
      c.routineLabel === null ||
      typeof c.routineLabel === "string") &&
    (c.promptDismissed === undefined ||
      typeof c.promptDismissed === "boolean") &&
    Array.isArray(c.notificationIds) &&
    c.notificationIds.every((id) => typeof id === "string") &&
    (c.lastReconciledDate === undefined ||
      c.lastReconciledDate === null ||
      typeof c.lastReconciledDate === "string") &&
    (c.todayLoggedDate === undefined ||
      c.todayLoggedDate === null ||
      (typeof c.todayLoggedDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(c.todayLoggedDate)))
  );
};

export const loadFirstMealReminders = async (
  userId: string,
  store: ReminderStore = SecureStore,
): Promise<FirstMealReminderSettings> => {
  try {
    const raw = await store.getItemAsync(keyFor(userId));
    if (raw === null) return DEFAULT_FIRST_MEAL_REMINDERS;
    const parsed: unknown = JSON.parse(raw);
    if (!isFirstMealReminderSettings(parsed))
      return DEFAULT_FIRST_MEAL_REMINDERS;
    return parsed;
  } catch {
    return DEFAULT_FIRST_MEAL_REMINDERS;
  }
};

export const markFirstMealPromptDismissed = async (
  userId: string,
  store: ReminderStore = SecureStore,
): Promise<FirstMealReminderSettings> => {
  const isCurrent = captureFirstMealReminderOwner(userId);
  return enqueue(userId, async () => {
    if (!isCurrent()) throw new Error("Reminder account retired");
    const current = await readForMutation(userId, store);
    if (!isCurrent()) throw new Error("Reminder account retired");
    const updated = { ...current, promptDismissed: true };
    await store.setItemAsync(keyFor(userId), JSON.stringify(updated));
    return updated;
  });
};

const ROLLING_SCHEDULE_DAYS = 7;

export const computeReminderScheduleDates = (
  settings: { readonly hour: number; readonly minute: number },
  options: { readonly todayLogged: boolean; readonly now?: Date },
): Date[] => {
  const now = options.now ?? new Date();
  const dates: Date[] = [];

  for (let offset = 0; offset < ROLLING_SCHEDULE_DAYS; offset++) {
    const target = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + offset,
      settings.hour,
      settings.minute,
      0,
      0,
    );

    if (offset === 0) {
      if (options.todayLogged) {
        // Suppress today's reminder because the first meal is already logged.
        continue;
      }
      if (target.getTime() <= now.getTime()) {
        // Target time today has already elapsed.
        continue;
      }
    }

    dates.push(target);
  }

  return dates;
};

const isoLocalDate = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

type ReminderRequest = Pick<
  FirstMealReminderSettings,
  "enabled" | "hour" | "minute" | "routineLabel"
>;
type ApplyResult =
  | { readonly ok: true; readonly settings: FirstMealReminderSettings }
  | {
      readonly ok: false;
      readonly reason: "permission_denied" | "unavailable";
    };
type ReminderOptions = {
  readonly todayLogged?: boolean;
  readonly now?: () => Date;
};

const cancelTracked = async (
  ids: readonly string[],
  scheduler: FirstMealReminderScheduler,
): Promise<string[]> => {
  const unique = [...new Set(ids)];
  const results = await Promise.allSettled(
    unique.map((id) => scheduler.cancel(id)),
  );
  return unique.filter((_, index) => results[index].status === "rejected");
};
const persist = (
  userId: string,
  settings: FirstMealReminderSettings,
  store: ReminderStore,
) => store.setItemAsync(keyFor(userId), JSON.stringify(settings));

// UI reads may fall back to defaults. Native mutations must retain the ID journal.
const readForMutation = async (
  userId: string,
  store: ReminderStore,
): Promise<FirstMealReminderSettings> => {
  const raw = await store.getItemAsync(keyFor(userId));
  if (raw === null) return DEFAULT_FIRST_MEAL_REMINDERS;
  const parsed: unknown = JSON.parse(raw);
  if (!isFirstMealReminderSettings(parsed))
    throw new Error("First-meal reminder journal could not be read.");
  return parsed;
};

const applyQueued = async (
  userId: string,
  requested: ReminderRequest,
  options: ReminderOptions,
  scheduler: FirstMealReminderScheduler,
  store: ReminderStore,
  generation: number,
  mayRequestPermission: boolean,
): Promise<ApplyResult> => {
  const valid = () =>
    identity(userId).active && identity(userId).generation === generation;
  if (!valid()) return { ok: false, reason: "unavailable" };
  let previous: FirstMealReminderSettings;
  try {
    previous = await readForMutation(userId, store);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!valid()) return { ok: false, reason: "unavailable" };
  const now = options.now?.() ?? new Date();
  const today = isoLocalDate(now);
  // A confirmed local save remains authoritative for this day, including stale reads.
  const todayLoggedDate = options.todayLogged
    ? today
    : (previous.todayLoggedDate ?? null);
  const base: FirstMealReminderSettings = { ...previous, todayLoggedDate };
  const nextIds: string[] = [];
  let remainingOldIds = [...previous.notificationIds];
  try {
    if (requested.enabled) {
      await scheduler.ensureChannel();
      if (!valid()) throw new Error("Reminder account retired");
      let permission = await scheduler.getPermission();
      if (!valid()) throw new Error("Reminder account retired");
      if (permission !== "granted" && mayRequestPermission) {
        permission = await scheduler.requestPermission();
        if (!valid()) throw new Error("Reminder account retired");
      }
      if (permission !== "granted") {
        // Passive reconciliation never prompts; retire old schedules after revocation.
        if (!mayRequestPermission) {
          const remaining = await cancelTracked(
            previous.notificationIds,
            scheduler,
          );
          remainingOldIds = remaining;
          await persist(userId, { ...base, notificationIds: remaining }, store);
        } else if (options.todayLogged) {
          await persist(userId, base, store);
        }
        return { ok: false, reason: "permission_denied" };
      }
    }
    // Persist the suppression marker before mutating native schedules.
    if (options.todayLogged) await persist(userId, base, store);
    if (!valid()) throw new Error("Reminder account retired");
    const failedOldIds = await cancelTracked(
      previous.notificationIds,
      scheduler,
    );
    remainingOldIds = failedOldIds;
    await persist(userId, { ...base, notificationIds: failedOldIds }, store);
    if (failedOldIds.length || !valid())
      throw new Error("Reminder cancellation incomplete");
    if (requested.enabled) {
      for (const date of computeReminderScheduleDates(requested, {
        todayLogged: todayLoggedDate === today,
        now,
      })) {
        if (!valid()) throw new Error("Reminder account retired");
        const id = Crypto.randomUUID();
        nextIds.push(id);
        // Persist the caller-supplied native ID before scheduling; interruption
        // during the native request can then be cleaned up on the next launch.
        await persist(
          userId,
          { ...base, notificationIds: [...nextIds] },
          store,
        );
        if (!valid()) throw new Error("Reminder account retired");
        await scheduler.scheduleAtDate(
          date,
          {
            title: "Mizyun reminder",
            body: "Open Mizyun to review your next step.",
            data: { url: "/log-meal", source: "first_meal_reminder", userId },
          },
          id,
        );
        if (!valid()) throw new Error("Reminder account retired");
      }
    }
    const settings: FirstMealReminderSettings = {
      ...base,
      enabled: requested.enabled,
      hour: requested.hour,
      minute: requested.minute,
      routineLabel: requested.routineLabel ?? null,
      promptDismissed: mayRequestPermission ? true : base.promptDismissed,
      notificationIds: [...nextIds],
      lastReconciledDate: today,
    };
    await persist(userId, settings, store);
    if (!valid()) throw new Error("Reminder account retired");
    return { ok: true, settings };
  } catch {
    const failedNewIds = await cancelTracked(nextIds, scheduler);
    // Includes old failed cancellations and newly scheduled IDs whose cleanup failed.
    await persist(
      userId,
      {
        ...base,
        notificationIds: [...new Set([...remainingOldIds, ...failedNewIds])],
      },
      store,
    );
    return { ok: false, reason: "unavailable" };
  }
};

export const applyFirstMealReminders = (
  userId: string,
  requested: ReminderRequest,
  options: ReminderOptions = {},
  scheduler: FirstMealReminderScheduler = expoFirstMealReminderScheduler,
  store: ReminderStore = SecureStore,
): Promise<ApplyResult> => {
  const generation = identity(userId).generation;
  return enqueue(userId, () =>
    applyQueued(userId, requested, options, scheduler, store, generation, true),
  );
};

export const reconcileFirstMealReminders = (
  userId: string,
  options: { readonly todayLogged: boolean; readonly now?: () => Date },
  scheduler: FirstMealReminderScheduler = expoFirstMealReminderScheduler,
  store: ReminderStore = SecureStore,
): Promise<FirstMealReminderSettings> => {
  const generation = identity(userId).generation;
  return enqueue(userId, async () => {
    const current = await readForMutation(userId, store);
    const result = await applyQueued(
      userId,
      current,
      options,
      scheduler,
      store,
      generation,
      false,
    );
    return result.ok ? result.settings : loadFirstMealReminders(userId, store);
  });
};

const retire = (userId: string) => {
  const current = identity(userId);
  lifecycle.set(userId, { generation: current.generation + 1, active: false });
};

/** Logout cleanup preserves opt-in preferences; rejection means native cleanup needs retry. */
export const suspendFirstMealReminders = (
  userId: string,
  scheduler: FirstMealReminderScheduler = expoFirstMealReminderScheduler,
  store: ReminderStore = SecureStore,
): Promise<void> => {
  retire(userId);
  return enqueue(userId, async () => {
    const previous = await readForMutation(userId, store);
    if (previous === DEFAULT_FIRST_MEAL_REMINDERS) return;
    const remaining = await cancelTracked(previous.notificationIds, scheduler);
    await persist(userId, { ...previous, notificationIds: remaining }, store);
    if (remaining.length)
      throw new Error("First-meal reminder cancellation incomplete.");
  });
};

export const clearFirstMealReminders = (
  userId: string,
  scheduler: FirstMealReminderScheduler = expoFirstMealReminderScheduler,
  store: ReminderStore = SecureStore,
): Promise<void> => {
  retire(userId);
  return enqueue(userId, async () => {
    const previous = await readForMutation(userId, store);
    const remaining = await cancelTracked(previous.notificationIds, scheduler);
    if (remaining.length) {
      await persist(
        userId,
        { ...DEFAULT_FIRST_MEAL_REMINDERS, notificationIds: remaining },
        store,
      );
      throw new Error("First-meal reminder cancellation incomplete.");
    }
    if (store.deleteItemAsync) await store.deleteItemAsync(keyFor(userId));
    else await persist(userId, DEFAULT_FIRST_MEAL_REMINDERS, store);
  });
};

export const expoFirstMealReminderScheduler: FirstMealReminderScheduler = {
  ensureChannel: async () => {
    if (Platform.OS !== "android") return;
    await Notifications.setNotificationChannelAsync("first-meal-reminders", {
      name: "First meal reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  },
  getPermission: async () => (await Notifications.getPermissionsAsync()).status,
  requestPermission: async () =>
    (await Notifications.requestPermissionsAsync()).status,
  scheduleAtDate: async (date, payload, identifier) =>
    Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: payload.title,
        body: payload.body,
        data: payload.data,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date,
        channelId: "first-meal-reminders",
      },
    }),
  cancel: (id) => Notifications.cancelScheduledNotificationAsync(id),
};
