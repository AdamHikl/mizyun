import { describe, expect, it } from "vitest";

import {
  COACH_APP_CAPABILITIES,
  COACH_APP_GUIDE,
  COACH_APP_GUIDE_PREAMBLE,
  COACH_APP_INDEX,
  COACH_FIXED_POLICY,
  COACH_SYSTEM_POLICY,
  buildCoachSystemPolicy,
  selectCoachAppCapabilities,
} from "./index.js";

/** Size of the pre-selection policy (fixed rules + every catalog entry). */
const PREVIOUS_FULL_POLICY_CHARS = 23_787;

const idsFor = (...texts: string[]): readonly string[] =>
  selectCoachAppCapabilities(texts).map(({ id }) => id);

const ask = (text: string, previous?: string) =>
  buildCoachSystemPolicy([
    ...(previous === undefined
      ? []
      : [
          { role: "user" as const, text: previous },
          { role: "assistant" as const, text: "Sure." },
        ]),
    { role: "user", text },
  ]);

describe("per-question Coach catalog selection", () => {
  it.each([
    ["How do I set up recurring meals?", "recurring-meals"],
    ["Can my breakfast be logged automatically every day?", "recurring-meals"],
    ["How do I join a challenge in Community?", "community"],
    ["Can I follow my friends and share a workout?", "community"],
    ["Can I scan a barcode or nutrition label?", "meals"],
    ["How do I log a meal from a photo?", "meals"],
    ["How do I import my runs from Apple Health?", "running"],
    ["Can I bring my Hevy history over?", "import-history"],
    ["Where can I see my AI usage in settings?", "account-settings"],
    ["How do I switch to dark mode?", "account-settings"],
    ["Make me a 4 day upper/lower workout plan", "workouts"],
    ["Can I log a swim?", "timed-activities"],
    ["Where is the evening stretch reminder?", "evening-stretch"],
    ["How do bouldering grades work?", "bouldering"],
    ["How do I record my waist measurement?", "body-progress"],
    ["What can I cook with what is in my fridge?", "meal-recipes"],
    ["How do I report a bug?", "feedback"],
    ["I forgot my password", "sign-in"],
    ["Ako si nastavím jazyk?", "account-settings"],
  ])("selects the relevant entry: %s", (text, id) => {
    expect(idsFor(text)).toContain(id);
  });

  it("does not over-select on word fragments", () => {
    expect(idsFor("It's important to stay hydrated, right?")).toEqual([]);
    expect(idsFor("How much protein do I need?")).not.toContain(
      "account-settings",
    );
    expect(idsFor("How do I set up recurring meals?")).not.toContain(
      "workouts",
    );
  });

  it("returns nothing for unrelated wellness questions and empty input", () => {
    expect(idsFor("Is creatine safe to take daily?")).toEqual([]);
    expect(idsFor("Can I track my sleep?")).toEqual([]);
    expect(idsFor("", "   ")).toEqual([]);
  });

  it("uses the full catalog only for whole-app overview questions", () => {
    expect(idsFor("What can the app do?")).toHaveLength(
      COACH_APP_CAPABILITIES.length,
    );
    expect(idsFor("What features does Mizyun have?")).toHaveLength(
      COACH_APP_CAPABILITIES.length,
    );
  });

  it("keeps the previous user message for follow-ups", () => {
    const policy = ask("And can I pause it?", "How do recurring meals work?");
    expect(policy.capabilityIds).toContain("recurring-meals");
    // Only the last two user messages count.
    const older = buildCoachSystemPolicy([
      { role: "user", text: "Tell me about bouldering" },
      { role: "user", text: "Thanks" },
      { role: "user", text: "Is creatine safe?" },
    ]);
    expect(older.capabilityIds).toEqual([]);
  });

  it("keeps every catalog id unique and indexed", () => {
    const ids = COACH_APP_CAPABILITIES.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const capability of COACH_APP_CAPABILITIES) {
      expect(capability.keywords.length).toBeGreaterThan(0);
      expect(COACH_APP_INDEX).toContain(`[${capability.id}]`);
      expect(COACH_APP_GUIDE).toContain(capability.guidance);
    }
  });
});

describe("buildCoachSystemPolicy", () => {
  it("always starts with the constant fixed policy and its rules", () => {
    for (const text of [
      "How do I set up recurring meals?",
      "Is creatine safe?",
      "What can the app do?",
    ]) {
      const policy = ask(text);
      expect(policy.systemPolicyParts.fixed).toBe(COACH_FIXED_POLICY);
      expect(policy.systemPolicy).toBe(
        `${COACH_FIXED_POLICY}\n${policy.systemPolicyParts.variable}`,
      );
      expect(policy.systemPolicy.startsWith(COACH_FIXED_POLICY)).toBe(true);
    }
    expect(COACH_FIXED_POLICY).toContain(COACH_APP_GUIDE_PREAMBLE);
    expect(COACH_FIXED_POLICY).toContain(COACH_APP_INDEX);
    expect(COACH_FIXED_POLICY).toContain("NEVER suggest, recommend");
    expect(COACH_FIXED_POLICY).toContain(
      "NEVER recommend exercises that aggravate",
    );
    expect(COACH_FIXED_POLICY).toContain("Never diagnose");
    expect(COACH_FIXED_POLICY).toContain("search_exercises");
    expect(COACH_FIXED_POLICY).toContain("get_available_routines");
    // The per-question catalog must not leak into the cacheable prefix.
    for (const capability of COACH_APP_CAPABILITIES) {
      expect(COACH_FIXED_POLICY).not.toContain(capability.guidance);
    }
  });

  it("attaches only the selected entries after the fixed part", () => {
    const policy = ask("How do I set up recurring meals?");
    const recurring = COACH_APP_CAPABILITIES.find(
      ({ id }) => id === "recurring-meals",
    )!;
    const bouldering = COACH_APP_CAPABILITIES.find(
      ({ id }) => id === "bouldering",
    )!;
    expect(policy.systemPolicyParts.variable).toContain(recurring.guidance);
    expect(policy.systemPolicy).not.toContain(bouldering.guidance);
  });

  it("falls back to the catalog index when nothing matches", () => {
    const policy = ask("Is creatine safe to take daily?");
    expect(policy.capabilityIds).toEqual([]);
    expect(policy.systemPolicyParts.variable).toContain("none matched");
    expect(policy.systemPolicy).toContain(COACH_APP_INDEX);
  });

  it("is deterministic for the same messages", () => {
    expect(ask("Can I log a swim?")).toEqual(ask("Can I log a swim?"));
  });

  it("omits the JSON answer envelope from the provider-neutral policy", () => {
    expect(COACH_FIXED_POLICY).not.toContain('{"answer"');
    expect(COACH_SYSTEM_POLICY).not.toContain('{"answer"');
    expect(ask("Make me a workout plan").systemPolicy).not.toContain(
      "JSON object",
    );
  });

  it("keeps typical turns far below the previous full-catalog policy", () => {
    const sizes = [
      "How do I set up recurring meals?",
      "How do I join a challenge in Community?",
      "Can I scan a barcode or nutrition label?",
      "Make me a 4 day upper/lower workout plan",
      "What's my bench PR?",
    ].map((text) => ask(text).systemPolicy.length);
    for (const size of sizes) {
      expect(size).toBeLessThan(PREVIOUS_FULL_POLICY_CHARS * 0.55);
    }
    expect(COACH_FIXED_POLICY.length).toBeLessThan(
      PREVIOUS_FULL_POLICY_CHARS * 0.46,
    );
  });
});
