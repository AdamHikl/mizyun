import {
  mealRecipeRevalidationRequestSchema,
  mealRecipeRevalidationResponseSchema,
  mealRecipeSessionContextSchema,
  type MealRecipeRevalidationRequest,
} from "@mizyun/contracts";
import {
  rankMealRecipeCandidates,
  type StoredProfile,
  type UserId,
} from "@mizyun/core";
import {
  RECIPE_CATALOG_DATA,
  RECIPE_CATALOG_REVISION,
} from "./catalog-data.js";
import { loadOwnedRecipeContext, recipeDigest } from "./context.js";
import { applyProfileDiets } from "./profile-diet.js";
import { buildFeasibleRecipeTemplates } from "./templates.js";
import { RecipeServiceError, type RecipeServiceOptions } from "./service.js";

export type MealRecipeSessionServiceOptions = Pick<
  RecipeServiceOptions,
  "repositories" | "accountRepository" | "enabled" | "now"
>;
const sourceIdentity = (
  snapshot: Awaited<ReturnType<typeof loadOwnedRecipeContext>>["snapshot"],
) => {
  const {
    generatedAt: _generatedAt,
    expiresAt: _expiresAt,
    ...identity
  } = snapshot;
  return recipeDigest(identity);
};
/** Owner-scoped deterministic reads. No consent, provider, ledger or intake mutation. */
export class MealRecipeSessionService {
  readonly now: () => Date;
  constructor(readonly options: MealRecipeSessionServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }
  private async authorize(
    userId: UserId,
    accessToken: string,
  ): Promise<StoredProfile> {
    if (!this.options.enabled())
      throw new RecipeServiceError(503, "RECIPES_DISABLED");
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
    if (profile.userId !== userId)
      throw new RecipeServiceError(503, "RECIPE_REQUEST_UNAVAILABLE");
    return profile;
  }
  private async read(userId: UserId, accessToken: string) {
    const profile = await this.authorize(userId, accessToken);
    const context = await loadOwnedRecipeContext(
      this.options.repositories,
      userId,
      accessToken,
      profile,
      this.now(),
    );
    return { profile, context };
  }
  private async verify(
    userId: UserId,
    accessToken: string,
    before: Awaited<ReturnType<MealRecipeSessionService["read"]>>,
  ) {
    const after = await this.read(userId, accessToken);
    if (
      sourceIdentity(before.context.snapshot) !==
      sourceIdentity(after.context.snapshot)
    )
      throw new RecipeServiceError(409, "RECIPE_CONTEXT_CHANGED");
    // Detect deletion, disable or profile changes during the final context load too.
    const finalProfile = await this.authorize(userId, accessToken);
    if (recipeDigest(finalProfile) !== recipeDigest(after.profile))
      throw new RecipeServiceError(409, "RECIPE_CONTEXT_CHANGED");
    return after.context;
  }
  async context(userId: UserId, accessToken: string) {
    const before = await this.read(userId, accessToken);
    const context = await this.verify(userId, accessToken, before);
    return mealRecipeSessionContextSchema.parse({
      version: "meal-recipe-v1",
      catalogRevision: RECIPE_CATALOG_REVISION,
      catalog: RECIPE_CATALOG_DATA.map(
        ({
          id,
          name,
          familyId,
          preparationState,
          per100g,
          allergens,
          vegan,
          vegetarian,
        }) => ({
          id,
          name,
          familyId,
          preparationState,
          per100g,
          allergens,
          vegan,
          vegetarian,
        }),
      ),
      context,
    });
  }
  async revalidate(
    userId: UserId,
    accessToken: string,
    untrusted: MealRecipeRevalidationRequest,
  ) {
    const parsed = mealRecipeRevalidationRequestSchema.safeParse(untrusted);
    if (!parsed.success)
      throw new RecipeServiceError(400, "INVALID_RECIPE_REQUEST");
    const request = parsed.data;
    if (request.catalogRevision !== RECIPE_CATALOG_REVISION)
      throw new RecipeServiceError(409, "RECIPE_CONTEXT_CHANGED");
    const before = await this.read(userId, accessToken);
    const { input, warnings } = applyProfileDiets(
      request.input,
      before.profile,
    );
    const feasible = buildFeasibleRecipeTemplates(input, {
      servings: request.servings,
      now: this.now(),
      advisoryWarnings: warnings,
    });
    if (
      feasible.state !== "ready" ||
      request.recipeIds.some(
        (id) =>
          !feasible.recipes.some(({ candidate }) => candidate.recipeId === id),
      )
    )
      throw new RecipeServiceError(422, "RECIPE_INGREDIENTS_NEED_REVIEW");
    const selected = feasible.recipes.filter(({ candidate }) =>
      request.recipeIds.includes(candidate.recipeId),
    );
    const current = await this.verify(userId, accessToken, before);
    const ranking = rankMealRecipeCandidates(
      current,
      selected.map(({ candidate }) => candidate),
      { now: this.now(), current: current.snapshot },
    );
    const ranked = ranking.ranked.map(({ recipeId }) =>
      selected.find(({ candidate }) => candidate.recipeId === recipeId)!,
    );
    return mealRecipeRevalidationResponseSchema.parse({
      version: "meal-recipe-v1",
      catalogRevision: RECIPE_CATALOG_REVISION,
      recipes: ranked.map(({ draft }) => draft),
      candidates: ranked.map(({ candidate }) => candidate),
      ranking,
    });
  }
}
