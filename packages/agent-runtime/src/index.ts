import type { Clock, ConversationId, UserId } from "@mizyun/core";
import { systemClock } from "@mizyun/core";
import type { MemoryRecord, MemoryStore } from "@mizyun/memory";

export const COACH_PROMPT_VERSION = "coach-system-v1";

export const COACH_SYSTEM_POLICY = [
  "You are Mizyun Coach, a conservative fitness and nutrition wellness assistant.",
  "Only answer questions related to fitness, workouts, gym training, exercise routines, nutrition, diet, and body progress.",
  "If the user asks an off-topic, unrelated, or general question, decline briefly and politely, and direct them to ask something gym, fitness, or nutrition related (e.g. 'I can only help with fitness and nutrition questions. Ask me something gym-related!').",
  "When the user asks to create, build, or suggest a workout routine, training split, or multi-day plan, call the get_training_prescription tool with their requested schedule, duration, distribution, equipment, and focus to obtain a verified deterministic plan before answering.",
  "When generating, suggesting, or recommending a workout plan, training split, or workout session (such as when calling get_training_prescription), keep your conversational markdown response very concise (at most 1-2 brief sentences summarizing the split and equipment) and direct the user to review the interactive plan widget below. NEVER list out individual exercises, sets, reps, days, or session breakdowns in text because the app automatically displays an interactive plan widget directly beneath your message.",
  "When the user asks to edit, adjust, modify, or replace exercises in an existing or planned workout, explain the adjustments clearly in markdown so they can review and apply the changes.",
  "Use only the confirmed Mizyun context supplied with this request for user-specific claims.",
  "Clearly distinguish confirmed facts, deterministic calculations, interpretations, and suggestions.",
  "Never diagnose, treat, prescribe medication, interpret injuries, or claim professional qualification.",
  "Never encourage extreme restriction, purging, compulsive exercise, dangerous training, or rapid weight change.",
  "Do not invent measurements, meals, workouts, goals, calculations, or memories.",
  "If context is missing or contradictory, say so and ask one focused question.",
  "Offer at most one practical, conservative, reversible next action.",
  'Always format your final answer as a JSON object with a single string field \'answer\' containing your conversational markdown response: {"answer": "<your conversational markdown response>"}. Never output raw JSON data structures or schemas as your answer.',
].join("\n");

/**
 * Safely extracts a clean assistant text string from raw text,
 * JSON objects, or structured model responses.
 *
 * Prevents raw JSON payloads (e.g. `{"response": {"workout_plan": ...}}`)
 * from leaking into the user-facing chat bubble.
 */
export const extractAssistantText = (candidate: unknown): string | null => {
  if (typeof candidate === "string") {
    const trimmed = candidate
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    if (trimmed.length === 0) return null;
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        const fromParsed = extractAssistantText(parsed);
        if (fromParsed !== null) return fromParsed;
        return null;
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }

  if (typeof candidate !== "object" || candidate === null) {
    return null;
  }

  const record = candidate as Record<string, unknown>;

  // 1. Direct string keys
  for (const key of [
    "answer",
    "response",
    "message",
    "text",
    "summary",
    "content",
  ]) {
    const val = record[key];
    if (typeof val === "string" && val.trim().length > 0) {
      const nested = extractAssistantText(val);
      if (nested !== null) return nested;
    }
  }

  // 2. Nested object keys
  for (const key of [
    "answer",
    "response",
    "message",
    "text",
    "summary",
    "content",
    "data",
    "result",
    "output",
  ]) {
    const val = record[key];
    if (typeof val === "object" && val !== null) {
      const nested = extractAssistantText(val);
      if (nested !== null) return nested;
    }
  }

  // 3. Known structured objects (e.g. workout_plan / prescription)
  if ("workout_plan" in record || "sessions" in record || "days" in record) {
    const planObj = (record.workout_plan ?? record) as Record<string, unknown>;
    const focus = typeof planObj.focus === "string" ? planObj.focus : null;
    const goal = typeof planObj.goal === "string" ? planObj.goal : null;
    const sessions = Array.isArray(planObj.sessions) ? planObj.sessions : null;
    if (focus || goal || sessions) {
      const parts: string[] = [];
      if (goal) {
        parts.push(`I have put together a workout plan tailored for ${goal}.`);
      } else if (focus) {
        parts.push(`I have put together a ${focus} workout plan for you.`);
      } else {
        parts.push(
          "I have put together a workout plan based on your preferences.",
        );
      }
      parts.push(
        "Review the detailed training prescription below to get started.",
      );
      return parts.join(" ");
    }
  }

  return null;
};

