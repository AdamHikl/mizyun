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
});
type VisionModelOutput = z.infer<typeof visionOutputSchema>;

export const normalizeCandidateValues = (
  candidate: VisionModelOutput,
): VisionModelOutput => {
  let {
    name,
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
  } = candidate;

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
  },
  required: [
    "name",
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
  ],
};

const NUTRITION_DRAFT_PROMPT_VERSION = "nutrition-draft-v2";
const NUTRITION_DRAFT_REFINE_PROMPT_VERSION = "nutrition-draft-refine-v1";

const visionSystemPolicy = [
  "You are a nutrition photo analyzer. Use only the photo and the user's hint.",
  "Identify the food or drink in the photo. If you cannot, set name to null.",
  "Estimate total calories (caloriesKcal) and all three macronutrients (proteinG, carbohydrateG, fatG) for the identified meal.",
  "Round to one decimal place for macro grams, integer for kcal. Always supply non-null point estimates (midpoint) whenever food is identified.",
  "For every estimate, return a plausible low/high range and list the portion or ingredient assumptions that drive it.",
  "Set all numeric fields to null only if you cannot identify any food or drink.",
  "Never make medical claims or suggest a daily calorie target.",
  "Output strictly the JSON schema requested.",
].join("\n");

const visionUserPrompt = (hint: string | undefined): string =>
  hint && hint.trim().length > 0
    ? `Identify the food in the photo. The user describes it as: "${hint.trim()}".`
    : "Identify the food or drink in the photo.";

const refineSystemPolicy = [
  "You are a nutrition assistant refining an existing meal draft.",
  "Use the current draft as the starting point. Do not invent new ingredients, portions, or meals.",
  "Apply the user's instruction conservatively: change only the values the instruction clearly targets.",
  "When the instruction references a current value (e.g. '200g instead of 100g'), scale the affected macros proportionally and surface the new low/high range.",
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
    `Calories: ${currentDraft.caloriesKcal ?? "(empty)"} kcal`,
    `Protein: ${currentDraft.proteinG ?? "(empty)"} g`,
    `Carbs: ${currentDraft.carbohydrateG ?? "(empty)"} g`,
    `Fat: ${currentDraft.fatG ?? "(empty)"} g`,
    `Confidence: ${currentDraft.confidence}`,
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
} | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const resolvedModel =
    typeof record.modelVersion === "string" && record.modelVersion.length > 0
      ? record.modelVersion
      : null;
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
    return this.#generate(
      [
        {
          text: `Estimate an editable meal draft from this user description only: "${request.description.trim()}".`,
        },
      ],
      "text",
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
      provenance: {
        inputKind,
        provider: "gemini",
        model: resolvedModel,
        promptVersion,
      },
    };
  }
}
