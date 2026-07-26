import { describe, expect, it } from "vitest";
import { buildWeeklyAdaptation } from "./weekly-adaptation";
import { summariseWeightTrend } from "./body-measurement";

const days = Array.from({ length: 6 }, (_, index) => ({
  date: `2026-07-${String(19 + index).padStart(2, "0")}`,
  entryCount: 3,
  caloriesKcal: 2_000,
  proteinG: 150,
  carbohydrateG: 200,
  fatG: 60,
}));

describe("buildWeeklyAdaptation", () => {
  it("proposes one pace step only with adequate adherence and trend", () => {
    const result = buildWeeklyAdaptation({
      goalKind: "cut",
      currentPace: "gradual",
      targetKcal: 2_000,
      targetProteinG: 150,
      nutritionDays: days,
      weightTrend: summariseWeightTrend([
        { measuredAt: new Date("2026-07-12"), weightKg: 80 },
        { measuredAt: new Date("2026-07-19"), weightKg: 79.95 },
        { measuredAt: new Date("2026-07-26"), weightKg: 79.9 },
      ]),
      trainingVolumeAction: "hold",
      now: new Date("2026-07-26"),
    });
    expect(result).toMatchObject({
      readiness: "ready",
      calorieAction: "decrease",
      currentPace: "gradual",
      proposedPace: "steady",
    });
  });

  it("holds when evidence is insufficient", () => {
    const result = buildWeeklyAdaptation({
      goalKind: "bulk",
      currentPace: "gradual",
      targetKcal: 2_500,
      targetProteinG: 150,
      nutritionDays: days.slice(0, 2),
      weightTrend: summariseWeightTrend([]),
      trainingVolumeAction: "build",
      now: new Date("2026-07-26"),
    });
    expect(result).toMatchObject({
      readiness: "insufficient_data",
      calorieAction: "hold",
      proposedPace: "gradual",
    });
  });
});
