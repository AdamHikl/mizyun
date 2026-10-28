import type { DailyNutritionDisplay } from "./dashboard-data";

/** Spoken hint for the Home calorie card, which opens Meals. */
export const DAILY_NUTRITION_ACCESSIBILITY_HINT = "Opens Meals";

const formatAmount = (value: number): string => value.toLocaleString();

const macroPhrase = (
  label: string,
  current: number | null,
  target: number | null,
  unit: string | null,
): string => {
  if (current === null) {
    return target !== null
      ? `${label} unknown of ${formatAmount(target)}${unit ? ` ${unit}` : ""}`
      : `${label} unknown`;
  }
  return target !== null
    ? `${label} ${formatAmount(current)} of ${formatAmount(target)}${unit ? ` ${unit}` : ""}`
    : `${label} ${formatAmount(current)}${unit ? ` ${unit}` : ""}`;
};

const caloriePhrase = (display: DailyNutritionDisplay): string => {
  const { consumedKcal, targetKcal, remainingKcal } = display;
  if (display.status === "loading") {
    return targetKcal !== null
      ? `Calories today loading, target ${formatAmount(targetKcal)} kcal`
      : "Calories today loading";
  }
  if (display.status === "error") return "Calories today unavailable";
  if (consumedKcal === null) {
    return targetKcal !== null
      ? `Calories today unknown of ${formatAmount(targetKcal)} kcal`
      : "Calories today unknown";
  }
  if (targetKcal === null) {
    return `Calories today: ${formatAmount(consumedKcal)} kcal, no calorie target set`;
  }
  const eaten = `Calories today: ${formatAmount(consumedKcal)} of ${formatAmount(targetKcal)} kcal`;
  // Remaining is withheld while any meal's nutrition is unconfirmed.
  if (remainingKcal === null) return eaten;
  return remainingKcal >= 0
    ? `${eaten}, ${formatAmount(remainingKcal)} left`
    : `${eaten}, ${formatAmount(Math.abs(remainingKcal))} over`;
};

/**
 * One spoken summary of the Home calorie card. The card is a single button,
 * so its nested values are unreachable to VoiceOver; this label repeats the
 * same displayed values (no new calculation) in reading order.
 */
export const dailyNutritionAccessibilityLabel = (
  display: DailyNutritionDisplay,
  proteinIdeas: readonly string[] = [],
): string => {
  const sentences = [caloriePhrase(display)];
  if (display.status !== "loading" && display.status !== "error") {
    // Only the first macro names its unit, matching how the values are read.
    sentences.push(
      [
        macroPhrase(
          "Protein",
          display.proteinG,
          display.targetProteinG,
          "grams",
        ),
        macroPhrase(
          "carbs",
          display.carbohydrateG,
          display.targetCarbohydrateG,
          null,
        ),
        macroPhrase("fat", display.fatG, display.targetFatG, null),
      ].join(", "),
    );
  }
  if (proteinIdeas.length > 0) {
    sentences.push(`Protein ideas for later today: ${proteinIdeas.join(", ")}`);
  }
  if (display.hasIncompleteMeals) {
    sentences.push("Some meals have unconfirmed nutrition");
  }
  return `${sentences.join(". ")}.`;
};
