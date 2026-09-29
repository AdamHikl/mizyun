import { describe, expect, it, vi } from "vitest";

import type { StoredWorkoutSet, UserId } from "@mizyun/core";

import { SupabaseWorkoutSetRepository } from "./workout-set-repository.js";
import type {
  RepositorySupabaseClient,
  RepositorySingleResult,
  RepositoryListResult,
} from "./index.js";

const setRow = {
  id: "00000000-0000-4000-8000-00000000d001",
  user_id: "00000000-0000-4000-8000-000000000001",
  workout_id: "00000000-0000-4000-8000-00000000b001",
  exercise_id: "00000000-0000-4000-8000-00000000c001",
  sequence: 1,
  repetitions: 8,
  load_kg: 60,
  duration_seconds: null,
  distance_meters: null,
  perceived_exertion: 7.5,
  completed_at: "2026-07-15T09:00:00.000Z",
  created_at: "2026-07-15T08:00:00.000Z",
};

const fakeClient = (opts: {
  selectMaybeSingle?: RepositorySingleResult<unknown>;
  insertSingle?: RepositorySingleResult<unknown>;
  selectList?: RepositoryListResult<unknown>;
}): RepositorySupabaseClient => ({
  from: (_t?: string) => {
    const builder = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue(opts.insertSingle ?? null),
      maybeSingle: vi.fn().mockResolvedValue(opts.selectMaybeSingle ?? null),
      then: (resolve: (v: RepositoryListResult<unknown>) => void) => {
        resolve(opts.selectList ?? { data: [], error: null });
      },
    };
    return builder as unknown as never;
  },
  rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  auth: {
    setSession: vi.fn().mockResolvedValue({
      data: { user: { id: "00000000-0000-4000-8000-000000000001" } },
      error: null,
    }),
  },
});

describe("SupabaseWorkoutSetRepository.create", () => {
  it("returns the parsed stored set", async () => {
    const repo = new SupabaseWorkoutSetRepository({
      clientFor: () =>
        fakeClient({ insertSingle: { data: setRow, error: null } }),
    });
    const stored: StoredWorkoutSet = {
      id: setRow.id,
      userId: "00000000-0000-4000-8000-000000000001" as UserId,
      workoutId: setRow.workout_id,
      exerciseId: setRow.exercise_id,
      sequence: 1,
      setType: "normal",
      repetitions: 8,
      loadKg: 60,
      durationSeconds: null,
      distanceMeters: null,
      perceivedExertion: 7.5,
      completedAt: new Date("2026-07-15T09:00:00.000Z"),
      createdAt: new Date("2026-07-15T08:00:00.000Z"),
    };
    const result = await repo.create(
      "00000000-0000-4000-8000-000000000001" as UserId,
      stored,
      { accessToken: "token" },
    );
    expect(result.loadKg).toBe(60);
    expect(result.perceivedExertion).toBe(7.5);
    expect(result.setType).toBe("normal");
  });

  it("translates the (workout_id, sequence) unique violation", async () => {
    const repo = new SupabaseWorkoutSetRepository({
      clientFor: () =>
        fakeClient({
          insertSingle: {
            data: null,
            error: {
              message:
                'duplicate key value violates unique constraint "workout_sets_workout_id_sequence_key"',
            },
          },
        }),
    });
    const stored: StoredWorkoutSet = {
      id: "00000000-0000-4000-8000-00000000d002",
      userId: "00000000-0000-4000-8000-000000000001" as UserId,
      workoutId: setRow.workout_id,
      exerciseId: setRow.exercise_id,
      sequence: 1,
      setType: "normal",
      repetitions: 8,
      loadKg: 60,
      durationSeconds: null,
      distanceMeters: null,
      perceivedExertion: 7.5,
      completedAt: null,
      createdAt: new Date(),
    };
    await expect(
      repo.create("00000000-0000-4000-8000-000000000001" as UserId, stored, {
        accessToken: "token",
      }),
    ).rejects.toThrow(/sequence collision/);
  });
});

describe("SupabaseWorkoutSetRepository.listForWorkout", () => {
  it("returns sets ordered by sequence ascending", async () => {
    const repo = new SupabaseWorkoutSetRepository({
      clientFor: () =>
        fakeClient({ selectList: { data: [setRow], error: null } }),
    });
    const list = await repo.listForWorkout(
      "00000000-0000-4000-8000-00000000b001",
      {
        accessToken: "token",
      },
    );
    expect(list).toHaveLength(1);
    expect(list[0]?.sequence).toBe(1);
  });
});

describe("SupabaseWorkoutSetRepository.deleteAllForWorkout", () => {
  it("returns 0 because SQL cascades handle workout set cleanup", async () => {
    const repo = new SupabaseWorkoutSetRepository({
      clientFor: () => fakeClient({ selectList: { data: [], error: null } }),
    });
    const removed = await repo.deleteAllForWorkout(
      "00000000-0000-4000-8000-00000000b001",
      { accessToken: "token" },
    );
    expect(removed).toBe(0);
  });
});