export type AgentProviderStatus =
  | {
      readonly ready: true;
      readonly provider: string;
      readonly model?: string;
      readonly externalAccess: true;
    }
  | {
      readonly ready: false;
      readonly provider: string;
      readonly reason: string;
      readonly model?: string;
      readonly externalAccess: false;
    };

export interface AgentMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
}

export interface AgentGroundingItem {
  readonly kind:
    | "profile"
    | "goal"
    | "nutrition"
    | "training"
    | "body"
    | "energy"
    | "plan"
    | "memory"
    | "tool";
  readonly label: string;
  readonly confirmed: boolean;
  readonly freshness: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface AgentRequest {
  readonly userId: UserId;
  readonly conversationId: ConversationId;
  readonly messages: readonly AgentMessage[];
  readonly memories: readonly MemoryRecord[];
  readonly grounding: readonly AgentGroundingItem[];
  readonly systemPolicy: string;
  readonly promptVersion: string;
  /**
   * Read-only tools the model may call. The runtime already
   * filtered the registry to user-bound tools; the provider
   * must NOT expose the userId or any unsafe parameter.
   */
  readonly tools?: readonly AgentToolDefinition[];
  /**
   * Prior tool results appended to the next round-trip. The
   * runtime folds these into `grounding` for the next call so
   * the model sees them as confirmed context.
   */
  readonly toolResults?: readonly AgentToolResult[];
  /**
   * The provider tool calls that produced `toolResults`. Providers whose chat
   * protocol requires an assistant tool-call message before tool-result
   * messages use this to replay the complete round-trip.
   */
  readonly requestedToolCalls?: readonly AgentToolCall[];
}

export interface AgentResponse {
  readonly message: AgentMessage & { readonly role: "assistant" };
  readonly provider: string;
  readonly evidence: readonly AgentGroundingItem[];
  readonly providerMetadata?: Readonly<Record<string, unknown>>;
  /**
   * Set when the model wants to call one or more tools before
   * producing a final answer. The runtime executes the tools,
   * folds results into grounding, and re-invokes the provider.
   * Absent when the response is the final answer.
   */
  readonly toolCalls?: readonly AgentToolCall[];
}

export interface AgentProvider {
  status(): Promise<AgentProviderStatus>;
  respond(request: AgentRequest): Promise<AgentResponse>;
}

export type ContentModerationDirection = "input" | "output";

export type ContentModerationDecision =
  | {
      readonly allowed: true;
      readonly provider: string;
      readonly model: string;
    }
  | {
      readonly allowed: false;
      readonly provider: string;
      readonly model: string;
      readonly category: string;
    };

/**
 * Provider-neutral moderation boundary. Implementations receive only the
 * current user text or the candidate assistant answer and must never persist
 * either value. Throwing is treated as a fail-closed decision by the runtime.
 */
export interface ContentModerator {
  moderateText(input: {
    readonly text: string;
    readonly direction: ContentModerationDirection;
  }): Promise<ContentModerationDecision>;
}

const boundedModerationMetadata = (
  value: string,
  maximumLength: number,
): string => {
  const bounded = value
    .trim()
    .slice(0, maximumLength)
    .replace(/[^A-Za-z0-9._:/-]/g, "_");
  return bounded.length > 0 ? bounded : "unknown";
};

/**
 * Read-only tool the model can invoke mid-response to pull
 * additional confirmed Mizyun context. The runtime is the
 * authority on `userId` — the model only sees a sanitised
 * argument shape and never the principal. Tools are pure
 * application services; they MUST NOT mutate data, switch
 * users, request arbitrary SQL, or expand the date range past
 * the maximum the runtime enforces (28 days).
 *
 * Tools return `AgentGroundingItem`s so the model sees them
 * with the same `kind / label / confirmed / freshness / data`
 * envelope as the static grounding.
 */
export interface AgentTool<TArgs> {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  /**
   * Validate and execute the tool. The runtime injects
   * `principalUserId`; the tool MUST refuse to act on any
   * other userId (defence in depth — the model cannot pass
   * `userId` as an arg because the schema does not expose it).
   */
  execute(input: {
    readonly principalUserId: UserId;
    readonly args: TArgs;
    readonly accessToken: string;
    readonly clock: Clock;
  }): Promise<AgentGroundingItem>;
}

export interface AgentToolCall {
  readonly id?: string;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface AgentToolResult {
  readonly id: string;
  readonly name: string;
  readonly evidence: AgentGroundingItem;
}

export interface AgentToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

/**
 * Tool a model asked to call cannot be resolved: either the
 * registry does not include the name, or the args fail the
 * tool's Zod schema. The runtime folds the error into the
 * evidence so the model can recover.
 */
export class UnknownAgentToolError extends Error {
  constructor(readonly toolName: string) {
    super(`Unknown agent tool: ${toolName}`);
    this.name = "UnknownAgentToolError";
  }
}

export interface AgentToolRegistry {
  list(): readonly AgentToolDefinition[];
  execute(input: {
    readonly principalUserId: UserId;
    readonly calls: readonly AgentToolCall[];
    readonly accessToken: string;
    readonly clock: Clock;
  }): Promise<readonly AgentToolResult[]>;
}

const KNOWN_KINDS = new Set([
  "profile",
  "goal",
  "nutrition",
  "training",
  "body",
  "energy",
] as const);

export type AgentEvidenceKind =
  "profile" | "goal" | "nutrition" | "training" | "body" | "energy" | "tool";

const isAgentEvidenceKind = (value: unknown): value is AgentEvidenceKind =>
  typeof value === "string" && (KNOWN_KINDS as ReadonlySet<string>).has(value);

const buildToolRegistry = <T>(
  tools: ReadonlyMap<string, AgentTool<T>>,
): AgentToolRegistry => {
  const definitions: AgentToolDefinition[] = [...tools.values()].map(
    (tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }),
  );
  return {
    list: () => definitions,
    execute: async ({ principalUserId, calls, accessToken, clock }) => {
      const results: AgentToolResult[] = [];
      for (const call of calls) {
        const tool = tools.get(call.name);
        if (tool === undefined) {
          throw new UnknownAgentToolError(call.name);
        }
        // The tool's `execute` validates its own args. We trust
        // its contract — the registry does not re-validate.
        const evidence = await tool.execute({
          principalUserId,
          args: call.args as T,
          accessToken,
          clock,
        });
        const fallbackKind: AgentEvidenceKind = "tool";
        const normalisedKind: AgentEvidenceKind = isAgentEvidenceKind(
          evidence.kind,
        )
          ? evidence.kind
          : fallbackKind;
        results.push({
          id: call.id ?? `${call.name}-${results.length}`,
          name: call.name,
          evidence: {
            ...evidence,
            kind: normalisedKind,
            label: evidence.label ?? tool.name,
            confirmed: true,
            freshness: new Date(clock.now()).toISOString(),
          },
        });
      }
      return results;
    },
  };
};

export const createAgentToolRegistry = <T>(
  tools: ReadonlyMap<string, AgentTool<T>>,
): AgentToolRegistry => buildToolRegistry(tools);

export const createAgentToolRegistryFromList = <T>(
  tools: readonly AgentTool<T>[],
): AgentToolRegistry => {
  const map = new Map<string, AgentTool<T>>();
  for (const tool of tools) {
    if (map.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    map.set(tool.name, tool);
  }
  return buildToolRegistry(map);
};

export type AgentProviderFailureKind =
  | "not_configured"
  | "external_access_disabled"
  | "authentication"
  | "payment_required"
  | "rate_limited"
  | "timeout"
  | "aborted"
  | "invalid_request"
  | "refused"
  | "malformed_response"
  | "unavailable";

export class AgentProviderError extends Error {
  readonly code = "AGENT_PROVIDER_ERROR";

  constructor(
    readonly kind: AgentProviderFailureKind,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AgentProviderError";
  }
}

export class AgentProviderUnavailableError extends AgentProviderError {
  constructor(message = "No model provider has been configured.") {
    super("not_configured", message, false);
    this.name = "AgentProviderUnavailableError";
  }
}

export class DisabledAgentProvider implements AgentProvider {
  async status(): Promise<AgentProviderStatus> {
    return {
      ready: false,
      provider: "disabled",
      externalAccess: false,
      reason: "Complete docs/BEFORE_TESTING.md before enabling AI features.",
    };
  }

  async respond(_request: AgentRequest): Promise<AgentResponse> {
    throw new AgentProviderUnavailableError();
  }
}

export type SafetyDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly category:
        | "emergency"
        | "self_harm"
        | "eating_disorder"
        | "medical"
        | "dangerous_target"
        | "prompt_injection";
      readonly response: string;
    };

const matches = (text: string, patterns: readonly RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(text));

/**
 * Deterministic first-line safety boundary. This is intentionally narrow and
 * conservative: it protects critical fixed cases even when the provider is
 * disabled or its moderation endpoint is unavailable. Provider moderation and
 * the versioned evaluation corpus remain additional layers.
 */
export const screenCoachInput = (rawText: string): SafetyDecision => {
  const text = rawText.normalize("NFKC").toLowerCase();
  if (
    matches(text, [
      /\b(chest pain|cannot breathe|can't breathe|unconscious|overdose)\b/,
      /\b(severe bleeding|medical emergency)\b/,
      /\b(bolesť na hrudi|nemôžem dýchať|bezvedom)/,
    ])
  ) {
    return {
      allowed: false,
      category: "emergency",
      response:
        "This may need urgent medical help. Stop exercising and contact your local emergency service or a qualified medical professional now. Mizyun cannot assess emergencies.",
    };
  }
  if (
    matches(text, [
      /\b(kill myself|suicide|end my life|self[- ]harm|hurt myself)\b/,
      /\b(zabiť sa|samovražd|ublížiť si)\b/,
    ])
  ) {
    return {
      allowed: false,
      category: "self_harm",
      response:
        "I’m sorry you’re dealing with this. Mizyun cannot safely support a self-harm crisis. Please contact local emergency services or a crisis professional, and reach out to someone you trust who can stay with you.",
    };
  }
  if (
    matches(text, [
      /\b(purge|vomit after eating|starve myself|anorexia|bulimia)\b/,
      /\b(earn my food|punish myself with exercise)\b/,
      /(vyvracať|hladovať|anorexi|bulími|cvičením sa potrestať)/,
    ])
  ) {
    return {
      allowed: false,
      category: "eating_disorder",
      response:
        "I can’t help with restriction, purging, or exercise used as punishment. A qualified clinician or registered dietitian can provide appropriate support. Mizyun can continue with neutral logging without targets.",
    };
  }
  if (
    matches(text, [
      /\b(diagnose|diagnosis|prescribe|medication dose|should i take)\b/,
      /\b(treat my|what injury|is this cancer|medical condition)\b/,
      /\b(diagnostikuj|diagnóz|predpíš|dávk[auy]\s+liek\w*|aké zranenie)\b/,
    ])
  ) {
    return {
      allowed: false,
      category: "medical",
      response:
        "I can provide general fitness and nutrition education, but I can’t diagnose, treat, prescribe, or assess an injury. Please take this question to a qualified medical professional.",
    };
  }
  if (
    matches(text, [
      /\b(lose|drop)\s+\d{2,}\s*(kg|kilograms|lb|pounds)\s+(in|within)\s+(a|one|1)\s+(week|month)\b/,
      /\b(under|below)\s+800\s+calories\b/,
      /\btrain\s+(through|despite)\s+(sharp|severe)\s+pain\b/,
      /\b(40|50|60|70|80|90|100)\s+sets?\s+(to failure\s+)?(every|each)\s+day\b/,
      /\b(max out|one rep max)\s+(every|each)\s+day\b/,
      /\b(schudnúť|zhodiť)\s+\d{2,}\s*(kg|kíl)\s+(za|do)\s+(týždeň|mesiac)\b/,
      /\b(pod|menej ako)\s+800\s+kalóri/i,
      /(40|50|60|70|80|90|100)\s+séri[íe]\s+(do zlyhania\s+)?každý deň/,
    ])
  ) {
    return {
      allowed: false,
      category: "dangerous_target",
      response:
        "I can’t help pursue an extreme intake, rapid weight-change target, or training through severe pain. Choose a conservative target and consult a qualified professional if pain or health concerns are involved.",
    };
  }
  if (
    matches(text, [
      /\bignore (all |the )?(previous|system|developer) instructions\b/,
      /\breveal (the )?(system prompt|hidden instructions|secrets)\b/,
      /\bact as root\b/,
      /\bignoruj (všetky )?(predchádzajúce|systémové) pokyny\b/,
      /\bodhaľ (systémový prompt|tajné pokyny)\b/,
    ])
  ) {
    return {
      allowed: false,
      category: "prompt_injection",
      response:
        "I can help with your confirmed Mizyun fitness and nutrition records, but I can’t change or reveal the system’s instructions or access controls.",
    };
  }
  return { allowed: true };
};

export interface AgentOrchestratorOptions {
  readonly provider: AgentProvider;
  readonly memories: MemoryStore;
  readonly moderator?: ContentModerator;
  readonly clock?: Clock;
  readonly memoryLimit?: number;
  /**
   * Optional tool registry. When provided, the orchestrator
   * drives a read-only tool loop: the provider may return
   * `toolCalls`, the orchestrator executes them under the
   * principal-bound `userId`, folds results into grounding,
   * and re-invokes the provider until a final answer lands
   * or `maxToolCalls` round-trips elapse.
   */
  readonly tools?: AgentToolRegistry;
  /**
   * Hard cap on tool-call round-trips per Coach message.
   * Defaults to 1 (single tool batch). The provider is
   * never invoked more than `maxToolCalls + 1` times.
   */
  readonly maxToolCalls?: number;
}

/**
 * Thrown when the orchestrator exhausts its tool-call budget
 * without a final answer. Surfaces as `AI_UNAVAILABLE` in the
 * route layer so the user sees the generic recovery copy.
 */
export class AgentToolBudgetExceededError extends Error {
  constructor(readonly limit: number) {
    super(`The agent exceeded the tool-call budget (${limit} round-trips).`);
    this.name = "AgentToolBudgetExceededError";
  }
}

export class AgentOrchestrator {
  readonly #provider: AgentProvider;
  readonly #memories: MemoryStore;
  readonly #moderator: ContentModerator | undefined;
  readonly #clock: Clock;
  readonly #memoryLimit: number;
  readonly #tools: AgentToolRegistry | undefined;
  readonly #maxToolCalls: number;

  constructor(options: AgentOrchestratorOptions) {
    this.#provider = options.provider;
    this.#memories = options.memories;
    this.#moderator = options.moderator;
    this.#clock = options.clock ?? systemClock;
    this.#memoryLimit = options.memoryLimit ?? 12;
    this.#tools = options.tools;
    this.#maxToolCalls = options.maxToolCalls ?? 1;
  }

  status(): Promise<AgentProviderStatus> {
    return this.#provider.status();
  }

  async #moderate(
    text: string,
    direction: ContentModerationDirection,
  ): Promise<AgentResponse | null> {
    if (this.#moderator === undefined || text.trim().length === 0) return null;
    try {
      const decision = await this.#moderator.moderateText({ text, direction });
      if (decision.allowed) return null;
      const category = boundedModerationMetadata(decision.category, 64);
      const provider = boundedModerationMetadata(decision.provider, 64);
      const model = boundedModerationMetadata(decision.model, 128);
      const selfHarm = /self.?harm|suicid/i.test(category);
      return {
        message: {
          role: "assistant",
          text: selfHarm
            ? "I’m sorry you’re dealing with this. Mizyun cannot safely support a self-harm crisis. Please contact local emergency services or a crisis professional, and reach out to someone you trust who can stay with you."
            : "Mizyun could not safely answer that request. Please rephrase it as a general fitness or nutrition wellness question.",
        },
        provider: "mizyun-safety",
        evidence: [],
        providerMetadata: {
          safetyCategory: `external_moderation_${category}`,
          moderationDirection: direction,
          moderationProvider: provider,
          moderationModel: model,
          promptVersion: COACH_PROMPT_VERSION,
        },
      };
    } catch {
      return {
        message: {
          role: "assistant",
          text: "Mizyun could not safely evaluate this request right now. Please try again later.",
        },
        provider: "mizyun-safety",
        evidence: [],
        providerMetadata: {
          safetyCategory: "moderation_unavailable",
          moderationDirection: direction,
          promptVersion: COACH_PROMPT_VERSION,
        },
      };
    }
  }

  async respond(input: {
    readonly userId: UserId;
    readonly conversationId: ConversationId;
    readonly messages: readonly AgentMessage[];
    readonly grounding?: readonly AgentGroundingItem[];
    readonly accessToken?: string;
  }): Promise<AgentResponse> {
    const latestUserMessage = [...input.messages]
      .reverse()
      .find((message) => message.role === "user");
    const safety = screenCoachInput(latestUserMessage?.text ?? "");
    if (!safety.allowed) {
      return {
        message: { role: "assistant", text: safety.response },
        provider: "mizyun-safety",
        evidence: [],
        providerMetadata: {
          safetyCategory: safety.category,
          promptVersion: COACH_PROMPT_VERSION,
        },
      };
    }
    const moderatedInput = await this.#moderate(
      latestUserMessage?.text ?? "",
      "input",
    );
    if (moderatedInput !== null) return moderatedInput;

    const memories = await this.#memories.search({
      userId: input.userId,
      accessToken: input.accessToken ?? "",
      text: latestUserMessage?.text ?? "",
      limit: this.#memoryLimit,
      asOf: this.#clock.now(),
    });

