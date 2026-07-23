import type { ConversationId, UserId } from "./index";

export type ConversationStatus = "active" | "archived";
export type ConversationMessageRole = "user" | "assistant";
export type ConversationMessageStatus = "complete" | "failed";

export interface StoredConversation {
  readonly id: ConversationId;
  readonly userId: UserId;
  readonly title: string | null;
  readonly status: ConversationStatus;
  readonly providerMetadata: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface StoredConversationMessage {
  readonly id: string;
  readonly userId: UserId;
  readonly conversationId: ConversationId;
  readonly role: ConversationMessageRole;
  readonly text: string;
  readonly status: ConversationMessageStatus;
  readonly idempotencyKey: string | null;
  readonly providerMetadata: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

export interface ConversationRepositoryOptions {
  readonly accessToken: string;
}

export interface ConversationRepository {
  create(
    userId: UserId,
    input: { readonly id: ConversationId; readonly title: string | null },
    options: ConversationRepositoryOptions & { readonly now: Date },
  ): Promise<StoredConversation>;
  list(
    userId: UserId,
    options: ConversationRepositoryOptions & { readonly limit: number },
  ): Promise<readonly StoredConversation[]>;
  get(
    userId: UserId,
    conversationId: ConversationId,
    options: ConversationRepositoryOptions,
  ): Promise<StoredConversation | null>;
  listMessages(
    userId: UserId,
    conversationId: ConversationId,
    options: ConversationRepositoryOptions & { readonly limit: number },
  ): Promise<readonly StoredConversationMessage[]>;
  update(
    userId: UserId,
    conversationId: ConversationId,
    patch: {
      readonly title?: string | null;
      readonly status?: ConversationStatus;
    },
    options: ConversationRepositoryOptions & { readonly now: Date },
  ): Promise<StoredConversation | null>;
  delete(
    userId: UserId,
    conversationId: ConversationId,
    options: ConversationRepositoryOptions,
  ): Promise<boolean>;
  findUserMessageByIdempotencyKey(
    userId: UserId,
    conversationId: ConversationId,
    idempotencyKey: string,
    options: ConversationRepositoryOptions,
  ): Promise<StoredConversationMessage | null>;
  addMessage(
    userId: UserId,
    input: {
      readonly id: string;
      readonly conversationId: ConversationId;
      readonly role: ConversationMessageRole;
      readonly text: string;
      readonly status: ConversationMessageStatus;
      readonly idempotencyKey: string | null;
      readonly providerMetadata?: Readonly<Record<string, unknown>>;
    },
    options: ConversationRepositoryOptions & { readonly now: Date },
  ): Promise<StoredConversationMessage>;
  deleteAllForUser(
    userId: UserId,
    options: ConversationRepositoryOptions,
  ): Promise<void>;
}
