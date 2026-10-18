import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Evening stretch reminder (#298). One local notification for tonight only,
 * scheduled on days with finished training and cancelled once tonight's
 * stretch is done. Settings live on the device per user, like the other
 * local reminders.
 */
export interface EveningStretchSettings {
  readonly enabled: boolean;
  readonly hour: number;
  readonly minute: number;
  readonly notificationId: string | null;
  /** Local date and "HH:MM" the pending notification was scheduled for. */
  readonly scheduledDate: string | null;
  readonly scheduledTime: string | null;
  /** Local date of the last finished stretch session. */
  readonly completedDate: string | null;
  /** The OS prompt is requested at most once from automatic syncs. */
  readonly permissionRequested: boolean;
}

export const DEFAULT_EVENING_STRETCH: EveningStretchSettings = {
  enabled: true,
  hour: 21,
  minute: 0,
  notificationId: null,
  scheduledDate: null,
  scheduledTime: null,
  completedDate: null,
  permissionRequested: false,
};

export const EVENING_STRETCH_ROUTE = "/evening-stretch";
export const EVENING_STRETCH_SOURCE = "evening_stretch_reminder";
const CHANNEL_ID = "evening-stretch";

export interface EveningStretchStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync?(key: string): Promise<unknown>;
}

type PermissionStatus = "granted" | "denied" | "undetermined";

export interface EveningStretchScheduler {
  ensureChannel(): Promise<void>;
  getPermission(): Promise<PermissionStatus>;
  requestPermission(): Promise<PermissionStatus>;
  scheduleAtDate(
    date: Date,
    payload: {
      readonly title: string;
      readonly body: string;
      readonly data: Record<string, unknown>;
    },
  ): Promise<string>;
  cancel(id: string): Promise<void>;
  /** Pending notifications with their data, used to retire orphans. */
  listScheduled(): Promise<
    readonly { readonly id: string; readonly data: Record<string, unknown> }[]
  >;
}

const keyFor = (userId: string): string => `mizyun.evening-stretch.${userId}`;

const isDateOrNull = (value: unknown): boolean =>
  value === null || (typeof value === "string" && value.length <= 10);

const isHour = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 23;

const isMinute = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 59;

export const isEveningStretchSettings = (
  value: unknown,
): value is EveningStretchSettings => {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Partial<EveningStretchSettings>;
  return (
    typeof c.enabled === "boolean" &&
    isHour(c.hour) &&
    isMinute(c.minute) &&
    (c.notificationId === null || typeof c.notificationId === "string") &&
    isDateOrNull(c.scheduledDate) &&
    (c.scheduledTime === null || typeof c.scheduledTime === "string") &&
    isDateOrNull(c.completedDate) &&
    typeof c.permissionRequested === "boolean"
  );
};

export const loadEveningStretch = async (
  userId: string,
  store: EveningStretchStore = SecureStore,
): Promise<EveningStretchSettings> => {
  try {
    const raw = await store.getItemAsync(keyFor(userId));
    if (raw === null) return DEFAULT_EVENING_STRETCH;
    const parsed: unknown = JSON.parse(raw);
    return isEveningStretchSettings(parsed) ? parsed : DEFAULT_EVENING_STRETCH;
  } catch {
    return DEFAULT_EVENING_STRETCH;
  }
};

const write = (
  userId: string,
  settings: EveningStretchSettings,
  store: EveningStretchStore,
): Promise<unknown> =>
  store.setItemAsync(keyFor(userId), JSON.stringify(settings));

