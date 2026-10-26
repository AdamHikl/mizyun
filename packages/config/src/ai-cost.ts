/**
 * Per-call AI cost estimate for the cost allowance (#336, ADR-0081).
 *
 * Every AI call reserves a design estimate before the provider runs and then
 * settles the estimate of what it actually cost, priced from the tokens the
 * provider reported, the provider that served it and any web-search fees.
 * Amounts are integer micro-USD (1 USD = 1,000,000). List prices were checked
 * on AI_PRICES_CHECKED_ON; docs/AI_UNIT_ECONOMICS_2026-10-26.md and
 * scripts/ai-cost-model.mjs carry the same numbers.
 */

export const AI_PRICES_CHECKED_ON = "2026-10-26";

/** What a call is for; sets its output share and reservation. */
export type AiCostKind =
  "coach" | "text" | "photo" | "refine" | "recipe" | "illustration";

interface TokenPrice {
  /** USD per million input tokens. */
  readonly input: number;
  /** USD per million output tokens. */
  readonly output: number;
}

/** claude-haiku-5-5, prompts up to 100,000 tokens. */
export const HAIKU_PRICE: TokenPrice = { input: 0.1, output: 0.5 };
/** gemini-3.8-flash / 3.6-flash through 2026-12-31. */
export const GEMINI_PRICE_2026: TokenPrice = { input: 0.75, output: 3.75 };
/** gemini-3.8-flash / 3.6-flash from 2027-01-01. */
export const GEMINI_PRICE_2027: TokenPrice = { input: 1.5, output: 7.5 };
const GEMINI_2027_FROM = Date.UTC(2027, 0, 1);

/** Anthropic web search, per search. */
export const ANTHROPIC_WEB_SEARCH_MICROS = 10_000;
/** Gemini Google Search grounding, per grounded request (free quota ignored). */
export const GEMINI_GROUNDING_MICROS = 14_000;
/** One 1K meal illustration on gemini-3.1-flash-lite-image (1,120 image tokens at $30/MTok). */
export const ILLUSTRATION_MICROS = 34_000;

/**
 * Output share of the tokens a call reports, per kind. Taken from the
 * largest output shares in the Mizyun AI eval suite and rounded up.
 */
export const AI_COST_OUTPUT_SHARE: Readonly<Record<AiCostKind, number>> = {
  coach: 0.06,
  text: 0.3,
  photo: 0.35,
  refine: 0.35,
  recipe: 0.7,
  illustration: 0,
};

/**
 * Amount reserved before the provider runs: about the largest request
 * observed for the kind at 2027 Gemini prices, including web-search fees for
 * typed meals. A call may settle above its reservation.
 */
export const AI_COST_RESERVATION_MICROS: Readonly<Record<AiCostKind, number>> =
  {
    coach: 10_000,
    text: 35_000,
    photo: 15_000,
    refine: 12_000,
    recipe: 20_000,
    illustration: ILLUSTRATION_MICROS,
  };

export interface AiCallUsage {
  /** Total tokens the provider reported (input, cache and output). */
  readonly tokensUsed?: number | undefined;
  /** Provider name from the response or draft provenance, e.g. "anthropic". */
  readonly provider?: string | undefined;
  /** Web searches or grounded requests the call made. */
  readonly webSearches?: number | undefined;
}

type PricedProvider = "anthropic" | "gemini" | "local";

/**
 * Unknown providers are priced as Gemini, the most expensive routed vendor.
 * On-device and rules-only results cost nothing.
 */
export const pricedProvider = (
  provider: string | undefined,
): PricedProvider => {
  const name = (provider ?? "").toLowerCase();
  if (name.includes("anthropic") || name.includes("claude")) return "anthropic";
  if (
    name.includes("apple") ||
    name.includes("on-device") ||
    name.includes("ondevice") ||
    name === "rules" ||
    name === "deterministic"
  ) {
    return "local";
  }
  return "gemini";
};

const tokenPrice = (provider: PricedProvider, at: Date): TokenPrice | null =>
  provider === "local"
    ? null
    : provider === "anthropic"
      ? HAIKU_PRICE
      : at.getTime() >= GEMINI_2027_FROM
        ? GEMINI_PRICE_2027
        : GEMINI_PRICE_2026;

const nonNegative = (value: number | undefined): number =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * Estimated micro-USD of one finished call. Without a reported token count
 * the reservation is charged, so a missing count never makes a call free.
 */
export const estimateAiCallCostMicros = (
  kind: AiCostKind,
  usage: AiCallUsage,
  at: Date,
): number => {
  if (kind === "illustration") return ILLUSTRATION_MICROS;
  const provider = pricedProvider(usage.provider);
  const price = tokenPrice(provider, at);
  if (price === null) return 0;
  const searches = nonNegative(usage.webSearches);
  const searchMicros =
    searches *
    (provider === "anthropic"
      ? ANTHROPIC_WEB_SEARCH_MICROS
      : GEMINI_GROUNDING_MICROS);
  if (usage.tokensUsed === undefined || !Number.isFinite(usage.tokensUsed)) {
    return Math.max(AI_COST_RESERVATION_MICROS[kind], searchMicros);
  }
  const share = AI_COST_OUTPUT_SHARE[kind];
  // tokens × USD per million tokens = micro-USD.
  const tokenMicros =
    nonNegative(usage.tokensUsed) *
    ((1 - share) * price.input + share * price.output);
  return Math.ceil(tokenMicros + searchMicros);
};

/** First instant of the next UTC month, when the monthly allowance renews. */
export const nextMonthlyAllowanceReset = (at: Date): Date =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));

/** User-facing copy for a cost-allowance denial. */
export const aiAllowanceMessage = (
  scope: "day" | "month",
  resetAt: Date,
): string =>
  scope === "month"
    ? `You've used this month's AI allowance. It renews on ${resetAt.toLocaleDateString(
        "en-GB",
        { day: "numeric", month: "long", timeZone: "UTC" },
      )}.`
    : "You've used today's AI allowance. It renews at midnight UTC.";
