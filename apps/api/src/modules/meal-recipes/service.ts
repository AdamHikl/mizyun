import { createHash } from "node:crypto";
import { capsForTier } from "@mizyun/config";
import {
  CURRENT_AI_CONSENT_VERSION,
  recipeTemplateSelectionSchema,
  recognizedIngredientProposalSchema,
  ingredientRecognitionResponseSchema,
  mealRecipeSuggestionResponseSchema,
  recipeAssistantReplySchema,
  RECIPE_ASSISTANT_VERSION,
  type MealRecipeSuggestionRequest,
  type RecipeAssistantTurn,
} from "@mizyun/contracts";
import {
  rankMealRecipeCandidates,
  type UserId,
  type AiConsentRepository,
  type AccountRepository,
  type StoredProfile,
  type RecipeRequestLedger,
  type RecipeRequestOperation,
} from "@mizyun/core";
import {
  RECIPE_GENERATION_MAX_RESULTS,
  RecipeProviderError,
  type RecipeGenerationProvider,
  type IngredientRecognitionProvider,
  type RecipeGenerationResult,
  type IngredientRecognitionRequest,
  type RecipeAssistantProvider,
  DisabledRecipeAssistantProvider,
} from "@mizyun/agent-runtime";
import { authorizeAiAccess } from "../../ai-eligibility.js";
import type { BetaProRepository } from "../../beta-pro-repository.js";
import type { EnergyRoutesOptions } from "../energy/index.js";
import { loadOwnedRecipeContext, recipeDigest } from "./context.js";
import { applyProfileDiets } from "./profile-diet.js";
import { buildFeasibleRecipeTemplates } from "./templates.js";
import { RECIPE_CATALOG_DATA } from "./catalog-data.js";

