import { describe, expect, it } from "vitest";

import { err, ok, type Result } from "@mizyun/core";
import type { ApiClient, ApiError } from "@mizyun/api-client";

import { submitOnboarding } from "./submit-onboarding";
import type { OnboardingForm } from "./onboarding-state";

const baseForm = (overrides: Partial<OnboardingForm> = {}): OnboardingForm => ({
  displayName: "Adam",
  unitSystem: "metric",
  baselineWeight: "72.5",
  goalKind: "cut",
  goalWeight: "68",
  goalStartDate: "2026-07-19",
  goalTargetDate: "2026-10-17",
  ...overrides,
});

const notFound = err({
  kind: "http_error",
  status: 404,
  code: "NOT_FOUND",
  message: "missing",
} as ApiError);

const stubClient = (
  queue: ReadonlyArray<Result<unknown, ApiError>>,
): ApiClient & {
  readonly calls: Array<{
    readonly method: string;
    readonly path: string;
    readonly body: unknown;
  }>;
} => {
  const calls: Array<{
    readonly method: string;
    readonly path: string;
    readonly body: unknown;
  }> = [];
  let cursor = 0;
  return {
    status: () => ({ configured: true, baseUrl: "http://test" }),
    request: async <T>(options: {
      readonly method: string;
      readonly path: string;
      readonly body?: unknown;
    }): Promise<Result<T, ApiError>> => {
      calls.push({
        method: options.method,
        path: options.path,
        body: options.body,
      });
      const next = queue[cursor++];
      if (!next) throw new Error(`unexpected API call ${cursor}`);
      return next as Result<T, ApiError>;
    },
    get calls() {
      return calls;
    },
  };
};

const createdGoal = ok({ goal: { id: "goal-1" } });
const createdMeasurement = ok({ bodyMeasurement: { id: "measure-1" } });
const savedProfile = ok({ profile: { userId: "user-1" } });

describe("submitOnboarding", () => {
  it("ensures goal and baseline before writing the completion marker", async () => {
    const client = stubClient([
      notFound,
      createdGoal,
      ok({ bodyMeasurements: [] }),
      createdMeasurement,
      savedProfile,
    ]);
    expect((await submitOnboarding(baseForm(), client)).ok).toBe(true);
    expect(client.calls.map(({ method, path }) => `${method} ${path}`)).toEqual(
      [
        "GET /v1/goals/active",
        "POST /v1/goals",
        "GET /v1/body-measurements?limit=200",
        "POST /v1/body-measurements",
        "PUT /v1/profile",
      ],
    );
    expect(client.calls[1]?.body).toMatchObject({
      target: { weightKg: 68 },
    });
    expect(client.calls[3]?.body).toMatchObject({
      weightKg: 72.5,
      measurements: { context: "onboarding_baseline" },
    });
    expect(client.calls[4]?.body).toEqual({
      displayName: "Adam",
      unitSystem: "metric",
    });
  });

  it("converts imperial display values to canonical kilograms", async () => {
    const client = stubClient([
      notFound,
      createdGoal,
      ok({ bodyMeasurements: [] }),
      createdMeasurement,
      savedProfile,
    ]);
    await submitOnboarding(
      baseForm({
        unitSystem: "imperial",
        baselineWeight: "160",
        goalWeight: "150",
      }),
      client,
    );
    expect(client.calls[1]?.body).toMatchObject({
      target: { weightKg: 68.039 },
    });
    expect(client.calls[3]?.body).toMatchObject({ weightKg: 72.575 });
  });

  it("skips duplicate creates when a retry finds existing authority", async () => {
    const client = stubClient([
      ok({ goal: { id: "existing" } }),
      ok({ bodyMeasurements: [{ weightKg: 72.5 }] }),
      savedProfile,
    ]);
    expect((await submitOnboarding(baseForm(), client)).ok).toBe(true);
    expect(client.calls.map(({ method, path }) => `${method} ${path}`)).toEqual(
      [
        "GET /v1/goals/active",
        "GET /v1/body-measurements?limit=200",
        "PUT /v1/profile",
      ],
    );
  });

  it("does not mark onboarding complete when baseline persistence fails", async () => {
    const client = stubClient([
      ok({ goal: { id: "existing" } }),
      ok({ bodyMeasurements: [] }),
      err({ kind: "network_error", cause: new Error("offline") }),
    ]);
    const result = await submitOnboarding(baseForm(), client);
    expect(result.ok).toBe(false);
    expect(client.calls.some((call) => call.path === "/v1/profile")).toBe(
      false,
    );
  });

  it("does not continue when checking existing authority fails", async () => {
    const client = stubClient([
      err({ kind: "network_error", cause: new Error("offline") }),
    ]);
    const result = await submitOnboarding(baseForm(), client);
    expect(result.ok).toBe(false);
    expect(client.calls).toHaveLength(1);
  });

  it("rejects malformed local values before making a request", async () => {
    const client = stubClient([]);
    const result = await submitOnboarding(
      baseForm({ baselineWeight: "nope" }),
      client,
    );
    expect(result.ok).toBe(false);
    expect(client.calls).toHaveLength(0);
  });
});
