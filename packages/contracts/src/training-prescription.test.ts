import { describe, expect, it } from "vitest";

import { trainingPrescriptionSchema } from "./training-prescription";

describe("trainingPrescriptionSchema", () => {
  it("accepts an incomplete prescription with typed missing inputs", () => {
    const result = trainingPrescriptionSchema.parse({
      version: "v1",
      computedAt: "2026-07-26T10:00:00.000Z",
      complete: false,
      missingInputs: ["experience_level"],
      goalKind: "bulk",
      requestedDaysPerWeek: null,
      resistanceDaysPerWeek: null,
      aerobicMinutesPerWeek: 150,
      recentLoad: {
        completedSessionsLast7Days: 0,
        completedSetsLast7Days: 0,
        averageRpeLast7Days: null,
      },
      volumeAction: "hold",
      sessions: [],
      assumptions: [],
      warnings: ["Complete preferences."],
    });
    expect(result.complete).toBe(false);
  });

  it("rejects unsafe set counts and RPE values", () => {
    const result = trainingPrescriptionSchema.safeParse({
      version: "v1",
      computedAt: "2026-07-26T10:00:00.000Z",
      complete: true,
      missingInputs: [],
      goalKind: "bulk",
      requestedDaysPerWeek: 3,
      resistanceDaysPerWeek: 3,
      aerobicMinutesPerWeek: 150,
      recentLoad: {
        completedSessionsLast7Days: 3,
        completedSetsLast7Days: 30,
        averageRpeLast7Days: 12,
      },
      volumeAction: "build",
      sessions: [
        {
          index: 1,
          label: "Session 1",
          estimatedMinutes: 60,
          exercises: [
            {
              catalogId: "squat",
              name: "Squat",
              movementPattern: "knee_dominant",
              equipment: ["barbell"],
              sets: 20,
              repsMin: 4,
              repsMax: 6,
              durationMinutes: null,
              restSeconds: 150,
              progression: "double_progression",
            },
          ],
        },
      ],
      assumptions: [],
      warnings: [],
    });
    expect(result.success).toBe(false);
  });
});
