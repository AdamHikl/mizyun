import { describe, expect, it } from "vitest";

import type { UserId } from "./index.js";
import {
  applyWorkoutPatch,
  isNonStrengthWorkoutDetails,
  NON_STRENGTH_ACTIVITY_TYPES,
  NOTES_MAX,
  WORKOUT_NAME_MAX,
  type StoredWorkout,
  type WorkoutPatch,
  validateWorkoutCreate,
  validateWorkoutPatch,
} from "./workout.js";

const userId = "00000000-0000-4000-8000-000000000001" as UserId;

const baseStored = (overrides: Partial<StoredWorkout> = {}): StoredWorkout => ({
  id: "00000000-0000-4000-8000-00000000a001",
  userId,
  name: "Tuesday leg day",
  startedAt: new Date("2026-07-10T08:00:00Z"),
  completedAt: new Date("2026-07-10T09:00:00Z"),
  notes: "Felt strong.",
  source: "manual",
  details: {},
  createdAt: new Date("2026-07-10T08:00:00Z"),
  updatedAt: new Date("2026-07-10T08:00:00Z"),
  ...overrides,
});

describe("validateWorkoutCreate", () => {
  it("accepts a minimal in-flight workout (only name, startedAt auto)", () => {
    expect(
      validateWorkoutCreate({
        name: "Leg day",
        startedAt: new Date("2026-07-10T08:00:00Z"),
      }),
    ).toBeNull();
  });

  it("accepts a fully populated workout with completedAt", () => {
    expect(
      validateWorkoutCreate({
        name: "Leg day",
        startedAt: new Date("2026-07-10T08:00:00Z"),
        completedAt: new Date("2026-07-10T09:00:00Z"),
        notes: "Felt strong.",
        details: { program: "5/3/1" },
      }),
    ).toBeNull();
  });

  it("rejects a blank name", () => {
    expect(
      validateWorkoutCreate({
        name: "   ",
        startedAt: new Date("2026-07-10T08:00:00Z"),
      }),
    ).toEqual({ kind: "name_empty" });
  });

  it("rejects a name longer than the bound", () => {
    expect(
      validateWorkoutCreate({
        name: "x".repeat(WORKOUT_NAME_MAX + 1),
        startedAt: new Date("2026-07-10T08:00:00Z"),
      }),
    ).toEqual({ kind: "name_too_long", max: WORKOUT_NAME_MAX });
  });

  it("rejects notes longer than the bound", () => {
    expect(
      validateWorkoutCreate({
        name: "Leg day",
        startedAt: new Date("2026-07-10T08:00:00Z"),
        notes: "x".repeat(NOTES_MAX + 1),
      }),
    ).toEqual({ kind: "notes_too_long", max: NOTES_MAX });
  });

  it("rejects a non-object details value", () => {
    expect(
      validateWorkoutCreate({
        name: "Leg day",
        startedAt: new Date("2026-07-10T08:00:00Z"),
        details: null as unknown as Record<string, unknown>,
      }),
    ).toEqual({ kind: "details_must_be_object" });
  });

  it("rejects completedAt < startedAt", () => {
    expect(
      validateWorkoutCreate({
        name: "Leg day",
        startedAt: new Date("2026-07-10T09:00:00Z"),
        completedAt: new Date("2026-07-10T08:00:00Z"),
      }),
    ).toEqual({ kind: "completed_at_before_started_at" });
  });

  it("accepts completedAt === startedAt (zero-duration workout)", () => {
    expect(
      validateWorkoutCreate({
        name: "Empty session",
        startedAt: new Date("2026-07-10T08:00:00Z"),
        completedAt: new Date("2026-07-10T08:00:00Z"),
      }),
    ).toBeNull();
  });

  it("accepts null completedAt (in-flight workout)", () => {
    expect(
      validateWorkoutCreate({
        name: "In-flight",
        startedAt: new Date("2026-07-10T08:00:00Z"),
        completedAt: null,
      }),
    ).toBeNull();
  });
});

describe("validateWorkoutPatch", () => {
  it("rejects an empty patch", () => {
    expect(validateWorkoutPatch(baseStored(), {})).toEqual({
      kind: "empty_patch",
    });
  });

  it("accepts a single-field name patch", () => {
    expect(validateWorkoutPatch(baseStored(), { name: "Pull day" })).toBeNull();
  });

  it("accepts clearing completedAt to null (re-open the workout)", () => {
    expect(
      validateWorkoutPatch(baseStored(), { completedAt: null }),
    ).toBeNull();
  });

  it("accepts clearing notes to null", () => {
    expect(validateWorkoutPatch(baseStored(), { notes: null })).toBeNull();
  });

  it("rejects a blank name in the patch", () => {
    expect(validateWorkoutPatch(baseStored(), { name: "   " })).toEqual({
      kind: "name_empty",
    });
  });

  it("rejects completedAt before the original startedAt", () => {
    const stored = baseStored({
      startedAt: new Date("2026-07-10T08:00:00Z"),
    });
    expect(
      validateWorkoutPatch(stored, {
        completedAt: new Date("2026-07-09T08:00:00Z"),
      }),
    ).toEqual({ kind: "completed_at_before_started_at" });
  });

  it("rejects completedAt before a freshly-patched startedAt", () => {
    const stored = baseStored({
      startedAt: new Date("2026-07-10T08:00:00Z"),
    });
    expect(
      validateWorkoutPatch(stored, {
        startedAt: new Date("2026-07-11T08:00:00Z"),
        completedAt: new Date("2026-07-10T20:00:00Z"),
      }),
    ).toEqual({ kind: "completed_at_before_started_at" });
  });
});

