import type { PlanTier, ProfileRepository, UserId } from "@mizyun/core";
import { ADVANCED_NUTRIENT_FIELDS } from "@mizyun/core";
import type { BetaProRepository } from "../../beta-pro-repository.js";

/** Shared authority for editing, summaries and AI draft suggestions. */
export const resolveAdvancedNutritionSource = async (
  options: {
    readonly betaProRepository?: BetaProRepository;
    readonly profileRepository?: ProfileRepository;
  },
  userId: UserId,
  accessToken: string,
  profilePlanTier?: PlanTier,
): Promise<"paid" | "beta_pro" | "none"> => {
  const beta = await options.betaProRepository?.getRequest(userId, {
    accessToken,
  });
  if (beta?.status === "approved") return "beta_pro";
  const tier =
    profilePlanTier ??
    (
      await options.profileRepository?.getOrCreate(userId, {
        accessToken,
        now: new Date(),
      })
    )?.planTier;
  return tier === "paid" ? "paid" : "none";
};

export const hasAdvancedNutritionForDraft = async (
  ...args: Parameters<typeof resolveAdvancedNutritionSource>
): Promise<boolean> => {
  try {
    return (await resolveAdvancedNutritionSource(...args)) !== "none";
  } catch {
    // Entitlement unavailability cannot unlock Pro or block basic drafting.
    return false;
  }
};

export const draftForCapability = <T extends object>(
  draft: T,
  includeAdvancedNutrition: boolean | undefined,
): T => {
  if (includeAdvancedNutrition) return draft;
  const basic = { ...draft };
  for (const field of ADVANCED_NUTRIENT_FIELDS) {
    Reflect.deleteProperty(basic, field);
  }
  return basic;
};
