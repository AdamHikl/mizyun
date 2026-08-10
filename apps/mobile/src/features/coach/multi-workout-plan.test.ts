import { describe, expect, it } from "vitest";

import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";
import type { Result } from "@mizyun/core";
import type { CoachMultiWorkoutPlanProposal } from "@mizyun/contracts";

import {
  humanFocusLabel,
  saveMultiWorkoutPlanWith,
} from "./multi-workout-plan";

const NOW = new Date("2026-07-19T10:15:00.000Z");

const proposal = (
  overrides: Partial<CoachMultiWorkoutPlanProposal> = {},
): CoachMultiWorkoutPlanProposal => ({
  id: "00000000-0000-4000-8000-0000000000a1",
  kind: "multi_workout_plan",
  prescriptionVersion: "v1-general-resistance-2026-07",
  volumeAction: "hold",
  focus: "ppl",
  requestedSessions: 3,
  sessionMinutes: 60,
  rationale: "Three PPL sessions of 60 minutes each.",
  startDay: "2026-07-19",
  endDay: "2026-07-25",
  sessions: [
    {
      index: 1,
      label: "Push",
      estimatedMinutes: 60,
      focus: "ppl",
      targetDay: "2026-07-19",
      exercises: [
        {
          catalogId: "ex-push-1",
          name: "Bench press",
          movementPattern: "horizontal_push",
          equipment: ["barbell", "bench"],
          sets: 4,
          repsMin: 6,
          repsMax: 10,
          durationMinutes: null,
          restSeconds: 120,
          progression: "double_progression",
        },
      ],
    },
    {
      index: 2,
      label: "Pull",
      estimatedMinutes: 60,
      focus: "ppl",
      targetDay: "2026-07-21",
      exercises: [
        {
          catalogId: "ex-pull-1",
          name: "Pull-up",
          movementPattern: "vertical_pull",
          equipment: ["pullup_bar"],
          sets: 4,
          repsMin: 6,
          repsMax: 10,
          durationMinutes: null,
          restSeconds: 120,
          progression: "double_progression",
        },
      ],
    },
    {
      index: 3,
      label: "Legs",
      estimatedMinutes: 60,
      focus: "ppl",
      targetDay: "2026-07-23",
      exercises: [
        {
          catalogId: "ex-leg-1",
          name: "Back squat",
          movementPattern: "knee_dominant",
          equipment: ["barbell", "rack"],
          sets: 5,
          repsMin: 5,
          repsMax: 8,
          durationMinutes: null,
          restSeconds: 180,
          progression: "double_progression",
        },
      ],
    },
  ],
  ...overrides,
});

const fakeWorkout = (id: string, name: string, startedAt: string) => ({
  id,
  userId: "00000000-0000-4000-8000-0000000000b1",
  name,
  startedAt,
  completedAt: null,
  notes: null,
  source: "manual" as const,
  details: {},
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
});

const queuedClient = (
  results: Array<Result<unknown, ApiError>>,
  requests: RequestOptions[] = [],
): { client: ApiClient; requests: RequestOptions[] } => {
  const client: ApiClient = {
    request: <T>(options: RequestOptions): Promise<Result<T, ApiError>> => {
      requests.push(options);
      const result = results.shift();
      if (result === undefined) throw new Error("missing queued result");
      return Promise.resolve(result as Result<T, ApiError>);
    },
    status: () => ({ configured: true, baseUrl: "https://example.test" }),
  };
  return { client, requests };
};

describe("saveMultiWorkoutPlan", () => {
  it("creates one workout per session with the session label and target-day startedAt", async () => {
    const captured: RequestOptions[] = [];
    const { client } = queuedClient(
      [
        {
          ok: true,
          value: {
            workout: fakeWorkout("w-1", "Push", "2026-07-19T12:00:00.000Z"),
          },
        },
        {
          ok: true,
          value: {
            workout: fakeWorkout("w-2", "Pull", "2026-07-21T12:00:00.000Z"),
          },
        },
        {
          ok: true,
          value: {
            workout: fakeWorkout("w-3", "Legs", "2026-07-23T12:00:00.000Z"),
          },
        },
      ],
      captured,
    );
    // saveMultiWorkoutPlanWith accepts the client directly, so we
    // don't need to mock the module-level apiClient.
    const result = await saveMultiWorkoutPlanWith(client, proposal());
    expect(result.ok).toBe(true);
    expect(result.saved).toHaveLength(3);
    expect(result.firstWorkoutId).toBe("w-1");
    expect(captured[0]?.method).toBe("POST");
    expect(captured[0]?.path).toBe("/v1/workouts");
    expect(captured[0]?.body).toMatchObject({
      name: "Push",
      startedAt: "2026-07-19T12:00:00.000Z",
    });
    expect(captured[1]?.body).toMatchObject({
      name: "Pull",
      startedAt: "2026-07-21T12:00:00.000Z",
    });
    expect(captured[2]?.body).toMatchObject({
      name: "Legs",
      startedAt: "2026-07-23T12:00:00.000Z",
    });
  });

  it("reports per-session failures without stopping the rest of the plan", async () => {
    const captured: RequestOptions[] = [];
    const { client } = queuedClient(
      [
        {
          ok: true,
          value: {
            workout: fakeWorkout("w-1", "Push", "2026-07-19T12:00:00.000Z"),
          },
        },
        {
          ok: false,
          error: {
            kind: "http_error",
            status: 422,
            code: "INVALID_INPUT",
            message: "Bad name",
          },
        },
        {
          ok: true,
          value: {
            workout: fakeWorkout("w-3", "Legs", "2026-07-23T12:00:00.000Z"),
          },
        },
      ],
      captured,
    );
    const result = await saveMultiWorkoutPlanWith(client, proposal());
    expect(result.ok).toBe(false);
    expect(result.saved).toHaveLength(3);
    expect(result.saved[0]?.result.ok).toBe(true);
    expect(result.saved[1]?.result.ok).toBe(false);
    expect(result.saved[2]?.result.ok).toBe(true);
    expect(result.firstWorkoutId).toBe("w-1");
  });
});

describe("humanFocusLabel", () => {
  it("returns null for empty or unknown focus values", () => {
    expect(humanFocusLabel(null)).toBeNull();
    expect(humanFocusLabel("")).toBeNull();
    expect(humanFocusLabel("unknown")).toBeNull();
  });

  it("maps plan-level focus codes to human labels", () => {
    expect(humanFocusLabel("general_hypertrophy")).toBe("Upper-body emphasis");
    expect(humanFocusLabel("ppl")).toBe("Push · Pull · Legs");
    expect(humanFocusLabel("upper_lower")).toBe("Upper / Lower");
    expect(humanFocusLabel("full_body")).toBe("Full body");
  });

  it("maps per-session distribution focus codes to human labels", () => {
    expect(humanFocusLabel("upper")).toBe("Upper body");
    expect(humanFocusLabel("lower")).toBe("Lower body");
    expect(humanFocusLabel("full")).toBe("Full body");
  });

  it("title-cases unmapped snake_case values instead of leaking the code", () => {
    expect(humanFocusLabel("high_intensity")).toBe("High Intensity");
  });
});
