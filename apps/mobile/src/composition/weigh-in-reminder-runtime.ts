import * as SecureStore from "expo-secure-store";
import * as Notifications from "expo-notifications";

import {
  isWeightLoggedToday,
  readLastBodyEntry,
} from "@/features/log-weight/log-weight-data";
import {
  activateWeighInReminders,
  reconcileWeighInReminders,
  suspendWeighInReminders,
  sweepUnownedWeighInNotifications,
} from "@/features/log-weight/weigh-in-reminders";

const OWNER_KEY = "mizyun.weigh-in-reminder-owners";

export interface WeighInRuntimePorts {
  readOwners(): Promise<readonly string[]>;
  writeOwners(owners: readonly string[]): Promise<void>;
  activate(owner: string): void;
  suspend(owner: string): Promise<void>;
  sweep(owner: string | null): Promise<void>;
  /** null when the answer is unknown (offline); then nothing is rescheduled. */
  readTodayLogged(owner: string): Promise<boolean | null>;
  reconcile(owner: string, todayLogged: boolean): Promise<unknown>;
}

/**
 * Serializes account transitions for the weigh-in reminder: the previous
 * account's schedules are cancelled before the next account's are refreshed.
 */
export class WeighInReminderRuntime {
  private revision = 0;
  private owner: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly ports: WeighInRuntimePorts) {}

  setOwner(owner: string | null): Promise<void> {
    const previous = this.owner;
    this.owner = owner;
    const revision = ++this.revision;
    // Retire synchronously so a delayed read cannot reschedule the old account.
    const retired =
      previous && previous !== owner
        ? this.ports.suspend(previous).then(
            () => null,
            (error: unknown) => error,
          )
        : Promise.resolve(null);
    return this.enqueue(async () => {
      const error = await retired;
      if (error) throw error;
      await this.ports.sweep(owner);
      for (const stored of await this.ports.readOwners()) {
        if (stored !== owner) await this.ports.suspend(stored);
      }
      if (revision !== this.revision) return;
      await this.ports.writeOwners(owner ? [owner] : []);
      if (!owner || revision !== this.revision) return;
      this.ports.activate(owner);
      await this.refreshFor(owner, revision);
    });
  }

  refresh(): Promise<void> {
    const owner = this.owner;
    const revision = this.revision;
    return this.enqueue(async () => {
      if (!owner || revision !== this.revision) return;
      await this.refreshFor(owner, revision);
    });
  }

  private async refreshFor(owner: string, revision: number): Promise<void> {
    const logged = await this.ports.readTodayLogged(owner);
    if (logged === null || revision !== this.revision) return;
    await this.ports.reconcile(owner, logged);
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const result = this.queue.catch(() => {}).then(work);
    this.queue = result;
    return result;
  }
}

export const weighInReminderRuntime = new WeighInReminderRuntime({
  readOwners: async () => {
    const raw = await SecureStore.getItemAsync(OWNER_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      !parsed.every((owner) => typeof owner === "string" && owner.length > 0)
    )
      throw new Error("Weigh-in reminder owner journal unavailable");
    return parsed;
  },
  writeOwners: async (owners) => {
    await SecureStore.setItemAsync(OWNER_KEY, JSON.stringify(owners));
  },
  activate: activateWeighInReminders,
  suspend: (owner) => suspendWeighInReminders(owner),
  sweep: (owner) =>
    sweepUnownedWeighInNotifications(owner, {
      list: () => Notifications.getAllScheduledNotificationsAsync(),
      cancel: (identifier) =>
        Notifications.cancelScheduledNotificationAsync(identifier),
    }),
  readTodayLogged: async (owner) => {
    const read = await readLastBodyEntry({ expectedUserId: owner }).catch(
      () => null,
    );
    // An unknown (offline) answer must not drop or add today's reminder.
    return read === null || !read.ok ? null : isWeightLoggedToday(read.entry);
  },
  reconcile: (owner, todayLogged) =>
    reconcileWeighInReminders(owner, { todayLogged }),
});
