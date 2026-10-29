/**
 * AI unit-economics model (#336, ADR-0081).
 *
 * List prices and per-request sizes behind docs/AI_UNIT_ECONOMICS_2026-10-26.md
 * and the per-user cost report (scripts/ai-usage-cost-report.mjs). Prices are
 * USD; revenue is EUR. Update PRICES_CHECKED_ON and the research log when a
 * price changes.
 */

export const PRICES_CHECKED_ON = "2026-10-29";

/** ECB euro reference rate, 2026-10-26: 1 EUR = 1.1188 USD. */
export const USD_PER_EUR = 1.1188;

/** USD per million tokens, or per call where named. */
export const PRICES = {
  /** claude-haiku-5-5, prompts up to 100,000 tokens; 5-minute cache writes. */
  haiku: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  /** gemini-3.8-flash (and 3.6 fallback), list price through 2026-12-31; implicit cache, no write fee. */
  gemini2026: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.75 },
  /** gemini-3.8-flash from 2027-01-01 (doubles). */
  gemini2027: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 1.5 },
  /** gemini-3.1-flash-lite-image: text input, image output tokens. */
  image: { input: 0.25, imageOutput: 30, tokensPerImage: 1120 },
  /** Anthropic web search, per search. */
  anthropicWebSearch: 0.01,
  /** Gemini grounding with Google Search, per request after 5,000 free/month per project. */
  geminiGrounding: 0.014,
};

/** One Gemini 3 image at the default media resolution. */
export const GEMINI_IMAGE_INPUT_TOKENS = 1120;

/**
 * Design size of one request per feature: the largest request observed in the
 * Mizyun AI eval suite (runs of 2026-10-18 to 2026-10-23) with output given
 * 50 % headroom, and photo features at their maximum photo count.
 */
export const REQUEST_SIZES = {
  /** Coach turn (Haiku); counted in the token ledger, so priced per token. */
  coachTurn: { provider: "haiku", input: 59_758, output: 1_560 },
  /** Photo meal draft, three photos (Gemini). */
  photoDraft: {
    provider: "gemini",
    input: 1_430 + 2 * GEMINI_IMAGE_INPUT_TOKENS,
    output: 924,
  },
  /** Typed meal with the web-search pass (Haiku, up to 3 searches). */
  typedMealSearch: {
    provider: "haiku",
    input: 2_302 + 15_000,
    output: 728 + 500,
    searches: 3,
  },
  /** Draft change (refine), text only; routed like typed meals. */
  refine: { provider: "gemini", input: 2_302, output: 1_092 },
  /** Log activity draft (Haiku). */
  activity: { provider: "haiku", input: 1_496, output: 455 },
  /** Evening stretch tailoring (Gemini). */
  stretch: { provider: "gemini", input: 2_475, output: 537 },
  /** Cooking assistant (Gemini); also charged in the token ledger. */
  cookingAssistant: { provider: "gemini", input: 731, output: 2_319 },
  /** Ingredient photos, three photos (Gemini); also charged in the token ledger. */
  ingredientPhotos: {
    provider: "gemini",
    input: 967 + 2 * GEMINI_IMAGE_INPUT_TOKENS,
    output: 564,
  },
};

const tokenPrice = (provider, year) =>
  provider === "haiku"
    ? PRICES.haiku
    : year >= 2027
      ? PRICES.gemini2027
      : PRICES.gemini2026;

/** USD for one request of `size` in `year`. */
export const requestCostUsd = (size, year = 2027) => {
  const price = tokenPrice(size.provider, year);
  const tokens =
    (size.input * price.input + size.output * price.output) / 1_000_000;
  const searches =
    (size.searches ?? 0) *
    (size.provider === "haiku"
      ? PRICES.anthropicWebSearch
      : PRICES.geminiGrounding / Math.max(1, size.searches ?? 1));
  return tokens + searches;
};

/** USD for one meal illustration (one 1K image plus a short prompt). */
export const illustrationCostUsd = () =>
  (300 * PRICES.image.input +
    PRICES.image.tokensPerImage * PRICES.image.imageOutput) /
  1_000_000;

/**
 * Blended USD per token-ledger token for Coach, with every input token priced
 * as uncached and a 6 % output share (the 2026-10-26 eval's largest share,
 * 2.5 %, rounded up). Since #347 the ledger charges cache reads at their own
 * rate and output at its reported count when above 6 % (about 9 % in a
 * typical turn after the 2026-10-28 token reduction), so this is a planning
 * blend, not a bound on what the ledger charges.
 */
export const COACH_OUTPUT_SHARE = 0.06;
export const coachTokenCostUsd = (provider = "haiku", year = 2027) => {
  const price = tokenPrice(provider, year);
  return (
    ((1 - COACH_OUTPUT_SHARE) * price.input +
      COACH_OUTPUT_SHARE * price.output) /
    1_000_000
  );
};

/** The most expensive thing one daily draft slot can buy. */
export const worstDraftSlotUsd = (year = 2027) =>
  Math.max(
    requestCostUsd(REQUEST_SIZES.photoDraft, year),
    requestCostUsd(REQUEST_SIZES.typedMealSearch, year),
    requestCostUsd(REQUEST_SIZES.activity, year),
    requestCostUsd(REQUEST_SIZES.stretch, year),
    requestCostUsd(REQUEST_SIZES.cookingAssistant, year),
    requestCostUsd(REQUEST_SIZES.ingredientPhotos, year),
  );

/** Store fee taken from every subscription payment. */
export const STORE_FEE = 0.15;

/** Pro prices (go-to-market plan 2026-10-26, Section 5.4), EUR. */
export const PLANS = {
  monthly: { priceEur: 7.99, months: 1 },
  annual: { priceEur: 49.99, months: 12 },
  foundingAnnual: { priceEur: 34.99, months: 12 },
};

export const netMonthlyEur = (plan) =>
  (plan.priceEur * (1 - STORE_FEE)) / plan.months;

/** Share of net revenue the worst-case user may cost (#336). */
export const COST_SHARE_LIMIT = 0.3;

/**
 * Worst-case monthly USD for a user who reaches every daily cap on each of
 * `days` days: every Coach message at the design turn size, bounded by the
 * hidden Coach token ceiling plus one overshooting turn (ADR-0087), every
 * draft slot at the most expensive draft, every refine at its design size,
 * and the monthly illustration allowance.
 */
export const worstCaseMonthlyUsd = (caps, { days = 30, year = 2027 } = {}) => {
  const turnTokens =
    REQUEST_SIZES.coachTurn.input + REQUEST_SIZES.coachTurn.output;
  const coachTokens = Math.min(
    caps.coachDailyMessageLimit * turnTokens,
    caps.coachDailyTokenBudget + turnTokens,
  );
  const perDay =
    coachTokens * coachTokenCostUsd("haiku", year) +
    caps.photoDraftDailyLimit * worstDraftSlotUsd(year) +
    caps.refineDailyLimit * requestCostUsd(REQUEST_SIZES.refine, year);
  return perDay * days + caps.illustrationsPerMonth * illustrationCostUsd();
};
