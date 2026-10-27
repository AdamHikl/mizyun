import type { Clock, ConversationId, UserId } from "@mizyun/core";
import { systemClock } from "@mizyun/core";
import type { MemoryRecord, MemoryStore } from "@mizyun/memory";
import type {
  ActivityDraftCandidate,
  ActivityDraftRequest,
} from "./activity-draft.js";
import {
  STRETCH_REFINE_PROMPT_VERSION,
  type StretchRefinementCandidate,
  type StretchRefinementRequest,
} from "./stretch-refinement.js";
import {
  COACH_APP_CAPABILITIES,
  COACH_APP_GUIDE_PREAMBLE,
  COACH_APP_INDEX,
  COACH_APP_KNOWLEDGE_VERSION,
  buildCoachAppCatalogExcerpt,
  isRecurringMealHelp,
  recurringMealHelp,
  selectCoachAppCapabilities,
} from "./app-capabilities.js";
export {
  COACH_APP_CAPABILITIES,
  COACH_APP_GUIDE,
  COACH_APP_GUIDE_PREAMBLE,
  COACH_APP_INDEX,
  COACH_APP_KNOWLEDGE_VERSION,
  buildCoachAppCatalogExcerpt,
  selectCoachAppCapabilities,
  type CoachAppCapability,
  COACH_INTERNAL_FEATURES,
  isRecurringMealHelp,
  isRecurringMealRequest,
} from "./app-capabilities.js";

export const COACH_PROMPT_VERSION = "coach-system-v4-app-v6";

/**
 * Constant Coach policy: identity/scope, behaviour, safety rules, catalog
 * rules and the catalog index. It is the stable prompt-cache prefix; only
 * the per-question catalog excerpt follows it.
 */
