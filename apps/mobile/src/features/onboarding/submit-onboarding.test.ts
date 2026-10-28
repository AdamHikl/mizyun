import { describe, expect, it } from "vitest";

import { err, ok, type Result } from "@mizyun/core";
import type { ApiClient, ApiError } from "@mizyun/api-client";

import { submitOnboarding } from "./submit-onboarding";
import type { OnboardingForm } from "./onboarding-state";

const baseForm = (overrides: Partial<OnboardingForm> = {}): OnboardingForm => ({
  displayName: "Adam",
  unitSystem: "metric",
  baselineWeight: "72.5",
  height: "178",
  birthYear: "1995",
  turned18: null,
  activityLevel: "moderately_active",
  sexAtBirth: "female",
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
} as unknown as ApiError);

const httpError = (
  status: number,
  code: string,
  message: string,
): Result<unknown, ApiError> =>
  err({ kind: "http_error", status, code, message } as unknown as ApiError);

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
      savedProfile,
      notFound,
      createdGoal,
      ok({ bodyMeasurements: [] }),
      createdMeasurement,
      savedProfile,
    ]);
    expect((await submitOnboarding(baseForm(), client)).ok).toBe(true);
    expect(client.calls.map(({ method, path }) => `${method} ${path}`)).toEqual(
      [
        "PUT /v1/profile",
        "GET /v1/goals/active",
        "POST /v1/goals",
        "GET /v1/body-measurements?limit=200",
        "POST /v1/body-measurements",
        "PUT /v1/profile",
      ],
    );
    expect(client.calls[2]?.body).toMatchObject({
      target: { weightKg: 68 },
    });
    expect(client.calls[4]?.body).toMatchObject({
      weightKg: 72.5,
      measurements: { context: "onboarding_baseline" },
    });
    expect(client.calls[0]?.body).toEqual({
      unitSystem: "metric",
      heightCm: 178,
      birthYear: 1995,
      activityLevel: "moderately_active",
      sexAtBirth: "female",
    });
    expect(client.calls[5]?.body).toEqual({ displayName: "Adam" });
  });

  it("creates the goal without a target date unless one was chosen", async () => {
    const noDate = stubClient([
      savedProfile,
      notFound,
      createdGoal,
      ok({ bodyMeasurements: [] }),
      createdMeasurement,
      savedProfile,
    ]);
    await submitOnboarding(baseForm({ goalTargetDate: null }), noDate);
    expect(noDate.calls[2]?.body).not.toHaveProperty("targetDate");

    const withDate = stubClient([
      savedProfile,
      notFound,
      createdGoal,
      ok({ bodyMeasurements: [] }),
      createdMeasurement,
      savedProfile,
    ]);
    await submitOnboarding(baseForm(), withDate);
    expect(withDate.calls[2]?.body).toMatchObject({ targetDate: "2026-10-17" });
  });

  it("converts imperial display values to canonical kilograms", async () => {
    const client = stubClient([
      savedProfile,
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
        height: "70",
        goalWeight: "150",
      }),
      client,
    );
    expect(client.calls[2]?.body).toMatchObject({
      target: { weightKg: 68.039 },
    });
    expect(client.calls[4]?.body).toMatchObject({ weightKg: 72.575 });
    expect(client.calls[0]?.body).toMatchObject({ heightCm: 177.8 });
  });

  it("skips duplicate creates when a retry finds existing authority", async () => {
    const client = stubClient([
      savedProfile,
      ok({ goal: { id: "existing" } }),
      ok({ bodyMeasurements: [{ weightKg: 72.5 }] }),
      savedProfile,
    ]);
    expect((await submitOnboarding(baseForm(), client)).ok).toBe(true);
    expect(client.calls.map(({ method, path }) => `${method} ${path}`)).toEqual(
      [
        "PUT /v1/profile",
        "GET /v1/goals/active",
        "GET /v1/body-measurements?limit=200",
        "PUT /v1/profile",
      ],
    );
  });

  it("does not mark onboarding complete when baseline persistence fails", async () => {
    const client = stubClient([
      savedProfile,
      ok({ goal: { id: "existing" } }),
      ok({ bodyMeasurements: [] }),
      err({ kind: "network_error", cause: new Error("offline") }),
    ]);
    const result = await submitOnboarding(baseForm(), client);
    expect(result.ok).toBe(false);
    expect(
      client.calls.some(
        (call) =>
          call.path === "/v1/profile" &&
          (call.body as { displayName?: string }).displayName !== undefined,
      ),
    ).toBe(false);
  });

  it("does not continue when checking existing authority fails", async () => {
    const client = stubClient([
      savedProfile,
      err({ kind: "network_error", cause: new Error("offline") }),
    ]);
    const result = await submitOnboarding(baseForm(), client);
    expect(result.ok).toBe(false);
    expect(client.calls).toHaveLength(2);
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

  it("treats an active-goal 409 conflict as a no-op so onboarding can complete", async () => {
    const client = stubClient([
      savedProfile,
      httpError(404, "NOT_FOUND", "missing"),
      httpError(409, "VALIDATION_ERROR", "user already has an active goal"),
      ok({ bodyMeasurements: [] }),
      createdMeasurement,
      savedProfile,
    ]);
    const result = await submitOnboarding(baseForm(), client);
    expect(result.ok).toBe(true);
    expect(client.calls.map(({ method, path }) => `${method} ${path}`)).toEqual(
      [
        "PUT /v1/profile",
        "GET /v1/goals/active",
        "POST /v1/goals",
        "GET /v1/body-measurements?limit=200",
        "POST /v1/body-measurements",
        "PUT /v1/profile",
      ],
    );
  });

  it("saves nothing else when the server refuses the health details", async () => {
    for (const [refusal, message] of [
      [
        httpError(
          403,
          "HEALTH_DATA_CONSENT_REQUIRED",
          "Agree to Mizyun storing your health data before adding it.",
        ),
        /Agree to Mizyun storing your health data/,
      ],
      [
        httpError(
          422,
          "VALIDATION_ERROR",
          "Invalid profile patch: birthYear: Mizyun is for adults (18+).",
        ),
        /adults 18 and over/,
      ],
    ] as const) {
      const client = stubClient([refusal]);
      const result = await submitOnboarding(baseForm(), client);
      expect(result).toEqual({
        ok: false,
        message: expect.stringMatching(message),
      });
      expect(client.calls).toHaveLength(1);
    }
  });

  it("does not silently swallow a different 409 conflict", async () => {
    const client = stubClient([
      savedProfile,
      httpError(404, "NOT_FOUND", "missing"),
      httpError(409, "VALIDATION_ERROR", "invalid_status_transition"),
    ]);
    const result = await submitOnboarding(baseForm(), client);
    expect(result.ok).toBe(false);
    expect(client.calls.map(({ method, path }) => `${method} ${path}`)).toEqual(
      ["PUT /v1/profile", "GET /v1/goals/active", "POST /v1/goals"],
    );
  });
});
