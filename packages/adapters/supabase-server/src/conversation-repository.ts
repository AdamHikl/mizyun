import type {
  ConversationId,
  ConversationRepository,
  StoredConversation,
  StoredConversationMessage,
  UserId,
} from "@mizyun/core";

import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

interface ConversationRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  title: string | null;
  status: "active" | "archived";
  provider_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface MessageRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  conversation_id: string;
  role: "user" | "assistant" | "tool";
  content: Record<string, unknown>;
  status: "complete" | "failed";
  idempotency_key: string | null;
  provider_metadata: Record<string, unknown>;
  created_at: string;
}

export const conversationFromRow = (
  row: ConversationRow,
): StoredConversation => ({
  id: row.id as ConversationId,
  userId: row.user_id as UserId,
  title: row.title,
  status: row.status,
  providerMetadata: row.provider_metadata,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

export const messageFromRow = (row: MessageRow): StoredConversationMessage => {
  const text = row.content.text;
  if (typeof text !== "string") {
    throw new RepositoryError("message content is missing text");
  }
  if (row.role === "tool") {
    throw new RepositoryError("tool messages are not exposed in coach threads");
  }
  return {
    id: row.id,
    userId: row.user_id as UserId,
    conversationId: row.conversation_id as ConversationId,
    role: row.role,
    text,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    providerMetadata: row.provider_metadata,
    createdAt: new Date(row.created_at),
  };
};

export class SupabaseConversationRepository implements ConversationRepository {
  constructor(
    private readonly options: {
      readonly clientFor: (accessToken: string) => RepositorySupabaseClient;
    },
  ) {}

  async create(
    userId: UserId,
    input: { readonly id: ConversationId; readonly title: string | null },
    options: { readonly accessToken: string; readonly now: Date },
  ): Promise<StoredConversation> {
    const result = await this.options
      .clientFor(options.accessToken)
      .from<ConversationRow>("conversations")
      .insert({ id: input.id, user_id: userId, title: input.title })
      .select("*")
      .single();
    if (result.error || result.data === null) {
      throw new RepositoryError(
        result.error?.message ?? "conversation insert returned no row",
      );
    }
    return conversationFromRow(result.data);
  }

  async list(
    userId: UserId,
    options: { readonly accessToken: string; readonly limit: number },
  ): Promise<readonly StoredConversation[]> {
    const result = await this.options
      .clientFor(options.accessToken)
      .from<ConversationRow>("conversations")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(options.limit);
    if (result.error) throw new RepositoryError(result.error.message);
    return result.data.map(conversationFromRow);
  }

  async get(
    userId: UserId,
    conversationId: ConversationId,
    options: { readonly accessToken: string },
  ): Promise<StoredConversation | null> {
    const result = await this.options
      .clientFor(options.accessToken)
      .from<ConversationRow>("conversations")
      .select("*")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (result.error) throw new RepositoryError(result.error.message);
    return result.data ? conversationFromRow(result.data) : null;
  }

  async listMessages(
    userId: UserId,
    conversationId: ConversationId,
    options: { readonly accessToken: string; readonly limit: number },
  ): Promise<readonly StoredConversationMessage[]> {
    const result = await this.options
      .clientFor(options.accessToken)
      .from<MessageRow>("messages")
      .select("*")
      .eq("user_id", userId)
      .eq("conversation_id", conversationId)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: false })
      .limit(options.limit);
    if (result.error) throw new RepositoryError(result.error.message);
    return result.data.map(messageFromRow).reverse();
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
    const result = await this.options
      .clientFor(options.accessToken)
      .from<ConversationRow>("conversations")
      .update({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
      })
      .eq("id", conversationId)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();
    if (result.error) throw new RepositoryError(result.error.message);
    return result.data ? conversationFromRow(result.data) : null;
  }

  async delete(
    userId: UserId,
    conversationId: ConversationId,
    options: { readonly accessToken: string },
  ): Promise<boolean> {
    const result = await this.options
      .clientFor(options.accessToken)
      .from<ConversationRow>("conversations")
      .delete()
      .eq("id", conversationId)
      .eq("user_id", userId)
      .select("id");
    if (result.error) throw new RepositoryError(result.error.message);
    return result.data.length > 0;
  }

  async findUserMessageByIdempotencyKey(
    userId: UserId,
    conversationId: ConversationId,
    idempotencyKey: string,
    options: { readonly accessToken: string },
  ): Promise<StoredConversationMessage | null> {
    const result = await this.options
      .clientFor(options.accessToken)
      .from<MessageRow>("messages")
      .select("*")
      .eq("user_id", userId)
      .eq("conversation_id", conversationId)
      .eq("role", "user")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (result.error) throw new RepositoryError(result.error.message);
    return result.data ? messageFromRow(result.data) : null;
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
    const result = await this.options
      .clientFor(options.accessToken)
      .from<MessageRow>("messages")
      .insert({
        id: input.id,
        user_id: userId,
        conversation_id: input.conversationId,
        role: input.role,
        content: { text: input.text },
        status: input.status,
        idempotency_key: input.idempotencyKey,
        provider_metadata: { ...(input.providerMetadata ?? {}) },
      })
      .select("*")
      .single();
    if (result.error || result.data === null) {
      throw new RepositoryError(
        result.error?.message ?? "message insert returned no row",
      );
    }
    return messageFromRow(result.data);
  }

  async deleteAllForUser(
    userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<void> {
    const result = await this.options
      .clientFor(options.accessToken)
      .from<ConversationRow>("conversations")
      .delete()
      .eq("user_id", userId);
    if (result.error) throw new RepositoryError(result.error.message);
  }
}