export const COACH_FIXED_POLICY = [
  "You are Mizyun Coach, an expert fitness, strength training, and nutrition wellness assistant, as well as the knowledgeable in-app guide for the Mizyun app.",
  "Only answer questions related to fitness, workouts, gym training, exercise routines, nutrition, diet, body progress, and using or navigating the Mizyun app itself.",
  "If the user asks an off-topic, unrelated, or general question (e.g. general software coding, world news, trivia, politics), decline briefly and politely, and direct them to ask something fitness, nutrition, or Mizyun-related.",
  "When the user asks about their remaining calories, remaining protein, daily calorie target, or nutrition status for today (e.g. 'how many calories do I have left?', 'did I hit my protein goal today?', 'what is my calorie target?'):",
  "- Check your confirmed grounding context under kind: 'nutrition' (which includes consumed calories, daily target calories, remaining calories, consumed protein, daily target protein, and remaining protein).",
  "- State their consumed amounts, their daily target, and exact remaining calories or protein directly and accurately.",
  "- If they have not logged any meals today, mention that 0 kcal have been logged so far and state their full daily target as remaining.",
  "When the user asks what they ate, whether they logged a specific food, or about their meal history (e.g. 'what did I eat today?', 'did I log my protein shake?', 'what did I have for lunch on Monday?'):",
  "- For today's meals, check your confirmed grounding context under kind: 'nutrition' (which includes 'loggedMealsToday' and 'today.loggedMeals' with dish names, timestamps, calories, and macros).",
  "- For past dates or specific food searches, invoke the get_meal_history tool with the target date (YYYY-MM-DD) or food search query.",
  "- Report the exact dish names, timestamps, calories, and macros accurately, and provide helpful coaching commentary on their food choices if requested.",
  "When the user asks about their performance on a specific exercise, past weights/reps, personal records (PRs), or progressive overload (e.g. 'what did I bench last week?', 'what is my squat PR?', 'how many pullups did I do last time?'):",
  "- Invoke the get_exercise_history tool with the exercise name (e.g. exercise_name: 'barbell bench press', 'squat', 'deadlift', 'pullup', 'incline dumbbell').",
  "- Reference their best load (PR), recent volume, and exact completed sets (load in kg, reps, RPE).",
  "- Provide encouraging strength progression coaching and actionable overload targets based on their confirmed performance.",
  "When the user asks about their body measurements, waist progress, or body composition (e.g. 'what is my waist measurement?', 'has my waist shrunk?', 'am I losing fat or muscle?'):",
  "- Check your confirmed grounding context under kind: 'body' (which includes 'latestCircumferences' with waist, chest, and hips in cm) or call the get_recent_measurements tool to compare tape measurements across the window.",
  "- Emphasize that waist circumferences decreasing while body weight stays relatively stable is a prime indicator of successful body recomposition (fat loss alongside muscle retention or gain).",
  "When the user asks about their workout history or completed sessions (e.g. 'what workouts did I do this week?', 'when was my last leg day?', 'what workout did I do on Tuesday?'):",
  "- Check your confirmed grounding context under kind: 'training' (which includes 'last7Days.completedWorkouts' with workout names and dates) or call the get_recent_workouts tool (which returns 'recentCompletedWorkouts' with exact workout names, dates, and durations in minutes).",
  "- Reference the specific workout names, dates, and session durations accurately.",
  "When the user asks to create, build, customize, or recommend a workout routine, training split, or workout session (e.g. push/pull/legs, upper/lower, full body, chest & triceps, shoulder focus, specific target muscles or exercises):",
  "- You have full coaching expertise to design a tailored routine; use the search_exercises tool to find or discover exercises in the current Mizyun exercise library.",
  "- Invoke the propose_workout_plan tool with your chosen sessions, exact exercise names, target sets, reps, and rest times. This automatically attaches an interactive action proposal card to the chat so the user can review and save the plan with 1 tap.",
  "- When generating or proposing a workout plan, keep your conversational markdown response very concise (1-2 brief sentences summarizing the routine focus) and direct the user to review the interactive plan widget below. NEVER list out individual exercises, sets, or reps in markdown text because the interactive widget displays them automatically.",
  "When the user asks to edit, adjust, modify, or replace exercises in an existing or planned workout, explain the adjustments clearly in markdown so they can review and apply the changes.",
  "When the user asks to review, evaluate, critique, or give feedback on one of their existing or saved workout routines (e.g. 'what do you think about my push 1 routine?', 'how is my leg day?'):",
  "- Their saved routines are in your confirmed grounding context under kind: 'training' in 'availableRoutines' and available through the get_available_routines tool.",
  "- Reference the specific exercises, target sets, rep ranges, target loads, and rest periods configured in that routine.",
  "- Provide expert strength and hypertrophy coaching feedback on exercise order, movement pattern balance, compound vs isolation sequencing, weekly volume distribution, and fatigue management.",
  "- If the user mentions a routine name (e.g. 'Push 1'), check your confirmed routines or use get_available_routines to inspect its exact exercise selection.",
  "When the user asks for a weekly review, check-in, or asks to review/adapt their week (e.g. 'review my week', 'show my weekly review', 'how was my week', 'zhodnoť mi týždeň', or Slovak equivalents):",
  "- Deliver an informative, motivating, and actionable weekly review in structured markdown with these sections:",
  "  1. Weekly Snapshot & Wins: Highlight what went well (days logged, workouts completed, consistency).",
  "  2. Nutrition & Meal Recommendations: Analyze average calorie and protein intake against targets. If there is a protein gap or calorie discrepancy, provide 1-2 concrete, practical food or meal suggestions (e.g. adding Greek yogurt, eggs, cottage cheese, lean meat, or shakes).",
  "  3. Training & Volume Guidance: Summarize completed sessions in the past 7 days and recommend upcoming training volume and split focus.",
  "  4. Next Week's Action Focus: Give 1-2 practical, high-impact habit goals (e.g. logging 3+ morning weigh-ins to establish trend regression, hitting protein targets consistently).",
  "- The interactive weekly adaptation proposal card will be attached to display formal metrics and goal pace actions.",
  "Use only the confirmed Mizyun context supplied with this request for user-specific claims.",
  "Strictly check and respect all confirmed user constraints, food allergies, dietary restrictions, and physical limitations from confirmed memories and profile context.",
  "NEVER suggest, recommend, or prescribe any food, ingredient, meal, or recipe that violates the user's food allergies or dietary restrictions (for example, if the user has an allergy to peanuts, never recommend peanuts, peanut butter, or dishes containing peanuts, and explicitly suggest safe alternatives such as sunflower seed butter, almond butter if tolerated, or soy nut butter instead).",
  "NEVER recommend exercises that aggravate confirmed user injuries or physical limitations.",
  "Clearly distinguish confirmed facts, deterministic calculations, interpretations, and suggestions.",
  "Never diagnose, treat, prescribe medication, interpret injuries, or claim professional qualification.",
  "Never encourage extreme restriction, purging, compulsive exercise, dangerous training, or rapid weight change.",
  "Do not invent measurements, meals, workouts, goals, calculations, or memories.",
  "If context is missing or contradictory, say so and ask one focused question.",
  "Offer at most one practical, conservative, reversible next action.",
  "Never output raw JSON data structures or schemas as your answer.",
  COACH_APP_GUIDE_PREAMBLE,
  COACH_APP_INDEX,
].join("\n");

