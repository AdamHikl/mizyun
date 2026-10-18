import { invalidateSessionReads } from "@/composition/api-client";
import {
  syncEveningStretch,
  sweepEveningStretchNotifications,
  type EveningStretchSyncStatus,
} from "./evening-stretch-reminder";
import { fetchTodayTraining } from "./today-training-data";
import { onTrainingSaved } from "./training-saved-signal";

export interface EveningStretchRuntimePorts {
  readTraining(): Promise<boolean | null>;
  sync(
    owner: string,
    trainedToday: boolean | null,
    requestPermission: "never" | "once" | "always",
  ): Promise<EveningStretchSyncStatus>;
  sweep(owner: string | null): Promise<void>;
}

/**
 * Keeps tonight's stretch reminder in step with the signed-in account. A
 * sync started for one account is dropped if the account changes first.
 */
export class EveningStretchRuntime {
  private owner: string | null = null;
  private revision = 0;
  constructor(private readonly ports: EveningStretchRuntimePorts) {}

  async setOwner(owner: string | null): Promise<void> {
    if (owner === this.owner) return;
    this.owner = owner;
    this.revision++;
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
    const trained = await this.ports.readTraining().catch(() => null);
    if (owner !== this.owner || revision !== this.revision) return null;
    return this.ports.sync(owner, trained, requestPermission);
  }
}

export const eveningStretchRuntime = new EveningStretchRuntime({
  readTraining: async () => (await fetchTodayTraining())?.trained ?? null,
  sync: async (owner, trainedToday, requestPermission) =>
    (await syncEveningStretch(owner, { trainedToday, requestPermission }))
      .status,
  sweep: (owner) => sweepEveningStretchNotifications(owner),
});

// Save screens announce finished training; the first one may show the OS prompt.
onTrainingSaved(() => {
  // Cached workout reads predate the save that just finished.
  invalidateSessionReads();
  void eveningStretchRuntime.refresh("once").catch(() => {});
});
