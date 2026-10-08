/** General adult WHO references and EU/FDA label benchmarks, not personal targets. */
export const adultNutrientReferences = (dailyTargetKcal: number | null) => ({
  fibreMinimumG: 25,
  sodiumBelowMg: 2000,
  // EU adult labeling uses a fixed 2,000-kcal reference diet, not the user's target.
  totalSugarsEuLabelReferenceG: 90,
  cholesterolFdaDailyValueMg: 300,
  // Saturated fat supplies 9 kcal/g; WHO reference is at most 10% of energy.
  saturatedFatMaximumG:
    dailyTargetKcal !== null &&
    Number.isFinite(dailyTargetKcal) &&
    dailyTargetKcal > 0
      ? dailyTargetKcal / 90
      : null,
});
