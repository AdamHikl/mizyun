/**
 * GEMINI-VISION-001 — Gemini vision provider for Google AI Studio.
 *
 * Implements `VisionDraftProvider` against the Gemini `generateContent`
 * API with multimodal inline image data and structured JSON outputs.
 * Photo bytes are transient: in-memory → provider → discarded.
 */

import {
  VisionProviderError,
  type VisionDraftCandidate,
  type VisionDraftProvider,
  type VisionDraftRequest,
  type RefineFoodDraftRequest,
  type TextFoodDraftRequest,
  type VisionMimeType,
} from "@mizyun/agent-runtime";
import { z } from "zod";

const visionOutputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .nullish()
    .transform((v) => v ?? null),
  portionWeightG: z
    .number()
    .positive()
    .lte(20_000)
    .nullish()
    .transform((v) => v ?? null),
  caloriesKcal: z
    .number()
    .nonnegative()
    .lte(20_000)
    .nullish()
    .transform((v) => v ?? null),
  proteinG: z
    .number()
    .nonnegative()
    .lte(10_000)
    .nullish()
    .transform((v) => v ?? null),
  carbohydrateG: z
    .number()
    .nonnegative()
    .lte(10_000)
    .nullish()
    .transform((v) => v ?? null),
  fatG: z
    .number()
    .nonnegative()
    .lte(10_000)
    .nullish()
    .transform((v) => v ?? null),
  calorieRangeKcal: z
    .object({ low: z.number().nonnegative(), high: z.number().nonnegative() })
    .nullish()
    .transform((v) => v ?? null),
  proteinRangeG: z
    .object({ low: z.number().nonnegative(), high: z.number().nonnegative() })
    .nullish()
    .transform((v) => v ?? null),
  carbohydrateRangeG: z
    .object({ low: z.number().nonnegative(), high: z.number().nonnegative() })
    .nullish()
    .transform((v) => v ?? null),
  fatRangeG: z
    .object({ low: z.number().nonnegative(), high: z.number().nonnegative() })
    .nullish()
    .transform((v) => v ?? null),
  confidence: z.number().min(0).max(1).default(0.8),
  warnings: z.array(z.string().trim().min(1).max(500)).max(8).default([]),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(8).default([]),
  calculation: z
    .string()
    .max(5000)
    .nullish()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
});
type VisionModelOutput = z.infer<typeof visionOutputSchema>;

