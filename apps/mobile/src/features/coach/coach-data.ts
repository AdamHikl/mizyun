import type { ApiClient, ApiError } from "@mizyun/api-client";
import {
  coachConversationListResponseSchema,
  coachConversationResponseSchema,
  coachMessageResponseSchema,
  coachProviderStatusSchema,
  coachThreadResponseSchema,
  coachWeeklyAdaptationAcceptResponseSchema,
  type CoachConversation,
  type CoachMessage,
  type CoachProviderStatus,
  type CoachWeeklyAdaptationAcceptResponse,
} from "@mizyun/contracts";

import { apiClient } from "@/composition/api-client";

export type CoachLoadResult =
  | {
      readonly ok: true;
      readonly status: CoachProviderStatus;
      readonly conversations: readonly CoachConversation[];
    }
  | { readonly ok: false; readonly message: string };

export type CoachThreadResult =
  | {
      readonly ok: true;
      readonly conversation: CoachConversation;
      readonly messages: readonly CoachMessage[];
    }
  | { readonly ok: false; readonly message: string };

// =========================================================================
// AI-MOB-002 — Thread list + preview helpers.
// =========================================================================

const PREVIEW_MAX_CHARS = 280;

/**
 * Build a human-readable preview from the latest assistant
 * message of a thread. Returns the conversation title when the
 * thread is empty, or a fallback when the latest message is not
 * an assistant message. The preview is what the thread-list
 * sheet shows under the title.
 */
export const previewFor = (
  conversation: CoachConversation,
  messages: readonly CoachMessage[],
): string => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message === undefined || message.role !== "assistant") continue;
    if (message.text.length <= PREVIEW_MAX_CHARS) return message.text;
    return `${message.text.slice(0, PREVIEW_MAX_CHARS - 1)}…`;
  }
  return conversation.title ?? "Coach check-in";
};

/**
 * Render an ISO-8601 instant as a coarse relative label
 * (`just now`, `Nm ago`, `Nh ago`, `Nd ago`). The labels are
 * coarse on purpose — the screen shows the absolute timestamp
 * on long-press via `accessibilityHint`.
 */
export const relativeLabel = (iso: string, now: Date = new Date()): string => {
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  if (diffMs < 0) return "just now";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return then.toISOString().slice(0, 10);
};

const humanize = (error: ApiError): string => {
  switch (error.kind) {
    case "context_changed":
      return "This request is no longer current. Refresh before continuing.";
    case "network_error":
      return "Coach is offline. Your existing conversation is still safe.";
    case "session_expired":
    case "no_session":
      return "Your session expired. Sign in again.";
    case "not_configured":
      return "The Mizyun API is not configured.";
    case "http_error":
      if (error.status === 429) {
        const reason = error.reason;
        if (reason === "daily_budget_exhausted") {
          const resetAt = error.resetAt;
          if (resetAt) {
            const resetDate = new Date(resetAt);
            const hours = Math.max(
              0,
              Math.ceil((resetDate.getTime() - Date.now()) / 3600000),
            );
            return `Daily Coach limit reached. Resets in ~${hours}h.`;
          }
          return "Daily Coach limit reached. Resets at midnight UTC.";
        }
        if (reason === "concurrent_in_flight") {
          return "Coach is thinking about your previous message. Wait a moment.";
        }
        const retryAfter = error.retryAfterSeconds;
        if (retryAfter && retryAfter > 0) {
          return `Coach is busy — try again in ${retryAfter}s.`;
        }
        return "Coach is busy — try again in a moment.";
      }
      if (error.code === "AI_CONFIGURATION_ERROR")
        return "Coach needs server attention before this message can be retried.";
      if (error.status === 503 || error.status === 502)
        return "Coach is temporarily unavailable. Your message was saved; retry when ready.";
      if (error.status === 404) return "That conversation no longer exists.";
      return "Coach could not complete that request. Try again.";
    case "validation_error":
    case "parse_error":
      return "Coach returned an unexpected response.";
  }
};

export const loadCoach = async (): Promise<CoachLoadResult> =>
  loadCoachWith(apiClient);

export const loadCoachWith = async (
  client: ApiClient,
): Promise<CoachLoadResult> => {
  const status = await client.request<CoachProviderStatus>({
    method: "GET",
    path: "/v1/coach/status",
    schema: coachProviderStatusSchema,
  });
  if (!status.ok) return { ok: false, message: humanize(status.error) };
  if (!status.value.ready) {
    return { ok: true, status: status.value, conversations: [] };
  }
  const conversations = await client.request<{
    conversations: CoachConversation[];
  }>({
    method: "GET",
    path: "/v1/coach/conversations",
    schema: coachConversationListResponseSchema,
  });
  return conversations.ok
    ? {
        ok: true,
        status: status.value,
        conversations: conversations.value.conversations,
      }
    : { ok: false, message: humanize(conversations.error) };
};

export const createCoachConversation = async (
  title = "Coach check-in",
): Promise<CoachThreadResult> => {
  const result = await apiClient.request<{ conversation: CoachConversation }>({
    method: "POST",
    path: "/v1/coach/conversations",
    body: { title },
    schema: coachConversationResponseSchema,
  });
  return result.ok
    ? { ok: true, conversation: result.value.conversation, messages: [] }
    : { ok: false, message: humanize(result.error) };
};

