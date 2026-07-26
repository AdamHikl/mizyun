import { describe, expect, it } from "vitest";

import { isExplicitWorkoutProposalIntent } from "./workout-action.js";

describe("isExplicitWorkoutProposalIntent", () => {
  it.each([
    "Build today's workout",
    "Create my workout",
    "What should I train today?",
    "Zostav mi dnešný tréning",
    "Čo mám dnes cvičiť?",
  ])("recognizes a workout proposal request: %s", (text) => {
    expect(isExplicitWorkoutProposalIntent(text)).toBe(true);
  });

  it.each([
    "How was my workout yesterday?",
    "Am I progressing on squats?",
    "Explain my training volume",
  ])("leaves retrospective questions with the grounded Coach: %s", (text) => {
    expect(isExplicitWorkoutProposalIntent(text)).toBe(false);
  });
});