export const normalizeCandidateValues = (
  candidate: VisionModelOutput,
): VisionModelOutput => {
  let {
    name,
    portionWeightG,
    caloriesKcal,
    proteinG,
    carbohydrateG,
    fatG,
    calorieRangeKcal,
    proteinRangeG,
    carbohydrateRangeG,
    fatRangeG,
    confidence,
    warnings,
    assumptions,
    calculation,
  } = candidate;

  if (portionWeightG !== null) {
    portionWeightG = Math.round(portionWeightG * 10) / 10;
  }

  // 1. If ranges are present but point estimates are null, derive point estimate as the midpoint
  if (caloriesKcal === null && calorieRangeKcal !== null) {
    caloriesKcal = Math.round(
      (calorieRangeKcal.low + calorieRangeKcal.high) / 2,
    );
  }
  if (proteinG === null && proteinRangeG !== null) {
    proteinG =
      Math.round(((proteinRangeG.low + proteinRangeG.high) / 2) * 10) / 10;
  }
  if (carbohydrateG === null && carbohydrateRangeG !== null) {
    carbohydrateG =
      Math.round(
        ((carbohydrateRangeG.low + carbohydrateRangeG.high) / 2) * 10,
      ) / 10;
  }
  if (fatG === null && fatRangeG !== null) {
    fatG = Math.round(((fatRangeG.low + fatRangeG.high) / 2) * 10) / 10;
  }

  // 2. If calories are known and two macros are known but one is null/missing (and food is identified),
  // infer the missing macro from the calorie balance.
  if (caloriesKcal !== null) {
    if (proteinG !== null && carbohydrateG !== null && fatG === null) {
      const remainingKcal = caloriesKcal - (proteinG * 4 + carbohydrateG * 4);
      if (remainingKcal >= 0) {
        fatG = Math.round((remainingKcal / 9) * 10) / 10;
      }
    } else if (proteinG !== null && fatG !== null && carbohydrateG === null) {
      const remainingKcal = caloriesKcal - (proteinG * 4 + fatG * 9);
      if (remainingKcal >= 0) {
        carbohydrateG = Math.round((remainingKcal / 4) * 10) / 10;
      }
    } else if (carbohydrateG !== null && fatG !== null && proteinG === null) {
      const remainingKcal = caloriesKcal - (carbohydrateG * 4 + fatG * 9);
      if (remainingKcal >= 0) {
        proteinG = Math.round((remainingKcal / 4) * 10) / 10;
      }
    }
  }

  // 3. If point estimates are present but ranges are null, derive plausible conservative ranges (+/- 15%)
  if (caloriesKcal !== null && calorieRangeKcal === null) {
    const delta = Math.max(20, Math.round(caloriesKcal * 0.15));
    calorieRangeKcal = {
      low: Math.max(0, caloriesKcal - delta),
      high: caloriesKcal + delta,
    };
  }
  if (proteinG !== null && proteinRangeG === null) {
    const delta = Math.max(2, Math.round(proteinG * 0.15 * 10) / 10);
    proteinRangeG = {
      low: Math.max(0, Math.round((proteinG - delta) * 10) / 10),
      high: Math.round((proteinG + delta) * 10) / 10,
    };
  }
  if (carbohydrateG !== null && carbohydrateRangeG === null) {
    const delta = Math.max(2, Math.round(carbohydrateG * 0.15 * 10) / 10);
    carbohydrateRangeG = {
      low: Math.max(0, Math.round((carbohydrateG - delta) * 10) / 10),
      high: Math.round((carbohydrateG + delta) * 10) / 10,
    };
  }
  if (fatG !== null && fatRangeG === null) {
    const delta = Math.max(1, Math.round(fatG * 0.15 * 10) / 10);
    fatRangeG = {
      low: Math.max(0, Math.round((fatG - delta) * 10) / 10),
      high: Math.round((fatG + delta) * 10) / 10,
    };
  }

  return {
    name,
    portionWeightG,
    caloriesKcal,
    proteinG,
    carbohydrateG,
    fatG,
    calorieRangeKcal,
    proteinRangeG,
    carbohydrateRangeG,
    fatRangeG,
    confidence,
    warnings,
    assumptions,
    calculation: calculation ?? null,
  };
};

