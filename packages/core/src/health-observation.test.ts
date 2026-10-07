import { describe, expect, it } from "vitest";
import { healthPreviewRecordSchema } from "../../contracts/src/index";
import {
  getHealthPreviewAllowedUses,
  getHealthPreviewWindow,
  normalizeHealthPreviewRecords,
  type HealthPreviewRecord,
} from "./health-observation";

const weight: HealthPreviewRecord = {
  kind: "weight",
  provider: "apple_health",
  externalId: "synthetic-weight-1",
  sourceAppId: "org.example.synthetic",
  sourceAppName: null,
  sourceTimeZone: null,
  measuredAt: "2026-10-06T12:30:00.000Z",
  weightKg: 74.12567,
};
const workout: HealthPreviewRecord = {
  kind: "workout",
  provider: "health_connect",
  externalId: "synthetic-workout-1",
  sourceAppId: "org.example.synthetic",
  sourceAppName: "Synthetic fitness",
  sourceTimeZone: "Europe/Bratislava",
  startedAt: "2026-10-06T12:00:00.000Z",
  endedAt: "2026-10-06T12:30:00.000Z",
  activityType: "walking",
  durationSeconds: 1700.5,
};
const options = {
  kind: "weight" as const,
  provider: "apple_health" as const,
  from: "2026-09-06T13:00:00.000Z",
  to: "2026-10-06T13:00:00.000Z",
};

