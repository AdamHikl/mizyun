import { describe, expect, it } from "vitest";

import { cleanAssistantProposalText, coachMessageSchema } from "./coach";

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

describe("cleanAssistantProposalText", () => {
  it("passes through raw text untouched when no proposal is attached", () => {
    const raw =
      "Here are three tips for protein intake:\n1. Eggs\n2. Chicken\n3. Greek yogurt";
    expect(cleanAssistantProposalText(raw, null)).toBe(raw);
    expect(cleanAssistantProposalText(raw, undefined)).toBe(raw);
  });

  it("trims markdown dividers, headers, and exercise lists when multi_workout_plan is attached", () => {
    const raw = `Here's your **3-day hypertrophy-focused split** (2 upper, 1 lower) using **dumbbells, barbells, and cables** to emphasize a **V-shape** (prioritizing lats, delts, and upper back). Each session is ~150 minutes with controlled tempo and rest.

---

### Day 1: Upper Body (Back & Shoulders focus)
* Barbell Bent-Over Row: 4 sets x 8-10 reps (Rest: 2-3 mins)
* Dumbbell Incline Bench Press: 4 sets x 8-10 reps (Rest: 2 mins)
* Lat Pulldowns: 4 sets x 10-12 reps

### Day 2: Lower Body
* Barbell Squat: 4 sets x 6-8 reps`;

    const proposal: import("./coach").CoachMultiWorkoutPlanProposal = {
      id: "00000000-0000-4000-8000-000000000001",
      kind: "multi_workout_plan",
      prescriptionVersion: "v1",
      volumeAction: "build",
      focus: "hypertrophy",
      requestedSessions: 3,
      sessionMinutes: 150,
      rationale: "Hypertrophy split",
      sessions: [
        {
          index: 1,
          label: "Upper body",
          estimatedMinutes: 150,
          focus: "upper",
          targetDay: "2026-08-25",
          exercises: [
            {
              catalogId: "barbell-row",
              name: "Barbell row",
              movementPattern: "horizontal_pull",
              equipment: ["barbell"],
              sets: 4,
              repsMin: 8,
              repsMax: 10,
              durationMinutes: null,
              restSeconds: 120,
              progression: "double_progression",
            },
          ],
        },
      ],
      startDay: "2026-08-25",
      endDay: "2026-08-31",
    };

    const cleaned = cleanAssistantProposalText(raw, proposal);
    expect(cleaned).toBe(
      "Here's your **3-day hypertrophy-focused split** (2 upper, 1 lower) using **dumbbells, barbells, and cables** to emphasize a **V-shape** (prioritizing lats, delts, and upper back). Each session is ~150 minutes with controlled tempo and rest.",
    );
    expect(cleaned).not.toContain("---");
    expect(cleaned).not.toContain("Barbell Bent-Over Row");
    expect(cleaned).not.toContain("Day 1");
  });

  it("replaces a trailing colon with a period when trimming lists", () => {
    const raw = `Here is your customized workout routine:
1. Incline Dumbbell Press: 3 sets
2. Cable Lateral Raise: 4 sets`;

    const proposal: import("./coach").CoachWorkoutProposal = {
      id: "00000000-0000-4000-8000-000000000002",
      kind: "workout_start",
      prescriptionVersion: "v1",
      volumeAction: "hold",
      session: {
        index: 1,
        label: "Upper body",
        estimatedMinutes: 60,
        exercises: [],
      },
    };

    const cleaned = cleanAssistantProposalText(raw, proposal);
    expect(cleaned).toBe("Here is your customized workout routine.");
  });

  it("returns a proposal-specific fallback when the raw text begins immediately with a list or is empty", () => {
    const raw = `### 3-Day Workout Split
* Push-ups: 3x10
* Squats: 3x10`;

    const proposal: import("./coach").CoachMultiWorkoutPlanProposal = {
      id: "00000000-0000-4000-8000-000000000003",
      kind: "multi_workout_plan",
      prescriptionVersion: "v1",
      volumeAction: "build",
      focus: null,
      requestedSessions: 3,
      sessionMinutes: 60,
      rationale: "Plan",
      sessions: [
        {
          index: 1,
          label: "Session 1",
          estimatedMinutes: 60,
          focus: null,
          targetDay: "2026-08-25",
          exercises: [],
        },
        {
          index: 2,
          label: "Session 2",
          estimatedMinutes: 60,
          focus: null,
          targetDay: "2026-08-27",
          exercises: [],
        },
        {
          index: 3,
          label: "Session 3",
          estimatedMinutes: 60,
          focus: null,
          targetDay: "2026-08-29",
          exercises: [],
        },
      ],
      startDay: "2026-08-25",
      endDay: "2026-08-31",
    };

    expect(cleanAssistantProposalText(raw, proposal)).toBe(
      "Here is your 3-session plan. Review and save your sessions below.",
    );
    expect(cleanAssistantProposalText("", proposal)).toBe(
      "Here is your 3-session plan. Review and save your sessions below.",
    );
    expect(cleanAssistantProposalText(null, proposal)).toBe(
      "Here is your 3-session plan. Review and save your sessions below.",
    );
  });

  it("returns fallback text for workout_start, daily_plan, meal_log, and workout_edit", () => {
    expect(
      cleanAssistantProposalText("", {
        id: "00000000-0000-4000-8000-000000000004",
        kind: "workout_start",
        prescriptionVersion: "v1",
        volumeAction: "hold",
        session: {
          index: 1,
          label: "Full body",
          estimatedMinutes: 45,
          exercises: [],
        },
      }),
    ).toBe("Here is your planned Full body workout. Review and start below.");

    expect(
      cleanAssistantProposalText("", {
        id: "00000000-0000-4000-8000-000000000005",
        kind: "daily_plan",
        version: "v1",
        date: "2026-08-25",
        calorie: null,
        protein: null,
        training: null,
        missingInputs: [],
        nextAction: "train",
      }),
    ).toBe(
      "Here is your daily action plan. Review your targets and next action below.",
    );

    expect(
      cleanAssistantProposalText("", {
        id: "00000000-0000-4000-8000-000000000006",
        kind: "meal_log",
        candidate: {} as unknown as import("./food-entry").FoodDraftCandidate,
      }),
    ).toBe(
      "I drafted that meal from your description. Review the portion, calories, and macros before logging it.",
    );

    expect(
      cleanAssistantProposalText("", {
        id: "00000000-0000-4000-8000-000000000007",
        kind: "workout_edit",
        workoutId: "00000000-0000-4000-8000-000000000008",
        targetName: "Session",
        exercises: [],
        summary: "Updated exercises",
      }),
    ).toBe(
      "I updated the workout with your requested changes. Review the edits below.",
    );
  });
});
