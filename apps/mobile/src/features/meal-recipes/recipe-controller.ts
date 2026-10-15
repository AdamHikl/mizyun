import type {
  ApiError,
  MealRecipeApi,
  MealRecipeSessionApi,
} from "@mizyun/api-client";
import {
  isDefinitiveRecipeRejection,
  recipeRequestMessage,
} from "./recipe-presentation";
class RecipeRequestFailure extends Error {
  constructor(readonly error: ApiError) {
    super("Suggestion unavailable");
  }
}
import {
  mealRecipeInputSchema,
  type MealRecipeInput,
  type MealRecipeSessionContext,
  type MealRecipeCapabilities,
  type MealRecipeDraft,
} from "@mizyun/contracts";
import {
  rankMealRecipeCandidates,
  scaleRecipeServing,
  isMealRecipeSnapshotFresh,
} from "@mizyun/core";
import {
  type RecipeSession,
  type RecipeSessionStore,
  RECIPE_SESSION_TTL_MS,
} from "./recipe-storage";
export interface RecipeControllerOptions {
  readonly owner: string;
  readonly api: MealRecipeApi;
  readonly sessionApi: MealRecipeSessionApi;
  readonly store: RecipeSessionStore;
  readonly isCurrent: () => boolean;
  readonly newId: () => string;
  readonly now?: () => number;
  readonly stage: (
    selected: {
      name: string;
      caloriesKcal: number | null;
      proteinG: number | null;
      carbohydrateG: number | null;
      fatG: number | null;
      grams: number;
    },
    options: {
      replace: boolean;
      isCurrent: () => boolean;
      operationId: string;
      requireExisting: boolean;
    },
  ) => Promise<{
    status:
      "ready" | "resolved" | "collision" | "unavailable" | "context_changed";
    operationId?: string;
  }>;
}
export interface RecipeSnapshot {
  readonly phase: "loading" | "idle" | "working" | "retired";
  readonly session: RecipeSession | null;
  readonly metadata: MealRecipeSessionContext | null;
  readonly capabilities: MealRecipeCapabilities | null;
  readonly validated: boolean;
  readonly message: string | null;
  readonly collision: boolean;
  readonly persistenceReady: boolean;
}
export class RecipeController {
  private listeners = new Set<() => void>();
  private state: RecipeSnapshot = {
    phase: "loading",
    session: null,
    metadata: null,
    capabilities: null,
    validated: false,
    message: null,
    collision: false,
    persistenceReady: false,
  };
  private epoch = 0;
  private retired = false;
  private aiRetired = false;
  private inputsDirty = false;
  constructor(private options: RecipeControllerOptions) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<RecipeSnapshot>) {
    if (this.retired || !this.options.isCurrent()) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private current(epoch = this.epoch) {
    return !this.retired && this.options.isCurrent() && epoch === this.epoch;
  }
  private now() {
    return (this.options.now ?? Date.now)();
  }
  private requestOptions() {
    return {
      expectedUserId: this.options.owner,
      isCurrent: () => this.current(),
    };
  }
  private async persist(session: RecipeSession) {
    const epoch = this.epoch;
    await this.options.store.save(this.options.owner, session, () =>
      this.current(epoch),
    );
    if (!this.current(epoch)) throw new Error("Context changed");
    this.update({ session, persistenceReady: true });
  }
  private revised(patch: Partial<RecipeSession>): RecipeSession {
    const now = this.now();
    return {
      version: "recipe-session-v1",
      input: null,
      result: null,
      selectedRecipeId: null,
      portion: 1,
      operationId: null,
      handoffOpened: false,
      pendingRequestId: null,
      ...this.state.session,
      ...patch,
      updatedAt: now,
      expiresAt: now + RECIPE_SESSION_TTL_MS,
    };
  }
  async init() {
    if (!this.current()) return;
    this.update({ phase: "loading", validated: false });
    const epoch = this.epoch;
    try {
      const session = await this.options.store.load(this.options.owner);
      if (!this.current(epoch)) return;
      this.update({
        session,
        persistenceReady: true,
        message: session?.pendingRequestId
          ? "The previous AI request outcome is unknown. A new suggestion is an explicit new request."
          : null,
      });
      const [metadata, capabilities] = await Promise.all([
        this.options.sessionApi.context(this.requestOptions()),
        this.options.api.capabilities(this.requestOptions()),
      ]);
      if (!this.current(epoch)) return;
      this.update({
        metadata: metadata.ok ? metadata.value : null,
        capabilities: capabilities.ok ? capabilities.value : null,
        phase: "idle",
        message: metadata.ok
          ? this.state.message
          : "Current macro context is unavailable. Retry when connected.",
      });
      if (session?.result) await this.refresh();
    } catch {
      if (this.current(epoch))
        this.update({
          phase: "idle",
          persistenceReady: false,
          message:
            "Saved recipe recovery is unavailable. Retry before continuing.",
        });
    }
  }
  invalidateInputs() {
    this.inputsDirty = true;
    this.update({
      validated: false,
      collision: false,
      message:
        "Save your changed ingredients and constraints before using a recipe.",
    });
  }
  async anotherConsumption() {
    if (this.state.phase !== "idle" || !this.state.session) return;
    this.update({ phase: "working" });
    try {
      await this.persist(
        this.revised({ operationId: null, handoffOpened: false }),
      );
      this.update({
        phase: "idle",
        message:
          "A separate consumption will receive a new meal identity. An unresolved existing meal still needs recovery first.",
      });
    } catch {
      this.update({
        phase: "idle",
        message: "Could not prepare another consumption. Retry.",
      });
    }
  }
  async setInput(input: MealRecipeInput) {
    if (
      !this.current() ||
      this.state.phase !== "idle" ||
      !this.state.persistenceReady
    )
      return;
    const parsed = mealRecipeInputSchema.safeParse(input);
    if (!parsed.success) {
      this.update({
        message: "Confirm each ingredient and its preparation state.",
      });
      return;
    }
    this.update({ phase: "working", validated: false, collision: false });
    try {
      await this.persist(
        this.revised({
          input: parsed.data,
          selectedRecipeId: null,
          operationId: null,
          handoffOpened: false,
          pendingRequestId: null,
        }),
      );
      this.inputsDirty = false;
      this.update({
        phase: "idle",
        message:
          "Ingredients changed. Check current recipes or request new suggestions.",
      });
    } catch {
      this.update({
        phase: "idle",
        persistenceReady: false,
        message:
          "Could not save confirmed ingredients. Retry before continuing.",
      });
    }
  }
  async generate() {
    if (
      !this.current() ||
      this.aiRetired ||
      this.inputsDirty ||
      this.state.phase !== "idle" ||
      !this.state.persistenceReady ||
      !this.state.session?.input ||
      !this.state.capabilities?.suggest ||
      !this.state.metadata
    )
      return;
    const epoch = this.epoch;
    const input = this.state.session.input;
    const requestId = this.options.newId();
    this.update({
      phase: "working",
      validated: false,
      message: null,
      collision: false,
    });
    try {
      await this.persist(this.revised({ pendingRequestId: requestId }));
      if (!this.current(epoch) || this.aiRetired) return;
      const response = await this.options.api.suggest(
        { requestId, input, servings: 1 },
        {
          ...this.requestOptions(),
          isCurrent: () => this.current(epoch) && !this.aiRetired,
        },
      );
      if (!this.current(epoch) || this.aiRetired) return;
      if (!response.ok) throw new RecipeRequestFailure(response.error);
      if (response.value.recipes.length === 0) {
        await this.persist(
          this.revised({
            result: null,
            selectedRecipeId: null,
            operationId: null,
            handoffOpened: false,
            pendingRequestId: null,
          }),
        );
        this.update({
          phase: "idle",
          message: "No supported recipes match these confirmed ingredients.",
        });
        return;
      }
      const checked = await this.options.sessionApi.revalidate(
        {
          version: "meal-recipe-v1",
          catalogRevision: this.state.metadata!.catalogRevision,
          input,
          servings: 1,
          recipeIds: response.value.recipes.map(
            (recipe: MealRecipeDraft) => recipe.recipeId,
          ),
        },
        {
          ...this.requestOptions(),
          isCurrent: () => this.current(epoch) && !this.aiRetired,
        },
      );
      if (!this.current(epoch) || this.aiRetired) return;
      if (!checked.ok) throw new Error("Validation unavailable");
      await this.persist(
        this.revised({
          result: checked.value,
          selectedRecipeId: null,
          portion: 1,
          operationId: null,
          handoffOpened: false,
          pendingRequestId: null,
        }),
      );
      this.update({ phase: "idle", validated: true, message: null });
    } catch (error) {
      if (!this.current(epoch)) return;
      const failure =
        error instanceof RecipeRequestFailure ? error.error : null;
      if (isDefinitiveRecipeRejection(failure))
        await this.persist(this.revised({ pendingRequestId: null })).catch(
          () => undefined,
        );
      if (this.current(epoch))
        this.update({
          phase: "idle",
          validated: false,
          message: recipeRequestMessage(failure),
        });
    }
  }
  async refresh() {
    if (!this.current() || this.state.phase === "working") return false;
    const epoch = this.epoch;
    this.update({ phase: "working", validated: false, message: null });
    try {
      const capabilities = await this.options.api.capabilities(
        this.requestOptions(),
      );
      if (!this.current(epoch)) return false;
      if (!this.aiRetired)
        this.update({
          capabilities: capabilities.ok ? capabilities.value : null,
        });
      const session = this.state.session;
      const response =
        session?.input && session.result
          ? await this.options.sessionApi.revalidate(
              {
                version: "meal-recipe-v1",
                catalogRevision: session.result.catalogRevision,
                input: session.input,
                servings: 1,
                recipeIds: session.result.recipes.map(
                  (recipe) => recipe.recipeId,
                ),
              },
              this.requestOptions(),
            )
          : null;
      if (!this.current(epoch)) return false;
      if (response) {
        if (!response.ok) throw new Error("Validation unavailable");
        await this.persist(this.revised({ result: response.value }));
        this.update({ phase: "idle", validated: true, message: null });
        return true;
      }
      const metadata = await this.options.sessionApi.context(
        this.requestOptions(),
      );
      if (!this.current(epoch)) return false;
      this.update({
        phase: "idle",
        metadata: metadata.ok ? metadata.value : null,
        message: metadata.ok
          ? null
          : "Macro fit unavailable. Retry when connected.",
      });
      return metadata.ok;
    } catch {
      if (this.current(epoch))
        this.update({
          phase: "idle",
          validated: false,
          message:
            "These are saved recipe details. Current ingredients and dietary constraints could not be verified; cooking and recipe logging are unavailable.",
        });
      return false;
    }
  }
  async select(recipeId: string) {
    if (
      this.state.session?.selectedRecipeId === recipeId &&
      this.state.session.operationId
    )
      return;
    if (
      this.state.phase !== "idle" ||
      !this.state.session?.result?.recipes.some(
        (row) => row.recipeId === recipeId,
      )
    )
      return;
    this.update({ phase: "working", collision: false });
    try {
      await this.persist(
        this.revised({
          selectedRecipeId: recipeId,
          portion: 1,
          operationId: null,
          handoffOpened: false,
        }),
      );
      this.update({ phase: "idle" });
    } catch {
      this.update({
        phase: "idle",
        persistenceReady: false,
        message: "Could not save selection. Retry before continuing.",
      });
    }
  }
  async portion(multiplier: number) {
    if (
      this.state.phase !== "idle" ||
      this.state.session?.operationId ||
      !this.selected(multiplier)
    )
      return;
    this.update({ phase: "working", collision: false });
    try {
      await this.persist(
        this.revised({ portion: multiplier, operationId: null }),
      );
      this.update({ phase: "idle" });
    } catch {
      this.update({
        phase: "idle",
        persistenceReady: false,
        message: "Could not save serving. Retry before continuing.",
      });
    }
  }
  selected(multiplier = this.state.session?.portion ?? 1) {
    const result = this.state.session?.result,
      id = this.state.session?.selectedRecipeId;
    const recipe = result?.recipes.find((row) => row.recipeId === id),
      candidate = result?.candidates.find((row) => row.recipeId === id);
    return recipe && candidate
      ? scaleRecipeServing(recipe, candidate, multiplier)
      : null;
  }
  fresh() {
    return (
      !this.inputsDirty &&
      this.state.validated &&
      this.state.session !== null &&
      this.state.session.expiresAt > this.now() &&
      !!this.state.session.result &&
      isMealRecipeSnapshotFresh(
        this.state.session.result.ranking.context.snapshot,
        new Date(this.now()),
        this.state.session.result.ranking.context.snapshot,
      )
    );
  }
  ranking() {
    const result = this.state.session?.result;
    if (!result) return null;
    const selected = this.selected();
    const candidates = result.candidates.map((candidate) =>
      selected && candidate.recipeId === selected.candidate.recipeId
        ? selected.candidate
        : candidate,
    );
    return rankMealRecipeCandidates(
      this.fresh()
        ? result.ranking.context
        : {
            ...result.ranking.context,
            state: "stale",
            reason: "source_stale",
            focus: [],
          },
      candidates,
      { now: new Date(this.now()), current: result.ranking.context.snapshot },
    );
  }
  expire() {
    if (!this.fresh() && this.state.validated)
      this.update({
        validated: false,
        message:
          "Current recipe fit has expired. Check again before cooking or logging.",
      });
  }
  async handoff(replace = false) {
    if (
      !this.current() ||
      this.inputsDirty ||
      this.state.phase !== "idle" ||
      !this.state.persistenceReady
    )
      return false;
    if (!(await this.refresh())) return false;
    const selected = this.selected();
    if (!selected || !this.fresh()) return false;
    this.update({ phase: "working", collision: false });
    try {
      const operationId =
        this.state.session?.operationId ?? this.options.newId();
      await this.persist(this.revised({ operationId }));
      const result = await this.options.stage(
        {
          name: selected.recipe.name,
          caloriesKcal: selected.recipe.caloriesKcal,
          ...selected.recipe.nutritionPerServing,
          grams: selected.candidate.portionGrams,
        },
        {
          replace,
          isCurrent: () => this.current(),
          operationId,
          requireExisting: this.state.session?.handoffOpened ?? false,
        },
      );
      if (!this.current()) return false;
      if (result.status === "ready")
        await this.persist(this.revised({ handoffOpened: true }));
      this.update({
        phase: "idle",
        collision: result.status === "collision",
        message:
          result.status === "ready"
            ? null
            : result.status === "resolved"
              ? "This meal was already recorded. Prepare a separate consumption if you ate another serving."
              : result.status === "collision"
                ? "An unfinished meal draft is saved. Return to it, or explicitly replace it to continue."
                : "The meal draft could not be saved. Retry before continuing.",
      });
      return result.status === "ready";
    } catch {
      this.update({
        phase: "idle",
        message: "The meal draft could not be saved. Retry before continuing.",
      });
      return false;
    }
  }
  retireAi() {
    this.aiRetired = true;
    this.epoch++;
    this.update({
      phase: "idle",
      validated: false,
      capabilities: this.state.capabilities
        ? {
            ...this.state.capabilities,
            suggest: false,
            recognizeIngredients: false,
          }
        : null,
      message:
        "AI consent changed. Manual meal logging and saved details remain available.",
    });
  }
  dispose() {
    this.retired = true;
    this.epoch++;
    this.state = {
      ...this.state,
      phase: "retired",
      session: null,
      metadata: null,
    };
    for (const listener of this.listeners) listener();
  }
}
