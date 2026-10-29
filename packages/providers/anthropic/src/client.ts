import Anthropic from "@anthropic-ai/sdk";

/**
 * Narrow Messages API boundary so providers can be exercised with a fake
 * client in tests. The default implementation is the official SDK.
 */
export interface AnthropicMessagesClient {
  create(
    params: Anthropic.MessageCreateParamsNonStreaming,
    options: { readonly timeoutMs: number; readonly signal?: AbortSignal },
  ): Promise<Anthropic.Message>;
}

export const createAnthropicSdkClient = (
  apiKey: string,
): AnthropicMessagesClient => {
  // Retries are owned by the providers so they stay bounded and observable.
  const sdk = new Anthropic({ apiKey, maxRetries: 0 });
  return {
    create: (params, options) =>
      sdk.messages.create(params, {
        timeout: options.timeoutMs,
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      }),
  };
};

export type AnthropicEffort = "low" | "medium" | "high";

export const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-5-5";

/**
 * Claude Haiku 5.5 rejects non-default sampling parameters and accepts
 * `thinking: disabled` only at effort `high` or below. Thinking stays off by
 * default to match the sub-5s latency target the Gemini path uses.
 */
export const requestControls = (input: {
  readonly effort: AnthropicEffort;
  readonly thinking: boolean;
}): Pick<
  Anthropic.MessageCreateParamsNonStreaming,
  "thinking" | "output_config"
> => ({
  thinking: input.thinking ? { type: "adaptive" } : { type: "disabled" },
  output_config: { effort: input.effort },
});

export type AnthropicFailureKind =
  | "invalid_request"
  | "authentication"
  | "payment_required"
  | "rate_limited"
  | "timeout"
  | "aborted"
  | "unavailable";

export interface NormalizedAnthropicError {
  readonly kind: AnthropicFailureKind;
  readonly status: number | null;
  readonly retryable: boolean;
}

export const normalizeAnthropicError = (
  error: unknown,
): NormalizedAnthropicError => {
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return { kind: "timeout", status: null, retryable: false };
  }
  if (error instanceof Anthropic.APIUserAbortError) {
    return { kind: "aborted", status: null, retryable: false };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { kind: "unavailable", status: null, retryable: true };
  }
  const status =
    error instanceof Anthropic.APIError && typeof error.status === "number"
      ? error.status
      : typeof error === "object" &&
          error !== null &&
          "status" in error &&
          typeof (error as { status: unknown }).status === "number"
        ? (error as { status: number }).status
        : null;
  if (status === 400 || status === 404 || status === 413 || status === 422) {
    return { kind: "invalid_request", status, retryable: false };
  }
  if (status === 401 || status === 403) {
    return { kind: "authentication", status, retryable: false };
  }
  if (status === 402) {
    return { kind: "payment_required", status, retryable: false };
  }
  if (status === 429) {
    return { kind: "rate_limited", status, retryable: true };
  }
  // 529 is Anthropic's "overloaded" status.
  if (status !== null && status >= 500) {
    return {
      kind: "unavailable",
      status,
      retryable: status === 500 || status === 529 || status === 503,
    };
  }
  const name = error instanceof Error ? error.name : "";
  if (name.includes("Timeout")) {
    return { kind: "timeout", status, retryable: false };
  }
  if (name.includes("Abort")) {
    return { kind: "aborted", status, retryable: false };
  }
  return { kind: "unavailable", status, retryable: false };
};

const RETRY_JITTER_MAX_MS = 250;
const RETRY_AFTER_MAX_MS = 2_000;

export const retryDelayMilliseconds = (
  error: unknown,
  random: () => number,
): number => {
  const headers =
    error instanceof Anthropic.APIError ? error.headers : undefined;
  const value = headers?.get("retry-after") ?? null;
  if (value !== null) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, RETRY_AFTER_MAX_MS);
    }
  }
  const unit = Math.min(1, Math.max(0, random()));
  return Math.min(
    RETRY_JITTER_MAX_MS,
    Math.floor(unit * (RETRY_JITTER_MAX_MS + 1)),
  );
};

/** Concatenated visible text, ignoring thinking and server-tool blocks. */
export const textOf = (message: Anthropic.Message): string =>
  message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

/**
 * Token counts of one response. Anthropic reports cache reads and writes
 * apart from `input_tokens`; they are added into the prompt and total and
 * also kept separately, so the cost ledger can price them at their own rates.
 */
export const usageOf = (
  message: Anthropic.Message,
): {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
} => {
  const usage = message.usage;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
  const prompt = usage.input_tokens + cacheReadTokens + cacheWriteTokens;
  return {
    promptTokens: prompt,
    completionTokens: usage.output_tokens,
    totalTokens: prompt + usage.output_tokens,
    cacheReadTokens,
    cacheWriteTokens,
  };
};

export const latencyBucket = (milliseconds: number): string => {
  if (milliseconds < 1_000) return "under_1s";
  if (milliseconds < 3_000) return "1_to_3s";
  if (milliseconds < 8_000) return "3_to_8s";
  return "over_8s";
};

const UNSUPPORTED_SCHEMA_KEYS = new Set([
  "$schema",
  "title",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "pattern",
  "patternProperties",
]);

/**
 * Converts a JSON schema to the subset Claude structured outputs accept:
 * numeric/string/array-length constraints are removed (callers keep
 * validating with Zod), `minItems` is clamped to 0/1 and every object is
 * closed with `additionalProperties: false`. Gemini-style upper-case type
 * names are lower-cased.
 */
export const toAnthropicJsonSchema = (
  schema: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  const sanitize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sanitize);
    if (typeof value !== "object" || value === null) return value;
    const record = value as Record<string, unknown>;
    const cleaned: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) {
      if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
      if (key === "additionalProperties") continue;
      if (key === "nullable") continue;
      if (key === "type" && typeof entry === "string") {
        cleaned.type = entry.toLowerCase();
        continue;
      }
      if (key === "minItems" && typeof entry === "number") {
        cleaned.minItems = entry > 0 ? 1 : 0;
        continue;
      }
      if (key === "properties" && typeof entry === "object" && entry) {
        cleaned.properties = Object.fromEntries(
          Object.entries(entry as Record<string, unknown>).map(([k, v]) => [
            k,
            sanitize(v),
          ]),
        );
        continue;
      }
      cleaned[key] = sanitize(entry);
    }
    if (record.nullable === true && typeof cleaned.type === "string") {
      cleaned.type = [cleaned.type, "null"];
    }
    const isObject =
      cleaned.type === "object" ||
      (Array.isArray(cleaned.type) && cleaned.type.includes("object")) ||
      (cleaned.type === undefined && cleaned.properties !== undefined);
    if (isObject) {
      if (cleaned.properties === undefined) cleaned.properties = {};
      cleaned.additionalProperties = false;
    }
    return cleaned;
  };
  return sanitize(schema) as Record<string, unknown>;
};
