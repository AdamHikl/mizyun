import { describe, expect, it } from "vitest";

import {
  ExpoAnalyticsConsentStore,
  ExpoAnalyticsEventStore,
  analyticsStoragePolicy,
} from "./local-analytics-storage";
import type { AnalyticsEvent } from "@mizyun/observability";

const memoryFile = () => {
  let value: string | null = null;
  return {
    get exists() {
      return value !== null;
    },
    text: async () => value ?? "",
    write: (next: string) => {
      value = next;
    },
    delete: () => {
      value = null;
    },
    corrupt: (next: string) => {
      value = next;
    },
  };
};

const event = (recordedAt: string): AnalyticsEvent => ({
  schemaVersion: 1,
  recordedAt,
  name: "feature_viewed",
  properties: { feature: "dashboard" },
});

describe("Expo analytics storage adapters", () => {
  it("keeps consent unknown until the user makes an explicit choice", async () => {
    const store = new ExpoAnalyticsConsentStore(memoryFile());
    expect(await store.read()).toBe("unknown");
    await store.write("granted");
    expect(await store.read()).toBe("granted");
  });

  it("drops malformed records and events older than the retention window", async () => {
    const file = memoryFile();
    const now = Date.parse("2026-07-22T12:00:00.000Z");
    const store = new ExpoAnalyticsEventStore(file, () => now);
    file.corrupt(JSON.stringify([event("2026-05-01T00:00:00.000Z"), null]));
    await store.append(event("2026-07-22T12:00:00.000Z"));
    expect(await store.list()).toEqual([event("2026-07-22T12:00:00.000Z")]);
  });

  it("bounds the log and supports permanent local clearing", async () => {
    const file = memoryFile();
    const store = new ExpoAnalyticsEventStore(file, () =>
      Date.parse("2026-07-22T12:00:00.000Z"),
    );
    for (
      let index = 0;
      index < analyticsStoragePolicy.maximumEvents + 5;
      index++
    ) {
      await store.append(event("2026-07-22T12:00:00.000Z"));
    }
    expect(await store.list()).toHaveLength(
      analyticsStoragePolicy.maximumEvents,
    );
    await store.clear();
    expect(await store.list()).toEqual([]);
  });

  it("recovers from a corrupt local file without blocking callers", async () => {
    const file = memoryFile();
    file.corrupt("not-json");
    const now = Date.parse("2026-07-22T12:00:00.000Z");
    const store = new ExpoAnalyticsEventStore(file, () => now);
    expect(await store.list()).toEqual([]);
    await store.append(event("2026-07-22T12:00:00.000Z"));
    expect(await store.list()).toHaveLength(1);
  });
});