    let grounding: readonly AgentGroundingItem[] = input.grounding ?? [];
    let toolResults: readonly AgentToolResult[] | undefined;
    let toolCallsUsed = 0;

    let response = await this.#provider.respond({
      ...input,
      grounding,
      memories,
      systemPolicy: COACH_SYSTEM_POLICY,
      promptVersion: COACH_PROMPT_VERSION,
      ...(this.#tools ? { tools: this.#tools.list() } : {}),
    });

    while (
      response.toolCalls !== undefined &&
      response.toolCalls.length > 0 &&
      toolCallsUsed < this.#maxToolCalls
    ) {
      if (this.#tools === undefined) {
        throw new Error(
          "Provider returned toolCalls but no registry was configured.",
        );
      }
      toolCallsUsed += 1;
      try {
        toolResults = await this.#tools.execute({
          principalUserId: input.userId,
          calls: response.toolCalls,
          accessToken: input.accessToken ?? "",
          clock: this.#clock,
        });
      } catch (error) {
        // Surface a safe, conservative fallback when a tool
        // throws (e.g. UnknownAgentToolError, repo error).
        // The model already saw the partial answer text it
        // produced; we ship that with an annotation so the
        // user gets a deterministic error envelope rather
        // than a 500.
        const reason =
          error instanceof Error ? error.message : "Tool execution failed.";
        const fallbackText =
          response.message.text.trim().length > 0
            ? response.message.text
            : "I can only help with fitness and nutrition questions. Ask me something gym-related!";
        const toolErrorResponse: AgentResponse = {
          message: {
            role: "assistant",
            text: fallbackText,
          },
          provider: response.provider,
          evidence: response.evidence,
          providerMetadata: {
            ...(response.providerMetadata ?? {}),
            toolCallError: reason,
            toolCallsUsed,
            finishReason: "tool_error",
            promptVersion: COACH_PROMPT_VERSION,
          },
        };
        const moderatedOutput = await this.#moderate(
          toolErrorResponse.message.text,
          "output",
        );
        return moderatedOutput ?? toolErrorResponse;
      }
      grounding = [
        ...grounding,
        ...toolResults.map((result) => result.evidence),
      ];
      response = await this.#provider.respond({
        ...input,
        grounding,
        memories,
        systemPolicy: COACH_SYSTEM_POLICY,
        promptVersion: COACH_PROMPT_VERSION,
        requestedToolCalls: response.toolCalls,
        toolResults,
      });
    }

    if (
      response.toolCalls !== undefined &&
      response.toolCalls.length > 0 &&
      toolCallsUsed >= this.#maxToolCalls
    ) {
      throw new AgentToolBudgetExceededError(this.#maxToolCalls);
    }

    const finalText =
      response.message.text.trim().length > 0
        ? response.message.text
        : "I can only help with fitness and nutrition questions. Ask me something gym-related!";
    const finalResponse: AgentResponse = {
      ...response,
      message: {
        role: "assistant",
        text: finalText,
      },
      providerMetadata: {
        ...(response.providerMetadata ?? {}),
        ...(this.#tools ? { toolCallsUsed } : {}),
        promptVersion: COACH_PROMPT_VERSION,
      },
    };
    const moderatedOutput = await this.#moderate(
      finalResponse.message.text,
      "output",
    );
    return moderatedOutput ?? finalResponse;
  }
}

