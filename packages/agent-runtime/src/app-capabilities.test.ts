import { describe, expect, it } from "vitest";
import {
  isRecurringMealHelp,
  isRecurringMealRequest,
  COACH_APP_GUIDE,
  recurringMealHelp,
} from "./app-capabilities.js";

describe("recurring-meal setup intent", () => {
  it("qualifies new controls and preserves older Account navigation", () => {
    expect(COACH_APP_GUIDE).toContain("build 7");
    expect(COACH_APP_GUIDE).toContain("Account bottom tab");
    expect(recurringMealHelp()).toContain("If Repeat is missing");
    expect(recurringMealHelp()).toContain("manually");
  });
  it.each([
    "Log a recurring breakfast with 30 g protein",
    "Log two eggs every morning and create a full body workout",
    "Please log my recurring meal with my allergy restrictions",
  ])("excludes detailed schedule commands from one-off drafts: %s", (text) => {
    expect(isRecurringMealRequest(text)).toBe(true);
    expect(isRecurringMealHelp(text)).toBe(false);
  });
  it.each([
    "How can I make an automated logging of meals so that when I eat something every breakfast, it is just there instead of me having to log it each day.",
    "How do recurring meals work?",
    "Where can I repeat a meal?",
    "Does Mizyun have recurring meals?",
    "Can I automatically log my breakfast?",
    "Please log two eggs every morning",
    "Add a recurring meal for breakfast",
    "Log my breakfast automatically every day",
  ])("recognizes setup help: %s", (text) => {
    expect(isRecurringMealHelp(text)).toBe(true);
  });

  it.each([
    "Can you show me the breakfast I logged every day this week?",
    "Does the photo meal feature automatically save the food?",
    "Log two eggs every morning and create a full body workout",
    "Log a recurring breakfast with 30 g protein",
    "Can I have the same breakfast every day?",
    "How can I repeat a meal and change the app theme?",
    "Can I repeat a breakfast and export my data?",
    "Please log eggs and toast every morning",
    "I ate two eggs every morning",
    "Please log 180 g chicken and rice",
    "How many calories are in my recurring breakfast?",
    "Should I eat eggs every day?",
    "How can I make my daily breakfast healthier?",
    "Can you recommend breakfast every day with my peanut allergy?",
    "How can I automatically log workouts?",
    "What did I eat every day last week?",
    "How do I turn on breakfast reminders?",
  ])(
    "leaves personal records/advice/other features with grounded Coach: %s",
    (text) => {
      expect(isRecurringMealHelp(text)).toBe(false);
    },
  );
});
