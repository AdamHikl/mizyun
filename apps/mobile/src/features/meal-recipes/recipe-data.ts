import {
  createMealRecipeApi,
  createMealRecipeSessionApi,
} from "@mizyun/api-client";
import { randomUUID } from "expo-crypto";
import { apiClient } from "@/composition/api-client";
import { stageRecipeMealDraft } from "@/features/log-meal/public-data";
import { RecipeController } from "./recipe-controller";
import { recipeSessionStore } from "./recipe-storage";
export const createRecipeController = (
  owner: string,
  isCurrent: () => boolean,
) =>
  new RecipeController({
    owner,
    isCurrent,
    newId: randomUUID,
    api: createMealRecipeApi(apiClient),
    sessionApi: createMealRecipeSessionApi(apiClient),
    store: recipeSessionStore,
    stage: (selected, options) =>
      stageRecipeMealDraft(owner, selected, options),
  });
