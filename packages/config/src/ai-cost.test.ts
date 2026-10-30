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

  describe("prompt-cache tokens (#347)", () => {
    // A typical Coach turn on Haiku (ADR-0087): 8,000 cached prompt tokens,
    // 2,400 new ones and 1,000 output tokens.
    const turn = { tokensUsed: 11_400, provider: "anthropic" } as const;

    it("prices Haiku cache reads at a tenth of the input price", () => {
      const micros = estimateAiCallCostMicros(
        "coach",
        { ...turn, cacheReadTokens: 8_000, cacheWriteTokens: 0 },
        OCT_2026,
      );
      // 684 output tokens (6 % of the total) come out of the 3,400 uncached.
      expect(micros).toBe(Math.ceil(2_716 * 0.1 + 684 * 0.5 + 8_000 * 0.01));
      expect(micros).toBeLessThan(
        estimateAiCallCostMicros("coach", turn, OCT_2026),
      );
    });

    it("prices Haiku 5-minute cache writes at 1.25 times the input price", () => {
      const write = estimateAiCallCostMicros(
        "coach",
        { ...turn, cacheReadTokens: 0, cacheWriteTokens: 8_000 },
        OCT_2026,
      );
      expect(write).toBe(Math.ceil(2_716 * 0.1 + 684 * 0.5 + 8_000 * 0.125));
      expect(write).toBeGreaterThan(
        estimateAiCallCostMicros("coach", turn, OCT_2026),
      );
    });

    it("prices Gemini implicit-cache hits at a tenth of input, doubling in 2027", () => {
      const usage = {
        tokensUsed: 10_000,
        provider: "gemini",
        cacheReadTokens: 6_000,
      };
      expect(estimateAiCallCostMicros("coach", usage, OCT_2026)).toBe(
        Math.ceil(3_400 * 0.75 + 600 * 3.75 + 6_000 * 0.075),
      );
      expect(estimateAiCallCostMicros("coach", usage, JAN_2027)).toBe(
        Math.ceil(3_400 * 1.5 + 600 * 7.5 + 6_000 * 0.15),
      );
    });

    it("never prices a call below today's charge when a cache count is missing", () => {
      const today = estimateAiCallCostMicros("coach", turn, OCT_2026);
      expect(today).toBe(Math.ceil(11_400 * (0.94 * 0.1 + 0.06 * 0.5)));
      for (const counts of [
        {},
        { cacheReadTokens: undefined, cacheWriteTokens: undefined },
        { cacheWriteTokens: 0 },
        { cacheReadTokens: Number.NaN },
        { cacheReadTokens: -8_000 },
      ]) {
        expect(
          estimateAiCallCostMicros("coach", { ...turn, ...counts }, OCT_2026),
        ).toBe(today);
      }
      // A missing total still charges the reservation, whatever the cache says.
      expect(
        estimateAiCallCostMicros(
          "coach",
          { provider: "anthropic", cacheReadTokens: 8_000 },
          OCT_2026,
        ),
      ).toBe(AI_COST_RESERVATION_MICROS.coach);
    });

    it("prices inconsistent cache counts as uncached input, as before", () => {
      const today = estimateAiCallCostMicros("coach", turn, OCT_2026);
      for (const counts of [
        { cacheReadTokens: 20_000 },
        { cacheReadTokens: 8_000, cacheWriteTokens: 8_000 },
        { cacheWriteTokens: 12_000 },
      ]) {
        expect(
          estimateAiCallCostMicros("coach", { ...turn, ...counts }, OCT_2026),
        ).toBe(today);
      }
      // Gemini writes cost the input price: a bad write count cannot lower it.
      const gemini = { tokensUsed: 10_000, provider: "gemini" };
      expect(
        estimateAiCallCostMicros(
          "coach",
          { ...gemini, cacheWriteTokens: 50_000 },
          OCT_2026,
        ),
      ).toBe(estimateAiCallCostMicros("coach", gemini, OCT_2026));
    });

    it("charges the typical ADR-0087 turn at least its Haiku list cost", () => {
      // 8,000 cached + 2,400 new prompt tokens and 1,000 output tokens: the
      // reported output (9 %) is above the 6 % share, so it is used.
      const listCost = 2_400 * 0.1 + 1_000 * 0.5 + 8_000 * 0.01;
      expect(
        estimateAiCallCostMicros(
          "coach",
          { ...turn, cacheReadTokens: 8_000, outputTokens: 1_000 },
          OCT_2026,
        ),
      ).toBe(Math.ceil(listCost));
      // A reported output below the share keeps the share as the floor.
      expect(
        estimateAiCallCostMicros(
          "coach",
          { ...turn, cacheReadTokens: 8_000, outputTokens: 100 },
          OCT_2026,
        ),
      ).toBe(Math.ceil(2_716 * 0.1 + 684 * 0.5 + 8_000 * 0.01));
    });

    it("charges an incomplete multi-round turn at least the reservation", () => {
      const small = { ...turn, cacheReadTokens: 8_000, incomplete: true };
      expect(estimateAiCallCostMicros("coach", small, OCT_2026)).toBe(
        AI_COST_RESERVATION_MICROS.coach,
      );
      // Known rounds above the reservation are charged in full.
      const large = {
        tokensUsed: 20_000,
        provider: "gemini",
        incomplete: true,
      };
      expect(estimateAiCallCostMicros("coach", large, OCT_2026)).toBe(
        Math.ceil(20_000 * (0.94 * 0.75 + 0.06 * 3.75)),
      );
    });
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
