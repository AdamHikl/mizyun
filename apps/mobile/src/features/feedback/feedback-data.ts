import type { ApiError } from "@mizyun/api-client";
import { apiClient } from "@/composition/api-client";
import {
  createFeedbackResponseSchema,
  createFeedbackSchema,
  listFeedbackResponseSchema,
  type CreateFeedbackInput,
  type CreateFeedbackResponse,
  type FeedbackItem,
  type ListFeedbackResponse,
} from "@mizyun/contracts";

const humanizeApiError = (error: ApiError, fallback: string): string => {
  switch (error.kind) {
    case "session_expired":
      return "Your session expired. Sign in again.";
    case "no_session":
      return "You're signed out. Sign in and try again.";
    case "network_error":
      return "Network unavailable. Try again when you're online.";
    case "http_error":
      if (typeof error.message === "string" && error.message.length > 0) {
        return error.message;
      }
      return fallback;
    case "validation_error":
      return "Please double-check the values and try again.";
    case "not_configured":
      return "The API isn't configured yet.";
    case "parse_error":
      return fallback;
  }
};

export const submitFeedback = async (
  body: CreateFeedbackInput,
): Promise<
  | { readonly ok: true; readonly feedback: FeedbackItem }
  | { readonly ok: false; readonly message: string }
> => {
  const parsed = createFeedbackSchema.safeParse(body);
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Invalid feedback input.";
    return { ok: false, message };
  }

  const result = await apiClient.request<CreateFeedbackResponse>({
    method: "POST",
    path: "/v1/feedback",
    body: parsed.data,
    schema: createFeedbackResponseSchema,
  });

  if (result.ok) {
    return { ok: true, feedback: result.value.feedback };
  }

  return {
    ok: false,
    message: humanizeApiError(
      result.error,
      "Failed to submit feedback. Please try again.",
    ),
  };
};

export const loadUserFeedback = async (): Promise<
  | { readonly ok: true; readonly feedback: readonly FeedbackItem[] }
  | { readonly ok: false; readonly message: string }
> => {
  const result = await apiClient.request<ListFeedbackResponse>({
    method: "GET",
    path: "/v1/feedback",
    schema: listFeedbackResponseSchema,
  });

  if (result.ok) {
    return { ok: true, feedback: result.value.feedback };
  }

  return {
    ok: false,
    message: humanizeApiError(result.error, "Failed to load past feedback."),
  };
};
