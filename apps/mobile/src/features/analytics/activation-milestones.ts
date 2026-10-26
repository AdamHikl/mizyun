import * as SecureStore from "expo-secure-store";
import { bucketDuration } from "@mizyun/observability";
import type {
  AcquisitionSource,
  CoreRecordKind,
  FirstRunChoice,
} from "@mizyun/contracts";
import type {
  AnalyticsEventInput,
  NetworkAnalyticsClient,
} from "./network-analytics-client";

/**
 * Device-local first-run anchor for the activation scorecard (GTM-04).
 *
 * It holds only dates and enum flags, never record content. Events leave the
 * device solely through `NetworkAnalyticsClient.track`, which drops them
 * unless optional analytics consent is currently granted. The anchor itself is
 * kept regardless, so a later consent never relabels an old record as "first".
 */
export interface ActivationState {
  readonly version: 1;
  readonly owner: string;
  readonly firstRunAt: string;
  readonly choice: FirstRunChoice;
  readonly sourceAnswered: boolean;
  /** Local calendar date (YYYY-MM-DD) of the first confirmed record. */
  readonly firstRecordOn: string | null;
  readonly day7: boolean;
  readonly day28: boolean;
}

/** SecureStore-compatible key-value storage, one entry per account. */
export interface ActivationStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync(key: string): Promise<unknown>;
}

type ActivationAnalytics = Pick<NetworkAnalyticsClient, "track">;

export const activationStateKey = (owner: string): string => {
  if (!/^[a-zA-Z0-9._-]+$/.test(owner)) throw new Error("Invalid owner");
  return `mizyun.activation.v1.${owner}`;
};

/**
 * One queue for every anchor read-modify-write and erasure on this device, so
 * an erasure cannot be undone by a write that read the anchor before it.
 */
let anchorQueue: Promise<unknown> = Promise.resolve();
const serial = <T>(work: () => Promise<T>): Promise<T> => {
  const next = anchorQueue.then(work, work);
  anchorQueue = next.catch(() => undefined);
  return next;
};

/** Local account-data erasure of the first-run anchor (dates/flags only). */
export const clearActivationState = (
  owner: string,
  store: ActivationStore = SecureStore,
): Promise<void> =>
  serial(async () => {
    await store.deleteItemAsync(activationStateKey(owner));
  });

const parseState = (raw: unknown): ActivationState | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (
    value.version !== 1 ||
    typeof value.owner !== "string" ||
    typeof value.firstRunAt !== "string" ||
    typeof value.choice !== "string" ||
    (value.firstRecordOn !== null && typeof value.firstRecordOn !== "string")
  )
    return null;
  return {
    version: 1,
    owner: value.owner,
    firstRunAt: value.firstRunAt,
    choice: value.choice as ActivationState["choice"],
    sourceAnswered: value.sourceAnswered === true,
    firstRecordOn: value.firstRecordOn as string | null,
    day7: value.day7 === true,
    day28: value.day28 === true,
  };
};

const pad = (value: number) => String(value).padStart(2, "0");

/** Device-local calendar date, matching how users experience "a day". */
export const localIsoDate = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const utcDay = (isoDate: string): number => {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
};

/** Whole local calendar days from `from` to `to`, DST-independent. */
export const calendarDaysBetween = (from: string, to: string): number =>
  Math.round(utcDay(to) - utcDay(from));

/** ISO-8601 week label, e.g. "2026-W44", for a local calendar date. */
export const isoWeekOf = (isoDate: string): string => {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const weekYear = date.getUTCFullYear();
  const yearStart = Date.UTC(weekYear, 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${weekYear}-W${pad(week)}`;
};

export class ActivationMilestones {
  constructor(
    private readonly store: ActivationStore,
    private readonly analytics: ActivationAnalytics,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The owner's first-run record, or null when this device has none. */
  stateFor(owner: string): Promise<ActivationState | null> {
    return this.serial(() => this.read(owner));
  }

  completeFirstRun(
    owner: string,
    choice: FirstRunChoice,
    shownAt: number,
  ): Promise<void> {
    return this.serial(async () => {
      if ((await this.read(owner)) !== null) return;
      const now = this.now();
      await this.write({
        version: 1,
        owner,
        firstRunAt: now.toISOString(),
        choice,
        sourceAnswered: false,
        firstRecordOn: null,
        day7: false,
        day28: false,
      });
      await this.emit({
        name: "first_run_completed",
        properties: {
          choice,
          duration: bucketDuration(Math.max(0, now.getTime() - shownAt)),
        },
      });
    });
  }

  /** Returns whether the answer was recorded under current consent. */
  recordAcquisitionSource(
    owner: string,
    source: AcquisitionSource,
  ): Promise<boolean> {
    return this.serial(async () => {
      const state = await this.read(owner);
      if (state === null || state.sourceAnswered) return false;
      const recorded = await this.emit({
        name: "acquisition_source_selected",
        properties: { source },
      });
      if (recorded) await this.write({ ...state, sourceAnswered: true });
      return recorded;
    });
  }

  /** Call after a core record is confirmed saved. Never throws. */
  recordCoreAction(owner: string | null, kind: CoreRecordKind): Promise<void> {
    if (owner === null) return Promise.resolve();
    return this.serial(async () => {
      const state = await this.read(owner);
      if (state === null) return;
      const today = localIsoDate(this.now());
      if (state.firstRecordOn === null) {
        await this.write({ ...state, firstRecordOn: today });
        await this.emit({
          name: "first_confirmed_record",
          properties: { recordKind: kind },
        });
        return;
      }
      const day = calendarDaysBetween(state.firstRecordOn, today);
      const milestone =
        day >= 1 && day <= 7 && !state.day7
          ? "day_7"
          : day >= 22 && day <= 28 && !state.day28
            ? "day_28"
            : null;
      if (milestone === null) return;
      await this.write({
        ...state,
        ...(milestone === "day_7" ? { day7: true } : { day28: true }),
      });
      await this.emit({
        name: "return_milestone_reached",
        properties: { milestone, cohortWeek: isoWeekOf(state.firstRecordOn) },
      });
    }).catch(() => undefined);
  }

  private async read(owner: string): Promise<ActivationState | null> {
    const raw = await this.store.getItemAsync(activationStateKey(owner));
    if (raw === null) return null;
    try {
      const state = parseState(JSON.parse(raw));
      return state?.owner === owner ? state : null;
    } catch {
      return null;
    }
  }

  private async write(state: ActivationState): Promise<void> {
    await this.store.setItemAsync(
      activationStateKey(state.owner),
      JSON.stringify(state),
    );
  }

  private async emit(event: AnalyticsEventInput): Promise<boolean> {
    try {
      const result = await this.analytics.track(event);
      return result.recorded;
    } catch {
      return false;
    }
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    return serial(work);
  }
}
