import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import {
  CURRENT_ANALYTICS_CONSENT_VERSION,
  type AnalyticsBatchIngestResponse,
  type AnalyticsClearResponse,
  type AnalyticsConsentResponse,
  type AnalyticsEventV2,
  type ScreenName,
} from "@mizyun/contracts";
import type {
  AnalyticsConsent,
  DurationBucket,
  FailureReason,
  FailureStage,
  LoggingFlow,
  RetryCountBucket,
  TapCountBucket,
  TrackResult,
} from "@mizyun/observability";

export interface AnalyticsStorageFile {
  readonly exists: boolean;
  text(): Promise<string>;
  write(content: string): void;
  delete(): void;
}

export interface NetworkAnalyticsApiTransport {
  getConsent(): Promise<{ ok: boolean; data?: AnalyticsConsentResponse }>;
  updateConsent(input: {
    readonly version: typeof CURRENT_ANALYTICS_CONSENT_VERSION;
    readonly granted: boolean;
    readonly expectedRevision: number;
    readonly operationId: string;
  }): Promise<{
    ok: boolean;
    data?: AnalyticsConsentResponse;
    conflict?: boolean;
  }>;
  ingestBatch(input: {
    readonly consentVersion: typeof CURRENT_ANALYTICS_CONSENT_VERSION;
    readonly epoch: string;
    readonly events: readonly AnalyticsEventV2[];
  }): Promise<{
    ok: boolean;
    data?: AnalyticsBatchIngestResponse;
    conflict?: boolean;
  }>;
  clearEvents(input: {
    readonly expectedRevision: number;
    readonly operationId: string;
  }): Promise<{
    ok: boolean;
    data?: AnalyticsClearResponse;
    conflict?: boolean;
  }>;
  listEvents(): Promise<{
    ok: boolean;
    data?: { readonly events: readonly AnalyticsEventV2[] };
  }>;
}

export interface StoredLocalConsentState {
  readonly version: typeof CURRENT_ANALYTICS_CONSENT_VERSION;
  readonly granted: boolean;
  readonly revision: number;
  readonly epoch: string;
  readonly pendingDenial?: boolean;
}

export type AnalyticsEventInput =
  | {
      readonly name: "app_session_started";
      readonly properties: { readonly entryPoint: "cold_start" | "foreground" };
    }
  | {
      readonly name: "screen_viewed";
      readonly properties: { readonly screen: ScreenName };
    }
  | {
      readonly name: "onboarding_started";
      readonly properties?: Record<string, never>;
    }
  | {
      readonly name: "onboarding_step_completed";
      readonly properties: {
        readonly step:
          | "welcome"
          | "profile"
          | "goals"
          | "preferences"
          | "notifications"
          | "complete";
      };
    }
  | {
      readonly name: "onboarding_completed";
      readonly properties: {
        readonly duration: DurationBucket;
        readonly taps: TapCountBucket;
      };
    }
  | {
      readonly name: "logging_flow_started";
      readonly properties: {
        readonly flow: LoggingFlow;
        readonly mode?: "manual" | "quick" | "voice" | "photo" | "barcode";
      };
    }
  | {
      readonly name: "logging_flow_completed";
      readonly properties: {
        readonly flow: LoggingFlow;
        readonly duration: DurationBucket;
        readonly taps: TapCountBucket;
        readonly retries: RetryCountBucket;
      };
    }
  | {
      readonly name: "logging_flow_failed";
      readonly properties: {
        readonly flow: LoggingFlow;
        readonly stage: FailureStage;
        readonly reason: FailureReason;
        readonly retryable: boolean;
        readonly retries: RetryCountBucket;
      };
    }
  | {
      readonly name: "logging_flow_exited";
      readonly properties: {
        readonly flow: LoggingFlow;
        readonly duration: DurationBucket;
        readonly exit: "cancel" | "navigate_away";
      };
    }
  | {
      readonly name: "core_record_created";
      readonly properties: { readonly recordKind: LoggingFlow };
    }
  | {
      readonly name: "feature_action_result";
      readonly properties: {
        readonly action: any;
        readonly outcome: "success" | "failure";
        readonly reason?: FailureReason;
        readonly duration?: DurationBucket;
      };
    }
  | {
      readonly name: "feature_viewed";
      readonly properties: { readonly feature: string };
    };

