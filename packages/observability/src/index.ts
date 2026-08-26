export type AnalyticsConsent = "unknown" | "granted" | "denied";

export type LoggingFlow = "meal" | "workout" | "body_measurement";
export type CoreRecordKind = LoggingFlow;
export type FeatureName =
  | "dashboard"
  | "nutrition_history"
  | "workout_history"
  | "body_history"
  | "progress_photos"
  | "settings";
export type DurationBucket =
  | "under_30_seconds"
  | "30_to_59_seconds"
  | "1_to_2_minutes"
  | "3_to_5_minutes"
  | "over_5_minutes";
export type TapCountBucket = "0_to_4" | "5_to_9" | "10_to_19" | "20_plus";
export type RetryCountBucket = "0" | "1" | "2" | "3_plus";
export type FailureStage = "validation" | "load" | "submit" | "upload";
export type FailureReason =
  | "invalid_input"
  | "network"
  | "session"
  | "server"
  | "disabled"
  | "unexpected";

/**
 * Closed analytics vocabulary. Event callers cannot attach arbitrary
 * properties, identifiers, free text, health values, or media references.
 */
export type AnalyticsEventInput =
  | {
      readonly name: "app_session_started";
      readonly properties: { readonly entryPoint: "cold_start" | "foreground" };
    }
  | {
      readonly name: "onboarding_completed";
      readonly properties: {
        readonly duration: DurationBucket;
        readonly taps: TapCountBucket;
      };
    }
  | {
      readonly name: "core_record_created";
      readonly properties: { readonly recordKind: CoreRecordKind };
    }
  | {
      readonly name: "logging_flow_started";
      readonly properties: { readonly flow: LoggingFlow };
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
      readonly name: "feature_viewed";
      readonly properties: { readonly feature: FeatureName };
    };

export type AnalyticsEvent = AnalyticsEventInput & {
  readonly schemaVersion: 1;
  readonly recordedAt: string;
};

export interface AnalyticsConsentStore {
  read(): Promise<AnalyticsConsent>;
  write(consent: Exclude<AnalyticsConsent, "unknown">): Promise<void>;
}

export interface AnalyticsEventStore {
  append(event: AnalyticsEvent): Promise<void>;
  list(): Promise<readonly AnalyticsEvent[]>;
  clear(): Promise<void>;
}

export interface AnalyticsExport {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly dataBoundary: "local_user_initiated_export";
  readonly events: readonly AnalyticsEvent[];
}

export interface AlphaAnalyticsSummary {
  readonly exportCount: number;
  readonly eventCount: number;
  readonly onboardingCompletedExports: number;
  readonly activatedExports: number;
  readonly returnDayCounts: Readonly<Record<string, number>>;
  readonly flows: Readonly<
    Record<
      LoggingFlow,
      {
        readonly started: number;
        readonly completed: number;
        readonly failed: number;
        readonly durationBuckets: Readonly<Record<DurationBucket, number>>;
        readonly tapBuckets: Readonly<Record<TapCountBucket, number>>;
      }
    >
  >;
  readonly featureViews: Readonly<Record<FeatureName, number>>;
  readonly failureReasons: Readonly<Record<FailureReason, number>>;
}

export interface TrackResult {
  readonly recorded: boolean;
  readonly reason?: "consent_not_granted" | "storage_failure";
}

/**
 * Consent-aware, provider-neutral analytics boundary. All failures are
 * converted into non-throwing results so analytics can never block a core flow.
 */
export class LocalAnalyticsClient {
  private operation: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly consentStore: AnalyticsConsentStore,
    private readonly eventStore: AnalyticsEventStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  getConsent(): Promise<AnalyticsConsent> {
    return this.exclusive(async () => {
      try {
        return await this.consentStore.read();
      } catch {
        return "unknown";
      }
    });
  }

  setConsent(consent: Exclude<AnalyticsConsent, "unknown">): Promise<boolean> {
    return this.exclusive(async () => {
      try {
        await this.consentStore.write(consent);
        if (consent === "denied") await this.eventStore.clear();
        return true;
      } catch {
        return false;
      }
    });
  }

  track(input: AnalyticsEventInput): Promise<TrackResult> {
    return this.exclusive(async () => {
      try {
        if ((await this.consentStore.read()) !== "granted") {
          return { recorded: false, reason: "consent_not_granted" };
        }
        await this.eventStore.append({
          ...input,
          schemaVersion: 1,
          recordedAt: this.now().toISOString(),
        } as AnalyticsEvent);
        return { recorded: true };
      } catch {
        return { recorded: false, reason: "storage_failure" };
      }
    });
  }

  list(): Promise<readonly AnalyticsEvent[]> {
    return this.exclusive(async () => {
      try {
        if ((await this.consentStore.read()) !== "granted") return [];
        return await this.eventStore.list();
      } catch {
        return [];
      }
    });
  }

