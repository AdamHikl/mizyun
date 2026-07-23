import type {
  ConversationId,
  ConversationRepository,
  StoredConversation,
  StoredConversationMessage,
  UserId,
} from "@mizyun/core";

export class InMemoryConversationRepository implements ConversationRepository {
  readonly #conversations = new Map<ConversationId, StoredConversation>();
  readonly #messages = new Map<ConversationId, StoredConversationMessage[]>();

  async create(
    userId: UserId,
    input: { readonly id: ConversationId; readonly title: string | null },
    options: { readonly accessToken: string; readonly now: Date },
  ): Promise<StoredConversation> {
    const stored: StoredConversation = {
      id: input.id,
      userId,
      title: input.title,
      status: "active",
      providerMetadata: {},
      createdAt: options.now,
      updatedAt: options.now,
    };
    this.#conversations.set(stored.id, stored);
    this.#messages.set(stored.id, []);
    return stored;
  }

  async list(
    userId: UserId,
    options: { readonly accessToken: string; readonly limit: number },
  ): Promise<readonly StoredConversation[]> {
    return [...this.#conversations.values()]
      .filter((conversation) => conversation.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, options.limit);
  }

  async get(
    userId: UserId,
    conversationId: ConversationId,
    _options: { readonly accessToken: string },
  ): Promise<StoredConversation | null> {
    const stored = this.#conversations.get(conversationId);
    return stored?.userId === userId ? stored : null;
  }

  async listMessages(
    userId: UserId,
    conversationId: ConversationId,
    options: { readonly accessToken: string; readonly limit: number },
  ): Promise<readonly StoredConversationMessage[]> {
    const conversation = await this.get(userId, conversationId, options);
    if (conversation === null) return [];
    return (this.#messages.get(conversationId) ?? []).slice(-options.limit);
  }

  async update(
    userId: UserId,
    conversationId: ConversationId,
    patch: {
      readonly title?: string | null;
      readonly status?: "active" | "archived";
    },
    options: { readonly accessToken: string; readonly now: Date },
  ): Promise<StoredConversation | null> {
    const stored = await this.get(userId, conversationId, options);
    if (stored === null) return null;
    const updated: StoredConversation = {
      ...stored,
      title: patch.title === undefined ? stored.title : patch.title,
      status: patch.status ?? stored.status,
      updatedAt: options.now,
    };
    this.#conversations.set(conversationId, updated);
    return updated;
  }

  async delete(
    userId: UserId,
    conversationId: ConversationId,
    options: { readonly accessToken: string },
  ): Promise<boolean> {
    const stored = await this.get(userId, conversationId, options);
    if (stored === null) return false;
    this.#messages.delete(conversationId);
    return this.#conversations.delete(conversationId);
  }

  async findUserMessageByIdempotencyKey(
    userId: UserId,
    conversationId: ConversationId,
    idempotencyKey: string,
    options: { readonly accessToken: string },
  ): Promise<StoredConversationMessage | null> {
    const messages = await this.listMessages(userId, conversationId, {
      ...options,
      limit: 500,
    });
    return (
      messages.find(
        (message) =>
          message.role === "user" && message.idempotencyKey === idempotencyKey,
      ) ?? null
    );
  }

  async addMessage(
    userId: UserId,
    input: {
      readonly id: string;
      readonly conversationId: ConversationId;
      readonly role: "user" | "assistant";
      readonly text: string;
      readonly status: "complete" | "failed";
      readonly idempotencyKey: string | null;
      readonly providerMetadata?: Readonly<Record<string, unknown>>;
    },
    options: { readonly accessToken: string; readonly now: Date },
  ): Promise<StoredConversationMessage> {
    const conversation = await this.get(userId, input.conversationId, options);
    if (conversation === null) throw new Error("conversation not found");
    const stored: StoredConversationMessage = {
      ...input,
      userId,
      providerMetadata: input.providerMetadata ?? {},
      createdAt: options.now,
    };
    const messages = this.#messages.get(input.conversationId) ?? [];
    messages.push(stored);
    this.#messages.set(input.conversationId, messages);
    this.#conversations.set(input.conversationId, {
      ...conversation,
      updatedAt: options.now,
    });
    return stored;
  }

  async deleteAllForUser(
    userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<void> {
    for (const conversation of await this.list(userId, {
      ...options,
      limit: 10_000,
    })) {
      await this.delete(userId, conversation.id, options);
    }
  }
}
