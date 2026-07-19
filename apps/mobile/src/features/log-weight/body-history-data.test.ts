import { describe, expect, it } from "vitest";

import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";
import type { Result } from "@mizyun/core";

import {
  deleteBodyMeasurementWith,
  fetchBodyHistoryWith,
} from "./body-history-data";

const queuedClient = (
  results: Array<Result<unknown, ApiError>>,
  requests: RequestOptions[] = [],
): ApiClient => ({
  request: <T>(options: RequestOptions): Promise<Result<T, ApiError>> => {
    requests.push(options);
    const result = results.shift();
    if (result === undefined) throw new Error("missing result");
    return Promise.resolve(result as Result<T, ApiError>);
  },
  status: () => ({ configured: true, baseUrl: "https://example.test" }),
});

const measurement = (day: number, weightKg: number) => ({
  id: `00000000-0000-4000-8000-${day.toString().padStart(12, "0")}`,
  userId: "00000000-0000-4000-8000-000000000001",
  measuredAt: `2026-07-${day.toString().padStart(2, "0")}T08:00:00.000Z`,
  weightKg,
  measurements: {},
  source: "manual",
  createdAt: `2026-07-${day.toString().padStart(2, "0")}T08:00:00.000Z`,
});

describe("body history", () => {
  it("returns raw readings and the deterministic labeled trend", async () => {
    const result = await fetchBodyHistoryWith(
      queuedClient([
        {
          ok: true,
          value: {
            bodyMeasurements: [
              measurement(15, 79),
              measurement(8, 79.5),
              measurement(1, 80),
            ],
          },
        },
      ]),
    );
    expect(result.measurements).toHaveLength(3);
    expect(result.trend.status).toBe("ready");
    expect(result.trend.weeklyChangeKg).toBe(-0.5);
  });

  it("deletes a correction through the empty-success path", async () => {
    const requests: RequestOptions[] = [];
    const result = await deleteBodyMeasurementWith(
      queuedClient([{ ok: true, value: undefined }], requests),
      "00000000-0000-4000-8000-000000000001",
    );
    expect(result.ok).toBe(true);
    expect(requests[0]?.method).toBe("DELETE");
  });
});
