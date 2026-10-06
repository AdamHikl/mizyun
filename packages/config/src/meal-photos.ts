/** Retained meal photos are an explicitly enabled Dev experiment. */
export const loadMealPhotosEnabled = (
  env: Readonly<Record<string, string | undefined>>,
): boolean =>
  env.MIZYUN_ENVIRONMENT === "dev" &&
  env.MEAL_PHOTOS_ENABLED === "true" &&
  env.API_PORT === "4100";
