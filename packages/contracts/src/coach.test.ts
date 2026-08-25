import { describe, expect, it } from "vitest";

import { coachMessageSchema } from "./coach";

describe("Coach action proposal contracts", () => {
  it("accepts a schema-validated editable meal proposal", () => {
    const parsed = coachMessageSchema.parse({
      id: "00000000-0000-4000-8000-000000000001",
      conversationId: "00000000-0000-4000-8000-000000000002",
      role: "assistant",
      text: "Review this draft.",
      status: "complete",
      provider: "mistral",
      evidenceKinds: [],
      actionProposal: {
        id: "00000000-0000-4000-8000-000000000003",
        kind: "meal_log",
        candidate: {
          name: "Tuna",
          caloriesKcal: 290,
          proteinG: 63,
          carbohydrateG: 0,
          fatG: 2,
          calorieRangeKcal: { low: 250, high: 340 },
          proteinRangeG: { low: 55, high: 70 },
          carbohydrateRangeG: { low: 0, high: 2 },
          fatRangeG: { low: 1, high: 5 },
          confidence: 0.8,
          warnings: [],
          assumptions: ["Assumes drained tuna in water."],
          provenance: {
            inputKind: "text",
            provider: "mistral",
            model: "mistral-medium-latest",
            promptVersion: "nutrition-draft-v2",
          },
        },
      },
      createdAt: "2026-07-26T10:00:00.000Z",
    });

    expect(parsed.actionProposal?.kind).toBe("meal_log");
    if (parsed.actionProposal?.kind !== "meal_log") {
      throw new Error("expected a meal proposal");
    }
    expect(parsed.actionProposal.candidate.proteinG).toBe(63);
  });

  it("accepts a deterministic workout proposal with bounded prescription details", () => {
    const parsed = coachMessageSchema.parse({
      id: "00000000-0000-4000-8000-000000000011",
      conversationId: "00000000-0000-4000-8000-000000000012",
      role: "assistant",
      text: "Review this workout.",
      status: "complete",
      provider: "mizyun-planner",
      evidenceKinds: ["plan", "training"],
      actionProposal: {
        id: "00000000-0000-4000-8000-000000000013",
        kind: "workout_start",
        prescriptionVersion: "training-prescription-v1",
        volumeAction: "hold",
        session: {
          index: 1,
          label: "Full body A",
          estimatedMinutes: 45,
          exercises: [
            {
              catalogId: "goblet-squat",
              name: "Goblet squat",
              movementPattern: "knee_dominant",
              equipment: ["dumbbells"],
              sets: 3,
              repsMin: 6,
              repsMax: 10,
              durationMinutes: null,
              restSeconds: 120,
              progression: "double_progression",
            },
          ],
        },
      },
      createdAt: "2026-07-26T10:00:00.000Z",
    });
    expect(parsed.actionProposal?.kind).toBe("workout_start");
    if (parsed.actionProposal?.kind !== "workout_start") {
      throw new Error("expected a workout proposal");
    }
    expect(parsed.actionProposal.session.exercises[0]?.sets).toBe(3);
  });

  it("accepts a deterministic daily plan proposal", () => {
    const parsed = coachMessageSchema.parse({
      id: "00000000-0000-4000-8000-000000000021",
      conversationId: "00000000-0000-4000-8000-000000000022",
      role: "assistant",
      text: "Today’s plan.",
      status: "complete",
      provider: "mizyun-planner",
      evidenceKinds: ["plan", "nutrition", "training"],
      actionProposal: {
        id: "00000000-0000-4000-8000-000000000023",
        kind: "daily_plan",
        version: "v1-2026-07",
        date: "2026-07-26",
        calorie: {
          targetKcal: 2200,
          consumedKcal: 1500,
          remainingKcal: 700,
        },
        protein: { targetG: 144, consumedG: 80, remainingG: 64 },
        training: {
          due: true,
          completedToday: false,
          completedSessionsLast7Days: 1,
        },
        missingInputs: [],
        nextAction: "prioritise_protein",
      },
      createdAt: "2026-07-26T10:00:00.000Z",
    });
    expect(parsed.actionProposal?.kind).toBe("daily_plan");
  });

  it("accepts a bounded weekly adaptation proposal", () => {
    const parsed = coachMessageSchema.parse({
      id: "00000000-0000-4000-8000-000000000031",
      conversationId: "00000000-0000-4000-8000-000000000032",
      role: "assistant",
      text: "Weekly review.",
      status: "complete",
      provider: "mizyun-planner",
      evidenceKinds: ["plan", "nutrition", "training", "body"],
      actionProposal: {
        id: "00000000-0000-4000-8000-000000000033",
        kind: "weekly_adaptation",
        version: "v1-2026-07",
        goalId: "00000000-0000-4000-8000-000000000034",
        readiness: "ready",
        goalKind: "cut",
        currentPace: "gradual",
        proposedPace: "steady",
        calorieAction: "decrease",
        trainingVolumeAction: "hold",
        observations: {
          loggedNutritionDays: 6,
          averageCalorieAdherencePercent: 100,
          averageProteinAdherencePercent: 95,
          weeklyWeightChangeKg: -0.05,
          weeklyWeightChangePercent: -0.06,
        },
        reasons: ["Confirmed trend is below the conservative band."],
      },
      createdAt: "2026-07-26T10:00:00.000Z",
    });
    expect(parsed.actionProposal?.kind).toBe("weekly_adaptation");
  });

  it("accepts a structured workout edit proposal", () => {
    const parsed = coachMessageSchema.parse({
      id: "00000000-0000-4000-8000-000000000041",
      conversationId: "00000000-0000-4000-8000-000000000042",
      role: "assistant",
      text: "I adjusted your workout.",
      status: "complete",
      provider: "mizyun-planner",
      evidenceKinds: ["plan", "training"],
      actionProposal: {
        id: "00000000-0000-4000-8000-000000000043",
        kind: "workout_edit",
        workoutId: "00000000-0000-4000-8000-000000000044",
        targetName: "Full body (Updated)",
        notes: "Shoulder focus",
        exercises: [
          {
            catalogId: "incline-dumbbell-press",
            name: "Incline dumbbell press",
            movementPattern: "horizontal_push",
            equipment: ["dumbbells"],
            sets: 3,
            repsMin: 8,
            repsMax: 12,
            durationMinutes: null,
            restSeconds: 90,
            progression: "double_progression",
          },
        ],
        summary:
          "Replaced Barbell bench press with Incline dumbbell press at 3 sets.",
      },
      createdAt: "2026-07-26T10:00:00.000Z",
    });
    expect(parsed.actionProposal?.kind).toBe("workout_edit");
    if (parsed.actionProposal?.kind !== "workout_edit") {
      throw new Error("expected workout_edit proposal");
    }
    expect(parsed.actionProposal.workoutId).toBe(
      "00000000-0000-4000-8000-000000000044",
    );
    expect(parsed.actionProposal.exercises[0]?.name).toBe(
      "Incline dumbbell press",
    );
  });
});
