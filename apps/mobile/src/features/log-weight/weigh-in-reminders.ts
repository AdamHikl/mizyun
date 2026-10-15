import * as Notifications from "expo-notifications";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Opt-in local weigh-in reminder. Off by default; nothing is scheduled until
 * the user saves a time and days. Modelled on the first-meal reminder: a
 * rolling window of dated local notifications (so today's can be skipped once
 * a weight is logged), an ID journal written before each native schedule, and
 * cancellation on disable, sign-out and account deletion.
 *
 * Notification text is deliberately neutral; it never contains a weight.
 */

/** expo-notifications weekdays: Sunday = 1 ... Saturday = 7. */
export type WeighInWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface WeighInReminderSettings {
  readonly enabled: boolean;
  readonly hour: number;
  readonly minute: number;
  readonly weekdays: readonly number[];
  readonly notificationIds: readonly string[];
  readonly lastReconciledDate?: string | null;
  readonly todayLoggedDate?: string | null;
}

/**
 * Suggested starting point when the user opts in: Monday and Thursday at
 * 07:30. Two weigh-ins a week give a usable trend without encouraging
 * day-to-day fluctuation watching; the user can pick any days (including every
 * day). The suggestion only pre-fills the picker; nothing is scheduled until
 * the user saves.
 */
export const DEFAULT_WEIGH_IN_REMINDERS: WeighInReminderSettings = {
  enabled: false,
  hour: 7,
  minute: 30,
  weekdays: [2, 5],
  notificationIds: [],
  lastReconciledDate: null,
  todayLoggedDate: null,
};

export const WEIGH_IN_ROUTE = "/log-weight";
export const WEIGH_IN_SOURCE = "weigh_in_reminder";
export const WEIGH_IN_NOTIFICATION = {
  title: "Time for a weigh-in",
  body: "Open Mizyun to add your weight.",
} as const;
/** Dated notifications are scheduled this many days ahead (iOS caps at 64). */
export const WEIGH_IN_ROLLING_DAYS = 14;

export interface WeighInReminderStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync?(key: string): Promise<unknown>;
}

