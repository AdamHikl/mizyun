/** General adult WHO references, not personalized nutrition prescriptions. */
export const adultNutrientReferences = (dailyTargetKcal: number | null) => ({
  fibreMinimumG: 25,
  sodiumBelowMg: 2000,
  // Saturated fat supplies 9 kcal/g; WHO reference is at most 10% of energy.
  saturatedFatMaximumG:
    dailyTargetKcal !== null &&
    Number.isFinite(dailyTargetKcal) &&
    dailyTargetKcal > 0
      ? dailyTargetKcal / 90
      : null,
});
