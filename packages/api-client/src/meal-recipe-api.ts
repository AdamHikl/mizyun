import { err, ok, type Result } from "@mizyun/core";
import {
  mealRecipeCapabilitiesSchema,
  mealRecipeSuggestionRequestSchema,
  mealRecipeSuggestionResponseSchema,
  ingredientRecognitionResponseSchema,
  recipeRequestIdSchema,
  type MealRecipeCapabilities,
  type MealRecipeSuggestionRequest,
  type MealRecipeSuggestionResponse,
  type IngredientRecognitionResponse,
} from "@mizyun/contracts";
import type { z } from "zod";
import type { ApiClient } from "./api-client";
import type { HttpApiClientDependencies } from "./http-api-client";
import type { ApiError } from "./types";
import { parseApiErrorBody } from "./errors";

/** Owner and originating session generation must stay current throughout the call. */
export interface MealRecipeRequestOptions {
  readonly expectedUserId: string;
  readonly isCurrent: () => boolean;
  readonly signal?: AbortSignal;
}
export interface MealRecipeImage {
  readonly photo: Blob;
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
}
export interface IngredientRecognitionRequest {
  /** Persist this identity before dispatch. Retrying is always an explicit caller action. */
  readonly requestId: string;
  readonly images: readonly MealRecipeImage[];
}
export interface MealRecipeApi {
  capabilities(
    options: MealRecipeRequestOptions,
  ): Promise<Result<MealRecipeCapabilities, ApiError>>;
  suggest(
    input: MealRecipeSuggestionRequest,
    options: MealRecipeRequestOptions,
  ): Promise<Result<MealRecipeSuggestionResponse, ApiError>>;
  recognizeIngredients(
    input: IngredientRecognitionRequest,
    options: MealRecipeRequestOptions,
  ): Promise<Result<IngredientRecognitionResponse, ApiError>>;
}

/** Named public recipe boundary; no request identities or automatic retries are created here. */
export const createMealRecipeApi = (client: ApiClient): MealRecipeApi => ({
  capabilities: (options) =>
    client.getMealRecipeCapabilities?.(options) ??
    Promise.resolve(
      err({ kind: "not_configured", reason: "Recipe transport unavailable." }),
    ),
  suggest: (input, options) =>
    client.suggestMealRecipes?.(input, options) ??
    Promise.resolve(
      err({ kind: "not_configured", reason: "Recipe transport unavailable." }),
    ),
  recognizeIngredients: (input, options) =>
    client.recognizeMealRecipeIngredients?.(input, options) ??
    Promise.resolve(
      err({ kind: "not_configured", reason: "Recipe transport unavailable." }),
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
export const createMealRecipeTransport = (
  dependencies: HttpApiClientDependencies,
): MealRecipeApi => {
  const fetcher = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = dependencies.baseUrl.replace(/\/$/, "");
  const request = async <T>(
    path: string,
    schema: z.ZodType<T>,
    options: MealRecipeRequestOptions,
    body?: string | FormData,
    requestId?: string,
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
      if (
        !parsed.success ||
        (requestId !== undefined &&
          (parsed.data as { requestId?: string }).requestId !== requestId)
      )
        return err(invalid());
      return ok(parsed.data);
    } catch {
      return err(malformed());
    }
  };
  return {
    capabilities: (options) =>
      request("capabilities", mealRecipeCapabilitiesSchema, options),
    suggest: (input, options) => {
      const parsed = mealRecipeSuggestionRequestSchema.safeParse(input);
      if (!parsed.success) return Promise.resolve(err(invalid()));
      return request(
        "suggest",
        mealRecipeSuggestionResponseSchema,
        options,
        JSON.stringify(parsed.data),
        parsed.data.requestId,
      );
    },
    recognizeIngredients: async (input, options) => {
      try {
        if (
          !recipeRequestIdSchema.safeParse(input?.requestId).success ||
          !Array.isArray(input.images) ||
          input.images.length < 1 ||
          input.images.length > 3 ||
          input.images.some(
            (image) =>
              !["image/jpeg", "image/png", "image/webp"].includes(
                image.mimeType,
              ) ||
              !Number.isFinite(image.photo.size) ||
              image.photo.size <= 0 ||
              (image.photo.type !== "" && image.photo.type !== image.mimeType),
          ) ||
          input.images.reduce((sum, image) => sum + image.photo.size, 0) >
            4_194_304
        )
          return Promise.resolve(err(invalid()));
        const form = new FormData();
        form.append("requestId", input.requestId);
        input.images.forEach((image, index) =>
          form.append(
            "images",
            image.photo,
            `ingredient-${index + 1}.${image.mimeType === "image/jpeg" ? "jpg" : image.mimeType === "image/png" ? "png" : "webp"}`,
          ),
        );
        return request(
          "recognize-ingredients",
          ingredientRecognitionResponseSchema,
          options,
          form,
          input.requestId,
        );
      } catch {
        return err(invalid());
      }
    },
  };
};
