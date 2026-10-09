import type { PlanTier, ProfileRepository, UserId } from "@mizyun/core";
import type { BetaProRepository } from "./beta-pro-repository.js";
import { resolveAdvancedNutritionSource } from "./modules/food-entries/advanced-nutrition.js";

/** The existing authoritative paid/approved-pass rule; never a client-provided tier. */
export async function hasMealVisuals(
  options: {
    profileRepository: ProfileRepository;
    betaProRepository: BetaProRepository;
  },
  userId: UserId,
  accessToken: string,
  planTier?: PlanTier,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      resolveAdvancedNutritionSource(
        options,
        userId,
        accessToken,
        planTier,
      ).then((source) => source !== "none"),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 10_000);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
