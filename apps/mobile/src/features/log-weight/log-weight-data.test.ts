import { describe, expect, it } from "vitest";
import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";
import type { Result } from "@mizyun/core";
import {
  prepareWeightSubmission,
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
