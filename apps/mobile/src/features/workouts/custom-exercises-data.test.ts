import { describe, expect, it, vi } from "vitest";

import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";
import type { Result } from "@mizyun/core";
import type { Exercise } from "@mizyun/contracts";

vi.mock("@/composition/api-client", () => ({ apiClient: {} }));

import {
  SAVED_EXERCISE_LIMIT,
  createCustomExercise,
  deleteCustomExercise,
  loadExerciseUsage,
  loadSavedExercises,
  updateCustomExercise,
} from "./custom-exercises-data";

const exercise = (overrides: Partial<Exercise> = {}): Exercise => ({
  id: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  name: "Sled push",
  instructions: null,
  metadata: { custom: true, trackingMode: "load_reps" },
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

const queuedClient = (
  results: Array<Result<unknown, ApiError>>,
  requests: RequestOptions[] = [],
): ApiClient => ({
  request: <T>(options: RequestOptions): Promise<Result<T, ApiError>> => {
    requests.push(options);
    const result = results.shift();
    if (result === undefined) throw new Error("missing queued result");
    return Promise.resolve(result as Result<T, ApiError>);
  },
  status: () => ({ configured: true, baseUrl: "https://example.test" }),
});

const httpError = (status: number): Result<never, ApiError> => ({
  ok: false,
  error: { kind: "http_error", status, code: "x", message: "x" },
});

describe("loadSavedExercises", () => {
  it("requests the capped list and is not truncated below the cap", async () => {
    const requests: RequestOptions[] = [];
    const rows = Array.from({ length: SAVED_EXERCISE_LIMIT - 1 }, (_, i) =>
      exercise({ name: `Row ${i}` }),
    );
    const result = await loadSavedExercises(
      queuedClient([{ ok: true, value: { exercises: rows } }], requests),
    );
    expect(requests[0]).toMatchObject({
      method: "GET",
      path: "/v1/exercises?limit=200",
    });
    expect(result).toEqual({ ok: true, exercises: rows, truncated: false });
  });

  it("flags truncation at exactly 200 rows", async () => {
    const rows = Array.from({ length: 200 }, (_, i) =>
      exercise({ name: `Row ${i}` }),
    );
    const result = await loadSavedExercises(
      queuedClient([{ ok: true, value: { exercises: rows } }]),
    );
    expect(result).toMatchObject({ ok: true, truncated: true });
  });

  it("returns a message when the load fails", async () => {
    const result = await loadSavedExercises(
      queuedClient([{ ok: false, error: { kind: "network_error", cause: 1 } }]),
    );
    expect(result).toEqual({
      ok: false,
      message: "Network unavailable. Load your exercises when you're online.",
    });
  });
});

describe("createCustomExercise", () => {
  it("posts custom metadata and the tracking mode with notes", async () => {
    const requests: RequestOptions[] = [];
    const created = exercise();
    const result = await createCustomExercise(
      { name: "Sled push", instructions: "Low hips", trackingMode: "duration" },
      queuedClient([{ ok: true, value: { exercise: created } }], requests),
    );
    expect(requests[0]).toMatchObject({
      method: "POST",
      path: "/v1/exercises",
      body: {
        name: "Sled push",
        instructions: "Low hips",
        metadata: { custom: true, trackingMode: "duration" },
      },
    });
    expect(result).toEqual({ ok: true, exercise: created });
  });

  it("omits instructions when there are no notes", async () => {
    const requests: RequestOptions[] = [];
    await createCustomExercise(
      { name: "Sled push", instructions: null, trackingMode: "load_reps" },
      queuedClient([{ ok: true, value: { exercise: exercise() } }], requests),
    );
    const body = requests[0]?.body as Record<string, unknown>;
    expect("instructions" in body).toBe(false);
    expect(body.metadata).toEqual({ custom: true, trackingMode: "load_reps" });
  });

  it("maps a failure to a message", async () => {
    const result = await createCustomExercise(
      { name: "Sled push", instructions: null, trackingMode: "load_reps" },
      queuedClient([httpError(422)]),
    );
    expect(result).toEqual({
      ok: false,
      message: "Please double-check the exercise.",
    });
  });
});

describe("updateCustomExercise", () => {
  it("re-reads the record, keeps newer metadata and remembers the old name", async () => {
    const requests: RequestOptions[] = [];
    const stale = exercise({
      name: "Sled push",
      instructions: "Old notes",
      metadata: { custom: true, trackingMode: "load_reps" },
    });
    const fresh = {
      ...stale,
      metadata: { custom: true, trackingMode: "load_reps", targetLoadKg: 80 },
    };
    const result = await updateCustomExercise(
      stale,
      { name: "Sled drag", instructions: null, trackingMode: "duration" },
      queuedClient(
        [
          { ok: true, value: { exercise: fresh } },
          { ok: true, value: { exercise: { ...fresh, name: "Sled drag" } } },
        ],
        requests,
      ),
    );
    expect(requests[0]).toMatchObject({
      method: "GET",
      path: `/v1/exercises/${stale.id}`,
    });
    expect(requests[1]).toMatchObject({
      method: "PUT",
      path: `/v1/exercises/${stale.id}`,
      body: {
        name: "Sled drag",
        instructions: null,
        metadata: {
          custom: true,
          trackingMode: "duration",
          targetLoadKg: 80,
          previousNames: ["Sled push"],
        },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("does not write when the re-read fails", async () => {
    const requests: RequestOptions[] = [];
    const result = await updateCustomExercise(
      exercise(),
      { name: "Sled drag", instructions: null, trackingMode: "duration" },
      queuedClient([httpError(404)], requests),
    );
    expect(requests).toHaveLength(1);
    expect(result).toEqual({
      ok: false,
      message: "That exercise no longer exists.",
    });
  });

  it("explains a tracking type the server refused because sets exist", async () => {
    const current = exercise();
    const result = await updateCustomExercise(
      current,
      { name: current.name, instructions: null, trackingMode: "duration" },
      queuedClient([
        { ok: true, value: { exercise: current } },
        httpError(409),
      ]),
    );
    expect(result).toEqual({
      ok: false,
      message:
        "This exercise has logged sets, so its tracking type can't change.",
    });
  });
});

describe("deleteCustomExercise", () => {
  it("returns ok on success", async () => {
    const requests: RequestOptions[] = [];
    const result = await deleteCustomExercise(
      "abc",
      queuedClient([{ ok: true, value: undefined }], requests),
    );
    expect(requests[0]).toMatchObject({
      method: "DELETE",
      path: "/v1/exercises/abc",
    });
    expect(result).toEqual({ ok: true });
  });

  it("reports an exercise with logged sets (409) as in use", async () => {
    const result = await deleteCustomExercise(
      "abc",
      queuedClient([httpError(409)]),
    );
    expect(result).toEqual({
      ok: false,
      inUse: true,
      message:
        "This exercise has logged sets, so it stays to keep your history.",
    });
  });

  it("treats a 404 as not in use", async () => {
    const result = await deleteCustomExercise(
      "abc",
      queuedClient([httpError(404)]),
    );
    expect(result).toEqual({
      ok: false,
      inUse: false,
      message: "That exercise no longer exists.",
    });
  });

  it("reports a network error", async () => {
    const result = await deleteCustomExercise(
      "abc",
      queuedClient([{ ok: false, error: { kind: "network_error", cause: 1 } }]),
    );
    expect(result).toEqual({
      ok: false,
      inUse: false,
      message: "Network unavailable. Delete the exercise when you're online.",
    });
  });

  it("encodes the id in the path", async () => {
    const requests: RequestOptions[] = [];
    await deleteCustomExercise(
      "a/b",
      queuedClient([{ ok: true, value: undefined }], requests),
    );
    expect(requests[0]?.path).toBe("/v1/exercises/a%2Fb");
  });
});

describe("loadExerciseUsage", () => {
  const summary = (totalSetCount: number) => ({
    bestLoadKg: null,
    lastSessionVolumeKg: null,
    totalSetCount,
  });

  it("detects logged sets from the returned sets", async () => {
    const requests: RequestOptions[] = [];
    const result = await loadExerciseUsage(
      "abc",
      queuedClient(
        [{ ok: true, value: { sets: [{ id: "s" }], summary: summary(1) } }],
        requests,
      ),
    );
    expect(requests[0]).toMatchObject({
      method: "GET",
      path: "/v1/exercises/abc/recent-sets?limit=1",
    });
    expect(result).toEqual({ ok: true, hasLoggedSets: true });
  });

  it("detects logged sets from the summary total alone", async () => {
    const result = await loadExerciseUsage(
      "abc",
      queuedClient([{ ok: true, value: { sets: [], summary: summary(3) } }]),
    );
    expect(result).toEqual({ ok: true, hasLoggedSets: true });
  });

  it("reports no logged sets", async () => {
    const result = await loadExerciseUsage(
      "abc",
      queuedClient([{ ok: true, value: { sets: [], summary: summary(0) } }]),
    );
    expect(result).toEqual({ ok: true, hasLoggedSets: false });
  });

  it("returns not ok when the check fails", async () => {
    const result = await loadExerciseUsage(
      "abc",
      queuedClient([httpError(500)]),
    );
    expect(result).toEqual({ ok: false });
  });
});
