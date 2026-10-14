import type { AgentProviderStatus } from "./index.js";

/** These bounds are shared by admission estimates and the concrete provider. */
export const RECIPE_GENERATION_MAX_OUTPUT_TOKENS = 1_024;
export const INGREDIENT_RECOGNITION_MAX_OUTPUT_TOKENS = 2_048;
export const RECIPE_PROVIDER_MAX_OUTPUT_BYTES = 8_192;
export const RECIPE_PROVIDER_MAX_INPUT_TEXT_BYTES = 32_768;
export const INGREDIENT_RECOGNITION_MAX_IMAGES = 3;
export const INGREDIENT_RECOGNITION_MAX_IMAGE_BYTES = 4 * 1_024 * 1_024;
export const RECIPE_GENERATION_MAX_RESULTS = 3;
export const INGREDIENT_RECOGNITION_MAX_RESULTS = 30;
export const RECIPE_PROVIDER_REQUEST_OVERHEAD_BYTES = 2_048;
export const INGREDIENT_RECOGNITION_ESTIMATED_IMAGE_TOKENS = 8_192;

export interface RecipeGenerationRequest {
  readonly eligibleRecipes: readonly {
    readonly recipeId: string;
    readonly nutrition: {
      readonly proteinG: number | null;
      readonly carbohydrateG: number | null;
      readonly fatG: number | null;
    };
    readonly prepMinutes: number;
  }[];
  readonly focus: readonly ("protein" | "carbohydrate" | "fat")[];
  readonly preferences: {
    readonly mealSize: "small" | "normal" | "large";
    readonly maximumPrepMinutes: number | null;
  };
  readonly signal: AbortSignal;
}

export interface RecipeGenerationResult {
  readonly recipeIds: readonly string[];
  /** Omitted usage must charge the full outer reservation. */
  readonly tokensUsed?: number;
}

export type RecipeIngredientPreparationState = "raw" | "cooked" | "as_sold";

export interface IngredientRecognitionRequest {
  /** Ephemeral normalized bytes. Never retained by this port. */
  readonly images: readonly {
    readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
    readonly bytes: Uint8Array;
  }[];
  readonly catalog: readonly {
    readonly ingredientId: string;
    readonly name: string;
    readonly preparationState: RecipeIngredientPreparationState;
  }[];
  readonly signal: AbortSignal;
}

export interface IngredientRecognitionResult {
  /** Unconfirmed proposals only; quantity, availability and safety require review. */
  readonly ingredients: readonly {
    readonly ingredientId: string | null;
    readonly name: string;
    readonly preparationState: RecipeIngredientPreparationState | "unknown";
  }[];
  readonly tokensUsed?: number;
}

export interface RecipeGenerationProvider {
  status(): Promise<AgentProviderStatus>;
  /** Conservative total reservation; synchronous, content-free and no provider calls. */
  estimateTokens(request: RecipeGenerationRequest): number;
  generate(request: RecipeGenerationRequest): Promise<RecipeGenerationResult>;
}

export interface IngredientRecognitionProvider {
  status(): Promise<AgentProviderStatus>;
  estimateTokens(request: IngredientRecognitionRequest): number;
  recognize(
    request: IngredientRecognitionRequest,
  ): Promise<IngredientRecognitionResult>;
}

export type RecipeProviderErrorReason =
  "unavailable" | "timeout" | "refused" | "malformed_output";

/** Never carries a vendor message, response body, prompt or image metadata. */
export class RecipeProviderError extends Error {
  constructor(readonly reason: RecipeProviderErrorReason) {
    super(`Recipe provider ${reason}.`);
    this.name = "RecipeProviderError";
  }
}

const disabledStatus = (): AgentProviderStatus => ({
  ready: false,
  provider: "disabled",
  reason: "Recipe provider is not enabled.",
  externalAccess: false,
});

