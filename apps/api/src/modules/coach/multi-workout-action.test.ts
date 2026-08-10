import { describe, expect, it } from "vitest";

import {
  defaultMultiWorkoutParams,
  extractMultiWorkoutParamsFromText,
  extractSessionDistribution,
  isMultiWorkoutProposalIntent,
} from "./multi-workout-action";

describe("isMultiWorkoutProposalIntent", () => {
  it("matches explicit N-day plan phrasing", () => {
    expect(
      isMultiWorkoutProposalIntent(
        "Help me create a 3 day gym plan to build a V-shape with each session about 2 hours long",
      ),
    ).toBe(true);
    expect(isMultiWorkoutProposalIntent("Build me a 5-day program")).toBe(true);
    expect(isMultiWorkoutProposalIntent("Make me a weekly split")).toBe(true);
  });

  it("matches split names and body-shape goals", () => {
    expect(isMultiWorkoutProposalIntent("Create a Push Pull Legs split")).toBe(
      true,
    );
    expect(isMultiWorkoutProposalIntent("Upper/lower program please")).toBe(
      true,
    );
    expect(isMultiWorkoutProposalIntent("I want a V-shape back")).toBe(true);
  });

  it("matches Slovak phrasing", () => {
    expect(
      isMultiWorkoutProposalIntent("Vytvor mi 3-dňový plán na chrbát"),
    ).toBe(true);
  });

  it("does NOT match single-workout or general coaching questions", () => {
    expect(isMultiWorkoutProposalIntent("Build me today's workout")).toBe(
      false,
    );
    expect(isMultiWorkoutProposalIntent("What should I train today?")).toBe(
      false,
    );
    expect(
      isMultiWorkoutProposalIntent("How many calories should I eat?"),
    ).toBe(false);
    expect(isMultiWorkoutProposalIntent("Hi")).toBe(false);
  });
});

describe("extractMultiWorkoutParamsFromText", () => {
  it("extracts session count, focus, and minutes from the canonical prompt", () => {
    const params = extractMultiWorkoutParamsFromText(
      "Help me create a 3 day gym plan to build a V-shape with each session about 2 hours long",
    );
    expect(params).not.toBeNull();
    expect(params?.requestedSessions).toBe(3);
    expect(params?.sessionMinutes).toBe(120);
    expect(params?.focus).toBe("general_hypertrophy");
    expect(params?.confidence).toBe("pattern");
  });

  it("extracts ppl focus and 4 days", () => {
    const params = extractMultiWorkoutParamsFromText(
      "Build me a 4 day Push Pull Legs split, 60 min sessions",
    );
    expect(params?.requestedSessions).toBe(4);
    expect(params?.sessionMinutes).toBe(60);
    expect(params?.focus).toBe("ppl");
  });

  it("extracts upper/lower focus and 90 min sessions", () => {
    const params = extractMultiWorkoutParamsFromText(
      "Create an upper/lower program, 4 days a week, 90 min each",
    );
    expect(params?.requestedSessions).toBe(4);
    expect(params?.sessionMinutes).toBe(90);
    expect(params?.focus).toBe("upper_lower");
  });

  it("falls back to a single-day plan with 60-min default when no count is given", () => {
    const params = extractMultiWorkoutParamsFromText(
      "Build me a V-shape weekly plan",
    );
    expect(params?.requestedSessions).toBe(3);
    expect(params?.sessionMinutes).toBe(60);
    expect(params?.focus).toBe("general_hypertrophy");
  });

  it("clamps out-of-range session counts to 1..7", () => {
    expect(
      extractMultiWorkoutParamsFromText("Create a 12 day plan")
        ?.requestedSessions,
    ).toBe(7);
    expect(
      extractMultiWorkoutParamsFromText("Create a 0 day plan")
        ?.requestedSessions,
    ).toBe(1);
  });

  it("clamps session minutes to the nearest preset", () => {
    expect(
      extractMultiWorkoutParamsFromText("3 day plan, each session 50 min")
        ?.sessionMinutes,
    ).toBe(60);
    expect(
      extractMultiWorkoutParamsFromText("3 day plan, each session 100 min")
        ?.sessionMinutes,
    ).toBe(105);
  });

  it("returns null for non-multi-workout text", () => {
    expect(extractMultiWorkoutParamsFromText("Hello there")).toBeNull();
    expect(extractMultiWorkoutParamsFromText("")).toBeNull();
  });
});

describe("defaultMultiWorkoutParams", () => {
  it("uses the profile defaults when both are present", () => {
    const params = defaultMultiWorkoutParams({
      trainingDaysPerWeek: 5,
      sessionDurationMinutes: 75,
    });
    expect(params.requestedSessions).toBe(5);
    expect(params.sessionMinutes).toBe(75);
    expect(params.focus).toBe("unknown");
    expect(params.sessionDistribution).toBeNull();
    expect(params.confidence).toBe("default");
  });

  it("falls back to 3 days and 60 minutes when the profile is incomplete", () => {
    const params = defaultMultiWorkoutParams({
      trainingDaysPerWeek: null,
      sessionDurationMinutes: null,
    });
    expect(params.requestedSessions).toBe(3);
    expect(params.sessionMinutes).toBe(60);
  });
});

describe("extractSessionDistribution", () => {
  it("extracts digit-form 2 upper / 1 lower for a 3-day V-shape plan", () => {
    const distribution = extractSessionDistribution(
      "Help me create a 3 day workout for hitting a V shape, I want two upper body and one lower body days",
      3,
    );
    expect(distribution).toEqual(["upper", "upper", "lower"]);
  });

  it("extracts digit-form 1 upper / 1 lower for a 2-day split", () => {
    const distribution = extractSessionDistribution(
      "Build me a 2 day plan with 1 upper body and 1 lower body day",
      2,
    );
    expect(distribution).toEqual(["upper", "lower"]);
  });

  it("returns null when the upper/lower counts do not sum to the requested sessions", () => {
    // user asks for 2 upper / 1 lower in a 4-day plan; engine
    // should not silently invent a third distribution entry.
    const distribution = extractSessionDistribution(
      "4 day plan, 2 upper body and 1 lower body",
      4,
    );
    expect(distribution).toBeNull();
  });

  it("returns null when only one of upper/lower is mentioned", () => {
    expect(
      extractSessionDistribution("3 day plan, all upper body", 3),
    ).toBeNull();
  });

  it("returns null when neither is mentioned", () => {
    expect(extractSessionDistribution("3 day PPL plan", 3)).toBeNull();
  });
});

describe("extractMultiWorkoutParamsFromText — session distribution wiring", () => {
  it("populates sessionDistribution when the user spells out upper/lower counts", () => {
    const params = extractMultiWorkoutParamsFromText(
      "Help me create a 3 day workout for hitting a V shape, I want two upper body and one lower body days",
    );
    expect(params).not.toBeNull();
    expect(params?.sessionDistribution).toEqual(["upper", "upper", "lower"]);
  });

  it("leaves sessionDistribution null when the user does not split upper/lower", () => {
    const params = extractMultiWorkoutParamsFromText(
      "Build me a 3-day PPL plan",
    );
    expect(params?.sessionDistribution).toBeNull();
  });
});
