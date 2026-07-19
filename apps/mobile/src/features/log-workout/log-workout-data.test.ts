import { describe, expect, it } from "vitest";

import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";
import type { Result } from "@mizyun/core";

import { submitLogWorkoutWith } from "./log-workout-data";

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

describe("submitLogWorkoutWith", () => {
  it("rejects an empty name without calling the API", async () => {
    const requests: RequestOptions[] = [];
    const result = await submitLogWorkoutWith(
      { name: "   ", notes: null, startedAt: NOW.toISOString() },
      fakeClient({ ok: true, value: {} }, requests),
    );
    expect(result.ok).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it("posts a completed workout and returns its id", async () => {
    const requests: RequestOptions[] = [];
    const result = await submitLogWorkoutWith(
      { name: " Legs ", notes: " Strong ", startedAt: NOW.toISOString() },
      fakeClient(
        {
          ok: true,
          value: {
            workout: {
              id: ID,
              userId: ID,
              name: "Legs",
              startedAt: NOW.toISOString(),
              completedAt: NOW.toISOString(),
              notes: "Strong",
              source: "manual",
              details: {},
              createdAt: NOW.toISOString(),
              updatedAt: NOW.toISOString(),
            },
          },
        },
        requests,
      ),
      () => NOW,
    );
    expect(result).toEqual({ ok: true, id: ID });
    expect(requests[0]).toMatchObject({
      method: "POST",
      path: "/v1/workouts",
      body: { name: "Legs", notes: "Strong", completedAt: NOW.toISOString() },
    });
  });
});
