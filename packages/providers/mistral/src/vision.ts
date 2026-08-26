/**
 * VISION-001 — Mistral vision provider.
 *
 * Implements `VisionDraftProvider` against the Mistral
 * `chat.complete` API with image content blocks. The workspace
 * key is the dedicated `mizyun-vision-draft` Mistral workspace
 * (separate from the text coach per ADR-0017). Photo bytes are
 * transient: in-memory → provider → discarded.
 *
 * Mirrors the safety + retry pattern of `MistralAgentProvider`
 * (single bounded rate-limit retry, timeout-aware, malformed
 * response detected).
 */

import { Mistral } from "@mistralai/mistralai";
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
  "Output strictly the JSON schema the user requested.",
].join("\n");

const visionUserPrompt = (hint: string | undefined): string =>
  hint && hint.trim().length > 0
    ? `Identify the food in the photo. The user describes it as: "${hint.trim()}".`
    : "Identify the food or drink in the photo.";

/**
 * AI-ACT-007 — refine a draft that the AI just produced (or the
 * user has since edited) by re-running the structured-output
 * provider with the current values and a free-text instruction.
 * The LLM adjusts the existing values; it never invents content
 * from scratch.
 */
const refineSystemPolicy = [
  "You are a nutrition assistant refining an existing meal draft.",
  "Use the current draft as the starting point. Do not invent new ingredients, portions, or meals.",
  "Apply the user's instruction conservatively: change only the values the instruction clearly targets.",
  "When the instruction references a current value (e.g. '200g instead of 100g'), scale the affected macros proportionally and surface the new low/high range.",
  "Always supply non-null point estimates (caloriesKcal, proteinG, carbohydrateG, fatG) and ranges for all nutrition values.",
  "When the instruction is ambiguous or unsafe, leave the draft unchanged, lower the confidence, and add a warning describing why.",
  "Preserve the same JSON schema. Keep `inputKind` from the original draft unless the instruction explicitly switches input kind.",
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
    "Return a refined draft that honours the instruction while staying within the same JSON schema. Keep changes conservative and explain assumptions in `assumptions`.",
  ];
  return lines.join("\n");
};

export interface MistralVisionProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
  readonly externalAccess: boolean;
  readonly client?: MistralVisionClient;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface MistralVisionClient {
  complete(
    request: {
      readonly model: string;
      readonly messages: Array<{
        role: "system" | "user" | "assistant";
        content:
          | string
          | Array<
              | { type: "text"; text: string }
              | { type: "image_url"; imageUrl: string }
            >;
      }>;
      readonly maxTokens: number;
      readonly temperature: number;
      readonly responseFormat: typeof visionOutputSchema;
    },
    options: { readonly timeoutMs: number },
  ): Promise<unknown>;
}

const sdkVisionClient = (apiKey: string): MistralVisionClient => {
  const client = new Mistral({ apiKey });
  return {
    complete: async (request, options) =>
      // The SDK's `chat.parse` accepts image_url content blocks and
      // places schema-validated output on `message.parsed`.
      client.chat.parse(
        // The SDK types here are narrower than the wire shape we
        // pass; the cast is necessary because the SDK's
        // ChatCompletionRequest union doesn't have a stable
        // typed shape for our content-block payload.
        request as never,
        {
          timeoutMs: options.timeoutMs,
          retries: { strategy: "none" },
        },
      ),
  };
};

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

const dataUrlOf = (
  mime: VisionMimeType,
  bytes: Readonly<Uint8Array>,
): string => {
  // Encode to base64 without spreading the byte array. Node's
  // Buffer is the fastest path; the rest of the runtime already
  // uses Buffer elsewhere.
  const buffer =
    typeof Buffer !== "undefined"
      ? Buffer.from(bytes)
      : // eslint-disable-next-line no-undef
        new Uint8Array(bytes);
  return `data:${mime};base64,${buffer.toString("base64")}`;
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

export class MistralVisionProvider implements VisionDraftProvider {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #timeoutMs: number;
  readonly #maxOutputTokens: number;
  readonly #externalAccess: boolean;
  readonly #client: MistralVisionClient;
  readonly #now: () => number;
  readonly #random: () => number;
  readonly #sleep: (milliseconds: number) => Promise<void>;

  constructor(options: MistralVisionProviderOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#timeoutMs = options.timeoutMs;
    this.#maxOutputTokens = options.maxOutputTokens;
    this.#externalAccess = options.externalAccess;
    this.#client = options.client ?? sdkVisionClient(options.apiKey);
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
      provider: "mistral-vision",
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
    const dataUrl = dataUrlOf(request.mimeType, request.photo);
    return this.#generate(
      [
        { type: "text", text: visionUserPrompt(request.textHint) },
        { type: "image_url", imageUrl: dataUrl },
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
      `Estimate an editable meal draft from this user description only: "${request.description.trim()}".`,
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
    return this.#generate(content, request.currentDraft.provenance.inputKind, {
      systemPolicy: refineSystemPolicy,
      promptVersion: NUTRITION_DRAFT_REFINE_PROMPT_VERSION,
    });
  }

  async #generate(
    content:
      | string
      | Array<
          | { type: "text"; text: string }
          | { type: "image_url"; imageUrl: string }
        >,
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
      this.#client.complete(
        {
          model: this.#model,
          messages: [
            { role: "system", content: systemPolicy },
            {
              role: "user",
              content,
            },
          ],
          maxTokens: this.#maxOutputTokens,
          temperature: 0.2,
          responseFormat: visionOutputSchema,
        },
        { timeoutMs: this.#timeoutMs },
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

    const parsedResponse = parseProviderResponse(raw);
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
      // Replace the candidate with a safe fallback so the user
      // never sees a medically-loaded suggestion. The route
      // surfaces the warning to the user; the model never
      // produces text that contradicts the policy.
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
          provider: "mistral",
          model: resolvedModel,
          promptVersion,
        },
      };
    }
    return {
      ...parsed,
      provenance: {
        inputKind,
        provider: "mistral",
        model: resolvedModel,
        promptVersion,
      },
    };
  }
}

const parseProviderResponse = (
  raw: unknown,
): {
  readonly candidate: VisionModelOutput;
  readonly resolvedModel: string | null;
} | null => {
  // Mistral's chat.complete returns an object with `choices[0]`
  // containing the message. The `content` field may be a string
  // (when the model returns free-form text) or an object when
  // the response_format is JSON schema.
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const resolvedModel =
    typeof record.model === "string" && record.model.length > 0
      ? record.model
      : null;
  const choices = record.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== "object" || first === null) return null;
  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as { content?: unknown }).content;
  const structured = (message as { parsed?: unknown }).parsed;
  if (structured !== undefined && structured !== null) {
    const parsed = visionOutputSchema.safeParse(structured);
    if (parsed.success) {
      return {
        candidate: normalizeCandidateValues(parsed.data),
        resolvedModel,
      };
    }
  }
  if (typeof content === "string") {
    try {
      const parsed: unknown = JSON.parse(content);
      return {
        candidate: normalizeCandidateValues(visionOutputSchema.parse(parsed)),
        resolvedModel,
      };
    } catch {
      return null;
    }
  }
  if (typeof content === "object" && content !== null) {
    const parsed = visionOutputSchema.safeParse(content);
    if (parsed.success) {
      return {
        candidate: normalizeCandidateValues(parsed.data),
        resolvedModel,
      };
    }
  }
  return null;
};