describe("applyWorkoutPatch", () => {
  it("returns the stored workout unchanged when the patch is empty (caller's responsibility)", () => {
    const stored = baseStored();
    const now = new Date("2026-08-01T00:00:00Z");
    const next = applyWorkoutPatch(stored, {}, now);
    expect(next).toEqual({ ...stored, updatedAt: now });
  });

  it("updates the name when the patch sets it", () => {
    const stored = baseStored();
    const now = new Date("2026-08-01T00:00:00Z");
    const next = applyWorkoutPatch(stored, { name: "Pull day" }, now);
    expect(next.name).toBe("Pull day");
    expect(next.startedAt).toBe(stored.startedAt);
    expect(next.completedAt).toBe(stored.completedAt);
    expect(next.createdAt).toBe(stored.createdAt);
    expect(next.updatedAt).toBe(now);
  });

  it("clears completedAt when the patch sets it to null", () => {
    const stored = baseStored();
    const now = new Date("2026-08-01T00:00:00Z");
    const next = applyWorkoutPatch(stored, { completedAt: null }, now);
    expect(next.completedAt).toBeNull();
  });

  it("preserves a `null` completedAt when the patch omits the field", () => {
    const stored = baseStored({ completedAt: null });
    const now = new Date("2026-08-01T00:00:00Z");
    const next = applyWorkoutPatch(stored, { name: "Pull day" }, now);
    expect(next.completedAt).toBeNull();
  });

  it("clears notes when the patch sets it to null", () => {
    const stored = baseStored();
    const now = new Date("2026-08-01T00:00:00Z");
    const next = applyWorkoutPatch(stored, { notes: null }, now);
    expect(next.notes).toBeNull();
  });

  it("replaces details wholesale", () => {
    const stored = baseStored({ details: { program: "5/3/1" } });
    const now = new Date("2026-08-01T00:00:00Z");
    const next = applyWorkoutPatch(
      stored,
      { details: { program: "nSuns" } },
      now,
    );
    expect(next.details).toEqual({ program: "nSuns" });
  });

  it("advances updatedAt", () => {
    const stored = baseStored();
    const now = new Date("2026-09-01T00:00:00Z");
    const next = applyWorkoutPatch(stored, { name: "Pull day" }, now);
    expect(next.updatedAt).toBe(now);
  });

  it("does not mutate the stored workout", () => {
    const stored = baseStored();
    const snapshot = JSON.parse(JSON.stringify(stored));
    applyWorkoutPatch(stored, { name: "Pull day" }, new Date());
    expect(JSON.parse(JSON.stringify(stored))).toEqual(snapshot);
  });

  it("preserves the immutable id, userId, and source", () => {
    const stored = baseStored({
      clientOperationId: "11111111-2222-4333-8444-555555555555",
    });
    const next = applyWorkoutPatch(stored, { name: "Pull day" }, new Date());
    expect(next.id).toBe(stored.id);
    expect(next.userId).toBe(stored.userId);
    expect(next.clientOperationId).toBe("11111111-2222-4333-8444-555555555555");
    expect(next.source).toBe("manual");
  });

  it("type-checks: a patch may carry all five optional fields", () => {
    const stored = baseStored();
    const now = new Date("2026-08-01T00:00:00Z");
    const later = new Date("2026-07-10T08:30:00Z");
    const patch: WorkoutPatch = {
      name: "Pull day",
      startedAt: new Date("2026-07-10T08:00:00Z"),
      completedAt: later,
      notes: "Light session",
      details: { program: "5/3/1" },
    };
    const next = applyWorkoutPatch(stored, patch, now);
    expect(next.name).toBe("Pull day");
    expect(next.startedAt.toISOString()).toBe("2026-07-10T08:00:00.000Z");
    expect(next.completedAt).toBe(later);
    expect(next.notes).toBe("Light session");
    expect(next.details).toEqual({ program: "5/3/1" });
  });
});

describe("isNonStrengthWorkoutDetails", () => {
  it("flags running and bouldering details", () => {
    expect(NON_STRENGTH_ACTIVITY_TYPES).toEqual(["running", "bouldering"]);
    expect(isNonStrengthWorkoutDetails({ activityType: "running" })).toBe(true);
    expect(isNonStrengthWorkoutDetails({ activityType: "bouldering" })).toBe(
      true,
    );
    expect(isNonStrengthWorkoutDetails({ runSummary: {} })).toBe(true);
    expect(isNonStrengthWorkoutDetails({ boulderSession: {} })).toBe(true);
  });
  it("leaves legacy strength details alone", () => {
    expect(isNonStrengthWorkoutDetails({})).toBe(false);
    expect(isNonStrengthWorkoutDetails({ activityType: "strength" })).toBe(
      false,
    );
  });
});
