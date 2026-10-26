import { describe, expect, it } from "vitest";
import {
  AI_COST_RESERVATION_MICROS,
  ILLUSTRATION_MICROS,
  aiAllowanceMessage,
  estimateAiCallCostMicros,
  nextMonthlyAllowanceReset,
  pricedProvider,
} from "./ai-cost";
import { AI_TIER_CAPS } from "./ai-tier";

const OCT_2026 = new Date("2026-10-26T12:00:00.000Z");
const JAN_2027 = new Date("2027-01-02T12:00:00.000Z");

/** Net revenue per month after the 15 % Store fee, USD at 1.1188 per EUR. */
const netMonthlyUsd = (priceEur: number, months: number) =>
  ((priceEur * 0.85) / months) * 1.1188;

describe("estimateAiCallCostMicros", () => {
  it("prices a median Haiku Coach turn at under a fifth of a cent", () => {
    // 14,036 input + 804 output tokens observed in the eval suite.
    const micros = estimateAiCallCostMicros(
      "coach",
      { tokensUsed: 14_840, provider: "anthropic" },
      OCT_2026,
    );
    expect(micros).toBe(Math.ceil(14_840 * (0.94 * 0.1 + 0.06 * 0.5)));
    expect(micros).toBeLessThan(2_000);
  });

  it("doubles Gemini token prices from 2027-01-01 and keeps Haiku", () => {
    const usage = { tokensUsed: 2_000, provider: "gemini" };
    const before = estimateAiCallCostMicros("photo", usage, OCT_2026);
    const after = estimateAiCallCostMicros("photo", usage, JAN_2027);
    expect(after).toBeGreaterThanOrEqual(2 * before - 1);
    expect(after).toBeLessThanOrEqual(2 * before + 1);
    const haiku = { tokensUsed: 2_000, provider: "anthropic" };
    expect(estimateAiCallCostMicros("photo", haiku, JAN_2027)).toBe(
      estimateAiCallCostMicros("photo", haiku, OCT_2026),
    );
  });

  it("adds web-search fees per provider", () => {
    const tokens = { tokensUsed: 3_000 };
    const anthropic = estimateAiCallCostMicros(
      "text",
      { ...tokens, provider: "anthropic", webSearches: 3 },
      OCT_2026,
    );
    const plain = estimateAiCallCostMicros(
      "text",
      { ...tokens, provider: "anthropic" },
      OCT_2026,
    );
    expect(anthropic - plain).toBe(30_000);
    const gemini = estimateAiCallCostMicros(
      "text",
      { ...tokens, provider: "gemini", webSearches: 1 },
      OCT_2026,
    );
    expect(
      gemini -
        estimateAiCallCostMicros(
          "text",
          { ...tokens, provider: "gemini" },
          OCT_2026,
        ),
    ).toBe(14_000);
  });

  it("charges the reservation when the provider reports no token count", () => {
    expect(
      estimateAiCallCostMicros("photo", { provider: "gemini" }, OCT_2026),
    ).toBe(AI_COST_RESERVATION_MICROS.photo);
  });

  it("prices unknown providers as Gemini and on-device results as free", () => {
    expect(pricedProvider("vision-stub")).toBe("gemini");
    expect(pricedProvider(undefined)).toBe("gemini");
    expect(pricedProvider("claude-haiku-5-5")).toBe("anthropic");
    expect(
      estimateAiCallCostMicros(
        "text",
        { tokensUsed: 1_000, provider: "apple-foundation-models" },
        OCT_2026,
      ),
    ).toBe(0);
  });

  it("ignores negative or non-finite counts", () => {
    expect(
      estimateAiCallCostMicros(
        "coach",
        { tokensUsed: -5, provider: "anthropic", webSearches: -1 },
        OCT_2026,
      ),
    ).toBe(0);
  });

  it("charges a fixed price per illustration", () => {
    expect(estimateAiCallCostMicros("illustration", {}, OCT_2026)).toBe(
      ILLUSTRATION_MICROS,
    );
  });
});

describe("allowance renewal", () => {
  it("renews the monthly allowance on the first of the next UTC month", () => {
    expect(nextMonthlyAllowanceReset(OCT_2026).toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );
    expect(
      nextMonthlyAllowanceReset(new Date("2026-12-31T23:59:00Z")).toISOString(),
    ).toBe("2027-01-01T00:00:00.000Z");
  });

  it("names the renewal date in the denial copy", () => {
    expect(aiAllowanceMessage("month", new Date("2026-11-01T00:00:00Z"))).toBe(
      "You've used this month's AI allowance. It renews on 1 November.",
    );
    expect(aiAllowanceMessage("day", new Date())).toMatch(/midnight UTC/);
  });
});

describe("paid allowance against subscription revenue (#336)", () => {
  // Largest single call that can be admitted just under the allowance: a
  // Coach turn of 61,318 tokens (largest observed) priced on Gemini in 2027.
  const largestCallMicros = estimateAiCallCostMicros(
    "coach",
    { tokensUsed: 61_318, provider: "gemini" },
    JAN_2027,
  );

  it("keeps the worst-case paid month under 30 % of monthly and annual net revenue", () => {
    const worstUsd =
      (AI_TIER_CAPS.paid.monthlyCostMicros + largestCallMicros) / 1_000_000;
    expect(worstUsd).toBeLessThan(0.3 * netMonthlyUsd(7.99, 1));
    expect(worstUsd).toBeLessThan(0.3 * netMonthlyUsd(49.99, 12));
  });

  it("lets a normal paid day fit 30 times into the month at 2027 prices", () => {
    // One Coach conversation (four median Haiku turns) and three photo drafts.
    const coach =
      4 *
      estimateAiCallCostMicros(
        "coach",
        { tokensUsed: 14_840, provider: "anthropic" },
        JAN_2027,
      );
    const photos =
      3 *
      estimateAiCallCostMicros(
        "photo",
        { tokensUsed: 1_885, provider: "gemini" },
        JAN_2027,
      );
    expect(30 * (coach + photos)).toBeLessThan(
      AI_TIER_CAPS.paid.monthlyCostMicros,
    );
    expect(coach + photos).toBeLessThan(AI_TIER_CAPS.paid.dailyCostMicros);
  });

  it("gives free accounts a smaller allowance than paid ones", () => {
    expect(AI_TIER_CAPS.free.monthlyCostMicros).toBeLessThan(
      AI_TIER_CAPS.paid.monthlyCostMicros,
    );
    expect(AI_TIER_CAPS.free.dailyCostMicros).toBeLessThan(
      AI_TIER_CAPS.paid.dailyCostMicros,
    );
  });
});