export {
  COACH_SAFETY_DATASET_VERSION,
  coachSafetyEvaluationCases,
  type CoachSafetyEvaluationCase,
} from "./evaluation-cases.js";

// =========================================================================
// VISION-001 — Read-only Coach vision draft provider.
// =========================================================================

/**
 * Photo bytes that flow into a vision provider are transient: the
 * runtime holds the bytes in memory, sends them to the provider,
 * then discards. Photo bytes NEVER land on disk, in logs, in
 * analytics, or in the user-visible chat prompt (per
 * `docs/AI_IMPLEMENTATION_PLAN.md` §"exclude progress-photo bytes
 * and URLs from the text-coach phase"). The Mistral workspace is
 * separate from the text-coach workspace per ADR-0017.
 */
export type VisionMimeType = "image/jpeg" | "image/png" | "image/webp";

export interface VisionDraftRequest {
  readonly userId: UserId;
  readonly photo: Readonly<Uint8Array>;
  readonly mimeType: VisionMimeType;
  /**
   * Optional text hint from the user (e.g. "this is my lunch"). The
   * hint is part of the request and is sent to the provider, never
   * logged.
   */
  readonly textHint?: string;
  /**
   * Optional caller-supplied request id for log correlation.
   */
  readonly requestId?: string;
}

