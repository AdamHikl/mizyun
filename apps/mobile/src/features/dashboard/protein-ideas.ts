import type { CoachingPreferences } from "@mizyun/contracts";

type DietaryPreference = CoachingPreferences["dietaryPreferences"][number];

interface ProteinIdea {
  readonly label: string;
  readonly vegan: boolean;
  readonly dairy: boolean;
  readonly gluten: boolean;
}

// Names only: amounts depend on the product and portion, so the user's logged
// meal remains the source of nutrition values.
const ideas: readonly ProteinIdea[] = [
  { label: "Tofu or tempeh", vegan: true, dairy: false, gluten: false },
  { label: "Greek yogurt or skyr", vegan: false, dairy: true, gluten: false },
  { label: "Lentils or chickpeas", vegan: true, dairy: false, gluten: false },
  { label: "Eggs", vegan: false, dairy: false, gluten: false },
  { label: "Edamame", vegan: true, dairy: false, gluten: false },
  { label: "Cottage cheese", vegan: false, dairy: true, gluten: false },
  { label: "Seitan", vegan: true, dairy: false, gluten: true },
  { label: "Soy milk or soy yogurt", vegan: true, dairy: false, gluten: false },
];

const MAX_IDEAS = 4;

/**
 * Plant-forward protein ideas for vegetarian and vegan preferences. Other
 * diets return none, because the dashboard has no evidence they need help.
 */
export const proteinIdeasFor = (
  preferences: readonly DietaryPreference[] | null | undefined,
): readonly string[] => {
  const selected = new Set(preferences ?? []);
  const vegan = selected.has("vegan");
  if (!vegan && !selected.has("vegetarian")) return [];
  return ideas
    .filter((idea) => !vegan || idea.vegan)
    .filter((idea) => !selected.has("lactose_free") || !idea.dairy)
    .filter((idea) => !selected.has("gluten_free") || !idea.gluten)
    .slice(0, MAX_IDEAS)
    .map((idea) => idea.label);
};
