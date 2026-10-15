import { describe, expect, it } from "vitest";
import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";
import type { Result } from "@mizyun/core";
import {
  describeElapsedDays,
  isWeightLoggedToday,
  prepareWeightSubmission,
  presentLastBodyEntry,
  readLastBodyEntryWith,
  submitLogWeightWith,
  type WeightSubmission,
} from "./log-weight-data";

const NOW = "2026-07-19T10:15:00.000Z";
const ID = "00000000-0000-4000-8000-000000000001";
const form = {
  weight: "72",
  waist: "",
  chest: "",
  unitSystem: "metric" as const,
};
const fakeClient = (
  result: Result<unknown, ApiError>,
  requests: RequestOptions[] = [],
): ApiClient => ({
  request: <T>(options: RequestOptions): Promise<Result<T, ApiError>> => {
    requests.push(options);
    return Promise.resolve(result as Result<T, ApiError>);
  },
  status: () => ({
    configured: true,
    baseUrl: "https://example.test",
    provider: "supabase",
  }),
});

describe("measurement submission boundary", () => {
  it("rejects empty, nonpositive, or malformed optional measurements before preparing a command", () => {
    for (const invalid of [
      { ...form, weight: "" },
      { ...form, weight: "0" },
      { ...form, waist: "not a number" },
    ]) {
      expect(prepareWeightSubmission(invalid, ID, NOW).ok).toBe(false);
    }
  });
  it("converts pounds/inches once, with fixed identity and time, before posting", async () => {
    const prepared = prepareWeightSubmission(
      { ...form, weight: "160", waist: "32", unitSystem: "imperial" },
      ID,
      NOW,
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error("fixture invalid");
    const requests: RequestOptions[] = [];
    const result = await submitLogWeightWith(
      prepared.payload,
      fakeClient(
        { ok: true, value: { bodyMeasurement: { id: ID } } },
        requests,
      ),
    );
    expect(result).toEqual({ ok: true, id: ID });
    expect(requests[0]).toMatchObject({
      body: {
        clientOperationId: ID,
        measuredAt: NOW,
        weightKg: 72.575,
        measurements: { waist_cm: 81.28 },
      },
      headers: { "Idempotency-Key": ID },
    });
  });
  it("does not invent an identity or timestamp for a keyless restored command", async () => {
    const requests: RequestOptions[] = [];
    const client = fakeClient({ ok: true, value: {} }, requests);
    for (const payload of [
      { weightKg: 72 },
      { weightKg: 72, measuredAt: NOW },
      { weightKg: 72, measuredAt: NOW, clientOperationId: "bad" },
    ]) {
      expect(
        (await submitLogWeightWith(payload as WeightSubmission, client)).ok,
      ).toBe(false);
    }
    expect(requests).toHaveLength(0);
  });
  it("passes the owner/context guard to the API client without changing the immutable payload", async () => {
    const requests: RequestOptions[] = [];
    const isCurrent = () => true;
    const payload: WeightSubmission = {
      clientOperationId: ID,
      measuredAt: NOW,
      weightKg: 72,
    };
    await submitLogWeightWith(
      payload,
      fakeClient(
        { ok: true, value: { bodyMeasurement: { id: ID } } },
        requests,
      ),
      { expectedUserId: "owner-a", isCurrent },
    );
    expect(requests[0]?.body).toEqual(payload);
    expect(requests[0]?.expectedUserId).toBe("owner-a");
    expect(requests[0]?.isCurrent).toBe(isCurrent);
  });
});

describe("last body entry hint", () => {
  const now = new Date(2026, 9, 15, 12);
  const row = (days: number, over: Record<string, unknown> = {}) => ({
    id: ID,
    userId: ID,
    measuredAt: new Date(2026, 9, 15 - days, 8).toISOString(),
    weightKg: 82.4,
    measurements: {},
    source: "manual",
    createdAt: NOW,
    ...over,
  });
  it("describes elapsed local days", () => {
    const at = (days: number) =>
      describeElapsedDays(new Date(2026, 9, 15 - days, 23).toISOString(), now);
    expect([0, 1, 3, 13, 14, 30, 59, 60, 200].map(at)).toEqual([
      "today",
      "yesterday",
      "3 days ago",
      "13 days ago",
      "2 weeks ago",
      "4 weeks ago",
      "8 weeks ago",
      "2 months ago",
      "6 months ago",
    ]);
    expect(describeElapsedDays("not a date", now)).toBeNull();
  });
  it("formats the hint in the user's unit", () => {
    const entry = {
      measuredAt: row(3).measuredAt,
      weightKg: 82.4,
      waistCm: 90,
      chestCm: null,
    };
    expect(presentLastBodyEntry(entry, "metric", now)).toEqual({
      weight: "82.4",
      waist: "90",
      chest: null,
      weightHint: "Last: 82.4 kg · 3 days ago",
    });
    expect(presentLastBodyEntry(entry, "imperial", now)).toMatchObject({
      weight: "181.7",
      waist: "35.43",
      weightHint: "Last: 181.7 lb · 3 days ago",
    });
    expect(
      presentLastBodyEntry({ ...entry, weightKg: null }, "metric", now)
        .weightHint,
    ).toBeNull();
  });
  it("reads the latest weight even when a newer entry has only a waist", async () => {
    const requests: RequestOptions[] = [];
    const client = fakeClient(
      {
        ok: true,
        value: {
          bodyMeasurements: [
            row(0, { weightKg: null, measurements: { waist_cm: 88 } }),
            row(2, { weightKg: 81 }),
            row(9, { weightKg: 83 }),
          ],
        },
      },
      requests,
    );
    const read = await readLastBodyEntryWith(client, { expectedUserId: "u" });
    expect(requests[0]).toMatchObject({
      method: "GET",
      path: "/v1/body-measurements?limit=20",
      expectedUserId: "u",
    });
    expect(read).toEqual({
      ok: true,
      entry: {
        measuredAt: row(2).measuredAt,
        weightKg: 81,
        waistCm: 88,
        chestCm: null,
      },
    });
  });
  it("distinguishes no entries from a failed read", async () => {
    expect(
      await readLastBodyEntryWith(
        fakeClient({ ok: true, value: { bodyMeasurements: [] } }),
      ),
    ).toEqual({ ok: true, entry: null });
    expect(
      await readLastBodyEntryWith(
        fakeClient({
          ok: false,
          error: { kind: "network_error", cause: null },
        }),
      ),
    ).toEqual({ ok: false });
  });
  it("detects a weight logged today only", () => {
    const entry = (days: number, weightKg: number | null) => ({
      measuredAt: row(days).measuredAt,
      weightKg,
      waistCm: null,
      chestCm: null,
    });
    expect(isWeightLoggedToday(entry(0, 80), now)).toBe(true);
    expect(isWeightLoggedToday(entry(1, 80), now)).toBe(false);
    expect(isWeightLoggedToday(entry(0, null), now)).toBe(false);
    expect(isWeightLoggedToday(null, now)).toBe(false);
  });
});
