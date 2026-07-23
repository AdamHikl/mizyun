import type { ApiClient, ApiError } from "@mizyun/api-client";
import {
  coachConversationListResponseSchema,
  coachConversationResponseSchema,
  coachMessageResponseSchema,
  coachProviderStatusSchema,
  coachThreadResponseSchema,
  type CoachConversation,
  type CoachMessage,
  type CoachProviderStatus,
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

const humanize = (error: ApiError): string => {
  switch (error.kind) {
    case "network_error":
      return "Coach is offline. Your existing conversation is still safe.";
    case "session_expired":
    case "no_session":
      return "Your session expired. Sign in again.";
    case "not_configured":
      return "The Mizyun API is not configured.";
    case "http_error":
      if (error.status === 429)
        return "Your daily Coach budget is used up. Try again tomorrow.";
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
): Promise<CoachThreadResult> => {
  const result = await apiClient.request<{
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

const newIdempotencyKey = (): string =>
  `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

export const sendCoachMessage = async (
  conversationId: string,
  text: string,
  idempotencyKey = newIdempotencyKey(),
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
