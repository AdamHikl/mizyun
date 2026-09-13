import { describe, expect, it } from "vitest";

import {
  LocalAnalyticsClient,
  LoggingFlowMeasurement,
  bucketDuration,
  bucketRetries,
  bucketTaps,
  isAnalyticsEvent,
  isAnalyticsExport,
  summarizeAlphaAnalytics,
  type AnalyticsConsent,
  type AnalyticsEvent,
} from "./index";

const stores = (initialConsent: AnalyticsConsent = "unknown") => {
  let consent = initialConsent;
  const events: AnalyticsEvent[] = [];
  return {
    events,
    consentStore: {
      read: async () => consent,
      write: async (next: "granted" | "denied") => {
        consent = next;
      },
    },
    eventStore: {
      append: async (event: AnalyticsEvent) => {
        events.push(event);
      },
      list: async () => events,
      clear: async () => {
        events.splice(0);
      },
    },
  };
};

describe("LocalAnalyticsClient", () => {
  it("records nothing until explicit consent is granted", async () => {
    const store = stores();
    const client = new LocalAnalyticsClient(
      store.consentStore,
      store.eventStore,
    );

    expect(
      await client.track({
        name: "feature_viewed",
        properties: { feature: "dashboard" },
      }),
    ).toEqual({ recorded: false, reason: "consent_not_granted" });
    expect(store.events).toEqual([]);
  });

  it("records only the closed event shape and exports without an identifier", async () => {
    const store = stores("granted");
    const client = new LocalAnalyticsClient(
      store.consentStore,
      store.eventStore,
      () => new Date("2026-07-22T12:00:00.000Z"),
    );
    await client.track({
      name: "core_record_created",
      properties: { recordKind: "meal" },
    });

    expect(await client.export()).toEqual({
      schemaVersion: 1,
      generatedAt: "2026-07-22T12:00:00.000Z",
      dataBoundary: "local_user_initiated_export",
      events: [
        {
          schemaVersion: 1,
          recordedAt: "2026-07-22T12:00:00.000Z",
          name: "core_record_created",
          properties: { recordKind: "meal" },
        },
      ],
    });
    expect(JSON.stringify(await client.export())).not.toMatch(
      /userId|deviceId|email|token|food|weight|photo|path/i,
    );
  });

  it("clears prior events when consent is denied", async () => {
    const store = stores("granted");
    const client = new LocalAnalyticsClient(
      store.consentStore,
      store.eventStore,
    );
    await client.track({
      name: "feature_viewed",
      properties: { feature: "settings" },
    });
    expect(await client.setConsent("denied")).toBe(true);
    expect(store.events).toEqual([]);
  });

  it("fails open when consent or event storage fails", async () => {
    const failure = async (): Promise<never> => {
      throw new Error("unavailable");
    };
    const client = new LocalAnalyticsClient(
      { read: failure, write: failure },
      { append: failure, list: failure, clear: failure },
    );
    expect(await client.getConsent()).toBe("unknown");
    expect(
      await client.track({
        name: "feature_viewed",
        properties: { feature: "dashboard" },
      }),
    ).toEqual({ recorded: false, reason: "storage_failure" });
    expect(await client.list()).toEqual([]);
  });
});

describe("privacy-reducing measurement buckets", () => {
  it("buckets duration, taps, and retries at documented boundaries", () => {
    expect(bucketDuration(29_999)).toBe("under_30_seconds");
    expect(bucketDuration(30_000)).toBe("30_to_59_seconds");
    expect(bucketDuration(60_000)).toBe("1_to_2_minutes");
    expect(bucketDuration(180_000)).toBe("3_to_5_minutes");
    expect(bucketDuration(360_000)).toBe("over_5_minutes");
    expect(bucketTaps(4)).toBe("0_to_4");
    expect(bucketTaps(5)).toBe("5_to_9");
    expect(bucketTaps(10)).toBe("10_to_19");
    expect(bucketTaps(20)).toBe("20_plus");
    expect([0, 1, 2, 3].map(bucketRetries)).toEqual(["0", "1", "2", "3_plus"]);
  });

  it("emits one completion plus one coarse record event", async () => {
    const store = stores("granted");
    const client = new LocalAnalyticsClient(
      store.consentStore,
      store.eventStore,
    );
    const flow = new LoggingFlowMeasurement("meal", client, 0, () => 45_000);
    flow.tap();
    flow.retry();
    flow.complete();
    flow.complete();
    await client.list();

    expect(store.events.map((event) => event.name)).toEqual([
      "logging_flow_started",
      "logging_flow_completed",
      "core_record_created",
    ]);
    expect(store.events[1]?.properties).toEqual({
      flow: "meal",
      duration: "30_to_59_seconds",
      taps: "0_to_4",
      retries: "1",
    });
  });
});

