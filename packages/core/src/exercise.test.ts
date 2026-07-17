import { describe, expect, it } from "vitest";

import type { UserId } from "./index.js";
import {
  applyExercisePatch,
  EXERCISE_NAME_MAX,
  INSTRUCTIONS_MAX,
  type ExercisePatch,
  type StoredExercise,
  validateExerciseCreate,
  validateExercisePatch,
} from "./exercise.js";

const userId = "00000000-0000-4000-8000-000000000001" as UserId;

const baseStored = (
  overrides: Partial<StoredExercise> = {},
): StoredExercise => ({
  id: "00000000-0000-4000-8000-00000000a001",
  userId,
  name: "Back squat",
  instructions: "Keep your back flat.",
  metadata: { equipment: "barbell" },
  createdAt: new Date("2026-07-10T08:00:00Z"),
  updatedAt: new Date("2026-07-10T08:00:00Z"),
  ...overrides,
});

describe("validateExerciseCreate", () => {
  it("accepts a minimal exercise with only `name`", () => {
    expect(validateExerciseCreate({ name: "Back squat" })).toBeNull();
  });

  it("accepts a fully populated exercise", () => {
    expect(
      validateExerciseCreate({
        name: "Romanian deadlift",
        instructions: "Lower the bar to mid-shin.",
        metadata: { equipment: "barbell", primary: "hamstrings" },
      }),
    ).toBeNull();
  });

  it("rejects a blank name", () => {
    expect(validateExerciseCreate({ name: "   " })).toEqual({
      kind: "name_empty",
    });
  });

  it("rejects a name longer than the bound", () => {
    expect(
      validateExerciseCreate({ name: "x".repeat(EXERCISE_NAME_MAX + 1) }),
    ).toEqual({ kind: "name_too_long", max: EXERCISE_NAME_MAX });
  });

  it("rejects instructions longer than the bound", () => {
    expect(
      validateExerciseCreate({
        name: "Back squat",
        instructions: "x".repeat(INSTRUCTIONS_MAX + 1),
      }),
    ).toEqual({
      kind: "instructions_too_long",
      max: INSTRUCTIONS_MAX,
    });
  });

  it("rejects a non-object metadata value", () => {
    expect(
      validateExerciseCreate({
        name: "Back squat",
        metadata: null as unknown as Record<string, unknown>,
      }),
    ).toEqual({ kind: "metadata_must_be_object" });
  });

  it("accepts null instructions", () => {
    expect(
      validateExerciseCreate({
        name: "Back squat",
        instructions: null,
      }),
    ).toBeNull();
  });
});

describe("validateExercisePatch", () => {
  it("rejects an empty patch", () => {
    expect(validateExercisePatch({})).toEqual({ kind: "empty_patch" });
  });

  it("accepts a single-field patch", () => {
    expect(validateExercisePatch({ name: "Front squat" })).toBeNull();
  });

  it("accepts clearing instructions to null", () => {
    expect(validateExercisePatch({ instructions: null })).toBeNull();
  });

  it("accepts a metadata replacement", () => {
    expect(
      validateExercisePatch({ metadata: { equipment: "kettlebell" } }),
    ).toBeNull();
  });

  it("rejects a blank name in the patch", () => {
    expect(validateExercisePatch({ name: "   " })).toEqual({
      kind: "name_empty",
    });
  });

  it("rejects an out-of-range instructions length", () => {
    expect(
      validateExercisePatch({
        instructions: "x".repeat(INSTRUCTIONS_MAX + 1),
      }),
    ).toEqual({
      kind: "instructions_too_long",
      max: INSTRUCTIONS_MAX,
    });
  });

  it("rejects metadata that is an array", () => {
    expect(
      validateExercisePatch({
        metadata: [] as unknown as Record<string, unknown>,
      }),
    ).toEqual({ kind: "metadata_must_be_object" });
  });
});

describe("applyExercisePatch", () => {
  it("returns the stored exercise unchanged when the patch is empty (caller's responsibility)", () => {
    const stored = baseStored();
    const now = new Date("2026-08-01T00:00:00Z");
    const next = applyExercisePatch(stored, {}, now);
    expect(next).toEqual({ ...stored, updatedAt: now });
  });

  it("updates the name when the patch sets it", () => {
    const stored = baseStored();
    const now = new Date("2026-08-01T00:00:00Z");
    const next = applyExercisePatch(stored, { name: "Front squat" }, now);
    expect(next.name).toBe("Front squat");
    expect(next.instructions).toBe(stored.instructions);
    expect(next.metadata).toEqual(stored.metadata);
    expect(next.createdAt).toBe(stored.createdAt);
    expect(next.updatedAt).toBe(now);
  });

  it("clears instructions when the patch sets it to null", () => {
    const stored = baseStored();
    const now = new Date("2026-08-01T00:00:00Z");
    const next = applyExercisePatch(stored, { instructions: null }, now);
    expect(next.instructions).toBeNull();
  });

  it("replaces the metadata object wholesale", () => {
    const stored = baseStored({ metadata: { equipment: "barbell" } });
    const now = new Date("2026-08-01T00:00:00Z");
    const next = applyExercisePatch(
      stored,
      { metadata: { equipment: "kettlebell", grip: "double" } },
      now,
    );
    expect(next.metadata).toEqual({ equipment: "kettlebell", grip: "double" });
  });

  it("advances updatedAt", () => {
    const stored = baseStored();
    const now = new Date("2026-09-01T00:00:00Z");
    const next = applyExercisePatch(stored, { name: "Front squat" }, now);
    expect(next.updatedAt).toBe(now);
  });

  it("does not mutate the stored exercise", () => {
    const stored = baseStored();
    const snapshot = JSON.parse(JSON.stringify(stored));
    applyExercisePatch(stored, { name: "Front squat" }, new Date());
    expect(JSON.parse(JSON.stringify(stored))).toEqual(snapshot);
  });

  it("preserves the immutable id and userId", () => {
    const stored = baseStored();
    const next = applyExercisePatch(
      stored,
      { name: "Front squat" },
      new Date(),
    );
    expect(next.id).toBe(stored.id);
    expect(next.userId).toBe(stored.userId);
  });

  it("type-checks: a patch may carry all three optional fields", () => {
    const stored = baseStored();
    const now = new Date("2026-08-01T00:00:00Z");
    const patch: ExercisePatch = {
      name: "Front squat",
      instructions: "Elbows up.",
      metadata: { equipment: "barbell" },
    };
    const next = applyExercisePatch(stored, patch, now);
    expect(next.name).toBe("Front squat");
    expect(next.instructions).toBe("Elbows up.");
    expect(next.metadata).toEqual({ equipment: "barbell" });
  });
});
