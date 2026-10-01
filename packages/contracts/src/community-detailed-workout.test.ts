import { describe, it, expect } from "vitest";
import {
  sharedWorkoutDetailsSchema,
  publishWorkoutActivitySchema,
} from "./community";
const details = {
  exercises: [
    {
      name: "Bench press",
      sets: [
        {
          setType: "normal",
          repetitions: 8,
          loadKg: 60,
          durationSeconds: null,
        },
      ],
    },
  ],
};
describe("explicit detailed workout allowlist", () => {
  it("retains exact chosen measurements", () =>
    expect(sharedWorkoutDetailsSchema.parse(details)).toEqual(details));
  it.each(["notes", "title", "metadata", "health"])("rejects extra %s", (key) =>
    expect(
      sharedWorkoutDetailsSchema.safeParse({ ...details, [key]: "private" })
        .success,
    ).toBe(false),
  );
  it("rejects hidden set metadata", () =>
    expect(
      sharedWorkoutDetailsSchema.safeParse({
        exercises: [
          {
            ...details.exercises[0],
            sets: [{ ...details.exercises[0]!.sets[0], perceivedExertion: 9 }],
          },
        ],
      }).success,
    ).toBe(false));
  it("bounds total sets", () =>
    expect(
      sharedWorkoutDetailsSchema.safeParse({
        exercises: [
          { name: "A", sets: Array(251).fill(details.exercises[0]!.sets[0]) },
          { name: "B", sets: Array(250).fill(details.exercises[0]!.sets[0]) },
        ],
      }).success,
    ).toBe(false));
  it("defaults old publications to no details", () =>
    expect(
      publishWorkoutActivitySchema.parse({
        workoutId: "10000000-0000-4000-8000-000000000001",
        operationId: "10000000-0000-4000-8000-000000000002",
        enrollmentGeneration: 1,
        sharedDay: "2026-10-01",
      }).includeWorkoutDetails,
    ).toBe(false));
});
