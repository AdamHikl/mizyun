import { describe, expect, it } from "vitest";

import type { StoredWorkoutSet, UserId } from "@mizyun/core";

import { InMemoryWorkoutSetRepository } from "./workout-set-repository.js";

const userId = "00000000-0000-4000-8000-000000000001" as UserId;
const exerciseId = "00000000-0000-4000-8000-00000000c001";
const options = { accessToken: "token" };

const makeSet = (
  n: number,
  completedAt: Date | null,
  createdAt: Date,
): StoredWorkoutSet => ({
  id: `00000000-0000-4000-8000-00000000d00${n}`,
  userId,
  workoutId: `00000000-0000-4000-8000-00000000b00${n}`,
  exerciseId,
  sequence: 1,
  setType: "normal",
  repetitions: 8,
  loadKg: 60,
  durationSeconds: null,
  distanceMeters: null,
  perceivedExertion: null,
  completedAt,
  createdAt,
});

describe("InMemoryWorkoutSetRepository.recentForExercise", () => {
  it("ranks by completedAt, not insert time, so backdated sets rank lower", async () => {
    const repo = new InMemoryWorkoutSetRepository();
    const live = makeSet(
      1,
      new Date("2026-10-17T09:00:00Z"),
      new Date("2026-10-17T09:00:00Z"),
    );
    // Backdated: performed earlier but entered later.
    const backdated = makeSet(
      2,
      new Date("2026-10-01T09:00:00Z"),
      new Date("2026-10-17T10:00:00Z"),
    );
    const unfinished = makeSet(3, null, new Date("2026-10-17T11:00:00Z"));
    for (const s of [backdated, live, unfinished]) {
      await repo.create(userId, s, options);
    }
    const recent = await repo.recentForExercise(
      userId,
      exerciseId,
      10,
      options,
    );
    expect(recent.map((s) => s.id)).toEqual([
      live.id,
      backdated.id,
      unfinished.id,
    ]);
  });

  it("breaks completedAt ties by createdAt descending", async () => {
    const repo = new InMemoryWorkoutSetRepository();
    const at = new Date("2026-10-01T09:00:00Z");
    const older = makeSet(1, at, new Date("2026-10-01T09:00:01Z"));
    const newer = makeSet(2, at, new Date("2026-10-01T09:00:02Z"));
    await repo.create(userId, older, options);
    await repo.create(userId, newer, options);
    const recent = await repo.recentForExercise(
      userId,
      exerciseId,
      10,
      options,
    );
    expect(recent.map((s) => s.id)).toEqual([newer.id, older.id]);
  });
});