const CONSENT_FILE_NAME = "mizyun-product-analytics-consent-v2.json";
const QUEUE_FILE_NAME = "mizyun-product-analytics-queue-v2.json";
const MAX_QUEUE_SIZE = 500;
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export class NetworkAnalyticsClient {
  private operation: Promise<unknown> = Promise.resolve();
  private sessionId = Crypto.randomUUID();
  private sequence = 0;
  private lastActivityAt = Date.now();
  private activeFlowId: string | null = null;
  private cachedConsent: StoredLocalConsentState | null = null;

  constructor(
    private readonly apiTransport: NetworkAnalyticsApiTransport,
    private readonly consentFile: AnalyticsStorageFile = new File(
      Paths.document,
      CONSENT_FILE_NAME,
    ),
    private readonly queueFile: AnalyticsStorageFile = new File(
      Paths.document,
      QUEUE_FILE_NAME,
    ),
    private readonly now: () => number = Date.now,
    private readonly appVersion = "0.1.0",
  ) {}

  startFlow(): string {
    const id = Crypto.randomUUID();
    this.activeFlowId = id;
    return id;
  }

  endFlow(): void {
    this.activeFlowId = null;
  }

  async getConsent(): Promise<AnalyticsConsent> {
    return this.exclusive(async () => {
      const state = await this.readLocalConsent();
      return state.granted
        ? "granted"
        : state.revision > 0 || state.pendingDenial
          ? "denied"
          : "unknown";
    });
  }

  async setConsent(next: "granted" | "denied"): Promise<boolean> {
    return this.exclusive(async () => {
      const current = await this.readLocalConsent();
      const operationId = Crypto.randomUUID();

      if (next === "denied") {
        // Synchronously stop capture locally and discard queue immediately
        const optimistic: StoredLocalConsentState = {
          version: CURRENT_ANALYTICS_CONSENT_VERSION,
          granted: false,
          revision: current.revision,
          epoch: Crypto.randomUUID(),
          pendingDenial: true,
        };
        await this.writeLocalConsent(optimistic);
        await this.clearQueue();

        const res = await this.apiTransport.updateConsent({
          version: CURRENT_ANALYTICS_CONSENT_VERSION,
          granted: false,
          expectedRevision: current.revision,
          operationId,
        });

        if (res.ok && res.data) {
          await this.writeLocalConsent({
            version: CURRENT_ANALYTICS_CONSENT_VERSION,
            granted: false,
            revision: res.data.revision,
            epoch: res.data.epoch,
            pendingDenial: false,
          });
        }
        return true;
      }

      // next === "granted"
      const res = await this.apiTransport.updateConsent({
        version: CURRENT_ANALYTICS_CONSENT_VERSION,
        granted: true,
        expectedRevision: current.revision,
        operationId,
      });

      if (!res.ok || !res.data) {
        return false;
      }

      await this.writeLocalConsent({
        version: CURRENT_ANALYTICS_CONSENT_VERSION,
        granted: true,
        revision: res.data.revision,
        epoch: res.data.epoch,
        pendingDenial: false,
      });

      return true;
    });
  }

  async resetLocalSession(): Promise<void> {
    return this.exclusive(async () => {
      this.sessionId = Crypto.randomUUID();
      this.sequence = 0;
      this.lastActivityAt = 0;
      this.activeFlowId = null;
      this.cachedConsent = null;
      await this.clearQueue();
      if (this.consentFile.exists) {
        try {
          this.consentFile.delete();
        } catch {}
      }
    });
  }

  async track(input: AnalyticsEventInput): Promise<TrackResult> {
    return this.exclusive(async () => {
      const consent = await this.readLocalConsent();
      if (!consent.granted) {
        return { recorded: false, reason: "consent_not_granted" };
      }

      const currentTime = this.now();
      if (currentTime - this.lastActivityAt > INACTIVITY_TIMEOUT_MS) {
        this.sessionId = Crypto.randomUUID();
        this.sequence = 0;
      }
      this.lastActivityAt = currentTime;

      const eventName =
        input.name === "feature_viewed" ? "screen_viewed" : input.name;
      const properties =
        input.name === "feature_viewed"
          ? { screen: input.properties.feature as ScreenName }
          : (input.properties ?? {});

      const event: AnalyticsEventV2 = {
        id: Crypto.randomUUID(),
        schemaVersion: 2,
        recordedAt: new Date(currentTime).toISOString(),
        sessionId: this.sessionId,
        sequence: this.sequence++,
        flowId: this.activeFlowId ?? undefined,
        platform: Platform.OS === "android" ? "android" : "ios",
        appVersion: this.appVersion,
        name: eventName as any,
        properties: properties as any,
      };

      await this.appendToQueue(event);
      void this.flush();

      return { recorded: true };
    });
  }

  async flush(): Promise<void> {
    const consent = await this.readLocalConsent();
    if (!consent.granted) {
      if (consent.pendingDenial) {
        await this.retryPendingDenial();
      }
      return;
    }

    const queue = await this.readQueue();
    if (queue.length === 0) return;

    const batch = queue.slice(0, 50);
    const res = await this.apiTransport.ingestBatch({
      consentVersion: CURRENT_ANALYTICS_CONSENT_VERSION,
      epoch: consent.epoch,
      events: batch,
    });

    if (res.conflict) {
      // Stale epoch or consent revoked on server: sync consent and discard queue
      await this.clearQueue();
      await this.syncConsent();
      return;
    }

    if (res.ok && res.data) {
      const acceptedSet = new Set(res.data.acceptedIds);
      const remaining = queue.filter((e) => !acceptedSet.has(e.id));
      await this.writeQueue(remaining);
    }
  }

  async syncConsent(): Promise<void> {
    const res = await this.apiTransport.getConsent();
    if (res.ok && res.data) {
      await this.writeLocalConsent({
        version: CURRENT_ANALYTICS_CONSENT_VERSION,
        granted: res.data.granted,
        revision: res.data.revision,
        epoch: res.data.epoch,
        pendingDenial: false,
      });
    }
  }

  async list(): Promise<readonly AnalyticsEventV2[]> {
    return this.readQueue();
  }

  async export(): Promise<{
    readonly schemaVersion: 2;
    readonly generatedAt: string;
    readonly events: readonly AnalyticsEventV2[];
  }> {
    return this.exclusive(async () => {
      const cutoff = this.now() - 30 * 24 * 60 * 60 * 1000;
      const serverRes = await this.apiTransport.listEvents();
      if (serverRes.ok && serverRes.data) {
        return {
          schemaVersion: 2,
          generatedAt: new Date(this.now()).toISOString(),
          events: serverRes.data.events.filter(
            (e) => new Date(e.recordedAt).getTime() >= cutoff,
          ),
        };
      }
      const local = await this.readQueue();
      return {
        schemaVersion: 2,
        generatedAt: new Date(this.now()).toISOString(),
        events: local.filter((e) => new Date(e.recordedAt).getTime() >= cutoff),
      };
    });
  }

  async clear(): Promise<boolean> {
    return this.exclusive(async () => {
      const current = await this.readLocalConsent();
      await this.clearQueue();

      const res = await this.apiTransport.clearEvents({
        expectedRevision: current.revision,
        operationId: Crypto.randomUUID(),
      });

      if (res.ok && res.data) {
        await this.writeLocalConsent({
          ...current,
          revision: res.data.revision,
          epoch: res.data.newEpoch,
        });
        return true;
      }
      return false;
    });
  }

  private async retryPendingDenial(): Promise<void> {
    const current = await this.readLocalConsent();
    if (!current.pendingDenial) return;

    const res = await this.apiTransport.updateConsent({
      version: CURRENT_ANALYTICS_CONSENT_VERSION,
      granted: false,
      expectedRevision: current.revision,
      operationId: Crypto.randomUUID(),
    });

    if (res.ok && res.data) {
      await this.writeLocalConsent({
        version: CURRENT_ANALYTICS_CONSENT_VERSION,
        granted: false,
        revision: res.data.revision,
        epoch: res.data.epoch,
        pendingDenial: false,
      });
    }
  }

  private async readLocalConsent(): Promise<StoredLocalConsentState> {
    if (this.cachedConsent) return this.cachedConsent;
    if (!this.consentFile.exists) {
      this.cachedConsent = {
        version: CURRENT_ANALYTICS_CONSENT_VERSION,
        granted: false,
        revision: 0,
        epoch: "00000000-0000-0000-0000-000000000000",
      };
      return this.cachedConsent;
    }
    try {
      const parsed = JSON.parse(await this.consentFile.text());
      if (parsed && typeof parsed.granted === "boolean") {
        this.cachedConsent = parsed;
        return parsed;
      }
    } catch {}
    this.cachedConsent = {
      version: CURRENT_ANALYTICS_CONSENT_VERSION,
      granted: false,
      revision: 0,
      epoch: "00000000-0000-0000-0000-000000000000",
    };
    return this.cachedConsent;
  }

  private async writeLocalConsent(
    state: StoredLocalConsentState,
  ): Promise<void> {
    this.cachedConsent = state;
    try {
      this.consentFile.write(JSON.stringify(state));
    } catch {}
  }

  private async readQueue(): Promise<readonly AnalyticsEventV2[]> {
    if (!this.queueFile.exists) return [];
    try {
      const parsed = JSON.parse(await this.queueFile.text());
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    return [];
  }

  private async writeQueue(events: readonly AnalyticsEventV2[]): Promise<void> {
    try {
      this.queueFile.write(JSON.stringify(events));
    } catch {}
  }

  private async appendToQueue(event: AnalyticsEventV2): Promise<void> {
    const queue = [...(await this.readQueue()), event].slice(-MAX_QUEUE_SIZE);
    await this.writeQueue(queue);
  }

  private async clearQueue(): Promise<void> {
    if (this.queueFile.exists) {
      try {
        this.queueFile.delete();
      } catch {}
    }
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.operation.then(work, work);
    this.operation = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}