  export(): Promise<AnalyticsExport> {
    return this.exclusive(async () => {
      let events: readonly AnalyticsEvent[] = [];
      try {
        if ((await this.consentStore.read()) === "granted") {
          events = await this.eventStore.list();
        }
      } catch {
        // A valid empty export is safer and more useful than throwing from UI.
      }
      return {
        schemaVersion: 1,
        generatedAt: this.now().toISOString(),
        dataBoundary: "local_user_initiated_export",
        events,
      };
    });
  }

  clear(): Promise<boolean> {
    return this.exclusive(async () => {
      try {
        await this.eventStore.clear();
        return true;
      } catch {
        return false;
      }
    });
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

export const bucketDuration = (milliseconds: number): DurationBucket => {
  if (milliseconds < 30_000) return "under_30_seconds";
  if (milliseconds < 60_000) return "30_to_59_seconds";
  if (milliseconds < 180_000) return "1_to_2_minutes";
  if (milliseconds < 360_000) return "3_to_5_minutes";
  return "over_5_minutes";
};

export const bucketTaps = (count: number): TapCountBucket => {
  if (count < 5) return "0_to_4";
  if (count < 10) return "5_to_9";
  if (count < 20) return "10_to_19";
  return "20_plus";
};

export const bucketRetries = (count: number): RetryCountBucket => {
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count === 2) return "2";
  return "3_plus";
};

export class LoggingFlowMeasurement {
  private taps = 0;
  private retries = 0;
  private finished = false;

  constructor(
    private readonly flow: LoggingFlow,
    private readonly analytics: Pick<LocalAnalyticsClient, "track">,
    private readonly startedAt = Date.now(),
    private readonly now: () => number = Date.now,
  ) {
    void analytics.track({
      name: "logging_flow_started",
      properties: { flow },
    });
  }

  tap(): void {
    this.taps += 1;
  }

  retry(): void {
    this.retries += 1;
  }

  complete(): void {
    if (this.finished) return;
    this.finished = true;
    void this.analytics.track({
      name: "logging_flow_completed",
      properties: {
        flow: this.flow,
        duration: bucketDuration(Math.max(0, this.now() - this.startedAt)),
        taps: bucketTaps(this.taps),
        retries: bucketRetries(this.retries),
      },
    });
    void this.analytics.track({
      name: "core_record_created",
      properties: { recordKind: this.flow },
    });
  }

  fail(stage: FailureStage, reason: FailureReason, retryable: boolean): void {
    void this.analytics.track({
      name: "logging_flow_failed",
      properties: {
        flow: this.flow,
        stage,
        reason,
        retryable,
        retries: bucketRetries(this.retries),
      },
    });
  }
}

/** Defensive parser for persisted local data. The closed writer remains the
 * primary safety control; invalid or future-version records are discarded. */
export const isAnalyticsEvent = (value: unknown): value is AnalyticsEvent => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "recordedAt", "name", "properties"])
  ) {
    return false;
  }
  if (
    value.schemaVersion !== 1 ||
    typeof value.recordedAt !== "string" ||
    Number.isNaN(Date.parse(value.recordedAt)) ||
    typeof value.name !== "string" ||
    !isRecord(value.properties)
  ) {
    return false;
  }
  const properties = value.properties;
  switch (value.name) {
    case "app_session_started":
      return (
        hasExactKeys(properties, ["entryPoint"]) &&
        isOneOf(properties.entryPoint, ["cold_start", "foreground"])
      );
    case "onboarding_completed":
      return (
        hasExactKeys(properties, ["duration", "taps"]) &&
        isDuration(properties.duration) &&
        isTapCount(properties.taps)
      );
    case "core_record_created":
      return (
        hasExactKeys(properties, ["recordKind"]) &&
        isLoggingFlow(properties.recordKind)
      );
    case "logging_flow_started":
      return (
        hasExactKeys(properties, ["flow"]) && isLoggingFlow(properties.flow)
      );
    case "logging_flow_completed":
      return (
        hasExactKeys(properties, ["flow", "duration", "taps", "retries"]) &&
        isLoggingFlow(properties.flow) &&
        isDuration(properties.duration) &&
        isTapCount(properties.taps) &&
        isRetryCount(properties.retries)
      );
    case "logging_flow_failed":
      return (
        hasExactKeys(properties, [
          "flow",
          "stage",
          "reason",
          "retryable",
          "retries",
        ]) &&
        isLoggingFlow(properties.flow) &&
        isOneOf(properties.stage, ["validation", "load", "submit", "upload"]) &&
        isOneOf(properties.reason, [
          "invalid_input",
          "network",
          "session",
          "server",
          "disabled",
          "unexpected",
        ]) &&
        typeof properties.retryable === "boolean" &&
        isRetryCount(properties.retries)
      );
    case "feature_viewed":
      return (
        hasExactKeys(properties, ["feature"]) &&
        isOneOf(properties.feature, [
          "dashboard",
          "nutrition_history",
          "body_history",
          "progress_photos",
          "settings",
        ])
      );
    default:
      return false;
  }
};

