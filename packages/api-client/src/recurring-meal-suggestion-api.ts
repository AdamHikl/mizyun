import { err, type Result } from "@mizyun/core";
import { z } from "zod";
import {
  recurringMealSuggestionListResponseSchema,
  recurringMealSuggestionAcceptSchema,
  recurringMealSuggestionAcceptResponseSchema,
  recurringMealSuggestionDecisionSchema,
  recurringMealSuggestionPreferencesSchema,
  recurringMealTimeZoneSchema,
  type RecurringMealSuggestionAccept,
  type RecurringMealSuggestionAcceptResponse,
  type RecurringMealSuggestionDecision,
  type RecurringMealSuggestionListResponse,
  type RecurringMealSuggestionPreferences,
} from "@mizyun/contracts";
import type { ApiClient } from "./api-client";
import type { ApiError } from "./types";

export interface RecurringMealSuggestionLifetime {
  readonly expectedUserId: string;
  readonly isCurrent: () => boolean;
}
export interface RecurringMealSuggestionApi {
  list(
    timeZone: string,
    lifetime: RecurringMealSuggestionLifetime,
  ): Promise<Result<RecurringMealSuggestionListResponse, ApiError>>;
  accept(
    input: RecurringMealSuggestionAccept,
    lifetime: RecurringMealSuggestionLifetime,
  ): Promise<Result<RecurringMealSuggestionAcceptResponse, ApiError>>;
  decide(
    input: RecurringMealSuggestionDecision,
    lifetime: RecurringMealSuggestionLifetime,
  ): Promise<Result<{ ok: true }, ApiError>>;
  preferences(
    lifetime: RecurringMealSuggestionLifetime,
  ): Promise<Result<RecurringMealSuggestionPreferences, ApiError>>;
  setPreferences(
    input: RecurringMealSuggestionPreferences,
    lifetime: RecurringMealSuggestionLifetime,
  ): Promise<Result<RecurringMealSuggestionPreferences, ApiError>>;
  reset(
    lifetime: RecurringMealSuggestionLifetime,
  ): Promise<Result<{ ok: true }, ApiError>>;
}
const acknowledgment = z.object({ ok: z.literal(true) }).strict();
const base = "/v1/recurring-meal-suggestions";
/** Uses the normal transport's token/account guards and disabled-client behavior. */
export function createRecurringMealSuggestionApi(
  client: ApiClient,
): RecurringMealSuggestionApi {
  const request = <T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    schema: z.ZodTypeAny,
    lifetime: RecurringMealSuggestionLifetime,
    body?: unknown,
  ): Promise<Result<T, ApiError>> => {
    if (!lifetime.expectedUserId || !lifetime.isCurrent())
      return Promise.resolve(err({ kind: "context_changed" }));
    return client.request<T>({
      method,
      path,
      schema,
      ...lifetime,
      ...(body === undefined ? {} : { body }),
    });
  };
  const invalid = (
    issues: readonly z.ZodIssue[],
  ): Promise<Result<never, ApiError>> =>
    Promise.resolve(err({ kind: "validation_error", issues }));
  return {
    list: (timeZone, lifetime) => {
      const parsed = recurringMealTimeZoneSchema.safeParse(timeZone);
      return parsed.success
        ? request(
            "GET",
            `${base}?timeZone=${encodeURIComponent(parsed.data)}`,
            recurringMealSuggestionListResponseSchema,
            lifetime,
          )
        : invalid(parsed.error.issues);
    },
    accept: (input, lifetime) => {
      const parsed = recurringMealSuggestionAcceptSchema.safeParse(input);
      return parsed.success
        ? request(
            "POST",
            `${base}/${encodeURIComponent(parsed.data.proposal.candidateId)}/accept`,
            recurringMealSuggestionAcceptResponseSchema.refine(
              (value) => value.recurringMeal.userId === lifetime.expectedUserId,
              "Schedule owner mismatch",
            ),
            lifetime,
            parsed.data,
          )
        : invalid(parsed.error.issues);
    },
    decide: (input, lifetime) => {
      const parsed = recurringMealSuggestionDecisionSchema.safeParse(input);
      return parsed.success
        ? request(
            "POST",
            `${base}/${encodeURIComponent(parsed.data.proposal.candidateId)}/decision`,
            acknowledgment,
            lifetime,
            parsed.data,
          )
        : invalid(parsed.error.issues);
    },
    preferences: (lifetime) =>
      request(
        "GET",
        `${base}/preferences`,
        recurringMealSuggestionPreferencesSchema,
        lifetime,
      ),
    setPreferences: (input, lifetime) => {
      const parsed = recurringMealSuggestionPreferencesSchema.safeParse(input);
      return parsed.success
        ? request(
            "PATCH",
            `${base}/preferences`,
            recurringMealSuggestionPreferencesSchema,
            lifetime,
            parsed.data,
          )
        : invalid(parsed.error.issues);
    },
    reset: (lifetime) =>
      request("POST", `${base}/reset`, acknowledgment, lifetime),
  };
}