const geminiVisionOutputJsonSchema = {
  type: "OBJECT",
  properties: {
    name: {
      type: "STRING",
      nullable: true,
      description: "Name of the meal or food item identified.",
    },
    portionWeightG: {
      type: "NUMBER",
      nullable: true,
      description:
        "Best estimate of the total edible portion weight in grams represented by the nutrition totals, excluding plates, cups, wrappers, and other containers. For drinks, estimate the consumed liquid mass in grams.",
    },
    caloriesKcal: {
      type: "NUMBER",
      nullable: true,
      description: "Best estimate total calories in kcal (integer midpoint).",
    },
    proteinG: {
      type: "NUMBER",
      nullable: true,
      description:
        "Best estimate total protein in grams (1 decimal place midpoint).",
    },
    carbohydrateG: {
      type: "NUMBER",
      nullable: true,
      description:
        "Best estimate total carbohydrates in grams (1 decimal place midpoint).",
    },
    fatG: {
      type: "NUMBER",
      nullable: true,
      description:
        "Best estimate total fat in grams (1 decimal place midpoint).",
    },
    calorieRangeKcal: {
      type: "OBJECT",
      nullable: true,
      properties: {
        low: {
          type: "NUMBER",
          description: "Conservative lower bound for calories in kcal.",
        },
        high: {
          type: "NUMBER",
          description: "Conservative upper bound for calories in kcal.",
        },
      },
      required: ["low", "high"],
    },
    proteinRangeG: {
      type: "OBJECT",
      nullable: true,
      properties: {
        low: {
          type: "NUMBER",
          description: "Conservative lower bound for protein in grams.",
        },
        high: {
          type: "NUMBER",
          description: "Conservative upper bound for protein in grams.",
        },
      },
      required: ["low", "high"],
    },
    carbohydrateRangeG: {
      type: "OBJECT",
      nullable: true,
      properties: {
        low: {
          type: "NUMBER",
          description: "Conservative lower bound for carbohydrates in grams.",
        },
        high: {
          type: "NUMBER",
          description: "Conservative upper bound for carbohydrates in grams.",
        },
      },
      required: ["low", "high"],
    },
    fatRangeG: {
      type: "OBJECT",
      nullable: true,
      properties: {
        low: {
          type: "NUMBER",
          description: "Conservative lower bound for fat in grams.",
        },
        high: {
          type: "NUMBER",
          description: "Conservative upper bound for fat in grams.",
        },
      },
      required: ["low", "high"],
    },
    confidence: {
      type: "NUMBER",
      description: "Confidence score between 0.0 and 1.0.",
    },
    warnings: { type: "ARRAY", items: { type: "STRING" } },
    assumptions: { type: "ARRAY", items: { type: "STRING" } },
    calculation: {
      type: "STRING",
      nullable: true,
      description:
        "Detailed itemized breakdown showing each ingredient, portion, and nutritional calculation that drives the totals.",
    },
  },
  required: [
    "name",
    "portionWeightG",
    "caloriesKcal",
    "proteinG",
    "carbohydrateG",
    "fatG",
    "calorieRangeKcal",
    "proteinRangeG",
    "carbohydrateRangeG",
    "fatRangeG",
    "confidence",
    "warnings",
    "assumptions",
    "calculation",
  ],
};

const NUTRITION_DRAFT_PROMPT_VERSION = "nutrition-draft-v3";
const NUTRITION_DRAFT_REFINE_PROMPT_VERSION = "nutrition-draft-refine-v2";

export const visionSystemPolicy = [
  "You are a nutrition photo analyzer. Use only the photo and the user's hint.",
  "Identify the food or drink in the photo. If you cannot, set name to null.",
  "Estimate the total edible portion weight (portionWeightG) represented by the nutrition totals. Sum all edible food and drink components, exclude containers and tableware, and explain the portion assumption. Do not default to 100g unless the evidence genuinely supports 100g.",
  "Estimate total calories (caloriesKcal) and all three macronutrients (proteinG, carbohydrateG, fatG) for the identified meal.",
  "Round portionWeightG and macro grams to one decimal place, and kcal to an integer. Always supply non-null point estimates (midpoint) whenever food is identified.",
  "For every estimate, return a plausible low/high range and list the portion or ingredient assumptions that drive it.",
  "In calculation, provide the complete itemized breakdown showing each ingredient, portion, and nutritional calculation that drives the totals.",
  "Set all numeric fields to null only if you cannot identify any food or drink.",
  "Never make medical claims or suggest a daily calorie target.",
  "Output strictly the JSON schema requested.",
].join("\n");

export const textNutritionSystemPolicy = [
  "You are a nutrition analyzer specializing in text meal descriptions, recipes, and restaurant items.",
  "Estimate the total edible portion weight (portionWeightG) represented by the nutrition totals. Sum all edible food and drink components, exclude containers and tableware, and explain the portion assumption. Do not default to 100g unless the description or published serving genuinely supports 100g.",
  "Estimate total calories (caloriesKcal) and all three macronutrients (proteinG, carbohydrateG, fatG) for the identified meal.",
  "Round portionWeightG and macro grams to one decimal place, and kcal to an integer. Always supply non-null point estimates (midpoint) whenever food is identified.",
  "For every estimate, return a plausible low/high range and list the portion or ingredient assumptions that drive it.",
  "In calculation, provide the complete itemized breakdown showing each ingredient, portion, and nutritional calculation that drives the totals.",
  "For fast-food chains and restaurants (McDonald's, Burger King, KFC, Subway, Starbucks, etc.), prioritize official published nutrition facts.",
  "Respect regional and country differences: Central Europe / EU vs US portion sizes and beverage sugar formulations differ significantly.",
  "Explicitly handle single vs double patty burger sizes: e.g. Single Big Tasty Bacon in Central Europe is 588 kcal with 1 standard patty, vs Double Big Tasty at ~850–900 kcal with 150g patty. Never assign double-patty calorie counts when 'Single' is specified.",
  "When a user's country code is provided (e.g. 'SK'), prioritize official nutrition standards and portion sizes for that specific country.",
  "If the exact regional recipe or portion is ambiguous, capture the uncertainty in calorieRangeKcal, explain the assumption in assumptions, and assign conservative confidence (< 0.75).",
  "Set all numeric fields to null only if you cannot identify any food or drink.",
  "Never make medical claims or suggest a daily calorie target.",
  "Output strictly the JSON schema requested.",
].join("\n");

