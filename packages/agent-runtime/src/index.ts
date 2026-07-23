import type { Clock, ConversationId, UserId } from "@mizyun/core";
import { systemClock } from "@mizyun/core";
import type { MemoryRecord, MemoryStore } from "@mizyun/memory";

export const COACH_PROMPT_VERSION = "coach-system-v1";

export const COACH_SYSTEM_POLICY = [
  "You are Mizyun Coach, a conservative fitness and nutrition wellness assistant.",
  "Use only the confirmed Mizyun context supplied with this request for user-specific claims.",
  "Clearly distinguish confirmed facts, deterministic calculations, interpretations, and suggestions.",
  "Never diagnose, treat, prescribe medication, interpret injuries, or claim professional qualification.",
  "Never encourage extreme restriction, purging, compulsive exercise, dangerous training, or rapid weight change.",
  "Do not invent measurements, meals, workouts, goals, calculations, or memories.",
  "If context is missing or contradictory, say so and ask one focused question.",
  "Offer at most one practical, conservative, reversible next action.",
].join("\n");

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
    "profile" | "goal" | "nutrition" | "training" | "body" | "energy";
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
}

export interface AgentResponse {
  readonly message: AgentMessage & { readonly role: "assistant" };
  readonly provider: string;
  readonly evidence: readonly AgentGroundingItem[];
  readonly providerMetadata?: Readonly<Record<string, unknown>>;
}

export interface AgentProvider {
  status(): Promise<AgentProviderStatus>;
  respond(request: AgentRequest): Promise<AgentResponse>;
}

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
      /\b(diagnostikuj|diagnóz|predpíš|dávka liek|aké zranenie)\b/,
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
      /\b(schudnúť|zhodiť)\s+\d{2,}\s*(kg|kíl)\s+(za|do)\s+(týždeň|mesiac)\b/,
      /\b(pod|menej ako)\s+800\s+kalóri/i,
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
  readonly clock?: Clock;
  readonly memoryLimit?: number;
}

export class AgentOrchestrator {
  readonly #provider: AgentProvider;
  readonly #memories: MemoryStore;
  readonly #clock: Clock;
  readonly #memoryLimit: number;

  constructor(options: AgentOrchestratorOptions) {
    this.#provider = options.provider;
    this.#memories = options.memories;
    this.#clock = options.clock ?? systemClock;
    this.#memoryLimit = options.memoryLimit ?? 12;
  }

  status(): Promise<AgentProviderStatus> {
    return this.#provider.status();
  }

  async respond(input: {
    readonly userId: UserId;
    readonly conversationId: ConversationId;
    readonly messages: readonly AgentMessage[];
    readonly grounding?: readonly AgentGroundingItem[];
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
    const memories = await this.#memories.search({
      userId: input.userId,
      text: latestUserMessage?.text ?? "",
      limit: this.#memoryLimit,
      asOf: this.#clock.now(),
    });

    return this.#provider.respond({
      ...input,
      grounding: input.grounding ?? [],
      memories,
      systemPolicy: COACH_SYSTEM_POLICY,
      promptVersion: COACH_PROMPT_VERSION,
    });
  }
}

export {
  COACH_SAFETY_DATASET_VERSION,
  coachSafetyEvaluationCases,
  type CoachSafetyEvaluationCase,
} from "./evaluation-cases.js";