export const loadCoachThread = async (
  conversationId: string,
  client: ApiClient = apiClient,
): Promise<CoachThreadResult> => {
  const result = await client.request<{
    conversation: CoachConversation;
    messages: CoachMessage[];
  }>({
    method: "GET",
    path: `/v1/coach/conversations/${encodeURIComponent(conversationId)}`,
    schema: coachThreadResponseSchema,
  });
  return result.ok
    ? {
        ok: true,
        conversation: result.value.conversation,
        messages: result.value.messages,
      }
    : { ok: false, message: humanize(result.error) };
};

export interface CoachPendingDraft {
  readonly conversationId: string;
  readonly text: string;
  readonly idempotencyKey: string;
}

export const isCoachPendingDraft = (
  value: unknown,
): value is CoachPendingDraft =>
  typeof value === "object" &&
  value !== null &&
  "conversationId" in value &&
  typeof value.conversationId === "string" &&
  "text" in value &&
  typeof value.text === "string" &&
  "idempotencyKey" in value &&
  typeof value.idempotencyKey === "string";

export const newCoachMessageIdempotencyKey = (): string =>
  `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

export const optimisticCoachMessageId = (idempotencyKey: string): string =>
  `optimistic-${idempotencyKey}`;

export const mergeCoachSendResult = (
  current: readonly CoachMessage[],
  optimisticId: string,
  result: readonly CoachMessage[],
): readonly CoachMessage[] => {
  const resultIds = new Set(result.map((message) => message.id));
  return [
    ...current.filter(
      (message) => message.id !== optimisticId && !resultIds.has(message.id),
    ),
    ...result,
  ];
};

export const sendCoachMessage = async (
  conversationId: string,
  text: string,
  idempotencyKey = newCoachMessageIdempotencyKey(),
): Promise<CoachThreadResult> =>
  sendCoachMessageWith(apiClient, conversationId, text, idempotencyKey);

export const sendCoachMessageWith = async (
  client: ApiClient,
  conversationId: string,
  text: string,
  idempotencyKey: string,
): Promise<CoachThreadResult> => {
  const result = await client.request<{
    conversation: CoachConversation;
    userMessage: CoachMessage;
    assistantMessage: CoachMessage;
  }>({
    method: "POST",
    path: `/v1/coach/conversations/${encodeURIComponent(conversationId)}/messages`,
    headers: { "idempotency-key": idempotencyKey },
    body: { text: text.trim() },
    schema: coachMessageResponseSchema,
  });
  return result.ok
    ? {
        ok: true,
        conversation: result.value.conversation,
        messages: [result.value.userMessage, result.value.assistantMessage],
      }
    : { ok: false, message: humanize(result.error) };
};

export const sendCoachMealPhoto = async (
  conversationId: string,
  photo: Blob,
  idempotencyKey = newCoachMessageIdempotencyKey(),
  additionalPhotos?: readonly {
    readonly photo: Blob;
    readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
  }[],
  textHint?: string,
): Promise<CoachThreadResult> =>
  sendCoachMealPhotoWith(
    apiClient,
    conversationId,
    photo,
    idempotencyKey,
    additionalPhotos,
    textHint,
  );

export const sendCoachMealPhotoWith = async (
  client: ApiClient,
  conversationId: string,
  photo: Blob,
  idempotencyKey: string,
  additionalPhotos?: readonly {
    readonly photo: Blob;
    readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
  }[],
  textHint?: string,
): Promise<CoachThreadResult> => {
  if (client.draftCoachMealPhoto === undefined) {
    return {
      ok: false,
      message: "Coach meal photos are not configured on this device.",
    };
  }
  const result = await client.draftCoachMealPhoto({
    conversationId,
    idempotencyKey,
    photo,
    mimeType: "image/jpeg",
    ...(additionalPhotos !== undefined ? { additionalPhotos } : {}),
    ...(textHint !== undefined && textHint.trim().length > 0
      ? { textHint }
      : {}),
  });
  return result.ok
    ? {
        ok: true,
        conversation: result.value.conversation,
        messages: [result.value.userMessage, result.value.assistantMessage],
      }
    : { ok: false, message: humanize(result.error) };
};

export const acceptWeeklyAdaptation = async (
  conversationId: string,
  proposalId: string,
): Promise<
  | { readonly ok: true; readonly value: CoachWeeklyAdaptationAcceptResponse }
  | { readonly ok: false; readonly message: string }
> => acceptWeeklyAdaptationWith(apiClient, conversationId, proposalId);

export const acceptWeeklyAdaptationWith = async (
  client: ApiClient,
  conversationId: string,
  proposalId: string,
): Promise<
  | { readonly ok: true; readonly value: CoachWeeklyAdaptationAcceptResponse }
  | { readonly ok: false; readonly message: string }
> => {
  const result = await client.request<CoachWeeklyAdaptationAcceptResponse>({
    method: "POST",
    path: `/v1/coach/conversations/${encodeURIComponent(
      conversationId,
    )}/weekly-adaptations/${encodeURIComponent(proposalId)}/accept`,
    schema: coachWeeklyAdaptationAcceptResponseSchema,
  });
  return result.ok
    ? { ok: true, value: result.value }
    : { ok: false, message: humanize(result.error) };
};

export const deleteCoachConversation = async (
  conversationId: string,
): Promise<
  { readonly ok: true } | { readonly ok: false; readonly message: string }
> => {
  const result = await apiClient.request<void>({
    method: "DELETE",
    path: `/v1/coach/conversations/${encodeURIComponent(conversationId)}`,
  });
  return result.ok
    ? { ok: true }
    : { ok: false, message: humanize(result.error) };
};
