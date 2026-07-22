import { File, Paths } from "expo-file-system";
import {
  isAnalyticsEvent,
  type AnalyticsConsent,
  type AnalyticsConsentStore,
  type AnalyticsEvent,
  type AnalyticsEventStore,
} from "@mizyun/observability";

const CONSENT_FILE_NAME = "mizyun-product-analytics-consent-v1.txt";
const EVENT_FILE_NAME = "mizyun-product-analytics-v1.json";
const MAX_EVENTS = 500;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

interface LocalEventFile {
  readonly exists: boolean;
  text(): Promise<string>;
  write(content: string): void;
  delete(): void;
}

export class ExpoAnalyticsConsentStore implements AnalyticsConsentStore {
  constructor(
    private readonly file: LocalEventFile = new File(
      Paths.document,
      CONSENT_FILE_NAME,
    ),
  ) {}

  async read(): Promise<AnalyticsConsent> {
    if (!this.file.exists) return "unknown";
    const value = await this.file.text();
    return value === "granted" || value === "denied" ? value : "unknown";
  }

  async write(consent: "granted" | "denied"): Promise<void> {
    this.file.write(consent);
  }
}

/**
 * Bounded, local-only event store. It contains no account/device identifier
 * and is transmitted only when the user invokes the system share sheet.
 */
export class ExpoAnalyticsEventStore implements AnalyticsEventStore {
  constructor(
    private readonly file: LocalEventFile = new File(
      Paths.document,
      EVENT_FILE_NAME,
    ),
    private readonly now: () => number = Date.now,
  ) {}

  async append(event: AnalyticsEvent): Promise<void> {
    const cutoff = this.now() - RETENTION_MS;
    const retained = (await this.list())
      .filter((candidate) => Date.parse(candidate.recordedAt) >= cutoff)
      .slice(-(MAX_EVENTS - 1));
    this.file.write(JSON.stringify([...retained, event]));
  }

  async list(): Promise<readonly AnalyticsEvent[]> {
    if (!this.file.exists) return [];
    try {
      const parsed: unknown = JSON.parse(await this.file.text());
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isAnalyticsEvent).slice(-MAX_EVENTS);
    } catch {
      return [];
    }
  }

  async clear(): Promise<void> {
    if (this.file.exists) this.file.delete();
  }
}

export const analyticsStoragePolicy = {
  maximumEvents: MAX_EVENTS,
  retentionDays: RETENTION_MS / (24 * 60 * 60 * 1_000),
} as const;