const BRAND_OR_RESTAURANT_PATTERNS: readonly RegExp[] = [
  /\bmcdonald/i,
  /\bmcdo\b/i,
  /\bmaccas\b/i,
  /\bburger\s*king\b/i,
  /\bkfc\b/i,
  /\bkentucky\s*fried\s*chicken\b/i,
  /\bsubway\b/i,
  /\bstarbucks\b/i,
  /\bwendy/i,
  /\bchipotle\b/i,
  /\btaco\s*bell\b/i,
  /\bpizza\s*hut\b/i,
  /\bdomino/i,
  /\bfive\s*guys\b/i,
  /\bpopeyes?\b/i,
  /\bdunkin/i,
  /\bcosta\s*coffee\b/i,
  /\bpanera\b/i,
  /\bshake\s*shack\b/i,
  /\bchick-fil-a\b/i,
  /\bchick\s*fil\s*a\b/i,
  /\brestaurant\b/i,
  /\bmenu\b/i,
  /\bbistro\b/i,
  /\bfast\s*food\b/i,
];

export const isBrandOrRestaurantQuery = (description: string): boolean => {
  const trimmed = description.trim();
  if (trimmed.length === 0) return false;
  return BRAND_OR_RESTAURANT_PATTERNS.some((pattern) => pattern.test(trimmed));
};

const extractGeminiCandidateText = (raw: unknown): string | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const candidates = (raw as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const first = candidates[0];
  if (typeof first !== "object" || first === null) return null;
  const content = (first as { content?: unknown }).content;
  if (typeof content !== "object" || content === null) return null;
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const texts = parts
    .map((p) =>
      typeof (p as { text?: unknown })?.text === "string"
        ? (p as { text: string }).text.trim()
        : "",
    )
    .filter((t) => t.length > 0);
  return texts.length > 0 ? texts.join("\n\n") : null;
};

const visionUserPrompt = (hint: string | undefined): string =>
  hint && hint.trim().length > 0
    ? `Identify the food in the photo. The user describes it as: "${hint.trim()}".`
    : "Identify the food or drink in the photo.";

const refineSystemPolicy = [
  "You are a nutrition assistant refining an existing meal draft.",
  "Use the current draft as the starting point. Do not invent new ingredients, portions, or meals.",
  "Apply the user's instruction conservatively: change only the values the instruction clearly targets.",
  "When the instruction references a current value (e.g. '200g instead of 100g'), scale the affected macros proportionally and surface the new low/high range.",
  "Keep portionWeightG aligned with the total edible portion represented by the refined calories and macros; update it whenever the instruction changes portion size.",
  "In calculation, return an updated itemized breakdown reflecting the adjusted portions and calculations.",
  "Always supply non-null point estimates (caloriesKcal, proteinG, carbohydrateG, fatG) and ranges for all nutrition values.",
  "When the instruction is ambiguous or unsafe, leave the draft unchanged, lower the confidence, and add a warning describing why.",
  "Preserve the same JSON schema. Keep inputKind from the original draft unless the instruction explicitly switches input kind.",
  "Never make medical claims, diagnose, or suggest a daily calorie target.",
].join("\n");

