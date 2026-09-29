import type { DailyFoodSummary, FoodEntry } from "@mizyun/contracts";

const fields = [
  ["fibreG", "Fibre", "g"],
  ["saturatedFatG", "Saturated fat", "g"],
  ["totalSugarsG", "Total sugars", "g"],
  ["sodiumMg", "Sodium", "mg"],
  ["cholesterolMg", "Dietary cholesterol", "mg"],
] as const;

export const ADVANCED_DISPLAY_FIELDS = fields.map(([key, label]) => ({
  key,
  label,
}));

export const weeklyAdvancedNutrientLines = (
  summaries: ReadonlyArray<DailyFoodSummary>,
  visibleFields: ReadonlyArray<string>,
): string[] => {
  const entryCount = summaries.reduce((sum, day) => sum + day.entryCount, 0);
  if (entryCount === 0) return ["No meals logged this week."];
  const mealLabel = entryCount === 1 ? "logged meal" : "logged meals";
  return fields.flatMap(([key, label, unit]) => {
    if (!visibleFields.includes(key)) return [];
    const known = summaries.reduce(
      (sum, day) => sum + (day.advancedCoverage?.[key] ?? 0),
      0,
    );
    const subtotal =
      Math.round(
        summaries.reduce(
          (sum, day) => sum + (day.advancedKnownSubtotal?.[key] ?? 0),
          0,
        ) * 10,
      ) / 10;
    return [
      known === entryCount
        ? `${label}: ${subtotal} ${unit} across ${entryCount} ${mealLabel}`
        : `${label}: incomplete · known subtotal ${subtotal} ${unit} (${known}/${entryCount} ${mealLabel})`,
    ];
  });
};

export const advancedNutrientLines = (
  entries: ReadonlyArray<FoodEntry>,
  visibleFields: ReadonlyArray<string> = fields.map(([key]) => key),
): string[] =>
  fields.flatMap(([key, label, unit]) => {
    if (!visibleFields.includes(key)) return [];
    const known = entries
      .map((entry) => entry[key])
      .filter((value): value is number => value != null);
    if (entries.length === 1 && known.length === 0) return [];
    const subtotal =
      Math.round(known.reduce((sum, value) => sum + value, 0) * 10) / 10;
    if (entries.length === 1) return [`${label}: ${subtotal} ${unit}`];
    return [
      known.length === entries.length
        ? `${label}: ${subtotal} ${unit}`
        : `${label}: incomplete · known subtotal ${subtotal} ${unit} (${known.length}/${entries.length} entries)`,
    ];
  });
