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
  name: z.string().trim().min(1).max(200).nullable(),
  caloriesKcal: z.number().nonnegative().lte(20_000).nullable(),
  proteinG: z.number().nonnegative().lte(10_000).nullable(),
  carbohydrateG: z.number().nonnegative().lte(10_000).nullable(),
  fatG: z.number().nonnegative().lte(10_000).nullable(),
  calorieRangeKcal: z
    .object({ low: z.number().nonnegative(), high: z.number().nonnegative() })
    .nullable(),
  proteinRangeG: z
    .object({ low: z.number().nonnegative(), high: z.number().nonnegative() })
    .nullable(),
  carbohydrateRangeG: z
    .object({ low: z.number().nonnegative(), high: z.number().nonnegative() })
    .nullable(),
  fatRangeG: z
    .object({ low: z.number().nonnegative(), high: z.number().nonnegative() })
    .nullable(),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string().trim().min(1).max(500)).max(8),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(8),
});
type VisionModelOutput = z.infer<typeof visionOutputSchema>;

const geminiVisionOutputJsonSchema = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING", nullable: true },
    caloriesKcal: { type: "NUMBER", nullable: true },
    proteinG: { type: "NUMBER", nullable: true },
    carbohydrateG: { type: "NUMBER", nullable: true },
    fatG: { type: "NUMBER", nullable: true },
    calorieRangeKcal: {
      type: "OBJECT",
      nullable: true,
      properties: {
        low: { type: "NUMBER" },
        high: { type: "NUMBER" },
      },
      required: ["low", "high"],
    },
    proteinRangeG: {
      type: "OBJECT",
      nullable: true,
      properties: {
        low: { type: "NUMBER" },
        high: { type: "NUMBER" },
      },
      required: ["low", "high"],
    },
    carbohydrateRangeG: {
      type: "OBJECT",
      nullable: true,
      properties: {
        low: { type: "NUMBER" },
        high: { type: "NUMBER" },
      },
      required: ["low", "high"],
    },
    fatRangeG: {
      type: "OBJECT",
      nullable: true,
      properties: {
        low: { type: "NUMBER" },
        high: { type: "NUMBER" },
      },
      required: ["low", "high"],
    },
    confidence: { type: "NUMBER" },
    warnings: { type: "ARRAY", items: { type: "STRING" } },
    assumptions: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["name", "confidence", "warnings", "assumptions"],
};

const NUTRITION_DRAFT_PROMPT_VERSION = "nutrition-draft-v2";
const NUTRITION_DRAFT_REFINE_PROMPT_VERSION = "nutrition-draft-refine-v1";

const visionSystemPolicy = [
  "You are a nutrition photo analyzer. Use only the photo and the user's hint.",
  "Identify the food or drink in the photo. If you cannot, set name to null.",
  "Estimate calories and macros conservatively. Round to one decimal place for grams, integer for kcal.",
  "For every non-null estimate, return a plausible low/high range and list the portion or ingredient assumptions that drive it.",
  "Prefer null over a guess you are not confident about.",
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
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
  readonly externalAccess: boolean;
  readonly client?: GeminiVisionClient;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
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
      return { candidate: result.data, resolvedModel };
    }
  } catch {
    // Parse failed
  }
  return null;
};

export class GeminiVisionProvider implements VisionDraftProvider {
  readonly #apiKey: string;
  readonly #model: string;
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

    const call = () =>
      this.#client.generateContent(
        {
          model: this.#model,
          systemInstruction: {
            parts: [{ text: systemPolicy }],
          },
          contents: [
            {
              role: "user",
              parts,
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: this.#maxOutputTokens,
            responseMimeType: "application/json",
            responseSchema: geminiVisionOutputJsonSchema,
          },
        },
        { timeoutMs: this.#timeoutMs, apiKey: this.#apiKey },
      );

    let raw: unknown;
    try {
      raw = await call();
    } catch (firstError) {
      const normalized = normalizeError(firstError);
      if (!normalized.retryable) throw normalized;
      await this.#sleep(retryDelayMilliseconds(firstError, this.#random));
      try {
        raw = await call();
      } catch (secondError) {
        throw normalizeError(secondError);
      }
    }

    const parsedResponse = parseGeminiVisionResponse(raw);
    if (parsedResponse === null) {
      throw new VisionProviderError(
        "malformed_response",
        "The vision provider returned an invalid response.",
        false,
      );
    }
    const parsed = parsedResponse.candidate;
    const resolvedModel = parsedResponse.resolvedModel ?? this.#model;

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