const fakeGenerationEstimate = (request: RecipeGenerationRequest): number =>
  Buffer.byteLength(
    JSON.stringify(
      JSON.stringify({
        eligibleRecipes: request.eligibleRecipes,
        focus: request.focus,
        preferences: request.preferences,
      }),
    ),
    "utf8",
  ) +
  RECIPE_PROVIDER_REQUEST_OVERHEAD_BYTES +
  RECIPE_GENERATION_MAX_OUTPUT_TOKENS;

const fakeRecognitionEstimate = (
  request: IngredientRecognitionRequest,
): number =>
  Buffer.byteLength(
    JSON.stringify(JSON.stringify({ catalog: request.catalog })),
    "utf8",
  ) +
  RECIPE_PROVIDER_REQUEST_OVERHEAD_BYTES +
  INGREDIENT_RECOGNITION_MAX_OUTPUT_TOKENS +
  request.images.length * INGREDIENT_RECOGNITION_ESTIMATED_IMAGE_TOKENS;

export class DisabledRecipeGenerationProvider implements RecipeGenerationProvider {
  estimateTokens(request: RecipeGenerationRequest): number {
    return fakeGenerationEstimate(request);
  }
  async status(): Promise<AgentProviderStatus> {
    return disabledStatus();
  }
  async generate(
    _request: RecipeGenerationRequest,
  ): Promise<RecipeGenerationResult> {
    throw new RecipeProviderError("unavailable");
  }
}

export class DisabledIngredientRecognitionProvider implements IngredientRecognitionProvider {
  estimateTokens(request: IngredientRecognitionRequest): number {
    return fakeRecognitionEstimate(request);
  }
  async status(): Promise<AgentProviderStatus> {
    return disabledStatus();
  }
  async recognize(
    _request: IngredientRecognitionRequest,
  ): Promise<IngredientRecognitionResult> {
    throw new RecipeProviderError("unavailable");
  }
}

const fakeStatus = (): AgentProviderStatus => ({
  ready: true,
  provider: "synthetic",
  externalAccess: true,
});

/** Explicit synthetic injection only; composition must never select this as a live fallback. */
export class FakeRecipeGenerationProvider implements RecipeGenerationProvider {
  constructor(
    private readonly result?: RecipeGenerationResult | RecipeProviderError,
  ) {}
  estimateTokens(request: RecipeGenerationRequest): number {
    return fakeGenerationEstimate(request);
  }
  async status(): Promise<AgentProviderStatus> {
    return fakeStatus();
  }
  async generate(
    request: RecipeGenerationRequest,
  ): Promise<RecipeGenerationResult> {
    if (request.signal.aborted) throw new RecipeProviderError("timeout");
    if (this.result instanceof RecipeProviderError) throw this.result;
    return {
      recipeIds: [
        ...(this.result?.recipeIds ??
          request.eligibleRecipes
            .slice(0, RECIPE_GENERATION_MAX_RESULTS)
            .map((recipe) => recipe.recipeId)),
      ],
      ...(this.result === undefined
        ? { tokensUsed: 1 }
        : this.result.tokensUsed === undefined
          ? {}
          : { tokensUsed: this.result.tokensUsed }),
    };
  }
}

export class FakeIngredientRecognitionProvider implements IngredientRecognitionProvider {
  constructor(
    private readonly result:
      IngredientRecognitionResult | RecipeProviderError = {
      ingredients: [],
      tokensUsed: 1,
    },
  ) {}
  estimateTokens(request: IngredientRecognitionRequest): number {
    return fakeRecognitionEstimate(request);
  }
  async status(): Promise<AgentProviderStatus> {
    return fakeStatus();
  }
  async recognize(
    request: IngredientRecognitionRequest,
  ): Promise<IngredientRecognitionResult> {
    if (request.signal.aborted) throw new RecipeProviderError("timeout");
    if (this.result instanceof RecipeProviderError) throw this.result;
    return {
      ingredients: this.result.ingredients.map((ingredient) => ({
        ...ingredient,
      })),
      ...(this.result.tokensUsed === undefined
        ? {}
        : { tokensUsed: this.result.tokensUsed }),
    };
  }
}