export const isAnalyticsExport = (value: unknown): value is AnalyticsExport =>
  isRecord(value) &&
  hasExactKeys(value, [
    "schemaVersion",
    "generatedAt",
    "dataBoundary",
    "events",
  ]) &&
  value.schemaVersion === 1 &&
  typeof value.generatedAt === "string" &&
  !Number.isNaN(Date.parse(value.generatedAt)) &&
  value.dataBoundary === "local_user_initiated_export" &&
  Array.isArray(value.events) &&
  value.events.every(isAnalyticsEvent);

export const summarizeAlphaAnalytics = (
  exports: readonly AnalyticsExport[],
): AlphaAnalyticsSummary => {
  const flows = Object.fromEntries(
    (["meal", "workout", "body_measurement"] as const).map((flow) => [
      flow,
      {
        started: 0,
        completed: 0,
        failed: 0,
        durationBuckets: zeroRecord(DURATION_BUCKETS),
        tapBuckets: zeroRecord(TAP_BUCKETS),
      },
    ]),
  ) as unknown as Record<
    LoggingFlow,
    {
      started: number;
      completed: number;
      failed: number;
      durationBuckets: Record<DurationBucket, number>;
      tapBuckets: Record<TapCountBucket, number>;
    }
  >;
  const featureViews = zeroRecord(FEATURES);
  const failureReasons = zeroRecord(FAILURE_REASONS);
  const returnDayCounts: Record<string, number> = {};
  let eventCount = 0;
  let onboardingCompletedExports = 0;
  let activatedExports = 0;

  for (const value of exports) {
    eventCount += value.events.length;
    const hasOnboarding = value.events.some(
      (event) => event.name === "onboarding_completed",
    );
    const hasCoreRecord = value.events.some(
      (event) => event.name === "core_record_created",
    );
    if (hasOnboarding) onboardingCompletedExports += 1;
    if (hasOnboarding && hasCoreRecord) activatedExports += 1;

    const returnDays = new Set(
      value.events
        .filter((event) => event.name === "app_session_started")
        .map((event) => event.recordedAt.slice(0, 10)),
    ).size;
    const dayBucket = returnDays >= 7 ? "7_plus" : String(returnDays);
    returnDayCounts[dayBucket] = (returnDayCounts[dayBucket] ?? 0) + 1;

    for (const event of value.events) {
      switch (event.name) {
        case "logging_flow_started":
          flows[event.properties.flow].started += 1;
          break;
        case "logging_flow_completed":
          flows[event.properties.flow].completed += 1;
          flows[event.properties.flow].durationBuckets[
            event.properties.duration
          ] += 1;
          flows[event.properties.flow].tapBuckets[event.properties.taps] += 1;
          break;
        case "logging_flow_failed":
          flows[event.properties.flow].failed += 1;
          failureReasons[event.properties.reason] += 1;
          break;
        case "feature_viewed":
          featureViews[event.properties.feature] += 1;
          break;
        default:
          break;
      }
    }
  }

  return {
    exportCount: exports.length,
    eventCount,
    onboardingCompletedExports,
    activatedExports,
    returnDayCounts,
    flows,
    featureViews,
    failureReasons,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean => {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
};

const isOneOf = <T extends string>(
  value: unknown,
  choices: readonly T[],
): value is T => typeof value === "string" && choices.includes(value as T);

const isLoggingFlow = (value: unknown): value is LoggingFlow =>
  isOneOf(value, ["meal", "workout", "body_measurement"]);

const isDuration = (value: unknown): value is DurationBucket =>
  isOneOf(value, [
    "under_30_seconds",
    "30_to_59_seconds",
    "1_to_2_minutes",
    "3_to_5_minutes",
    "over_5_minutes",
  ]);

const isTapCount = (value: unknown): value is TapCountBucket =>
  isOneOf(value, ["0_to_4", "5_to_9", "10_to_19", "20_plus"]);

const isRetryCount = (value: unknown): value is RetryCountBucket =>
  isOneOf(value, ["0", "1", "2", "3_plus"]);

const DURATION_BUCKETS: readonly DurationBucket[] = [
  "under_30_seconds",
  "30_to_59_seconds",
  "1_to_2_minutes",
  "3_to_5_minutes",
  "over_5_minutes",
];
const TAP_BUCKETS: readonly TapCountBucket[] = [
  "0_to_4",
  "5_to_9",
  "10_to_19",
  "20_plus",
];
const FEATURES: readonly FeatureName[] = [
  "dashboard",
  "nutrition_history",
  "workout_history",
  "body_history",
  "progress_photos",
  "settings",
];
const FAILURE_REASONS: readonly FailureReason[] = [
  "invalid_input",
  "network",
  "session",
  "server",
  "disabled",
  "unexpected",
];

const zeroRecord = <T extends string>(keys: readonly T[]): Record<T, number> =>
  Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