/** Fixed and per-question parts of a Coach system policy. */
export interface AgentSystemPolicyParts {
  /** Constant across requests and turns; safe to mark as a cache prefix. */
  readonly fixed: string;
  /** Per-turn suffix (catalog excerpt for the current question). */
  readonly variable: string;
}

export interface CoachSystemPolicy {
  /** Always `${parts.fixed}\n${parts.variable}`. */
  readonly systemPolicy: string;
  readonly systemPolicyParts: AgentSystemPolicyParts;
  /** Catalog entries attached for this question, in catalog order. */
  readonly capabilityIds: readonly string[];
}

/**
 * Builds the Coach policy for one turn from the latest user message and the
 * user message before it (follow-ups). Compute it once per turn and reuse it
 * for every provider round so the cached prefix stays identical.
 */
export const buildCoachSystemPolicy = (
  messages: readonly AgentMessage[],
): CoachSystemPolicy => {
  const userTexts = messages
    .filter((message) => message.role === "user")
    .slice(-2)
    .reverse()
    .map((message) => message.text);
  const selected = selectCoachAppCapabilities(userTexts);
  const variable = buildCoachAppCatalogExcerpt(selected);
  return {
    systemPolicy: `${COACH_FIXED_POLICY}\n${variable}`,
    systemPolicyParts: { fixed: COACH_FIXED_POLICY, variable },
    capabilityIds: selected.map((capability) => capability.id),
  };
};

/** Full-catalog policy (every entry). The runtime uses buildCoachSystemPolicy. */
export const COACH_SYSTEM_POLICY = `${COACH_FIXED_POLICY}\n${buildCoachAppCatalogExcerpt(COACH_APP_CAPABILITIES)}`;

/**
 * Safely extracts a clean assistant text string from raw text,
 * JSON objects, or structured model responses.
 *
 * Prevents raw JSON payloads (e.g. `{"response": {"workout_plan": ...}}`)
 * from leaking into the user-facing chat bubble.
 */