const refineUserPrompt = (
  currentDraft: RefineFoodDraftRequest["currentDraft"],
  instruction: string,
): string => {
  const lines = [
    "Current meal draft:",
    `Name: ${currentDraft.name ?? "(empty)"}`,
    `Portion weight: ${currentDraft.portionWeightG ?? "(empty)"} g`,
    `Calories: ${currentDraft.caloriesKcal ?? "(empty)"} kcal`,
    `Protein: ${currentDraft.proteinG ?? "(empty)"} g`,
    `Carbs: ${currentDraft.carbohydrateG ?? "(empty)"} g`,
    `Fat: ${currentDraft.fatG ?? "(empty)"} g`,
    `Confidence: ${currentDraft.confidence}`,
    ...(currentDraft.calculation
      ? [`Current calculation: ${currentDraft.calculation}`]
      : []),
    "",
    `User instruction: "${instruction.trim()}"`,
    "",
    "Return a refined draft that honours the instruction while staying within the requested JSON schema. Keep changes conservative and explain assumptions in assumptions.",
  ];
  return lines.join("\n");
};

export interface GeminiVisionProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly fallbackModel?: string | undefined;
  readonly thinkingBudget?: number | undefined;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
  readonly externalAccess: boolean;
  readonly enableSearchGrounding?: boolean | undefined;
  readonly client?: GeminiVisionClient | undefined;
  readonly now?: (() => number) | undefined;
  readonly random?: (() => number) | undefined;
  readonly sleep?: ((milliseconds: number) => Promise<void>) | undefined;
}

export type GeminiVisionPart =
  | { readonly text: string }
  | {
      readonly inlineData: { readonly mimeType: string; readonly data: string };
    };

export interface GeminiVisionClient {
  generateContent(
    request: {
      readonly model: string;
      readonly systemInstruction?: {
        readonly parts: readonly { readonly text: string }[];
      };
      readonly contents: readonly {
        readonly role: "user";
        readonly parts: readonly GeminiVisionPart[];
      }[];
      readonly tools?: readonly Readonly<Record<string, unknown>>[];
      readonly generationConfig?: {
        readonly temperature?: number;
        readonly maxOutputTokens?: number;
        readonly responseMimeType?: string;
        readonly responseSchema?: Readonly<Record<string, unknown>>;
        readonly thinkingConfig?: {
          readonly thinkingBudget?: number;
        };
      };
    },
    options: { readonly timeoutMs: number; readonly apiKey: string },
  ): Promise<unknown>;
}

export const defaultGeminiVisionFetchClient = (): GeminiVisionClient => ({
  generateContent: async (request, options) => {
    const { model, ...body } = request;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(options.apiKey)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `Gemini Vision API returned HTTP ${response.status}: ${errorText}`,
        );
        (err as { statusCode?: number }).statusCode = response.status;
        (err as { headers?: Headers }).headers = response.headers;
        throw err;
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  },
});

const RETRY_JITTER_MAX_MS = 250;

const statusCodeOf = (error: unknown): number | null => {
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof (error as { statusCode: unknown }).statusCode === "number"
  ) {
    return (error as { statusCode: number }).statusCode;
  }
  return null;
};

const errorNameOf = (error: unknown): string =>
  error instanceof Error ? error.name : "";

const retryAfterHeaderOf = (error: unknown): string | null => {
  if (
    typeof error !== "object" ||
    error === null ||
    !("headers" in error) ||
    typeof (error as { headers: unknown }).headers !== "object" ||
    (error as { headers: unknown }).headers === null ||
    !("get" in (error as { headers: object }).headers) ||
    typeof (error as { headers: { get: unknown } }).headers.get !== "function"
  ) {
    return null;
  }
  const value: unknown = (
    error as { headers: { get: (k: string) => unknown } }
  ).headers.get("retry-after");
  return typeof value === "string" && value.length > 0 ? value : null;
};

const retryDelayMilliseconds = (
  error: unknown,
  random: () => number,
): number => {
  const retryAfter = retryAfterHeaderOf(error);
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isInteger(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, 2_000);
    }
  }
  const unit = Math.min(1, Math.max(0, random()));
  return Math.min(
    RETRY_JITTER_MAX_MS,
    Math.floor(unit * (RETRY_JITTER_MAX_MS + 1)),
  );
};

