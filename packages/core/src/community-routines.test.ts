import { describe, expect, it } from "vitest";
import { projectRoutineSnapshot } from "./community-routines";
const exercise = {
  name: "Bench press",
  targetSets: 3,
  targetReps: "8-12",
  targetLoad: "100 lb",
  restSeconds: 90,
  notes: "Private injury cue",
  catalogId: "foreign-id",
  limitations: ["private"],
  coachContext: "private",
};
const details = {
  workoutLifecycle: { kind: "routine" },
  coachPlan: { exercises: [exercise], health: "private" },
  injury: "private",
  notes: "private",
};
describe("deliberate routine projection", () => {
  it("rejects prohibited public title and contact exercise text", () => {
    expect(() =>
      projectRoutineSnapshot(details, "Starvation challenge"),
    ).toThrow();
    expect(() =>
      projectRoutineSnapshot(
        {
          ...details,
          coachPlan: {
            exercises: [{ ...exercise, name: "https://example.com" }],
          },
        },
        "Plan",
      ),
    ).toThrow();
  });
  it("copies only targets with deterministic pounds conversion, excluding source references and private context", () => {
    expect(projectRoutineSnapshot(details, "Shared strength")).toEqual({
      schemaVersion: "2026-10-01",
      title: "Shared strength",
      exercises: [
        {
          name: "Bench press",
          sets: 3,
          repsMin: 8,
          repsMax: 12,
          loadKg: 45.359,
          restSeconds: 90,
        },
      ],
    });
  });
  it.each([
    "8 reps until injured",
    "12-8",
    "0-8",
    "8-101",
    "NaN",
    "8-12 meals",
  ])("rejects unsafe or ambiguous repetition target %s", (targetReps) => {
    expect(() =>
      projectRoutineSnapshot(
        { ...details, coachPlan: { exercises: [{ ...exercise, targetReps }] } },
        "Plan",
      ),
    ).toThrow();
  });
  it.each(["80", "-2 kg", "100 ml", "1001 kg", "Infinity kg"])(
    "rejects invalid load %s",
    (targetLoad) =>
      expect(() =>
        projectRoutineSnapshot(
          {
            ...details,
            coachPlan: { exercises: [{ ...exercise, targetLoad }] },
          },
          "Plan",
        ),
      ).toThrow(),
  );
  it("requires a deliberate routine source, not performed sessions or arbitrary details", () => {
    expect(() =>
      projectRoutineSnapshot(
        { ...details, workoutLifecycle: { kind: "session" } },
        "Plan",
      ),
    ).toThrow();
    expect(() =>
      projectRoutineSnapshot(
        { ...details, coachPlan: { exercises: [] } },
        "Plan",
      ),
    ).toThrow();
  });
});
