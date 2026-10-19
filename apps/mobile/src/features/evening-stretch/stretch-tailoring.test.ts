import { describe, expect, it } from "vitest";
import { buildEveningStretchSession } from "@mizyun/core";

import {
  applyTailoredPlan,
  shouldTailorStretch,
  type LoadedStretch,
} from "./stretch-tailoring";

const allowed = {
  variantEnabled: true,
  consentGranted: true,
  confirmedAdult: true,
  userId: "00000000-0000-4000-8000-000000000001",
  trained: true,
} as const;

describe("shouldTailorStretch", () => {
  it("tailors only Dev builds for consented adults after training", () => {
    expect(shouldTailorStretch(allowed)).toBe(true);
  });

  it.each([
    ["a Production build", { variantEnabled: false }],
    ["no AI consent (nobody is prompted)", { consentGranted: false }],
    ["no adult confirmation", { confirmedAdult: false }],
    ["signed out", { userId: null }],
    ["a rest day", { trained: false }],
    ["unknown training", { trained: null }],
  ])("does not tailor for %s", (_label, change) => {
    expect(shouldTailorStretch({ ...allowed, ...change })).toBe(false);
  });
});

describe("applyTailoredPlan", () => {
  const deterministic = buildEveningStretchSession({
    exercises: [{ name: "Chest Dips", setCount: 3 }],
    activities: [],
  });
  const tailored = buildEveningStretchSession({
    exercises: [{ name: "Lat Pulldown", setCount: 3 }],
    activities: [],
  });
  const ready: LoadedStretch = {
    status: "ready",
    plan: deterministic,
    fallback: false,
    tailored: false,
  };

  it("swaps the list before the session starts", () => {
    expect(applyTailoredPlan("overview", ready, tailored)).toEqual({
      ...ready,
      plan: tailored,
      tailored: true,
    });
  });

  it("never swaps once stretching started or finished", () => {
    expect(applyTailoredPlan("holding", ready, tailored)).toBe(ready);
    expect(applyTailoredPlan("done", ready, tailored)).toBe(ready);
  });

  it("keeps the deterministic plan without a tailored one", () => {
    expect(applyTailoredPlan("overview", ready, null)).toBe(ready);
    const loading: LoadedStretch = { status: "loading" };
    expect(applyTailoredPlan("overview", loading, tailored)).toBe(loading);
  });
});
