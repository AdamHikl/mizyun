import { describe, expect, it } from "vitest";

import { err, ok, type Result } from "@mizyun/core";
import type { ApiClient, ApiError } from "@mizyun/api-client";

import { submitOnboarding } from "./submit-onboarding";
import type { OnboardingForm } from "./onboarding-state";

const NOW = new Date("2026-07-17T00:00:00Z");
const baseForm = (overrides: Partial<OnboardingForm> = {}): OnboardingForm => ({
  displayName: "Adam",
  unitSystem: "metric",
  goalKind: "cut",
  goalWeightKg: 78,
  goalStartDate: "2026-07-17",
  goalTargetDate: "2026-10-15",
  ...overrides,
});

/**
 * Build a stub `ApiClient` whose `request()` returns the supplied
 * ordered list of results. Each call shifts one off the front so the
 * test can drive the `PUT /v1/profile` → `POST /v1/goals` sequence.
 */
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
      if (!next)
        throw new Error(`stubClient received unexpected call ${cursor}`);
      return next as Result<T, ApiError>;
    },
    get calls() {
      return calls;
    },
  };
};

describe("submitOnboarding — happy path", () => {
  it("writes profile then goal and returns ok", async () => {
    const client = stubClient([
      ok({ profile: { userId: "u-1" } }),
      ok({ goal: { id: "g-1" } }),
    ]);
    const result = await submitOnboarding(baseForm(), client);
    expect(result.ok).toBe(true);
    expect(client.calls).toEqual([
      {
        method: "PUT",
        path: "/v1/profile",
        body: { displayName: "Adam", unitSystem: "metric" },
      },
      {
        method: "POST",
        path: "/v1/goals",
        body: {
          kind: "cut",
          pace: "steady",
          target: { weightKg: 78 },
          startsOn: "2026-07-17",
          targetDate: "2026-10-15",
        },
      },
    ]);
  });

  it("treats a missing goal kind/weight as a profile-only success", async () => {
    const client = stubClient([ok({ profile: { userId: "u-1" } })]);
    const result = await submitOnboarding(
      baseForm({ goalKind: null, goalWeightKg: null }),
      client,
    );
    expect(result.ok).toBe(true);
    expect(client.calls).toHaveLength(1);
  });

  it("trims the display name before sending", async () => {
    const client = stubClient([
      ok({ profile: { userId: "u-1" } }),
      ok({ goal: { id: "g-1" } }),
    ]);
    await submitOnboarding(baseForm({ displayName: "  Adam  " }), client);
    expect(client.calls[0].body).toMatchObject({ displayName: "Adam" });
  });
});

describe("submitOnboarding — error mapping", () => {
  it("surfaces a session_expired from the profile write as a friendly message", async () => {
    const client = stubClient([err({ kind: "session_expired" } as ApiError)]);
    const result = await submitOnboarding(baseForm(), client);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/session expired/i);
  });

  it("surfaces a network_error from the profile write", async () => {
    const client = stubClient([
      err({ kind: "network_error", cause: new Error("offline") } as ApiError),
    ]);
    const result = await submitOnboarding(baseForm(), client);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/network/i);
  });

  it("does not call the goals endpoint when the profile write fails", async () => {
    const client = stubClient([
      err({ kind: "http_error", status: 500 } as ApiError),
    ]);
    await submitOnboarding(baseForm(), client);
    expect(client.calls).toHaveLength(1);
  });

  it("surfaces a goal-side validation_error and uses the goal fallback message", async () => {
    const client = stubClient([
      ok({ profile: { userId: "u-1" } }),
      err({ kind: "validation_error", issues: [] } as ApiError),
    ]);
    const result = await submitOnboarding(baseForm(), client);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/server rejected/i);
  });

  it("uses the profile fallback when the profile error kind is unknown", async () => {
    const client = stubClient([
      err({ kind: "weird_unknown_kind" } as never as ApiError),
    ]);
    const result = await submitOnboarding(baseForm(), client);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/profile/i);
  });
});
