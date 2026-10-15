import type { MealRecipeInput } from "@mizyun/contracts";
import type { DietaryPreference, StoredProfile } from "@mizyun/core";

/**
 * Catalog exclusion applied for each saved profile diet, or null when the
 * catalog cannot enforce it. Halal and kosher depend on sourcing and
 * certification the catalog cannot know, so they never become a filter
 * (which would fail every request) and never claim compliance.
 */
const PROFILE_DIET_RESTRICTIONS = {
  omnivore: null,
  vegetarian: "vegetarian",
  vegan: "vegan",
  // The catalog has no reviewed fish/seafood items; keep the conservative mapping.
  pescatarian: "vegetarian",
  lactose_free: "dairy_free",
  gluten_free: "gluten_free",
  halal: null,
  kosher: null,
} as const satisfies Record<DietaryPreference, string | null>;

const PROFILE_DIET_WARNINGS: Partial<Record<DietaryPreference, string>> = {
  halal:
    "Check your ingredients meet halal requirements; recipe filtering does not verify halal status.",
  kosher:
    "Check your ingredients meet kosher requirements; recipe filtering does not verify kosher status.",
};

export interface ProfileDietApplication {
  readonly input: MealRecipeInput;
  /** Advisory recipe warnings for profile diets the catalog cannot enforce. */
  readonly warnings: readonly string[];
}

/** Single mapping from saved profile diets to recipe exclusions and advisories. */
export function applyProfileDiets(
  input: MealRecipeInput,
  profile: Pick<StoredProfile, "coachingPreferences">,
): ProfileDietApplication {
  const diets = profile.coachingPreferences.dietaryPreferences;
  const restrictions = diets.flatMap((diet) => {
    const restriction = PROFILE_DIET_RESTRICTIONS[diet];
    return restriction === null ? [] : [restriction];
  });
  const warnings = [
    ...new Set(diets.flatMap((diet) => PROFILE_DIET_WARNINGS[diet] ?? [])),
  ];
  return {
    input: {
      ...input,
      exclusions: {
        ...input.exclusions,
        dietaryRestrictions: [
          ...new Set([
            ...input.exclusions.dietaryRestrictions,
            ...restrictions,
          ]),
        ],
      },
    },
    warnings,
  };
}
