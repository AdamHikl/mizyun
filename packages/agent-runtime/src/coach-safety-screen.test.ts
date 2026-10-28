import { describe, expect, it } from "vitest";

import {
  COACH_SAFETY_ADVISORY,
  COACH_SAFETY_RESPONSES,
  normalizeSafetyText,
  screenCoachInput,
  screenCoachPhotoAdvice,
} from "./index.js";
import {
  COACH_SAFETY_SCREEN_CORPUS_VERSION,
  coachSafetyMustAllowCases,
  coachSafetyMustBlockCases,
} from "./coach-safety-screen-corpus.js";

const stripDiacritics = (text: string): string =>
  text.normalize("NFD").replace(/\p{M}+/gu, "");

describe("coach safety screen corpus (AI-01, L10N-01)", () => {
  it("is versioned and large enough to guard misses and false blocks", () => {
    expect(COACH_SAFETY_SCREEN_CORPUS_VERSION).toBe(
      "coach-safety-screen-v1-2026-10-27",
    );
    expect(coachSafetyMustBlockCases.length).toBeGreaterThanOrEqual(50);
    expect(coachSafetyMustAllowCases.length).toBeGreaterThanOrEqual(50);
    const ids = [
      ...coachSafetyMustBlockCases,
      ...coachSafetyMustAllowCases,
    ].map((testCase) => testCase.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(coachSafetyMustBlockCases.map((c) => [c.id, c] as const))(
    "blocks %s",
    (_id, testCase) => {
      expect(screenCoachInput(testCase.input)).toMatchObject({
        allowed: false,
        category: testCase.expectedCategory,
      });
    },
  );

  it.each(
    coachSafetyMustBlockCases
      .filter((c) => c.locale !== "en" && stripDiacritics(c.input) !== c.input)
      .map((c) => [c.id, c] as const),
  )("blocks %s without diacritics", (_id, testCase) => {
    expect(screenCoachInput(stripDiacritics(testCase.input))).toMatchObject({
      allowed: false,
      category: testCase.expectedCategory,
    });
  });

  it.each(coachSafetyMustAllowCases.map((c) => [c.id, c] as const))(
    "allows %s",
    (_id, testCase) => {
      expect(screenCoachInput(testCase.input).allowed).toBe(true);
    },
  );
});

describe("coach safety screen behaviour", () => {
  it("folds case, diacritics, apostrophes and invisible characters", () => {
    expect(normalizeSafetyText("  Chcem  SPÁCHAŤ­samo​vraždu ")).toBe(
      "chcem spachatsamovrazdu",
    );
    expect(normalizeSafetyText("I can’t")).toBe("i can't");
  });

  it("names 112 in the English crisis and emergency replies", () => {
    expect(COACH_SAFETY_RESPONSES.self_harm).toContain("112");
    expect(COACH_SAFETY_RESPONSES.emergency).toContain("112");
    expect(screenCoachInput("Chcem spáchať samovraždu")).toMatchObject({
      allowed: false,
      category: "self_harm",
      response: COACH_SAFETY_RESPONSES.self_harm,
    });
  });

  it.each([
    "My knee hurts when I squat, what can I change?",
    "I'm on blood pressure medication, is HIIT ok?",
    "I can't breathe properly during heavy squats, is my bracing wrong?",
    "Bolí ma koleno po behu, čo mám zmeniť?",
  ])("answers %s with a see-a-professional advisory", (text) => {
    expect(screenCoachInput(text)).toEqual({
      allowed: true,
      advisory: COACH_SAFETY_ADVISORY,
    });
  });

  it.each([
    "Should I take a rest day tomorrow?",
    "should I take creatine",
    "How do I treat my sore muscles",
  ])("answers %s without any safety note", (text) => {
    expect(screenCoachInput(text)).toEqual({ allowed: true });
  });

  it.each([
    ["lose 3 kg in 2 weeks", true],
    ["lose 5 kg in two weeks", false],
    ["lose 10 lb in a month", true],
    ["lose 20 lbs in a month", false],
    ["schudnúť 4 kg za mesiac", true],
    ["schudnúť 5 kg za týždeň", false],
  ])("applies the weekly-loss threshold to %s", (text, allowed) => {
    expect(screenCoachInput(text).allowed).toBe(allowed);
  });

  it.each([
    ["a 36 hour fast", true],
    ["a 72 hour fast", false],
    ["fast for 1 day", true],
    ["fast for 2 days", false],
    ["I eat 1200 calories a day", true],
    ["I eat 900 calories a day", false],
    ["I burn 500 calories a day walking", true],
    ["a snack under 200 calories for my diet", true],
    ["a diet under 800 calories", false],
  ])("applies intake and fasting thresholds to %s", (text, allowed) => {
    expect(screenCoachInput(text).allowed).toBe(allowed);
  });
});

describe("coach safety output screen", () => {
  it.each([
    "Great meal. If you ever feel chest pain or faint during training, stop and seek medical help.",
    "Avoid training through pain.",
    "Fasting for 3 days is not recommended.",
    "Losing 5 kg in 2 weeks is unrealistic; aim for 0.5 kg a week.",
    "A very low intake like 800 kcal a day is not recommended.",
    "Laxatives are not a safe way to lose weight.",
    "If you notice shortness of breath, contact a doctor.",
    "Log your distance in kms or miles.",
    "Don't fast for 5 days; eat regular meals instead.",
  ])("keeps cautionary advice: %s", (text) => {
    expect(screenCoachPhotoAdvice(text).allowed).toBe(true);
  });

  it.each([
    ["Try eating 600 calories a day to cut faster.", "dangerous_target"],
    ["Fast for 5 days to reset your metabolism.", "dangerous_target"],
    ["Use laxatives to drop the last kilo.", "eating_disorder"],
    ["You might want to kill yourself after this meal.", "self_harm"],
    ["Eat 700 kcal a day, not more.", "dangerous_target"],
    [
      "Try a 72 hour water fast instead of daily restriction.",
      "dangerous_target",
    ],
    [
      "Do a 5 day water fast, and don't forget electrolytes.",
      "dangerous_target",
    ],
    ["Stop eating for 3 days to drop water weight.", "dangerous_target"],
    [
      "Lose 10 kg in 2 weeks by cutting carbs instead of fat.",
      "dangerous_target",
    ],
    [
      "You can purge after meals if you feel bloated, it's not a big deal.",
      "eating_disorder",
    ],
    ["Keep training through the pain, you're not injured.", "dangerous_target"],
    [
      "Day 1: fast 72 hours\nDay 2: never skip electrolytes",
      "dangerous_target",
    ],
    ["Never eat more than 800 calories a day.", "dangerous_target"],
    [
      "Avoid eating more than 600 kcal a day while cutting.",
      "dangerous_target",
    ],
    ["Do not eat anything for 72 hours.", "dangerous_target"],
    ["Don't eat for the next 3 days.", "dangerous_target"],
    ["Don't hesitate to fast for 5 days.", "dangerous_target"],
    [
      "Skipping breakfast is risky, so eat 600 kcal a day instead.",
      "dangerous_target",
    ],
    [
      "Water fasting is dangerous for most people, but you can fast for 5 days.",
      "dangerous_target",
    ],
    ["Instead of 2000 kcal, eat 700 kcal a day.", "dangerous_target"],
  ])("blocks harmful advice: %s", (text, category) => {
    expect(screenCoachPhotoAdvice(text)).toMatchObject({
      allowed: false,
      category,
    });
  });
});

describe("coach safety screen cost", () => {
  it("screens a 20,000-character message quickly", () => {
    const longText = "under 500 kcal ".repeat(1400).slice(0, 20_000);
    const started = performance.now();
    screenCoachInput(longText);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
