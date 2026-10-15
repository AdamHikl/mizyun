import { describe, expect, it } from "vitest";
import type { EnergySummary } from "@mizyun/contracts";

import {
  energyPlanNotes,
  formatIsoDateForDisplay,
  hasEnergyPlanNotes,
} from "./energy-plan-notes";

const base = { complete: true } as unknown as EnergySummary;
const withFields = (extra: Record<string, unknown>): EnergySummary =>
  ({ ...base, ...extra }) as EnergySummary;

describe("energyPlanNotes", () => {
  it("renders nothing for an old summary without the new fields", () => {
    const notes = energyPlanNotes(base, "metric");
    expect(hasEnergyPlanNotes(notes)).toBe(false);
    expect(hasEnergyPlanNotes(energyPlanNotes(null, "metric"))).toBe(false);
  });

  it("describes mode, weekly change, projection and source", () => {
    const notes = energyPlanNotes(
      withFields({
        goalMode: { label: "Lean bulk" },
        targetWeeklyChangeKg: 0.14,
        weightSource: "trend",
        projection: {
          projectedWeeksToTarget: 20,
          projectedDate: "2027-03-12",
          targetDateRealistic: true,
        },
      }),
      "metric",
    );
    expect(notes.mode).toBe("Lean bulk · planned +0.14 kg/week");
    expect(notes.weightSource).toBe("Based on your weight trend.");
    expect(notes.projection).toContain("12 Mar 2027");
    expect(notes.unrealisticDate).toBeNull();
  });

  it("warns when the target date is earlier than the safe pace", () => {
    const notes = energyPlanNotes(
      withFields({
        projection: {
          projectedWeeksToTarget: 30,
          projectedDate: "2027-05-01",
          targetDateRealistic: false,
        },
      }),
      "metric",
    );
    expect(notes.unrealisticDate).toBe(
      "Your target date is earlier than this mode's safe pace; expected around 1 May 2027.",
    );
    expect(notes.projection).toBeNull();
  });

  it("shows calibration only when non-zero, with a real minus sign", () => {
    expect(
      energyPlanNotes(withFields({ calibrationKcal: 0 }), "metric").calibration,
    ).toBeNull();
    expect(
      energyPlanNotes(withFields({ calibrationKcal: -150 }), "metric")
        .calibration,
    ).toBe("Includes −150 kcal from weekly reviews.");
    expect(
      energyPlanNotes(withFields({ calibrationKcal: 100 }), "metric")
        .calibration,
    ).toBe("Includes +100 kcal from weekly reviews.");
  });

  it("shows adaptive maintenance only when ready", () => {
    const ready = {
      status: "ready",
      reason: null,
      maintenanceKcal: 2615,
      averageIntakeKcal: 2500,
      loggedDays: 20,
      windowDays: 28,
      weeklyChangeKg: 0.1,
    };
    expect(
      energyPlanNotes(withFields({ adaptiveMaintenance: ready }), "metric")
        .adaptiveMaintenance,
    ).toBe("Estimated from your logs: 2,615 kcal maintenance.");
    expect(
      energyPlanNotes(
        withFields({
          adaptiveMaintenance: {
            ...ready,
            status: "insufficient",
            maintenanceKcal: null,
          },
        }),
        "metric",
      ).adaptiveMaintenance,
    ).toBeNull();
  });

  it("uses pounds for imperial users", () => {
    const notes = energyPlanNotes(
      withFields({
        goalMode: { label: "Standard cut" },
        targetWeeklyChangeKg: -0.5,
      }),
      "imperial",
    );
    expect(notes.mode).toBe("Standard cut · planned −1.1 lb/week");
  });

  it("formats dates and passes through invalid ones", () => {
    expect(formatIsoDateForDisplay("2027-03-12")).toBe("12 Mar 2027");
    expect(formatIsoDateForDisplay("soon")).toBe("soon");
  });
});