const normalizeError = (error: unknown): VisionProviderError => {
  const status = statusCodeOf(error);
  if (status === 400 || status === 422) {
    return new VisionProviderError(
      "invalid_request",
      "The vision request was rejected.",
      false,
    );
  }
  if (status === 401 || status === 403) {
    return new VisionProviderError(
      "authentication",
      "The vision provider could not authenticate.",
      false,
    );
  }
  if (status === 429) {
    return new VisionProviderError(
      "rate_limited",
      "The vision provider is temporarily busy.",
      true,
    );
  }
  if (status !== null && status >= 500) {
    return new VisionProviderError(
      "unavailable",
      "The vision provider is temporarily unavailable.",
      false,
    );
  }
  const name = errorNameOf(error);
  if (name.includes("Timeout")) {
    return new VisionProviderError(
      "timeout",
      "The vision request timed out.",
      false,
    );
  }
  if (name.includes("Abort")) {
    return new VisionProviderError(
      "timeout",
      "The vision request was cancelled.",
      false,
    );
  }
  return new VisionProviderError(
    "unavailable",
    "The vision provider is temporarily unavailable.",
    false,
  );
};

const isHighDemandError = (
  error: unknown,
  normalized: VisionProviderError,
): boolean => {
  const status = statusCodeOf(error);
  if (
    status === 429 ||
    status === 503 ||
    status === 500 ||
    status === 502 ||
    status === 504
  ) {
    return true;
  }
  if (
    normalized.kind === "rate_limited" ||
    normalized.kind === "unavailable" ||
    normalized.kind === "timeout"
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /(MODEL_CAPACITY_EXHAUSTED|RESOURCE_EXHAUSTED|overloaded|capacity|high demand|temporarily unavailable|quota)/i.test(
    message,
  );
};

const toBase64 = (bytes: Readonly<Uint8Array>): string => {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
};

const isUnsafeOutput = (
  candidate: Pick<VisionDraftCandidate, "name">,
): boolean => {
  if (
    candidate.name !== null &&
    /(diagnose|prescribe|medication|disorder)/i.test(candidate.name)
  ) {
    return true;
  }
  return false;
};

const parseGeminiVisionResponse = (
  raw: unknown,
): {
  readonly candidate: VisionModelOutput;
  readonly resolvedModel: string | null;
  readonly tokensUsed?: number | undefined;
} | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const resolvedModel =
    typeof record.modelVersion === "string" && record.modelVersion.length > 0
      ? record.modelVersion
      : null;
  const usageMetadata = record.usageMetadata as
    Record<string, unknown> | undefined;
  const tokensUsed =
    typeof usageMetadata?.totalTokenCount === "number" &&
    Number.isFinite(usageMetadata.totalTokenCount) &&
    usageMetadata.totalTokenCount >= 0
      ? Math.round(usageMetadata.totalTokenCount)
      : undefined;
  const candidates = record.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const first = candidates[0];
  if (typeof first !== "object" || first === null) return null;
  const content = (first as { content?: unknown }).content;
  if (typeof content !== "object" || content === null) return null;
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const text = (parts[0] as { text?: unknown })?.text;
  if (typeof text !== "string") return null;

  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    const parsed: unknown = JSON.parse(cleaned);
    const result = visionOutputSchema.safeParse(parsed);
    if (result.success) {
      return {
        candidate: normalizeCandidateValues(result.data),
        resolvedModel,
        ...(tokensUsed !== undefined ? { tokensUsed } : {}),
      };
    }
  } catch {
    // Parse failed
  }
  return null;
};

export class GeminiVisionProvider implements VisionDraftProvider {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #fallbackModel: string | undefined;
  readonly #thinkingBudget: number;
  readonly #timeoutMs: number;
  readonly #maxOutputTokens: number;
  readonly #externalAccess: boolean;
  readonly #enableSearchGrounding: boolean;
  readonly #client: GeminiVisionClient;
  readonly #now: () => number;
  readonly #random: () => number;
  readonly #sleep: (milliseconds: number) => Promise<void>;