describe("device-only health preview rules", () => {
  it("uses exactly 30 rolling days across a DST transition", () => {
    const now = new Date("2026-11-01T12:30:00.123Z");
    const window = getHealthPreviewWindow(now);
    expect(window).toEqual({
      from: "2026-10-02T12:30:00.123Z",
      to: now.toISOString(),
    });
    expect(Date.parse(window.to) - Date.parse(window.from)).toBe(
      30 * 86_400_000,
    );
    expect(() => getHealthPreviewWindow(new Date(NaN))).toThrow(RangeError);
  });

  it("collapses exact replay while preserving equal values/times and different origins", () => {
    const differentId = { ...weight, externalId: "synthetic-weight-2" };
    const differentOrigin = { ...weight, sourceAppId: "org.example.other" };
    const result = normalizeHealthPreviewRecords({
      ...options,
      records: [weight, { ...weight }, differentId, differentOrigin],
    });
    expect(result.records).toHaveLength(3);
    expect(result.rejectedCount).toBe(0);
    expect(result.records).toContainEqual(differentId);
    expect(result.records).toContainEqual(differentOrigin);
  });

  it("sorts newest first with stable identity order independent of pages", () => {
    const newer = {
      ...weight,
      externalId: "newer",
      measuredAt: "2026-10-06T12:45:00Z",
    };
    const records = [weight, { ...weight, externalId: "other" }, newer];
    const forward = normalizeHealthPreviewRecords({ ...options, records });
    expect(forward).toEqual(
      normalizeHealthPreviewRecords({
        ...options,
        records: [...records].reverse(),
      }),
    );
    expect(forward.records[0]).toEqual(newer);
    expect(forward.records[0]).not.toBe(newer);
  });

  it("rejects own origins, provider/type mismatch, malformed input and out-of-window records", () => {
    const rejected = [
      null,
      { ...weight, provider: "health_connect" },
      workout,
      { ...weight, measuredAt: "2026-09-06T12:59:59Z" },
      { ...weight, measuredAt: "2026-10-06T13:00:01Z" },
      ...[
        "com.mizyun.app",
        "com.mizyun.dev",
        "com.mizyun.development",
        "com.mizyun.app.watchkitapp",
      ].map((sourceAppId) => ({ ...weight, sourceAppId })),
    ];
    expect(
      normalizeHealthPreviewRecords({
        ...options,
        records: [...rejected, weight],
      }),
    ).toEqual({
      records: [weight],
      rejectedCount: 3,
      truncated: false,
    });
  });

  it("includes exact window boundaries and only completed workouts within it", () => {
    const boundaryWeights = [options.from, options.to].map(
      (measuredAt, index) => ({
        ...weight,
        measuredAt,
        externalId: String(index),
      }),
    );
    expect(
      normalizeHealthPreviewRecords({ ...options, records: boundaryWeights })
        .records,
    ).toHaveLength(2);
    const result = normalizeHealthPreviewRecords({
      ...options,
      kind: "workout",
      provider: "health_connect",
      records: [
        workout,
        { ...workout, endedAt: "2026-10-06T13:00:01Z" },
        { ...workout, startedAt: "2026-09-06T12:59:59Z" },
      ],
    });
    expect(result).toEqual({
      records: [workout],
      rejectedCount: 0,
      truncated: false,
    });
  });

  it("fails closed on malformed or reversed query windows", () => {
    for (const from of [
      "bad",
      "2026-10-07T00:00:00Z",
      "2026-09-31T00:00:00Z",
    ]) {
      expect(
        normalizeHealthPreviewRecords({ ...options, from, records: [weight] }),
      ).toEqual({ records: [], rejectedCount: 1, truncated: false });
    }
  });

  it("caps only after normalization and reports truncation explicitly", () => {
    const records = Array.from({ length: 501 }, (_, index) => ({
      ...weight,
      externalId: `synthetic-${index}`,
    }));
    const result = normalizeHealthPreviewRecords({
      ...options,
      records: [...records, weight, weight],
    });
    expect(result.records).toHaveLength(500);
    expect(result.rejectedCount).toBe(0);
    expect(result.truncated).toBe(true);
  });

  it("ordinary filtering and many exact replays do not claim incomplete coverage", () => {
    const replays = Array.from({ length: 501 }, () => ({ ...weight }));
    const ownRecords = Array.from({ length: 501 }, (_, index) => ({
      ...weight,
      externalId: String(index),
      sourceAppId: "com.mizyun.app",
    }));
    const result = normalizeHealthPreviewRecords({
      ...options,
      records: [
        ...replays,
        ...ownRecords,
        { ...weight, measuredAt: "2026-09-01T12:00:00Z" },
      ],
    });
    expect(result).toEqual({
      records: [weight],
      rejectedCount: 0,
      truncated: false,
    });
  });

  it("resolves conflicting exact-id replay deterministically and preserves nearby app ids", () => {
    const conflict = {
      ...weight,
      weightKg: 75,
      sourceAppName: "Different source label",
    };
    const reversedKeys = Object.fromEntries(Object.entries(conflict).reverse());
    const first = normalizeHealthPreviewRecords({
      ...options,
      records: [weight, conflict],
    });
    expect(first).toEqual(
      normalizeHealthPreviewRecords({
        ...options,
        records: [reversedKeys, weight],
      }),
    );
    expect(first.records).toHaveLength(1);
    expect(
      normalizeHealthPreviewRecords({
        ...options,
        records: [{ ...weight, sourceAppId: "com.mizyun.app2" }],
      }).records,
    ).toHaveLength(1);
  });

  it("allows only local display and rejects spoofed rights/lineage", () => {
    expect(getHealthPreviewAllowedUses(weight)).toEqual(["local_display"]);
    expect(getHealthPreviewAllowedUses(workout)).toEqual(["local_display"]);
    for (const record of [
      null,
      { ...weight, allowedUses: ["coach"] },
      { ...weight, lineage: "manual" },
      { ...weight, sourceAppId: "com.mizyun.app" },
    ]) {
      expect(getHealthPreviewAllowedUses(record)).toEqual([]);
    }
  });

  it("matches the strict contract at malformed native boundaries", () => {
    const samples: unknown[] = [
      weight,
      workout,
      { ...workout, sourceAppName: null, sourceTimeZone: "+02:00" },
      { ...weight, sourceAppName: undefined },
      { ...weight, sourceTimeZone: "x".repeat(129) },
      { ...weight, externalId: "" },
      { ...weight, weightKg: NaN },
      { ...weight, weightKg: Infinity },
      { ...weight, weightKg: 250.1 },
      { ...weight, measuredAt: "2026-02-30T12:00:00Z" },
      { ...weight, measuredAt: "2026-10-06T12:30:00+00:00" },
      { ...weight, measuredAt: "2026-10-06T12:30Z" },
      { ...weight, userId: "spoof" },
      { ...weight, metadata: {} },
      { ...weight, provider: { toString: () => "apple_health" } },
      { ...workout, durationSeconds: -1 },
      { ...workout, durationSeconds: Infinity },
      { ...workout, durationSeconds: 1801 },
      { ...workout, endedAt: workout.startedAt },
      { ...workout, endedAt: "2026-10-06T11:30:00Z" },
    ];
    for (const sample of samples) {
      expect(getHealthPreviewAllowedUses(sample).length > 0).toBe(
        healthPreviewRecordSchema.safeParse(sample).success,
      );
    }
  });
});
