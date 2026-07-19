import { describe, expect, it } from "vitest";

import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";
import type { Result } from "@mizyun/core";

import { submitLogWeightWith } from "./log-weight-data";

const NOW = new Date("2026-07-19T10:15:00.000Z");
const ID = "00000000-0000-4000-8000-000000000001";

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

describe("submitLogWeightWith", () => {
  it("rejects a missing or non-positive weight", async () => {
    const client = fakeClient({ ok: true, value: {} });
    await expect(
      submitLogWeightWith(
        { weight: "", waist: "", chest: "", unitSystem: "metric" },
        client,
      ),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      submitLogWeightWith(
        { weight: "0", waist: "", chest: "", unitSystem: "metric" },
        client,
      ),
    ).resolves.toMatchObject({ ok: false });
  });

  it("converts pounds to canonical kilograms before posting", async () => {
    const requests: RequestOptions[] = [];
    const response = {
      bodyMeasurement: {
        id: ID,
        userId: ID,
        measuredAt: NOW.toISOString(),
        weightKg: 72.574_779,
        measurements: {},
        source: "manual",
        createdAt: NOW.toISOString(),
      },
    };
    const result = await submitLogWeightWith(
      {
        weight: "160",
        waist: "32",
        chest: "",
        unitSystem: "imperial",
      },
      fakeClient({ ok: true, value: response }, requests),
      () => NOW,
    );
    expect(result).toEqual({ ok: true, id: ID });
    const body = requests[0]?.body as { weightKg?: number };
    expect(body.weightKg).toBe(72.575);
    expect(body).toMatchObject({ measurements: { waist_cm: 81.28 } });
  });

  it("does not silently omit an invalid optional field", async () => {
    const requests: RequestOptions[] = [];
    const result = await submitLogWeightWith(
      {
        weight: "72",
        waist: "not a number",
        chest: "",
        unitSystem: "metric",
      },
      fakeClient({ ok: true, value: {} }, requests),
    );
    expect(result.ok).toBe(false);
    expect(requests).toHaveLength(0);
  });
});