export interface TextFoodDraftRequest {
  readonly userId: UserId;
  readonly description: string;
  readonly requestId?: string;
}

/**
 * AI-ACT-007 — refine an existing meal draft.
 *
 * The mobile composer sends the draft the AI just produced (or
 * the user has since edited) plus a free-text instruction. The
 * provider returns a refined draft that honours the instruction
 * while keeping the schema bounds and provenance rules. The
 * LLM never invents content from scratch — it adjusts the
 * existing values.
 */
export interface RefineFoodDraftRequest {
  readonly userId: UserId;
  readonly currentDraft: VisionDraftCandidate;
  readonly instruction: string;
  readonly requestId?: string;
}

export interface NutritionEstimateRange {
  readonly low: number;
  readonly high: number;
}

export interface VisionDraftCandidate {
  /**
   * Suggested food name. `null` when the model cannot make a
   * confident guess; the route translates this to a fixed
   * "AI could not identify" warning rather than fabricating a
   * name.
   */
  readonly name: string | null;
  /**
   * Per-macro suggestions. `null` per field is allowed; the route
   * maps it to "AI was not confident — please enter manually".
   */
  readonly caloriesKcal: number | null;
  readonly proteinG: number | null;
  readonly carbohydrateG: number | null;
  readonly fatG: number | null;
  readonly calorieRangeKcal: NutritionEstimateRange | null;
  readonly proteinRangeG: NutritionEstimateRange | null;
  readonly carbohydrateRangeG: NutritionEstimateRange | null;
  readonly fatRangeG: NutritionEstimateRange | null;
  /**
   * Model confidence in [0, 1]. Below 0.5 the route surfaces
   * the draft with a "low confidence" warning.
   */
  readonly confidence: number;
  /**
   * Free-text warnings the AI attached. Always surfaced verbatim
   * to the user; never logged.
   */
  readonly warnings: readonly string[];
  readonly assumptions: readonly string[];
  readonly provenance: {
    readonly inputKind: "photo" | "text";
    readonly provider: string;
    readonly model: string;
    readonly promptVersion: string;
  };
}