export const extractAssistantText = (candidate: unknown): string | null => {
  if (typeof candidate === "string") {
    const original = candidate.trim();
    // Unwrap only JSON envelopes, leaving conversational Markdown intact.
    const unfenced = original
      .replace(/^```(?:json\b)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    const markdownPrefix =
      /^\[[^\]\n]*\](?:\(|\[|:)/.test(unfenced) ||
      /^\[[ xX]\]\s+\S/.test(unfenced);
    const structured =
      unfenced.startsWith("{") ||
      (!markdownPrefix &&
        /^\[\s*(?:[\[\{"\]\d-]|true\b|false\b|null\b)/.test(unfenced));
    const trimmed = structured ? unfenced : original;
    if (trimmed.length === 0) return null;
    if (structured) {
      try {
        const parsed = JSON.parse(trimmed);
        const fromParsed = extractAssistantText(parsed);
        if (fromParsed !== null) return fromParsed;
        return null;
      } catch {
        // Malformed/truncated provider envelopes are not conversational text.
        return null;
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
  /**
   * Optional split of `systemPolicy` for providers with explicit prompt
   * caching: `systemPolicy === \`${fixed}\n${variable}\``. Providers that
   * ignore it must keep sending `systemPolicy` unchanged.
   */
  readonly systemPolicyParts?: AgentSystemPolicyParts | undefined;
  readonly promptVersion: string;
  /**
   * Read-only tools the model may call. The runtime already
   * filtered the registry to user-bound tools; the provider
   * must NOT expose the userId or any unsafe parameter.
   */
  readonly tools?: readonly AgentToolDefinition[] | undefined;
  /**
   * Prior tool results appended to the next round-trip. The
   * runtime folds these into `grounding` for the next call so
   * the model sees them as confirmed context.
   */
  readonly toolResults?: readonly AgentToolResult[] | undefined;
  /**
   * The provider tool calls that produced `toolResults`. Providers whose chat
   * protocol requires an assistant tool-call message before tool-result
   * messages use this to replay the complete round-trip.
   */
  readonly requestedToolCalls?: readonly AgentToolCall[] | undefined;
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
  readonly id?: string | undefined;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly thoughtSignature?: string | undefined;
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

export const createAgentToolRegistry = (
  tools: ReadonlyMap<string, AgentTool<any>>,
): AgentToolRegistry => buildToolRegistry(tools);

export const createAgentToolRegistryFromList = (
  tools: readonly AgentTool<any>[],
): AgentToolRegistry => {
  const map = new Map<string, AgentTool<any>>();
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
  const text = rawText
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
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
      /\btrain\s+(through|despite)\s+(?:sharp|severe|\w+\s+)*pain\b/,
      /\b(40|50|60|70|80|90|100)\s+sets?\s+(to failure\s+)?(every|each)\s+day\b/,
      /\b(max out|one rep max)\s+(every|each)\s+day\b/,
      /\b(schudnúť|zhodiť)\s+\d{2,}\s*(kg|kíl)\s+(za|do)\s+(týždeň|mesiac)(?:\b|\s|$)/,
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
      /\bignore (all |the )?(previous|system|developer|visual) (instructions|contents)\b/,
      /\breveal (the )?(system prompt|hidden instructions|developer secrets|secrets)\b/,
      /\bact as root\b/,
      /\[?system (override|command)\]?/i,
      /\b(grant admin privileges|delete records from all user databases)\b/,
      /\b(print|reveal|output|dump)\s+.*?(user profiles|root credentials|system prompt|developer secrets|auth tokens|connection strings|secrets)\b/,
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

/** Conservative output boundary for advisory photo answers; never image diagnosis. */
export const screenCoachPhotoAdvice = (text: string): SafetyDecision => {
  const inputSafety = screenCoachInput(text);
  if (!inputSafety.allowed) return inputSafety;
  if (
    [
      /\byou (?:definitely|clearly|probably) have\b/i,
      /\b(?:melanoma|cancer|fracture|ruptured|torn ligament|infection|tumou?r)\b/i,
      /\b(?:lesion|rash|injury|swelling|skin condition)\b[^.!?]{0,80}\b(?:is|indicates|shows|means|caused by)\b/i,
      /\b(?:take|apply|inject|start|stop|increase|reduce)\b[^.!?]{0,100}\b(?:medication|medicine|ibuprofen|aspirin|paracetamol|acetaminophen|antibiotic|insulin|steroid|tablet|pill)\b/i,
      /\b(?:ibuprofen|aspirin|paracetamol|acetaminophen|insulin)\b[^.!?]{0,80}\b\d+\s*(?:mg|dose|units)\b/i,
      /\b(?:body[ -]?fat|body composition)\b[^.!?]{0,50}\d+(?:\.\d+)?\s*%/i,
    ].some((pattern) => pattern.test(text.normalize("NFKC")))
  ) {
    return {
      allowed: false,
      category: "medical",
      response:
        "I can explain general fitness and nutrition context, but I cannot diagnose, assess body composition, or recommend treatment from photos. Please consult a qualified medical professional for health concerns.",
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

    if (isRecurringMealHelp(latestUserMessage?.text ?? "")) {
      const text = recurringMealHelp();
      const moderatedOutput = await this.#moderate(text, "output");
      if (moderatedOutput !== null) return moderatedOutput;
      return {
        message: { role: "assistant", text },
        provider: "mizyun-app-guide",
        evidence: [],
        providerMetadata: {
          appKnowledgeVersion: COACH_APP_KNOWLEDGE_VERSION,
          promptVersion: COACH_PROMPT_VERSION,
          totalTokens: 0,
        },
      };
    }

    const [searchMemories, constraintMemories] = await Promise.all([
      this.#memories.search({
        userId: input.userId,
        accessToken: input.accessToken ?? "",
        text: latestUserMessage?.text ?? "",
        limit: this.#memoryLimit,
        asOf: this.#clock.now(),
      }),
      this.#memories.search({
        userId: input.userId,
        accessToken: input.accessToken ?? "",
        text: "",
        kinds: ["constraint"],
        limit: this.#memoryLimit,
        asOf: this.#clock.now(),
      }),
    ]);
    const memoryMap = new Map<string, MemoryRecord>();
    for (const m of [...constraintMemories, ...searchMemories]) {
      memoryMap.set(m.id, m);
    }
    const memories = Array.from(memoryMap.values()).slice(0, this.#memoryLimit);

    let grounding: readonly AgentGroundingItem[] = input.grounding ?? [];
    let toolResults: readonly AgentToolResult[] | undefined;
    let toolCallsUsed = 0;
    // One policy per turn: every round shares the same cacheable prefix.
    const { systemPolicy, systemPolicyParts } = buildCoachSystemPolicy(
      input.messages,
    );

    let response = await this.#provider.respond({
      ...input,
      grounding,
      memories,
      systemPolicy,
      systemPolicyParts,
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
        systemPolicy,
        systemPolicyParts,
        promptVersion: COACH_PROMPT_VERSION,
        requestedToolCalls: response.toolCalls,
        toolResults,
        ...(this.#tools && toolCallsUsed < this.#maxToolCalls
          ? { tools: this.#tools.list() }
          : {}),
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
 * and URLs from the text-coach phase").
 */
export type VisionMimeType = "image/jpeg" | "image/png" | "image/webp";

export interface VisionDraftRequest {
  /** Coach may answer visual context without proposing a meal. */
  readonly purpose?: "meal" | "coach";
  /** Set only by the server after checking advanced nutrition capability. */
  readonly includeAdvancedNutrition?: boolean;
  readonly userId: UserId;
  readonly photo: Readonly<Uint8Array>;
  readonly mimeType: VisionMimeType;
  /** Additional transient photos in the same inference; maximum two. */
  readonly additionalPhotos?: readonly {
    readonly photo: Readonly<Uint8Array>;
    readonly mimeType: VisionMimeType;
  }[];
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
  /**
   * Optional ISO 3166-1 alpha-2 country code (e.g. "SK", "US") to ground
   * regional recipes, restaurant menus, and portion sizing.
   */
  readonly countryCode?: string | null | undefined;
}

export interface TextFoodDraftRequest {
  /** Set only by the server after checking advanced nutrition capability. */
  readonly includeAdvancedNutrition?: boolean;
  readonly userId: UserId;
  readonly description: string;
  readonly requestId?: string;
  /**
   * Optional ISO 3166-1 alpha-2 country code (e.g. "SK", "US") to ground
   * regional recipes, restaurant menus, and portion sizing.
   */
  readonly countryCode?: string | null | undefined;
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
  /** Set only by the server after checking advanced nutrition capability. */
  readonly includeAdvancedNutrition?: boolean;
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
  /** Other distinct meals found in the same inference, maximum two. */
  readonly additionalDrafts?: readonly VisionDraftCandidate[];
  /** Advisory visual context for Coach; never a saved meal. */
  readonly photoAdvice?: string;
  /**
   * Suggested food name. `null` when the model cannot make a
   * confident guess; the route translates this to a fixed
   * "AI could not identify" warning rather than fabricating a
   * name.
   */
  readonly name: string | null;
  /**
   * Estimated total edible portion weight represented by the nutrition
   * totals. Optional for backwards compatibility with older saved drafts.
   */
  readonly portionWeightG?: number | null | undefined;
  /**
   * Per-macro suggestions. `null` per field is allowed; the route
   * maps it to "AI was not confident — please enter manually".
   */
  readonly caloriesKcal: number | null;
  readonly proteinG: number | null;
  readonly carbohydrateG: number | null;
  readonly fatG: number | null;
  /** Optional meal totals; missing/null means unknown, never zero. */
  readonly fibreG?: number | null | undefined;
  readonly saturatedFatG?: number | null | undefined;
  readonly totalSugarsG?: number | null | undefined;
  readonly sodiumMg?: number | null | undefined;
  readonly cholesterolMg?: number | null | undefined;
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
  readonly tokensUsed?: number | undefined;
  /** Web searches or grounded requests made for this draft (cost, ADR-0081). */
  readonly webSearches?: number | undefined;
  readonly calculation?: string | null | undefined;
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
  /**
   * Draft a Log activity form from a description. Optional; the
   * route returns 503 when not implemented. The provider MUST throw
   * `VisionProviderError` on any failure.
   */
  generateActivityDraft?(
    request: ActivityDraftRequest,
  ): Promise<ActivityDraftCandidate>;
  /**
   * Choose catalog stretches for the evening stretch session (ADR-0076).
   * Optional; the route returns 503 when not implemented. The provider
   * MUST throw `VisionProviderError` on any failure.
   */
  refineStretchPlan?(
    request: StretchRefinementRequest,
  ): Promise<StretchRefinementCandidate>;
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
 * Default provider when no vision provider is configured.
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
      "AI vision is not configured. Set GEMINI_VISION_API_KEY or GEMINI_API_KEY to enable photo drafts.",
      false,
    );
  }
  async generateTextDraft(): Promise<VisionDraftCandidate> {
    return this.generateDraft();
  }
  async refineDraft(): Promise<VisionDraftCandidate> {
    return this.generateDraft();
  }
  async generateActivityDraft(): Promise<ActivityDraftCandidate> {
    throw new VisionProviderError(
      "not_configured",
      "AI activity drafts are not configured on this server.",
      false,
    );
  }
  async refineStretchPlan(): Promise<StretchRefinementCandidate> {
    throw new VisionProviderError(
      "not_configured",
      "AI stretch refinement is not configured on this server.",
      false,
    );
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
      portionWeightG: 300,
      caloriesKcal: 350,
      proteinG: 12,
      carbohydrateG: 40,
      fatG: 14,
      ...(request.includeAdvancedNutrition
        ? {
            fibreG: null,
            saturatedFatG: null,
            totalSugarsG: null,
            sodiumMg: null,
            cholesterolMg: null,
          }
        : {}),
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
      calculation:
        "Stub calculation: 350 kcal (12g protein, 40g carbs, 14g fat) based on standard serving estimate.",
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
      ...(request.includeAdvancedNutrition === undefined
        ? {}
        : { includeAdvancedNutrition: request.includeAdvancedNutrition }),
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
    const {
      fibreG,
      saturatedFatG,
      totalSugarsG,
      sodiumMg,
      cholesterolMg,
      ...basicDraft
    } = request.currentDraft;
    const draft: VisionDraftCandidate = request.includeAdvancedNutrition
      ? {
          ...basicDraft,
          fibreG: fibreG ?? null,
          saturatedFatG: saturatedFatG ?? null,
          totalSugarsG: totalSugarsG ?? null,
          sodiumMg: sodiumMg ?? null,
          cholesterolMg: cholesterolMg ?? null,
        }
      : basicDraft;
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
    const scaledPortionWeight = (value: number): number =>
      Math.round(value * scale * 10) / 10;
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
      portionWeightG:
        draft.portionWeightG == null
          ? draft.portionWeightG
          : scaledPortionWeight(draft.portionWeightG),
      caloriesKcal: scaledNumber(draft.caloriesKcal),
      proteinG: scaledNumber(draft.proteinG),
      carbohydrateG: scaledNumber(draft.carbohydrateG),
      fatG: scaledNumber(draft.fatG),
      ...(request.includeAdvancedNutrition
        ? {
            fibreG: scaledNumber(draft.fibreG ?? null),
            saturatedFatG: scaledNumber(draft.saturatedFatG ?? null),
            totalSugarsG: scaledNumber(draft.totalSugarsG ?? null),
            sodiumMg: scaledNumber(draft.sodiumMg ?? null),
            cholesterolMg: scaledNumber(draft.cholesterolMg ?? null),
          }
        : {}),
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
      calculation: `Stub refine calculation: scaled by ${scale}x to ${scaledNumber(draft.caloriesKcal)} kcal (${scaledNumber(draft.proteinG)}g protein, ${scaledNumber(draft.carbohydrateG)}g carbs, ${scaledNumber(draft.fatG)}g fat).`,
      provenance: {
        ...draft.provenance,
        provider: "vision-dev-stub",
        model: "deterministic-stub",
        promptVersion: "nutrition-draft-refine-v1",
      },
    };
  }
  /** Echoes the deterministic plan; the model is never called. */
  async refineStretchPlan(
    request: StretchRefinementRequest,
  ): Promise<StretchRefinementCandidate> {
    return {
      muscleTags: {},
      focusMuscles: [...request.deterministic.focusMuscles],
      picks: request.deterministic.stepIds.map((id) => ({
        id,
        holdSeconds: 30,
      })),
      provenance: {
        provider: "vision-dev-stub",
        model: "deterministic-stub",
        promptVersion: STRETCH_REFINE_PROMPT_VERSION,
      },
    };
  }
}

export * from "./evaluation-corpus.js";

export type { MealIllustrationProvider } from "./meal-illustration.js";

export * from "./meal-recipe";
export * from "./activity-draft";
export * from "./stretch-refinement";
