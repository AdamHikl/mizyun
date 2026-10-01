import { describe, expect, it } from "vitest";
import type { SharedWorkoutDetails, UserId } from "@mizyun/core";
import { InMemoryCommunityRepository } from "./community-repository.js";

const alice = "00000000-0000-4000-8000-000000000001" as UserId;
const details: SharedWorkoutDetails = {
  exercises: [
    {
      name: "Squat",
      sets: [
        {
          setType: "normal",
          repetitions: 8,
          loadKg: 50,
          durationSeconds: null,
        },
      ],
    },
  ],
};
const input = {
  sourceWorkoutId: "10000000-0000-4000-8000-000000000001",
  category: "strength" as const,
  sharedDay: "2026-10-01",
  durationSeconds: null,
  enrollmentGeneration: 1,
  operationId: "20000000-0000-4000-8000-000000000001",
};
const enrolled = async () => {
  const repo = new InMemoryCommunityRepository();
  await repo.saveProfile(alice, {
    handle: "alice",
    displayName: "Alice",
    isSearchable: false,
  });
  return repo;
};

describe("explicit detailed workout snapshot retries", () => {
  it("keeps old minimal publications minimal", async () => {
    const repo = await enrolled();
    const card = await repo.publishActivity(alice, input);
    expect(card.workoutDetails).toBeNull();
  });
  it("rejects a new publication with stale confirmed details", async () => {
    const repo = await enrolled();
    await expect(
      repo.publishActivity(alice, {
        ...input,
        workoutDetails: details,
        currentSourceWorkoutDetails: { exercises: [] },
      }),
    ).rejects.toThrow("conflict");
  });
  it("resolves a lost response to the original snapshot after private edits", async () => {
    const repo = await enrolled();
    const publication = {
      ...input,
      workoutDetails: details,
      currentSourceWorkoutDetails: details,
    };
    const card = await repo.publishActivity(alice, publication);
    const retry = await repo.publishActivity(alice, {
      ...publication,
      currentSourceWorkoutDetails: { exercises: [] },
    });
    expect(retry).toEqual(card);
    expect(retry.workoutDetails).toEqual(details);
    await expect(
      repo.publishActivity(alice, {
        ...publication,
        workoutDetails: { exercises: [] },
      }),
    ).rejects.toThrow("conflict");
    await repo.revokeActivity(card.id, alice);
    await expect(repo.publishActivity(alice, publication)).rejects.toThrow(
      "conflict",
    );
  });
  it("requires a new versioned operation to remove details while preserving the card chronology", async () => {
    const repo = await enrolled();
    const first = await repo.publishActivity(alice, {
      ...input,
      workoutDetails: details,
      currentSourceWorkoutDetails: details,
    });
    const updated = await repo.publishActivity(alice, {
      ...input,
      operationId: "20000000-0000-4000-8000-000000000002",
      expectedVersion: first.version,
      workoutDetails: null,
    });
    expect(updated.workoutDetails).toBeNull();
    expect(updated.version).toBe(first.version + 1);
    expect(updated.publishedAt).toEqual(first.publishedAt);
  });
});