export interface VisionDraftProvider {
  status(): Promise<{ readonly ready: boolean; readonly provider: string }>;
  /**
   * Generate a draft candidate. The provider MUST throw
   * `VisionProviderError` on any failure; the route maps that
   * to a 502/503 envelope.
   */
  generateDraft(request: VisionDraftRequest): Promise<VisionDraftCandidate>;
  generateTextDraft?(
    request: TextFoodDraftRequest,
  ): Promise<VisionDraftCandidate>;
  /**
   * AI-ACT-007 — refine an existing draft. Optional; the route
   * returns 503 when not implemented. The provider MUST throw
   * `VisionProviderError` on any failure.
   */
  refineDraft?(request: RefineFoodDraftRequest): Promise<VisionDraftCandidate>;
}

export type VisionProviderFailureKind =
  | "not_configured"
  | "external_access_disabled"
  | "authentication"
  | "rate_limited"
  | "timeout"
  | "invalid_request"
  | "refused"
  | "malformed_response"
  | "unavailable";

export class VisionProviderError extends Error {
  readonly code = "VISION_PROVIDER_ERROR";
  constructor(
    readonly kind: VisionProviderFailureKind,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "VisionProviderError";
  }
}

/**
 * Default provider when no Mistral vision workspace is configured.
 * Returns a candidate with `name: null` and a "not configured"
 * warning; the route maps that to a 503 with a safe
 * "AI vision is not configured" message.
 */
