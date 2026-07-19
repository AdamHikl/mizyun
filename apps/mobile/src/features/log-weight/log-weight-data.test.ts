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
      submitLogWeightWith({ weight: null, unitSystem: "metric" }, client),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      submitLogWeightWith({ weight: 0, unitSystem: "metric" }, client),
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
      { weight: 160, unitSystem: "imperial" },
      fakeClient({ ok: true, value: response }, requests),
      () => NOW,
    );
    expect(result).toEqual({ ok: true, id: ID });
    const body = requests[0]?.body as { weightKg?: number };
    expect(body.weightKg).toBe(72.575);
  });
});