describe("persisted event validation", () => {
  it("accepts every declared feature name including workout_history", () => {
    const features = [
      "dashboard",
      "nutrition_history",
      "workout_history",
      "body_history",
      "progress_photos",
      "settings",
    ] as const;
    for (const feature of features) {
      expect(
        isAnalyticsEvent({
          schemaVersion: 1,
          recordedAt: "2026-07-22T12:00:00.000Z",
          name: "feature_viewed",
          properties: { feature },
        }),
      ).toBe(true);
    }
  });

  it("rejects unknown and extra properties at the export boundary", () => {
    expect(
      isAnalyticsEvent({
        schemaVersion: 1,
        recordedAt: "2026-07-22T12:00:00.000Z",
        name: "feature_viewed",
        properties: { feature: "dashboard", token: "must-not-export" },
      }),
    ).toBe(false);
    expect(
      isAnalyticsEvent({
        schemaVersion: 1,
        recordedAt: "2026-07-22T12:00:00.000Z",
        name: "feature_viewed",
        properties: { feature: "unknown" },
      }),
    ).toBe(false);
  });

  it("requires the exact user-initiated export envelope", () => {
    expect(
      isAnalyticsExport({
        schemaVersion: 1,
        generatedAt: "2026-07-22T12:00:00.000Z",
        dataBoundary: "local_user_initiated_export",
        events: [],
      }),
    ).toBe(true);
    expect(
      isAnalyticsExport({
        schemaVersion: 1,
        generatedAt: "2026-07-22T12:00:00.000Z",
        dataBoundary: "local_user_initiated_export",
        events: [],
        participantEmail: "must-not-accept@example.test",
      }),
    ).toBe(false);
  });
});

describe("alpha analytics summary", () => {
  it("aggregates unlinked exports without emitting participant rows", () => {
    const recordedAt = "2026-07-22T12:00:00.000Z";
    const value = {
      schemaVersion: 1 as const,
      generatedAt: recordedAt,
      dataBoundary: "local_user_initiated_export" as const,
      events: [
        {
          schemaVersion: 1 as const,
          recordedAt,
          name: "onboarding_completed" as const,
          properties: {
            duration: "1_to_2_minutes" as const,
            taps: "5_to_9" as const,
          },
        },
        {
          schemaVersion: 1 as const,
          recordedAt,
          name: "core_record_created" as const,
          properties: { recordKind: "meal" as const },
        },
        {
          schemaVersion: 1 as const,
          recordedAt,
          name: "logging_flow_started" as const,
          properties: { flow: "meal" as const },
        },
        {
          schemaVersion: 1 as const,
          recordedAt,
          name: "logging_flow_completed" as const,
          properties: {
            flow: "meal" as const,
            duration: "under_30_seconds" as const,
            taps: "0_to_4" as const,
            retries: "0" as const,
          },
        },
        {
          schemaVersion: 1 as const,
          recordedAt,
          name: "feature_viewed" as const,
          properties: { feature: "dashboard" as const },
        },
      ],
    };
    const summary = summarizeAlphaAnalytics([value]);
    expect(summary.exportCount).toBe(1);
    expect(summary.eventCount).toBe(5);
    expect(summary.onboardingCompletedExports).toBe(1);
    expect(summary.activatedExports).toBe(1);
    expect(summary.flows.meal).toMatchObject({
      started: 1,
      completed: 1,
      failed: 0,
      durationBuckets: { under_30_seconds: 1 },
      tapBuckets: { "0_to_4": 1 },
    });
    expect(summary.featureViews.dashboard).toBe(1);
    expect(JSON.stringify(summary)).not.toMatch(/email|userId|deviceId/i);
  });
});