export class DisabledVisionProvider implements VisionDraftProvider {
  async status(): Promise<{
    readonly ready: boolean;
    readonly provider: string;
  }> {
    return { ready: false, provider: "disabled" };
  }
  async generateDraft(): Promise<VisionDraftCandidate> {
    throw new VisionProviderError(
      "not_configured",
      "AI vision is not configured. Set MISTRAL_VISION_API_KEY and MISTRAL_VISION_MODEL to enable photo drafts.",
      false,
    );
  }
  async generateTextDraft(): Promise<VisionDraftCandidate> {
    return this.generateDraft();
  }
  async refineDraft(): Promise<VisionDraftCandidate> {
    return this.generateDraft();
  }
}

/**
 * Development-only canned-suggestion provider. Returns a
 * deterministic candidate with the user's text hint as the food
 * name. The model is never called; the route sees a real draft
 * shape and the mobile UI sees a realistic round-trip. Use
 * `AGENT_PROVIDER=vision-dev` to enable.
 */
export class StubVisionProvider implements VisionDraftProvider {
  async status(): Promise<{
    readonly ready: boolean;
    readonly provider: string;
  }> {
    return { ready: true, provider: "vision-dev-stub" };
  }
  async generateDraft(
    request: VisionDraftRequest,
  ): Promise<VisionDraftCandidate> {
    const hint = request.textHint?.trim() ?? "";
    return {
      name: hint.length > 0 ? hint : "AI could not identify the food",
      caloriesKcal: 350,
      proteinG: 12,
      carbohydrateG: 40,
      fatG: 14,
      calorieRangeKcal: { low: 280, high: 430 },
      proteinRangeG: { low: 9, high: 16 },
      carbohydrateRangeG: { low: 32, high: 50 },
      fatRangeG: { low: 10, high: 19 },
      confidence: 0.45,
      warnings: [
        hint.length === 0
          ? "AI could not identify the food from this photo."
          : "Stub provider: please verify every value before saving.",
      ],
      assumptions: ["Assumes one ordinary serving."],
      provenance: {
        inputKind: "photo",
        provider: "vision-dev-stub",
        model: "deterministic-stub",
        promptVersion: "nutrition-draft-v2",
      },
    };
  }
  async generateTextDraft(
    request: TextFoodDraftRequest,
  ): Promise<VisionDraftCandidate> {
    const photoLikeRequest: VisionDraftRequest = {
      userId: request.userId,
      photo: new Uint8Array(),
      mimeType: "image/jpeg",
      textHint: request.description,
      ...(request.requestId === undefined
        ? {}
        : { requestId: request.requestId }),
    };
    const candidate = await this.generateDraft(photoLikeRequest);
    return {
      ...candidate,
      provenance: { ...candidate.provenance, inputKind: "text" },
    };
  }
  async refineDraft(
    request: RefineFoodDraftRequest,
  ): Promise<VisionDraftCandidate> {
    // Dev-only deterministic stub: detect a handful of simple
    // portion-change phrases and scale the existing draft
    // proportionally so the test suite can observe a real
    // round-trip. Anything we don't recognise is echoed back
    // with a low-confidence warning.
    const instruction = request.instruction.trim().toLowerCase();
    const draft = request.currentDraft;
    const scale = (() => {
      if (/\b(double|2x|twice as much|two times)\b/.test(instruction)) {
        return 2;
      }
      if (/\b(half|halve|0\.5x|0,5x)\b/.test(instruction)) {
        return 0.5;
      }
      if (/\b(triple|3x|three times)\b/.test(instruction)) {
        return 3;
      }
      const gramsMatch = instruction.match(
        /(\d+(?:\.\d+)?)\s*g(?:rams?)?\s+(?:instead of|vs\.?)\s+(\d+(?:\.\d+)?)\s*g(?:rams?)?/,
      );
      if (gramsMatch !== null) {
        const newGrams = Number(gramsMatch[1]);
        const oldGrams = Number(gramsMatch[2]);
        if (oldGrams > 0 && Number.isFinite(newGrams)) {
          return newGrams / oldGrams;
        }
      }
      return null;
    })();
    if (scale === null) {
      return {
        ...draft,
        confidence: Math.max(0.1, draft.confidence - 0.1),
        warnings: [
          ...draft.warnings,
          "Stub refine provider: instruction not recognised. Edit values manually.",
        ],
        assumptions: [
          ...draft.assumptions,
          "Stub refine: no portion adjustment applied.",
        ],
        provenance: {
          ...draft.provenance,
          provider: "vision-dev-stub",
          model: "deterministic-stub",
          promptVersion: "nutrition-draft-refine-v1",
        },
      };
    }
    const scaledNumber = (value: number | null): number | null =>
      value === null ? null : Math.round(value * scale * 100) / 100;
    const scaledRange = (
      value: { low: number; high: number } | null,
    ): { low: number; high: number } | null =>
      value === null
        ? null
        : {
            low: Math.round(value.low * scale * 100) / 100,
            high: Math.round(value.high * scale * 100) / 100,
          };
    return {
      ...draft,
      caloriesKcal: scaledNumber(draft.caloriesKcal),
      proteinG: scaledNumber(draft.proteinG),
      carbohydrateG: scaledNumber(draft.carbohydrateG),
      fatG: scaledNumber(draft.fatG),
      calorieRangeKcal: scaledRange(draft.calorieRangeKcal),
      proteinRangeG: scaledRange(draft.proteinRangeG),
      carbohydrateRangeG: scaledRange(draft.carbohydrateRangeG),
      fatRangeG: scaledRange(draft.fatRangeG),
      confidence: draft.confidence,
      warnings: [
        ...draft.warnings,
        `Stub refine: portion scaled by ${scale}x. Verify every value before saving.`,
      ],
      assumptions: [
        ...draft.assumptions,
        `Stub refine assumes a uniform ${scale}x scale.`,
      ],
      provenance: {
        ...draft.provenance,
        provider: "vision-dev-stub",
        model: "deterministic-stub",
        promptVersion: "nutrition-draft-refine-v1",
      },
    };
  }
}
