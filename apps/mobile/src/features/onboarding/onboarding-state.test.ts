import { describe, expect, it } from "vitest";

import {
  applyOnboardingPatch,
  freshOnboardingForm,
  nextStep,
  ONBOARDING_STEPS,
  previousStep,
  stepIndex,
  validatePrimaryGoal,
  validateDisplayName,
  validateStep,
  type OnboardingForm,
} from "./onboarding-state";

const NOW = new Date("2026-07-17T00:00:00Z");
const fresh = (): OnboardingForm => freshOnboardingForm(NOW);

describe("freshOnboardingForm", () => {
  it("defaults the unit system to metric", () => {
    expect(fresh().unitSystem).toBe("metric");
  });

  it("defaults the start date to today (UTC)", () => {
    expect(fresh().goalStartDate).toBe("2026-07-17");
  });

  it("defaults the target date 90 days from today", () => {
    expect(fresh().goalTargetDate).toBe("2026-10-15");
  });

  it("starts with an empty display name", () => {
    expect(fresh().displayName).toBe("");
  });
});

describe("validateDisplayName", () => {
  it("rejects a blank display name", () => {
    expect(validateDisplayName({ ...fresh(), displayName: "   " })).toMatch(
      /blank/i,
    );
  });

  it("rejects an over-long display name", () => {
    const long = "a".repeat(81);
    expect(validateDisplayName({ ...fresh(), displayName: long })).toMatch(
      /80 characters/,
    );
  });

  it("accepts a normal display name", () => {
    expect(validateDisplayName({ ...fresh(), displayName: "Adam" })).toBeNull();
  });
});

describe("validatePrimaryGoal", () => {
  it("rejects a missing goal kind", () => {
    expect(validatePrimaryGoal(fresh())).toMatch(/goal kind/i);
  });

  it("rejects a missing goal weight", () => {
    const form: OnboardingForm = {
      ...fresh(),
      goalKind: "cut",
      goalWeightKg: null,
    };
    expect(validatePrimaryGoal(form)).toMatch(/goal weight/i);
  });

  it("rejects an out-of-range weight", () => {
    expect(
      validatePrimaryGoal({ ...fresh(), goalKind: "cut", goalWeightKg: 5 }),
    ).toMatch(/30 and 250/);
    expect(
      validatePrimaryGoal({
        ...fresh(),
        goalKind: "cut",
        goalWeightKg: 500,
      }),
    ).toMatch(/30 and 250/);
  });

  it("accepts a valid cut/recomp/maintain with a weight", () => {
    for (const kind of ["cut", "recomp", "maintain"] as const) {
      expect(
        validatePrimaryGoal({
          ...fresh(),
          goalKind: kind,
          goalWeightKg: 75,
        }),
      ).toBeNull();
    }
  });
});

describe("validateStep", () => {
  it("routes welcome and units to no-op validators", () => {
    expect(validateStep("welcome", fresh())).toBeNull();
    expect(validateStep("units", fresh())).toBeNull();
  });

  it("routes displayName and primaryGoal to their dedicated validators", () => {
    expect(validateStep("displayName", fresh())).toMatch(/blank/i);
    expect(validateStep("primaryGoal", fresh())).toMatch(/goal kind/i);
  });
});

describe("ONBOARDING_STEPS ordering", () => {
  it("exposes the four steps in the documented order", () => {
    expect(ONBOARDING_STEPS).toEqual([
      "welcome",
      "displayName",
      "units",
      "primaryGoal",
    ]);
  });

  it("returns the index of each step", () => {
    expect(stepIndex("welcome")).toBe(0);
    expect(stepIndex("displayName")).toBe(1);
    expect(stepIndex("units")).toBe(2);
    expect(stepIndex("primaryGoal")).toBe(3);
  });

  it("advances to the next step", () => {
    expect(nextStep("welcome")).toBe("displayName");
    expect(nextStep("displayName")).toBe("units");
    expect(nextStep("units")).toBe("primaryGoal");
    expect(nextStep("primaryGoal")).toBeNull();
  });

  it("rolls back to the previous step", () => {
    expect(previousStep("welcome")).toBeNull();
    expect(previousStep("displayName")).toBe("welcome");
    expect(previousStep("units")).toBe("displayName");
    expect(previousStep("primaryGoal")).toBe("units");
  });
});

describe("applyOnboardingPatch", () => {
  it("updates the display name", () => {
    const next = applyOnboardingPatch(fresh(), {
      field: "displayName",
      value: "Adam",
    });
    expect(next.displayName).toBe("Adam");
  });

  it("updates the unit system", () => {
    const next = applyOnboardingPatch(fresh(), {
      field: "unitSystem",
      value: "imperial",
    });
    expect(next.unitSystem).toBe("imperial");
  });

  it("updates the goal kind, including null", () => {
    const set = applyOnboardingPatch(fresh(), {
      field: "goalKind",
      value: "cut",
    });
    expect(set.goalKind).toBe("cut");
    const cleared = applyOnboardingPatch(set, {
      field: "goalKind",
      value: null,
    });
    expect(cleared.goalKind).toBeNull();
  });

  it("updates the goal weight, including null", () => {
    const set = applyOnboardingPatch(fresh(), {
      field: "goalWeightKg",
      value: 78,
    });
    expect(set.goalWeightKg).toBe(78);
    const cleared = applyOnboardingPatch(set, {
      field: "goalWeightKg",
      value: null,
    });
    expect(cleared.goalWeightKg).toBeNull();
  });

  it("updates the dates", () => {
    const next = applyOnboardingPatch(fresh(), {
      field: "goalStartDate",
      value: "2026-08-01",
    });
    expect(next.goalStartDate).toBe("2026-08-01");
    const next2 = applyOnboardingPatch(next, {
      field: "goalTargetDate",
      value: "2026-12-01",
    });
    expect(next2.goalTargetDate).toBe("2026-12-01");
  });

  it("returns a new object (immutability)", () => {
    const before = fresh();
    const after = applyOnboardingPatch(before, {
      field: "displayName",
      value: "Adam",
    });
    expect(after).not.toBe(before);
    expect(before.displayName).toBe("");
  });
});
