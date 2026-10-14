import { describe, expect, it } from "vitest";
import {
  recurringMealSuggestionAcceptSchema,
  recurringMealSuggestionDecisionSchema,
  recurringMealSuggestionPreferencesSchema,
  recurringMealSuggestionProposalSchema,
} from "./recurring-meal-suggestion";
const ids = [1, 2, 3].map(
  (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
);
const proposal = {
  candidateId: "mrs1-12345678",
  familyKey: "yogurt",
  sourceEntryId: ids[2],
  sourceUpdatedAt: "2026-10-13T08:00:00Z",
  evidence: ids.map((id, i) => ({
    id,
    updatedAt: `2026-10-${11 + i}T08:00:00Z`,
    localDate: `2026-10-${11 + i}`,
  })),
  evidenceDigest: "abcdef12",
  name: "Yogurt",
  caloriesKcal: 150,
  proteinG: null,
  carbohydrateG: 0,
  fatG: 4,
  grams: 150,
  policyVersion: "mrs-exact-3-v1",
  reasonCode: "three_consecutive_days",
  localTime: "08:00",
  timeZone: "Europe/Bratislava",
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  startLocalDate: "2026-10-14",
  expiresAt: "2026-10-20T08:00:00Z",
};
describe("routine suggestion contracts", () => {
  it("accepts bounded proposal and permits explicitly customized days/time", () => {
    expect(
      recurringMealSuggestionProposalSchema.parse(proposal).proteinG,
    ).toBeNull();
    expect(
      recurringMealSuggestionAcceptSchema.parse({
        operationId: ids[0],
        proposal,
        localTime: "09:15",
        timeZone: "Europe/Bratislava",
        weekdays: [5, 1],
      }).weekdays,
    ).toEqual([1, 5]);
  });
  it("rejects duplicate evidence, absent source revision and unknown fields", () => {
    for (const patch of [
      {
        evidence: [
          proposal.evidence[0],
          proposal.evidence[0],
          proposal.evidence[2],
        ],
      },
      { sourceUpdatedAt: "2026-10-13T08:01:00Z" },
      { rawHistory: [] },
    ])
      expect(
        recurringMealSuggestionProposalSchema.safeParse({
          ...proposal,
          ...patch,
        }).success,
      ).toBe(false);
  });
  it("rejects invalid zones/times/dates and invalid nutrition", () => {
    for (const patch of [
      { timeZone: "Mars/Foo" },
      { localTime: "24:00" },
      { startLocalDate: "2026-02-30" },
      { grams: -1 },
      { proteinG: Infinity },
    ])
      expect(
        recurringMealSuggestionProposalSchema.safeParse({
          ...proposal,
          ...patch,
        }).success,
      ).toBe(false);
  });
  it("validates decision and preference envelopes", () => {
    expect(
      recurringMealSuggestionDecisionSchema.safeParse({
        proposal,
        decision: "never",
      }).success,
    ).toBe(true);
    expect(
      recurringMealSuggestionDecisionSchema.safeParse({
        proposal,
        decision: "delete",
      }).success,
    ).toBe(false);
    expect(
      recurringMealSuggestionPreferencesSchema.safeParse({ enabled: false })
        .success,
    ).toBe(true);
    expect(
      recurringMealSuggestionPreferencesSchema.safeParse({
        enabled: false,
        userId: ids[0],
      }).success,
    ).toBe(false);
  });
});