export class RecipeServiceError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: import("../../errors.js").ApiErrorCode,
  ) {
    super(
      "Recipe request cannot complete. Review the request or try a new generation when available.",
    );
    this.name = "RecipeServiceError";
  }
}
export interface RecipeServiceOptions {
  readonly repositories: EnergyRoutesOptions;
  readonly consentRepository: AiConsentRepository;
  readonly accountRepository: AccountRepository;
  readonly betaProRepository?: BetaProRepository;
  readonly ledger: RecipeRequestLedger | null;
  readonly generationProvider: RecipeGenerationProvider;
  readonly recognitionProvider: IngredientRecognitionProvider;
  /** Conversational cooking assistant (ADR0071); disabled when omitted. */
  readonly assistantProvider?: RecipeAssistantProvider;
  readonly enabled: () => boolean;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
}
export class MealRecipeService {
  readonly now: () => Date;
  readonly assistant: RecipeAssistantProvider;
  constructor(readonly options: RecipeServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.assistant =
      options.assistantProvider ?? new DisabledRecipeAssistantProvider();
  }
  async authorize(userId: UserId, accessToken: string): Promise<StoredProfile> {
    // Fail closed: the deterministic suggestion path has no ledger SQL fence
    // to catch deletion when the repository cannot report it.
    if (!this.options.accountRepository.getDeletionJob)
      throw new RecipeServiceError(503, "RECIPE_REQUEST_UNAVAILABLE");
    const job = await this.options.accountRepository.getDeletionJob(userId);
    if (job && ["in_progress", "failed", "completed"].includes(job.status))
      throw new RecipeServiceError(403, "ACCOUNT_DELETION_IN_PROGRESS");
    const profile =
      await this.options.repositories.profileRepository.getOrCreate(userId, {
        now: this.now(),
        accessToken,
      });
    const consent = await this.options.consentRepository.getConsent(userId, {
      accessToken,
    });
    const auth = authorizeAiAccess({ profile, consent, now: this.now() });
    if (!auth.authorized)
      throw new RecipeServiceError(auth.statusCode, auth.code);
    return profile;
  }
  async maximumImages(
    userId: UserId,
    accessToken: string,
    profile: StoredProfile,
  ): Promise<1 | 3> {
    const beta = await this.options.betaProRepository?.getRequest(userId, {
      accessToken,
    });
    return profile.planTier === "paid" || beta?.status === "approved" ? 3 : 1;
  }
  async readiness(userId: UserId, accessToken: string) {
    const base = {
      version: "meal-recipe-v1" as const,
      suggest: false,
      recognizeIngredients: false,
      maximumImages: 1 as 1 | 3,
      maximumTotalImageBytes: 4_194_304 as const,
      maximumImageDimension: 4096 as const,
      requiresIngredientConfirmation: true as const,
      requestIdRequired: true as const,
    };
    let profile: StoredProfile;
    try {
      profile = await this.authorize(userId, accessToken);
    } catch {
      return { ...base, reason: "access_required" as const };
    }
    const maximumImages = await this.maximumImages(
      userId,
      accessToken,
      profile,
    );
    if (!this.options.enabled())
      return { ...base, maximumImages, reason: "disabled" as const };
    if (!this.options.ledger || !(await this.options.ledger.isAvailable()))
      return {
        ...base,
        maximumImages,
        reason: "durable_budget_unavailable" as const,
      };
    const [generation, recognition] = await Promise.all([
      this.options.generationProvider.status(),
      this.options.recognitionProvider.status(),
    ]);
    return {
      ...base,
      maximumImages,
      suggest: generation.ready,
      recognizeIngredients: recognition.ready,
      reason:
        generation.ready || recognition.ready
          ? ("ready" as const)
          : ("provider_unavailable" as const),
    };
  }
  async requireReady(
    userId: UserId,
    accessToken: string,
    operation: RecipeRequestOperation,
    provider?: { status(): ReturnType<RecipeAssistantProvider["status"]> },
  ) {
    const profile = await this.authorize(userId, accessToken);
    if (!this.options.enabled())
      throw new RecipeServiceError(503, "RECIPES_DISABLED");
    if (!this.options.ledger || !(await this.options.ledger.isAvailable()))
      throw new RecipeServiceError(503, "RECIPE_BUDGET_UNAVAILABLE");
    const status = await (
      provider ??
      (operation === "suggest"
        ? this.options.generationProvider
        : this.options.recognitionProvider)
    ).status();
    if (!status.ready)
      throw new RecipeServiceError(503, "RECIPE_PROVIDER_UNAVAILABLE");
    return profile;
  }
  async attempt<T>(
    userId: UserId,
    accessToken: string,
    profile: StoredProfile,
    requestId: string,
    operation: RecipeRequestOperation,
    fingerprint: string,
    tokensEstimated: number,
    invoke: (signal: AbortSignal) => Promise<{ value: T; tokensUsed?: number }>,
    provider?: { status(): ReturnType<RecipeAssistantProvider["status"]> },
  ): Promise<T> {
    const caps = capsForTier(profile.planTier);
    if (
      !Number.isSafeInteger(tokensEstimated) ||
      tokensEstimated < 1 ||
      tokensEstimated > 100_000
    )
      throw new RecipeServiceError(503, "RECIPE_PROVIDER_BOUNDS_INVALID");
    const ledger = this.options.ledger!;
    const reserved = await ledger.reserve({
      userId,
      requestId,
      operation,
      fingerprint,
      consentVersion: CURRENT_AI_CONSENT_VERSION,
      tokensEstimated,
      limits: {
        dailyTokenBudget: caps.dailyTokenBudget,
        dailyDraftLimit: caps.photoDraftDailyLimit,
        requestsPerMinute: caps.draftRequestsPerMinute,
        maxConcurrentRequests: caps.maxConcurrentRequests,
      },
      leaseMs: 60_000,
    });
    if (reserved.kind !== "reserved") {
      if (reserved.kind === "denied")
        throw new RecipeServiceError(
          ["consent", "deletion"].includes(reserved.reason) ? 403 : 429,
          (
            {
              consent: "RECIPE_LIMIT_CONSENT",
              deletion: "RECIPE_LIMIT_DELETION",
              tokens: "RECIPE_LIMIT_TOKENS",
              drafts: "RECIPE_LIMIT_DRAFTS",
              minute: "RECIPE_LIMIT_MINUTE",
              inflight: "RECIPE_LIMIT_INFLIGHT",
            } as const
          )[reserved.reason],
        );
      throw new RecipeServiceError(
        409,
        reserved.kind === "conflict"
          ? "RECIPE_REQUEST_CONFLICT"
          : reserved.kind === "busy"
            ? "RECIPE_REQUEST_IN_PROGRESS"
            : "RECIPE_OUTCOME_UNAVAILABLE",
      );
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let terminal = false;
    try {
      await this.requireReady(userId, accessToken, operation, provider);
      const timeoutMs = Math.min(
        30_000,
        Math.max(1, this.options.timeoutMs ?? 30_000),
      );
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new RecipeServiceError(504, "RECIPE_PROVIDER_TIMEOUT"));
        }, timeoutMs);
      });
      const result = await Promise.race([invoke(controller.signal), deadline]);
      await this.requireReady(userId, accessToken, operation, provider);
      if (
        result.tokensUsed !== undefined &&
        (!Number.isSafeInteger(result.tokensUsed) ||
          result.tokensUsed < 1 ||
          result.tokensUsed > tokensEstimated)
      )
        throw new RecipeServiceError(502, "RECIPE_PROVIDER_USAGE_INVALID");
      const final = await ledger.finalize({
        userId,
        attemptId: reserved.attemptId,
        status: "succeeded",
        ...(result.tokensUsed !== undefined
          ? { tokensUsed: result.tokensUsed }
          : {}),
      });
      terminal = true;
      if (!final.publishAllowed)
        throw new RecipeServiceError(409, "RECIPE_RESULT_EXPIRED");
      return result.value;
    } catch (error) {
      if (!terminal)
        await ledger
          .finalize({ userId, attemptId: reserved.attemptId, status: "failed" })
          .catch(() => undefined);
      if (error instanceof RecipeServiceError) throw error;
      if (error instanceof RecipeProviderError)
        throw new RecipeServiceError(
          error.reason === "timeout" ? 504 : 502,
          (
            {
              timeout: "RECIPE_PROVIDER_TIMEOUT",
              unavailable: "RECIPE_PROVIDER_UNAVAILABLE",
              refused: "RECIPE_PROVIDER_REFUSED",
              malformed_output: "RECIPE_PROVIDER_MALFORMED_OUTPUT",
            } as const
          )[error.reason],
        );
      throw new RecipeServiceError(503, "RECIPE_REQUEST_UNAVAILABLE");
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
    }
  }
  async suggest(
    userId: UserId,
    accessToken: string,
    request: MealRecipeSuggestionRequest,
  ) {
    const profile = await this.requireReady(userId, accessToken, "suggest");
    const before = await loadOwnedRecipeContext(
      this.options.repositories,
      userId,
      accessToken,
      profile,
      this.now(),
    );
    const sourceIdentity = ({
      generatedAt: _g,
      expiresAt: _e,
      ...identity
    }: typeof before.snapshot) => identity;
    const { input, warnings } = applyProfileDiets(request.input, profile);
    const feasible = buildFeasibleRecipeTemplates(input, {
      servings: request.servings,
      now: this.now(),
      advisoryWarnings: warnings,
    });
    if (feasible.state === "clarification_needed")
      throw new RecipeServiceError(422, "RECIPE_INGREDIENTS_NEED_REVIEW");
    if (feasible.state === "invalid_input")
      throw new RecipeServiceError(400, "INVALID_RECIPE_REQUEST");
    /**
     * Ranks the provider's selection, or every feasible template when there
     * is no selection, after re-checking access and the owned source context.
     * Returns at most RECIPE_GENERATION_MAX_RESULTS deterministic drafts.
     */
    const complete = async (selectedIds: readonly string[] | null) => {
      const pool =
        selectedIds === null || selectedIds.length === 0
          ? feasible.recipes
          : feasible.recipes.filter(({ candidate }) =>
              selectedIds.includes(candidate.recipeId),
            );
      const currentProfile = await this.authorize(userId, accessToken);
      const after = await loadOwnedRecipeContext(
        this.options.repositories,
        userId,
        accessToken,
        currentProfile,
        this.now(),
      );
      if (
        recipeDigest(sourceIdentity(before.snapshot)) !==
        recipeDigest(sourceIdentity(after.snapshot))
      )
        throw new RecipeServiceError(409, "RECIPE_CONTEXT_CHANGED");
      const ranking = rankMealRecipeCandidates(
        before,
        pool.map(({ candidate }) => candidate),
        { now: this.now(), current: after.snapshot },
      );
      const ranked = ranking.ranked.slice(0, RECIPE_GENERATION_MAX_RESULTS);
      return mealRecipeSuggestionResponseSchema.parse({
        version: "meal-recipe-v1",
        requestId: request.requestId,
        recipes: ranked.map(
          ({ recipeId }) =>
            pool.find(({ candidate }) => candidate.recipeId === recipeId)!
              .draft,
        ),
        ranking: { ...ranking, ranked },
      });
    };
    // Nothing for a model to choose between: rank deterministically without
    // a provider call or an AI budget reservation. Access was required above
    // and is re-checked during and after the final context read.
    if (feasible.recipes.length <= RECIPE_GENERATION_MAX_RESULTS) {
      const value = await complete(null);
      await this.requireReady(userId, accessToken, "suggest");
      return value;
    }
    const projected = {
      eligibleRecipes: feasible.recipes.map(({ candidate }) => ({
        recipeId: candidate.recipeId,
        nutrition: candidate.nutrition,
        prepMinutes: candidate.prepMinutes,
      })),
      focus: before.focus,
      preferences: {
        mealSize: input.preferences.mealSize,
        maximumPrepMinutes: input.preferences.maximumPrepMinutes,
      },
      signal: new AbortController().signal,
    };
    return this.attempt(
      userId,
      accessToken,
      profile,
      request.requestId,
      "suggest",
      recipeDigest(request),
      this.options.generationProvider.estimateTokens(projected),
      async (signal) => {
        const output: RecipeGenerationResult =
          await this.options.generationProvider.generate({
            ...projected,
            signal,
          });
        const selection = recipeTemplateSelectionSchema.safeParse(
          output.recipeIds,
        );
        if (!selection.success)
          throw new RecipeProviderError("malformed_output");
        const ids = selection.data;
        if (
          new Set(ids).size !== ids.length ||
          ids.some(
            (id) =>
              !feasible.recipes.some(
                ({ candidate }) => candidate.recipeId === id,
              ),
          )
        )
          throw new RecipeProviderError("malformed_output");
        // An empty selection falls back to the deterministic top results.
        const value = await complete(ids);
        return {
          value,
          ...(output.tokensUsed !== undefined
            ? { tokensUsed: output.tokensUsed }
            : {}),
        };
      },
    );
  }
  async recognize(
    userId: UserId,
    accessToken: string,
    requestId: string,
    images: IngredientRecognitionRequest["images"],
  ) {
    const profile = await this.requireReady(userId, accessToken, "recognize");
    if (
      images.length < 1 ||
      images.length > (await this.maximumImages(userId, accessToken, profile))
    )
      throw new RecipeServiceError(403, "RECIPE_IMAGE_LIMIT");
    const catalog = RECIPE_CATALOG_DATA.map((item) => ({
      ingredientId: item.id,
      name: item.name,
      preparationState: item.preparationState,
    }));
    const projected = { images, catalog, signal: new AbortController().signal };
    const fingerprint = recipeDigest({
      requestId,
      images: images.map((image) => ({
        mimeType: image.mimeType,
        digest: createHash("sha256").update(image.bytes).digest("hex"),
      })),
    });
    return this.attempt(
      userId,
      accessToken,
      profile,
      requestId,
      "recognize",
      fingerprint,
      this.options.recognitionProvider.estimateTokens(projected),
      async (signal) => {
        const output = await this.options.recognitionProvider.recognize({
          ...projected,
          signal,
        });
        const parsedOutput = recognizedIngredientProposalSchema.safeParse(
          output.ingredients,
        );
        if (!parsedOutput.success)
          throw new RecipeProviderError("malformed_output");
        const ingredients = parsedOutput.data.map((item) => {
          const reference =
            item.ingredientId === null
              ? null
              : catalog.find(
                  (entry) => entry.ingredientId === item.ingredientId,
                );
          if (
            item.ingredientId !== null &&
            (!reference ||
              (item.preparationState !== "unknown" &&
                reference.preparationState !== item.preparationState))
          )
            throw new RecipeProviderError("malformed_output");
          return {
            ...item,
            name:
              reference?.name ??
              item.name.replace(/[\u0000-\u001f\u007f]/g, "").trim(),
            confirmed: false as const,
            quantity: null,
            quantityUnit: "g" as const,
            availability: "check_quantity" as const,
          };
        });
        const value = ingredientRecognitionResponseSchema.parse({
          version: "meal-recipe-v1",
          requestId,
          ingredients,
          warnings: [
            "Review each ingredient and preparation state. Photos do not establish quantities, availability, allergens or freshness.",
          ],
        });
        return {
          value,
          ...(output.tokensUsed !== undefined
            ? { tokensUsed: output.tokensUsed }
            : {}),
        };
      },
    );
  }
  /**
   * One conversational assistant turn (ADR0071). The client holds the
   * conversation; the server adds owner macro context and profile diets,
   * charges the existing recipe ledger (photo turns as `recognize`, text
   * turns as `suggest`) and re-validates the provider output.
   */
  async assist(
    userId: UserId,
    accessToken: string,
    turn: RecipeAssistantTurn,
    images: IngredientRecognitionRequest["images"],
  ) {
    const operation: RecipeRequestOperation = images.length
      ? "recognize"
      : "suggest";
    const profile = await this.requireReady(
      userId,
      accessToken,
      operation,
      this.assistant,
    );
    if (
      images.length > (await this.maximumImages(userId, accessToken, profile))
    )
      throw new RecipeServiceError(403, "RECIPE_IMAGE_LIMIT");
    if (!images.length && turn.messages.at(-1)?.role !== "user")
      throw new RecipeServiceError(400, "INVALID_RECIPE_REQUEST");
    const macro = await loadOwnedRecipeContext(
      this.options.repositories,
      userId,
      accessToken,
      profile,
      this.now(),
    );
    const projected = {
      images,
      ingredients: turn.ingredients,
      ideas: turn.ideas,
      messages: turn.messages,
      context: {
        remaining:
          macro.state === "ready"
            ? {
                proteinG: macro.positiveGaps.proteinG,
                carbohydrateG: macro.positiveGaps.carbohydrateG,
                fatG: macro.positiveGaps.fatG,
              }
            : null,
        focus: macro.state === "ready" ? macro.focus : [],
        dietaryPreferences: profile.coachingPreferences.dietaryPreferences,
      },
      signal: new AbortController().signal,
    };
    const fingerprint = recipeDigest({
      turn,
      images: images.map((image) => ({
        mimeType: image.mimeType,
        digest: createHash("sha256").update(image.bytes).digest("hex"),
      })),
    });
    return this.attempt(
      userId,
      accessToken,
      profile,
      turn.requestId,
      operation,
      fingerprint,
      this.assistant.estimateTokens(projected),
      async (signal) => {
        const output = await this.assistant.assist({ ...projected, signal });
        const parsed = recipeAssistantReplySchema.safeParse({
          version: RECIPE_ASSISTANT_VERSION,
          requestId: turn.requestId,
          reply: output.reply,
          ingredients: output.ingredients,
          ideas: output.ideas,
        });
        if (!parsed.success) throw new RecipeProviderError("malformed_output");
        return {
          value: parsed.data,
          ...(output.tokensUsed !== undefined
            ? { tokensUsed: output.tokensUsed }
            : {}),
        };
      },
      this.assistant,
    );
  }
}
