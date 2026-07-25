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
  type VisionMimeType,
} from "@mizyun/agent-runtime";
import { z } from "zod";

const visionOutputSchema = z.object({
  name: z.string().trim().min(1).max(200).nullable(),
  caloriesKcal: z.number().nonnegative().lte(20_000).nullable(),
  proteinG: z.number().nonnegative().lte(10_000).nullable(),
  carbohydrateG: z.number().nonnegative().lte(10_000).nullable(),
  fatG: z.number().nonnegative().lte(10_000).nullable(),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string().trim().min(1).max(500)).max(8),
});

const visionSystemPolicy = [
  "You are a nutrition photo analyzer. Use only the photo and the user's hint.",
  "Identify the food or drink in the photo. If you cannot, set name to null.",
  "Estimate calories and macros conservatively. Round to one decimal place for grams, integer for kcal.",
  "Prefer null over a guess you are not confident about.",
  "Never make medical claims. Never suggest a calorie target below 800 kcal.",
  "Output strictly the JSON schema the user requested.",
].join("\n");

const visionUserPrompt = (hint: string | undefined): string =>
  hint && hint.trim().length > 0
    ? `Identify the food in the photo. The user describes it as: "${hint.trim()}".`
    : "Identify the food or drink in the photo.";

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
      // The SDK's `chat.complete` accepts content blocks including
      // image_url. We forward the response through to the
      // provider; the structured output is parsed downstream.
      client.chat.complete(
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

const isUnsafeOutput = (candidate: VisionDraftCandidate): boolean => {
  if (candidate.caloriesKcal !== null && candidate.caloriesKcal < 800) {
    return true;
  }
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
    const call = () =>
      this.#client.complete(
        {
          model: this.#model,
          messages: [
            { role: "system", content: visionSystemPolicy },
            {
              role: "user",
              content: [
                { type: "text", text: visionUserPrompt(request.textHint) },
                { type: "image_url", imageUrl: dataUrl },
              ],
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

    const parsed = parseProviderResponse(raw);
    if (parsed === null) {
      throw new VisionProviderError(
        "malformed_response",
        "The vision provider returned an invalid response.",
        false,
      );
    }
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
        confidence: parsed.confidence,
        warnings: [
          ...parsed.warnings,
          "The AI suggestion was rejected by the safety policy. Please enter the values manually.",
        ],
      };
    }
    return parsed;
  }
}

const parseProviderResponse = (raw: unknown): VisionDraftCandidate | null => {
  // Mistral's chat.complete returns an object with `choices[0]`
  // containing the message. The `content` field may be a string
  // (when the model returns free-form text) or an object when
  // the response_format is JSON schema.
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const choices = record.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== "object" || first === null) return null;
  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    try {
      const parsed: unknown = JSON.parse(content);
      return visionOutputSchema.parse(parsed);
    } catch {
      return null;
    }
  }
  if (typeof content === "object" && content !== null) {
    const parsed = visionOutputSchema.safeParse(content);
    if (parsed.success) return parsed.data;
  }
  return null;
};
