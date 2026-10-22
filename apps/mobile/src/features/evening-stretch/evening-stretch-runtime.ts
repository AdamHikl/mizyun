import * as SecureStore from "expo-secure-store";

import { apiClient, invalidateSessionReads } from "@/composition/api-client";
import { isStretchAiEnabled } from "@/composition/app-variant";
import { loadAiConsent } from "@/features/coach/ai-consent";
import {
  loadEveningStretch,
  syncEveningStretch,
  sweepEveningStretchNotifications,
  type EveningStretchSyncStatus,
} from "./evening-stretch-reminder";
import { loadTailoredStretchPlan } from "./stretch-ai-refine";
import { fetchTodayTraining, type TodayTraining } from "./today-training-data";
import { prepareTonightStretch, tonightReminderAt } from "./tonight-stretch";
import { onTrainingSaved } from "./training-saved-signal";

export interface EveningStretchRuntimePorts {
  readTraining(): Promise<TodayTraining | null>;
  sync(
    owner: string,
    trainedToday: boolean | null,
    requestPermission: "never" | "once" | "always",
  ): Promise<EveningStretchSyncStatus>;
  sweep(owner: string | null): Promise<void>;
  /** Tonight's reminder instant, or null when no stretch is due today. */
  reminderAt(owner: string, now: Date): Promise<Date | null>;
  /**
   * Builds tonight's plan ahead of the stretch screen; `isCurrent` turns
   * false once the account changed.
   */
  prepare(
    owner: string,
    training: TodayTraining,
    now: Date,
    isCurrent: () => boolean,
  ): Promise<void>;
}

export interface EveningStretchRuntimeClock {
  now(): Date;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemClock: EveningStretchRuntimeClock = {
  now: () => new Date(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Re-check at least daily so a long wait never overflows the timer. */
const MAX_WAIT_MS = 24 * 60 * 60 * 1000;

/**
 * Keeps tonight's stretch reminder in step with the signed-in account and
 * prepares tonight's plan at reminder time. A sync started for one account
 * is dropped if the account changes first.
 */
export class EveningStretchRuntime {
  private owner: string | null = null;
  private revision = 0;
  private timer: unknown = null;
  constructor(
    private readonly ports: EveningStretchRuntimePorts,
    private readonly clock: EveningStretchRuntimeClock = systemClock,
  ) {}

  async setOwner(owner: string | null): Promise<void> {
    if (owner === this.owner) return;
    this.owner = owner;
    this.revision++;
    this.clearTimer();
    await this.ports.sweep(owner);
    await this.refresh();
  }

  /** "once" may show the OS prompt the first time training is seen. */
  async refresh(
    requestPermission: "never" | "once" | "always" = "never",
  ): Promise<EveningStretchSyncStatus | null> {
    const owner = this.owner;
    const revision = this.revision;
    if (owner === null) return null;
    const training = await this.ports.readTraining().catch(() => null);
    if (!this.isCurrent(owner, revision)) return null;
    const status = await this.ports.sync(
      owner,
      training?.trained ?? null,
      requestPermission,
    );
    if (this.isCurrent(owner, revision)) {
      // In the background: a settings save must not wait on an AI call.
      void this.prepareWhenDue(owner, revision, training).catch(() => {});
    }
    return status;
  }

  private isCurrent(owner: string, revision: number): boolean {
    return owner === this.owner && revision === this.revision;
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  /** Prepare now once the reminder time has passed, else wait for it. */
  private async prepareWhenDue(
    owner: string,
    revision: number,
    training: TodayTraining | null,
  ): Promise<void> {
    this.clearTimer();
    if (training === null || !training.trained) return;
    const now = this.clock.now();
    const at = await this.ports.reminderAt(owner, now);
    if (at === null || !this.isCurrent(owner, revision)) return;
    const wait = at.getTime() - now.getTime();
    if (wait > 0) {
      // An overlapping refresh may have armed one meanwhile.
      this.clearTimer();
      // Only fires while the app runs; otherwise the next open prepares.
      this.timer = this.clock.setTimeout(
        () => {
          this.timer = null;
          if (this.isCurrent(owner, revision)) {
            void this.refresh().catch(() => {});
          }
        },
        Math.min(wait, MAX_WAIT_MS),
      );
      return;
    }
    await this.ports.prepare(owner, training, now, () =>
      this.isCurrent(owner, revision),
    );
  }
}

export const eveningStretchRuntime = new EveningStretchRuntime({
  readTraining: () => fetchTodayTraining(),
  sync: async (owner, trainedToday, requestPermission) =>
    (await syncEveningStretch(owner, { trainedToday, requestPermission }))
      .status,
  sweep: (owner) => sweepEveningStretchNotifications(owner),
  reminderAt: async (owner, now) =>
    tonightReminderAt(await loadEveningStretch(owner), now),
  prepare: (owner, training, now, isCurrent) =>
    prepareTonightStretch(
      owner,
      training,
      now,
      {
        variantEnabled: isStretchAiEnabled,
        // The cached status only; the server enforces consent on the call.
        consent: (userId) => loadAiConsent(userId, SecureStore),
        tailor: (userId, input, localDate, allowed) =>
          loadTailoredStretchPlan(
            userId,
            input,
            localDate,
            apiClient,
            SecureStore,
            allowed,
          ),
      },
      isCurrent,
    ),
});

// Save screens announce finished training; the first one may show the OS prompt.
onTrainingSaved(() => {
  // Cached workout reads predate the save that just finished.
  invalidateSessionReads();
  void eveningStretchRuntime.refresh("once").catch(() => {});
});