  constructor(options: GeminiVisionProviderOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#fallbackModel =
      options.fallbackModel !== undefined &&
      options.fallbackModel !== options.model
        ? options.fallbackModel
        : undefined;
    this.#thinkingBudget = options.thinkingBudget ?? 0;
    this.#timeoutMs = options.timeoutMs;
    this.#maxOutputTokens = options.maxOutputTokens;
    this.#externalAccess = options.externalAccess;
    this.#enableSearchGrounding = options.enableSearchGrounding ?? true;
    this.#client = options.client ?? defaultGeminiVisionFetchClient();
    this.#now = options.now ?? Date.now;
    this.#random = options.random ?? Math.random;
    this.#sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async status(): Promise<{
    readonly ready: boolean;
    readonly provider: string;
  }> {
    return {
      ready: this.#externalAccess,
      provider: "gemini-vision",
      ...(this.#externalAccess ? {} : { model: this.#model }),
    };
  }

  async generateDraft(
    request: VisionDraftRequest,
  ): Promise<VisionDraftCandidate> {
    if (!this.#externalAccess) {
      throw new VisionProviderError(
        "external_access_disabled",
        "External AI vision access is disabled.",
        false,
      );
    }
    const base64Data = toBase64(request.photo);
    return this.#generate(
      [
        { text: visionUserPrompt(request.textHint) },
        {
          inlineData: {
            mimeType: request.mimeType,
            data: base64Data,
          },
        },
      ],
      "photo",
    );
  }