export interface WeighInReminderScheduler {
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

export const weighInReminderKey = (userId: string): string =>
  `mizyun.weigh-in-reminders.${userId}`;

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
export const activateWeighInReminders = (userId: string): void => {
  const current = identity(userId);
  lifecycle.set(userId, { generation: current.generation + 1, active: true });
};

const retire = (userId: string) => {
  const current = identity(userId);
  lifecycle.set(userId, { generation: current.generation + 1, active: false });
};

export const isWeighInReminderSettings = (
  value: unknown,
): value is WeighInReminderSettings => {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Partial<WeighInReminderSettings>;
  return (
    typeof c.enabled === "boolean" &&
    Number.isInteger(c.hour) &&
    (c.hour as number) >= 0 &&
    (c.hour as number) <= 23 &&
    Number.isInteger(c.minute) &&
    (c.minute as number) >= 0 &&
    (c.minute as number) <= 59 &&
    Array.isArray(c.weekdays) &&
    c.weekdays.every(
      (day) => Number.isInteger(day) && (day as number) >= 1 && day <= 7,
    ) &&
    new Set(c.weekdays).size === c.weekdays.length &&
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

export const loadWeighInReminders = async (
  userId: string,
  store: WeighInReminderStore = SecureStore,
): Promise<WeighInReminderSettings> => {
  try {
    const raw = await store.getItemAsync(weighInReminderKey(userId));
    if (raw === null) return DEFAULT_WEIGH_IN_REMINDERS;
    const parsed: unknown = JSON.parse(raw);
    return isWeighInReminderSettings(parsed)
      ? parsed
      : DEFAULT_WEIGH_IN_REMINDERS;
  } catch {
    return DEFAULT_WEIGH_IN_REMINDERS;
  }
};

const isoLocalDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const computeWeighInScheduleDates = (
  settings: {
    readonly hour: number;
    readonly minute: number;
    readonly weekdays: readonly number[];
  },
  options: { readonly todayLogged: boolean; readonly now?: Date },
): Date[] => {
  const now = options.now ?? new Date();
  const dates: Date[] = [];
  for (let offset = 0; offset < WEIGH_IN_ROLLING_DAYS; offset++) {
    const target = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + offset,
      settings.hour,
      settings.minute,
      0,
      0,
    );
    // Date.getDay(): Sunday = 0; expo weekday: Sunday = 1.
    if (!settings.weekdays.includes(target.getDay() + 1)) continue;
    if (offset === 0) {
      // A weight is already logged today, or the time has passed.
      if (options.todayLogged) continue;
      if (target.getTime() <= now.getTime()) continue;
    }
    dates.push(target);
  }
  return dates;
};

type ReminderRequest = Pick<
  WeighInReminderSettings,
  "enabled" | "hour" | "minute" | "weekdays"
>;
export type ApplyWeighInResult =
  | { readonly ok: true; readonly settings: WeighInReminderSettings }
  | {
      readonly ok: false;
      readonly reason: "permission_denied" | "unavailable" | "no_days";
    };
export interface WeighInReminderOptions {
  readonly todayLogged?: boolean;
  readonly now?: () => Date;
}

const cancelTracked = async (
  ids: readonly string[],
  scheduler: WeighInReminderScheduler,
): Promise<string[]> => {
  const unique = [...new Set(ids)];
  const results = await Promise.allSettled(
    unique.map((id) => scheduler.cancel(id)),
  );
  return unique.filter((_, index) => results[index]!.status === "rejected");
};

const persist = (
  userId: string,
  settings: WeighInReminderSettings,
  store: WeighInReminderStore,
) => store.setItemAsync(weighInReminderKey(userId), JSON.stringify(settings));

// UI reads may fall back to defaults. Native mutations must keep the ID journal.
const readForMutation = async (
  userId: string,
  store: WeighInReminderStore,
): Promise<WeighInReminderSettings> => {
  const raw = await store.getItemAsync(weighInReminderKey(userId));
  if (raw === null) return DEFAULT_WEIGH_IN_REMINDERS;
  const parsed: unknown = JSON.parse(raw);
  if (!isWeighInReminderSettings(parsed))
    throw new Error("Weigh-in reminder journal could not be read.");
  return parsed;
};

const applyQueued = async (
  userId: string,
  requested: ReminderRequest,
  options: WeighInReminderOptions,
  scheduler: WeighInReminderScheduler,
  store: WeighInReminderStore,
  generation: number,
  mayRequestPermission: boolean,
): Promise<ApplyWeighInResult> => {
  const valid = () =>
    identity(userId).active && identity(userId).generation === generation;
  if (!valid()) return { ok: false, reason: "unavailable" };
  if (requested.enabled && requested.weekdays.length === 0)
    return { ok: false, reason: "no_days" };
  let previous: WeighInReminderSettings;
  try {
    previous = await readForMutation(userId, store);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!valid()) return { ok: false, reason: "unavailable" };
  const now = options.now?.() ?? new Date();
  const today = isoLocalDate(now);
  const todayLoggedDate = options.todayLogged
    ? today
    : (previous.todayLoggedDate ?? null);
  const base: WeighInReminderSettings = { ...previous, todayLoggedDate };
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
        // Passive reconciliation never prompts; retire schedules after revocation.
        if (!mayRequestPermission) {
          remainingOldIds = await cancelTracked(
            previous.notificationIds,
            scheduler,
          );
          await persist(
            userId,
            { ...base, notificationIds: remainingOldIds },
            store,
          );
        } else if (options.todayLogged) {
          await persist(userId, base, store);
        }
        return { ok: false, reason: "permission_denied" };
      }
    }
    // Persist the suppression marker before mutating native schedules.
    if (options.todayLogged) await persist(userId, base, store);
    if (!valid()) throw new Error("Reminder account retired");
    remainingOldIds = await cancelTracked(previous.notificationIds, scheduler);
    await persist(userId, { ...base, notificationIds: remainingOldIds }, store);
    if (remainingOldIds.length || !valid())
      throw new Error("Reminder cancellation incomplete");
    if (requested.enabled) {
      for (const date of computeWeighInScheduleDates(requested, {
        todayLogged: todayLoggedDate === today,
        now,
      })) {
        if (!valid()) throw new Error("Reminder account retired");
        const id = Crypto.randomUUID();
        nextIds.push(id);
        // Journal the caller-supplied ID before the native request so an
        // interruption can be cleaned up on the next launch.
        await persist(
          userId,
          { ...base, notificationIds: [...nextIds] },
          store,
        );
        if (!valid()) throw new Error("Reminder account retired");
        await scheduler.scheduleAtDate(
          date,
          {
            ...WEIGH_IN_NOTIFICATION,
            data: { url: WEIGH_IN_ROUTE, source: WEIGH_IN_SOURCE, userId },
          },
          id,
        );
        if (!valid()) throw new Error("Reminder account retired");
      }
    }
    const settings: WeighInReminderSettings = {
      ...base,
      enabled: requested.enabled,
      hour: requested.hour,
      minute: requested.minute,
      weekdays: [...requested.weekdays].sort((a, b) => a - b),
      notificationIds: [...nextIds],
      lastReconciledDate: today,
    };
    await persist(userId, settings, store);
    if (!valid()) throw new Error("Reminder account retired");
    return { ok: true, settings };
  } catch {
    const failedNewIds = await cancelTracked(nextIds, scheduler);
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

export const applyWeighInReminders = (
  userId: string,
  requested: ReminderRequest,
  options: WeighInReminderOptions = {},
  scheduler: WeighInReminderScheduler = expoWeighInReminderScheduler,
  store: WeighInReminderStore = SecureStore,
): Promise<ApplyWeighInResult> => {
  const generation = identity(userId).generation;
  return enqueue(userId, () =>
    applyQueued(userId, requested, options, scheduler, store, generation, true),
  );
};

/** Passive refresh of the rolling window; never prompts for permission. */
export const reconcileWeighInReminders = (
  userId: string,
  options: { readonly todayLogged: boolean; readonly now?: () => Date },
  scheduler: WeighInReminderScheduler = expoWeighInReminderScheduler,
  store: WeighInReminderStore = SecureStore,
): Promise<WeighInReminderSettings> => {
  const generation = identity(userId).generation;
  return enqueue(userId, async () => {
    const current = await readForMutation(userId, store);
    // Never write for people who have not opted in, and nothing to refresh.
    if (!current.enabled && current.notificationIds.length === 0)
      return current;
    const result = await applyQueued(
      userId,
      current,
      options,
      scheduler,
      store,
      generation,
      false,
    );
    return result.ok ? result.settings : loadWeighInReminders(userId, store);
  });
};

/** After a weight is saved: skip today's reminder (a no-op when not enabled). */
export const markWeighInLoggedToday = (
  userId: string,
  scheduler: WeighInReminderScheduler = expoWeighInReminderScheduler,
  store: WeighInReminderStore = SecureStore,
  now?: () => Date,
): Promise<WeighInReminderSettings> =>
  reconcileWeighInReminders(
    userId,
    { todayLogged: true, ...(now ? { now } : {}) },
    scheduler,
    store,
  );

/** Sign-out cleanup: cancel native schedules but keep the opt-in preference. */
export const suspendWeighInReminders = (
  userId: string,
  scheduler: WeighInReminderScheduler = expoWeighInReminderScheduler,
  store: WeighInReminderStore = SecureStore,
): Promise<void> => {
  retire(userId);
  return enqueue(userId, async () => {
    const previous = await readForMutation(userId, store);
    if (previous === DEFAULT_WEIGH_IN_REMINDERS) return;
    const remaining = await cancelTracked(previous.notificationIds, scheduler);
    await persist(userId, { ...previous, notificationIds: remaining }, store);
    if (remaining.length)
      throw new Error("Weigh-in reminder cancellation incomplete.");
  });
};

/** Account deletion: cancel everything and remove the preference. */
export const clearWeighInReminders = (
  userId: string,
  scheduler: WeighInReminderScheduler = expoWeighInReminderScheduler,
  store: WeighInReminderStore = SecureStore,
): Promise<void> => {
  retire(userId);
  return enqueue(userId, async () => {
    const previous = await readForMutation(userId, store);
    const remaining = await cancelTracked(previous.notificationIds, scheduler);
    if (remaining.length) {
      await persist(
        userId,
        { ...DEFAULT_WEIGH_IN_REMINDERS, notificationIds: remaining },
        store,
      );
      throw new Error("Weigh-in reminder cancellation incomplete.");
    }
    if (store.deleteItemAsync)
      await store.deleteItemAsync(weighInReminderKey(userId));
    else await persist(userId, DEFAULT_WEIGH_IN_REMINDERS, store);
  });
};

/** Cancel weigh-in notifications that belong to no current owner. */
export const sweepUnownedWeighInNotifications = async (
  owner: string | null,
  ports: {
    list(): Promise<
      readonly {
        identifier: string;
        content: { data?: Record<string, unknown> };
      }[]
    >;
    cancel(identifier: string): Promise<void>;
  },
): Promise<void> => {
  const scheduled = await ports.list();
  const obsolete = scheduled.filter(
    (request) =>
      request.content.data?.source === WEIGH_IN_SOURCE &&
      (owner === null || request.content.data.userId !== owner),
  );
  const outcomes = await Promise.allSettled(
    obsolete.map((request) => ports.cancel(request.identifier)),
  );
  if (outcomes.some((result) => result.status === "rejected"))
    throw new Error("Weigh-in notification sweep incomplete");
};

export const expoWeighInReminderScheduler: WeighInReminderScheduler = {
  ensureChannel: async () => {
    if (Platform.OS !== "android") return;
    await Notifications.setNotificationChannelAsync("weigh-in-reminders", {
      name: "Weigh-in reminders",
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
        channelId: "weigh-in-reminders",
      },
    }),
  cancel: (id) => Notifications.cancelScheduledNotificationAsync(id),
};
