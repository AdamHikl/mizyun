import type { Clock, ConversationId, UserId } from "@mizyun/core";
import { systemClock } from "@mizyun/core";
import type { MemoryRecord, MemoryStore } from "@mizyun/memory";

export type AgentProviderStatus =
  | { readonly ready: true; readonly provider: string }
  | {
      readonly ready: false;
      readonly provider: string;
      readonly reason: string;
    };

export interface AgentMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
}

export interface AgentRequest {
  readonly userId: UserId;
  readonly conversationId: ConversationId;
  readonly messages: readonly AgentMessage[];
  readonly memories: readonly MemoryRecord[];
}

export interface AgentResponse {
  readonly message: AgentMessage & { readonly role: "assistant" };
  readonly provider: string;
  readonly providerMetadata?: Readonly<Record<string, unknown>>;
}

export interface AgentProvider {
  status(): Promise<AgentProviderStatus>;
  respond(request: AgentRequest): Promise<AgentResponse>;
}

export class AgentProviderUnavailableError extends Error {
  readonly code = "AGENT_PROVIDER_NOT_CONFIGURED";

  constructor(message = "No model provider has been configured.") {
    super(message);
    this.name = "AgentProviderUnavailableError";
  }
}

export class DisabledAgentProvider implements AgentProvider {
  async status(): Promise<AgentProviderStatus> {
    return {
      ready: false,
      provider: "disabled",
      reason: "Complete docs/BEFORE_TESTING.md before enabling AI features.",
    };
  }

  async respond(_request: AgentRequest): Promise<AgentResponse> {
    throw new AgentProviderUnavailableError();
  }
}

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
  }): Promise<AgentResponse> {
    const latestUserMessage = [...input.messages]
      .reverse()
      .find((message) => message.role === "user");
    const memories = await this.#memories.search({
      userId: input.userId,
      text: latestUserMessage?.text ?? "",
      limit: this.#memoryLimit,
      asOf: this.#clock.now(),
    });

    return this.#provider.respond({ ...input, memories });
  }
}
