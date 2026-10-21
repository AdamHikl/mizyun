/**
 * Retained meal photos are on in Dev when `MEAL_PHOTOS_ENABLED=true` on the
 * Dev port. Other environments need the explicit
 * `MIZYUN_MEAL_PHOTOS_ENABLED=true` flag (Production release, 2026-10-21).
 */
export const loadMealPhotosEnabled = (
  env: Readonly<Record<string, string | undefined>>,
): boolean =>
  (env.MIZYUN_ENVIRONMENT === "dev" &&
    env.MEAL_PHOTOS_ENABLED === "true" &&
    env.API_PORT === "4100") ||
  env.MIZYUN_MEAL_PHOTOS_ENABLED === "true";