export const isoLocalDate = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const timeLabel = (hour: number, minute: number): string =>
  `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

export const isEveningStretchDoneToday = (
  settings: EveningStretchSettings,
  now: Date = new Date(),
): boolean => settings.completedDate === isoLocalDate(now);

/** Tonight's reminder instant, or null once it has passed. */
export const computeEveningStretchDate = (
  settings: { readonly hour: number; readonly minute: number },
  now: Date,
): Date | null => {
  const target = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    settings.hour,
    settings.minute,
    0,
    0,
  );
  return target.getTime() > now.getTime() ? target : null;
};

export type EveningStretchSyncStatus =
  | "scheduled"
  | "not_needed"
  | "disabled"
  | "permission_denied"
  | "unknown"
  | "unavailable";

export interface EveningStretchSyncOptions {
  /** null when today's training could not be read; nothing is changed then. */
  readonly trainedToday: boolean | null;
  /** May show the OS prompt; automatic syncs ask at most once per user. */
  readonly requestPermission?: "never" | "once" | "always";
  readonly now?: Date;
}

// Serializes every read-modify-write so overlapping syncs cannot schedule twice.
let queue: Promise<unknown> = Promise.resolve();
const serialize = <T>(work: () => Promise<T>): Promise<T> => {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
};

/** Cancels this source's pending notifications except `keep`. */
const retireOthers = async (
  scheduler: EveningStretchScheduler,
  keep: string | null,
  belongsTo: (owner: unknown) => boolean,
): Promise<void> => {
  const pending = await scheduler.listScheduled().catch(() => []);
  await Promise.allSettled(
    pending
      .filter(
        (entry) =>
          entry.id !== keep &&
          entry.data.source === EVENING_STRETCH_SOURCE &&
          belongsTo(entry.data.userId),
      )
      .map((entry) => scheduler.cancel(entry.id)),
  );
};

const syncLocked = async (
  userId: string,
  options: EveningStretchSyncOptions,
  scheduler: EveningStretchScheduler,
  store: EveningStretchStore,
): Promise<{
  readonly status: EveningStretchSyncStatus;
  readonly settings: EveningStretchSettings;
}> => {
  const now = options.now ?? new Date();
  const current = await loadEveningStretch(userId, store);
  const today = isoLocalDate(now);
  const ownedBy = (owner: unknown) => owner === userId;

  const clear = async (
    status: EveningStretchSyncStatus,
    patch: Partial<EveningStretchSettings> = {},
  ) => {
    if (current.notificationId) {
      await scheduler.cancel(current.notificationId).catch(() => {});
    }
    await retireOthers(scheduler, null, ownedBy);
    const settings: EveningStretchSettings = {
      ...current,
      ...patch,
      notificationId: null,
      scheduledDate: null,
      scheduledTime: null,
    };
    await write(userId, settings, store);
    return { status, settings };
  };

  if (!current.enabled) return clear("disabled");
  if (current.completedDate === today) return clear("not_needed");
  const target = computeEveningStretchDate(current, now);
  if (target === null) return clear("not_needed");
  if (options.trainedToday === null) {
    return { status: "unknown", settings: current };
  }
  if (!options.trainedToday) return clear("not_needed");

  const wantedTime = timeLabel(current.hour, current.minute);
  if (
    current.notificationId !== null &&
    current.scheduledDate === today &&
    current.scheduledTime === wantedTime
  ) {
    // A sign-out sweep or reinstall can drop the OS request while the stored
    // record survives; reschedule unless it is still pending.
    const pending = await scheduler.listScheduled().catch(() => null);
    if (
      pending === null ||
      pending.some((entry) => entry.id === current.notificationId)
    ) {
      return { status: "scheduled", settings: current };
    }
  }

  await scheduler.ensureChannel();
  let permission = await scheduler.getPermission();
  const mode = options.requestPermission ?? "never";
  let permissionRequested = current.permissionRequested;
  if (
    permission !== "granted" &&
    (mode === "always" || (mode === "once" && !permissionRequested))
  ) {
    permissionRequested = true;
    // Persist first so a failing prompt is not retried by every sync.
    await write(userId, { ...current, permissionRequested }, store);
    permission = await scheduler.requestPermission();
  }
  if (permission !== "granted") {
    return clear("permission_denied", { permissionRequested });
  }

  const id = await scheduler.scheduleAtDate(target, {
    title: "Time to stretch",
    body: "Your 5-minute stretch for today's training is ready.",
    data: {
      url: EVENING_STRETCH_ROUTE,
      source: EVENING_STRETCH_SOURCE,
      userId,
    },
  });
  try {
    if (current.notificationId) {
      await scheduler.cancel(current.notificationId).catch(() => {});
    }
    await retireOthers(scheduler, id, ownedBy);
    const settings: EveningStretchSettings = {
      ...current,
      notificationId: id,
      scheduledDate: today,
      scheduledTime: wantedTime,
      permissionRequested,
    };
    await write(userId, settings, store);
    return { status: "scheduled", settings };
  } catch (error) {
    await scheduler.cancel(id).catch(() => {});
    throw error;
  }
};

/** Brings tonight's notification in line with the settings and today's training. */
export const syncEveningStretch = (
  userId: string,
  options: EveningStretchSyncOptions,
  scheduler: EveningStretchScheduler = expoEveningStretchScheduler,
  store: EveningStretchStore = SecureStore,
): Promise<{
  readonly status: EveningStretchSyncStatus;
  readonly settings: EveningStretchSettings;
}> =>
  serialize(() =>
    syncLocked(userId, options, scheduler, store).catch(async () => ({
      status: "unavailable" as const,
      settings: await loadEveningStretch(userId, store),
    })),
  );

/** Saves the switch and time; the caller syncs afterwards. */
export const saveEveningStretchPreference = (
  userId: string,
  preference: {
    readonly enabled: boolean;
    readonly hour: number;
    readonly minute: number;
  },
  store: EveningStretchStore = SecureStore,
): Promise<EveningStretchSettings> =>
  serialize(async () => {
    const current = await loadEveningStretch(userId, store);
    const settings: EveningStretchSettings = {
      ...current,
      enabled: preference.enabled,
      hour: preference.hour,
      minute: preference.minute,
    };
    await write(userId, settings, store);
    return settings;
  });

/** Asks for notification permission from an explicit settings save. */
export const ensureEveningStretchPermission = (
  userId: string,
  scheduler: EveningStretchScheduler = expoEveningStretchScheduler,
  store: EveningStretchStore = SecureStore,
): Promise<PermissionStatus> =>
  serialize(async () => {
    await scheduler.ensureChannel();
    const existing = await scheduler.getPermission();
    if (existing === "granted") return existing;
    const status = await scheduler.requestPermission();
    const current = await loadEveningStretch(userId, store);
    await write(userId, { ...current, permissionRequested: true }, store);
    return status;
  }).catch(() => "undetermined" as const);

/** Records tonight's stretch as done and cancels its reminder. */
export const markEveningStretchDone = (
  userId: string,
  now: Date = new Date(),
  scheduler: EveningStretchScheduler = expoEveningStretchScheduler,
  store: EveningStretchStore = SecureStore,
): Promise<EveningStretchSettings> =>
  serialize(async () => {
    const current = await loadEveningStretch(userId, store);
    if (current.notificationId) {
      await scheduler.cancel(current.notificationId).catch(() => {});
    }
    await retireOthers(scheduler, null, (owner) => owner === userId);
    const settings: EveningStretchSettings = {
      ...current,
      notificationId: null,
      scheduledDate: null,
      scheduledTime: null,
      completedDate: isoLocalDate(now),
    };
    await write(userId, settings, store);
    return settings;
  });

/** Cancels pending stretch reminders that belong to anyone but `owner`. */
export const sweepEveningStretchNotifications = (
  owner: string | null,
  scheduler: EveningStretchScheduler = expoEveningStretchScheduler,
): Promise<void> =>
  serialize(() =>
    retireOthers(scheduler, null, (userId) => userId !== owner),
  ).catch(() => {});

/** Account deletion or local data reset. */
export const clearEveningStretch = async (
  userId: string,
  scheduler: EveningStretchScheduler = expoEveningStretchScheduler,
  store: EveningStretchStore = SecureStore,
): Promise<void> => {
  await serialize(async () => {
    const previous = await loadEveningStretch(userId, store);
    if (previous.notificationId) {
      await scheduler.cancel(previous.notificationId).catch(() => {});
    }
    await retireOthers(scheduler, null, (owner) => owner === userId);
    if (typeof store.deleteItemAsync === "function") {
      await store.deleteItemAsync(keyFor(userId));
    } else {
      await write(userId, DEFAULT_EVENING_STRETCH, store);
    }
  }).catch(() => {
    // Best-effort cleanup during account deletion or logout.
  });
};

export const expoEveningStretchScheduler: EveningStretchScheduler = {
  ensureChannel: async () => {
    if (Platform.OS !== "android") return;
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Evening stretch",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  },
  getPermission: async () => (await Notifications.getPermissionsAsync()).status,
  requestPermission: async () =>
    (await Notifications.requestPermissionsAsync()).status,
  scheduleAtDate: async (date, payload) =>
    Notifications.scheduleNotificationAsync({
      content: {
        title: payload.title,
        body: payload.body,
        data: payload.data,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date,
        channelId: CHANNEL_ID,
      },
    }),
  cancel: (id) => Notifications.cancelScheduledNotificationAsync(id),
  listScheduled: async () =>
    (await Notifications.getAllScheduledNotificationsAsync()).map(
      (request) => ({
        id: request.identifier,
        data: (request.content.data ?? {}) as Record<string, unknown>,
      }),
    ),
};
