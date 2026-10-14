import { err, ok, type Result } from "@mizyun/core";
import {
  mealRecipeSessionContextSchema,
  mealRecipeRevalidationRequestSchema,
  mealRecipeRevalidationResponseSchema,
  type MealRecipeSessionContext,
  type MealRecipeRevalidationRequest,
  type MealRecipeRevalidationResponse,
} from "@mizyun/contracts";
import type { z } from "zod";
import type { ApiClient } from "./api-client";
import type { HttpApiClientDependencies } from "./http-api-client";
import type { MealRecipeRequestOptions } from "./meal-recipe-api";
import type { ApiError } from "./types";
import { parseApiErrorBody } from "./errors";

export interface MealRecipeSessionApi {
  context(
    options: MealRecipeRequestOptions,
  ): Promise<Result<MealRecipeSessionContext, ApiError>>;
  revalidate(
    input: MealRecipeRevalidationRequest,
    options: MealRecipeRequestOptions,
  ): Promise<Result<MealRecipeRevalidationResponse, ApiError>>;
}
export const createMealRecipeSessionApi = (
  client: ApiClient,
): MealRecipeSessionApi => ({
  context: (options) =>
    client.getMealRecipeSessionContext?.(options) ??
    Promise.resolve(
      err({
        kind: "not_configured",
        reason: "Recipe session transport unavailable.",
      }),
    ),
  revalidate: (input, options) =>
    client.revalidateMealRecipes?.(input, options) ??
    Promise.resolve(
      err({
        kind: "not_configured",
        reason: "Recipe session transport unavailable.",
      }),
    ),
});

const invalid = (): ApiError => ({
  kind: "validation_error",
  issues: [{ code: "custom", path: [], message: "Invalid recipe payload." }],
});
const aborted = (): ApiError => ({
  kind: "network_error",
  cause: new DOMException("Request aborted", "AbortError"),
});
const malformed = (): ApiError => ({
  kind: "parse_error",
  cause: "Invalid recipe response.",
});

/** Internal transport shared by HttpApiClient's named methods. Exactly one fetch per call. */
export const createMealRecipeSessionTransport = (
  dependencies: HttpApiClientDependencies,
): MealRecipeSessionApi => {
  const fetcher = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = dependencies.baseUrl.replace(/\/$/, "");
  const request = async <T>(
    path: string,
    schema: z.ZodType<T>,
    options: MealRecipeRequestOptions,
    body?: string,
  ): Promise<Result<T, ApiError>> => {
    try {
      if (
        !options.expectedUserId ||
        typeof options.isCurrent !== "function" ||
        !options.isCurrent()
      )
        return err({ kind: "context_changed" });
      if (options.signal?.aborted) return err(aborted());
      const session = await dependencies.authClient.getSession();
      if (!session) return err({ kind: "no_session" });
      if (session.user.id !== options.expectedUserId || !options.isCurrent())
        return err({ kind: "context_changed" });
      if (options.signal?.aborted) return err(aborted());
      const current = async () => {
        const latest = await dependencies.authClient.getSession();
        return (
          latest?.user.id === session.user.id &&
          latest.accessToken === session.accessToken &&
          options.isCurrent()
        );
      };
      let response: Response;
      try {
        response = await fetcher(`${baseUrl}/v1/meal-recipes/${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            authorization: `Bearer ${session.accessToken}`,
            ...(typeof body === "string"
              ? { "content-type": "application/json" }
              : {}),
          },
          ...(body === undefined ? {} : { body }),
          ...(options.signal ? { signal: options.signal } : {}),
        });
      } catch (cause) {
        if (!(await current())) return err({ kind: "context_changed" });
        return err(
          options.signal?.aborted
            ? aborted()
            : { kind: "network_error", cause },
        );
      }
      if (!(await current())) return err({ kind: "context_changed" });
      if (options.signal?.aborted) return err(aborted());
      if (response.status === 401) {
        void dependencies.authClient.signOut(session).catch(() => undefined);
        return err({ kind: "session_expired" });
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        if (!(await current())) return err({ kind: "context_changed" });
        return err(options.signal?.aborted ? aborted() : malformed());
      }
      if (!(await current())) return err({ kind: "context_changed" });
      if (options.signal?.aborted) return err(aborted());
      if (!response.ok) {
        const mapped = parseApiErrorBody(payload);
        if (!mapped.ok && mapped.error.kind === "http_error")
          return err({ ...mapped.error, status: response.status });
        return err(malformed());
      }
      const parsed = schema.safeParse(payload);
      if (!parsed.success) return err(invalid());
      return ok(parsed.data);
    } catch {
      return err(malformed());
    }
  };
  return {
    context: (options) =>
      request("session-context", mealRecipeSessionContextSchema, options),
    revalidate: (input, options) => {
      const parsed = mealRecipeRevalidationRequestSchema.safeParse(input);
      if (!parsed.success) return Promise.resolve(err(invalid()));
      return request(
        "revalidate",
        mealRecipeRevalidationResponseSchema.refine(
          (value) =>
            value.catalogRevision === parsed.data.catalogRevision &&
            value.recipes.length === parsed.data.recipeIds.length &&
            value.recipes.every(
              (recipe) =>
                parsed.data.recipeIds.includes(recipe.recipeId) &&
                recipe.servings === parsed.data.servings,
            ),
          "Recipe revalidation response does not match the request",
        ),
        options,
        JSON.stringify(parsed.data),
      );
    },
  };
};