  async generateTextDraft(
    request: TextFoodDraftRequest,
  ): Promise<VisionDraftCandidate> {
    if (!this.#externalAccess) {
      throw new VisionProviderError(
        "external_access_disabled",
        "External AI nutrition drafting access is disabled.",
        false,
      );
    }

    const countryInfo = request.countryCode?.trim() ?? "standard";
    const countrySuffix = request.countryCode?.trim()
      ? ` (country: ${request.countryCode.trim()})`
      : "";

    if (
      this.#enableSearchGrounding &&
      this.#externalAccess &&
      isBrandOrRestaurantQuery(request.description)
    ) {
      try {
        const searchPrompt = `Search the web for official published nutrition facts (calories in kcal, protein, carbohydrates, fat) for the following meal/food item. Note the specific restaurant, regional/country menu (${countryInfo}), and portion size:\n"${request.description.trim()}"`;
        const searchResponse = await this.#client.generateContent(
          {
            model: this.#model,
            contents: [
              {
                role: "user",
                parts: [{ text: searchPrompt }],
              },
            ],
            tools: [{ googleSearch: {} }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: this.#maxOutputTokens,
            },
          },
          { timeoutMs: this.#timeoutMs, apiKey: this.#apiKey },
        );

        const groundedText = extractGeminiCandidateText(searchResponse);
        if (groundedText && groundedText.length > 0) {
          const structuredPrompt = `Estimate an editable meal draft from this user description and verified search findings.\n\nUser description: "${request.description.trim()}"${countrySuffix}\n\nVerified search findings:\n${groundedText}`;
          return await this.#generate([{ text: structuredPrompt }], "text", {
            systemPolicy: textNutritionSystemPolicy,
          });
        }
      } catch {
        // Step 1 search failed; gracefully fall back to direct single-step generation
      }
    }

    return this.#generate(
      [
        {
          text: `Estimate an editable meal draft from this user description only: "${request.description.trim()}"${countrySuffix}.`,
        },
      ],
      "text",
      { systemPolicy: textNutritionSystemPolicy },
    );
  }

  async refineDraft(
    request: RefineFoodDraftRequest,
  ): Promise<VisionDraftCandidate> {
    if (!this.#externalAccess) {
      throw new VisionProviderError(
        "external_access_disabled",
        "External AI nutrition refine access is disabled.",
        false,
      );
    }
    if (request.instruction.trim().length < 2) {
      throw new VisionProviderError(
        "invalid_request",
        "The refine instruction must be at least 2 characters.",
        false,
      );
    }
    const content = refineUserPrompt(request.currentDraft, request.instruction);
    return this.#generate(
      [{ text: content }],
      request.currentDraft.provenance.inputKind,
      {
        systemPolicy: refineSystemPolicy,
        promptVersion: NUTRITION_DRAFT_REFINE_PROMPT_VERSION,
      },
    );
  }

  async #generate(
    parts: readonly GeminiVisionPart[],
    inputKind: "photo" | "text",
    overrides: {
      readonly systemPolicy?: string;
      readonly promptVersion?: string;
    } = {},
  ): Promise<VisionDraftCandidate> {
    const systemPolicy = overrides.systemPolicy ?? visionSystemPolicy;
    const promptVersion =
      overrides.promptVersion ?? NUTRITION_DRAFT_PROMPT_VERSION;

    const executeCallForModel = async (
      targetModel: string,
    ): Promise<{ readonly raw: unknown; readonly usedModel: string }> => {
      const isThinkingCapable =
        targetModel.includes("3.8") ||
        targetModel.includes("3.7") ||
        targetModel.includes("thinking") ||
        this.#thinkingBudget > 0;
      const generationConfig: Record<string, unknown> = {
        temperature: 0.2,
        maxOutputTokens: this.#maxOutputTokens,
        responseMimeType: "application/json",
        responseSchema: geminiVisionOutputJsonSchema,
        ...(isThinkingCapable
          ? { thinkingConfig: { thinkingBudget: this.#thinkingBudget } }
          : {}),
      };

      const call = () =>
        this.#client.generateContent(
          {
            model: targetModel,
            systemInstruction: {
              parts: [{ text: systemPolicy }],
            },
            contents: [
              {
                role: "user",
                parts,
              },
            ],
            generationConfig,
          },
          { timeoutMs: this.#timeoutMs, apiKey: this.#apiKey },
        );

      try {
        const result = await call();
        return { raw: result, usedModel: targetModel };
      } catch (firstError) {
        const normalized = normalizeError(firstError);
        if (!normalized.retryable) throw firstError;
        await this.#sleep(retryDelayMilliseconds(firstError, this.#random));
        try {
          const result = await call();
          return { raw: result, usedModel: targetModel };
        } catch (secondError) {
          throw secondError;
        }
      }
    };

    let callResult: { readonly raw: unknown; readonly usedModel: string };
    try {
      callResult = await executeCallForModel(this.#model);
    } catch (primaryError) {
      const normalized = normalizeError(primaryError);
      if (this.#fallbackModel && isHighDemandError(primaryError, normalized)) {
        try {
          callResult = await executeCallForModel(this.#fallbackModel);
        } catch (fallbackError) {
          throw normalizeError(fallbackError);
        }
      } else {
        throw normalized;
      }
    }

    const parsedResponse = parseGeminiVisionResponse(callResult.raw);
    if (parsedResponse === null) {
      throw new VisionProviderError(
        "malformed_response",
        "The vision provider returned an invalid response.",
        false,
      );
    }
    const parsed = parsedResponse.candidate;
    const resolvedModel = parsedResponse.resolvedModel ?? callResult.usedModel;

    if (isUnsafeOutput(parsed)) {
      return {
        name: null,
        portionWeightG: null,
        caloriesKcal: null,
        proteinG: null,
        carbohydrateG: null,
        fatG: null,
        calorieRangeKcal: null,
        proteinRangeG: null,
        carbohydrateRangeG: null,
        fatRangeG: null,
        confidence: parsed.confidence,
        warnings: [
          ...parsed.warnings,
          "The AI suggestion was rejected by the safety policy. Please enter the values manually.",
        ],
        assumptions: [],
        calculation: null,
        ...(parsedResponse.tokensUsed !== undefined
          ? { tokensUsed: parsedResponse.tokensUsed }
          : {}),
        provenance: {
          inputKind,
          provider: "gemini",
          model: resolvedModel,
          promptVersion,
        },
      };
    }

    return {
      ...parsed,
      ...(parsedResponse.tokensUsed !== undefined
        ? { tokensUsed: parsedResponse.tokensUsed }
        : {}),
      provenance: {
        inputKind,
        provider: "gemini",
        model: resolvedModel,
        promptVersion,
      },
    };
  }
}
