/**
 * Saving user-selected Health running workouts is a Dev-only feature. Reading,
 * editing and deleting runs already saved stays available in every environment.
 */
export const runHealthImportsEnabled = (
  env: Readonly<Record<string, string | undefined>>,
): boolean => env.MIZYUN_ENVIRONMENT === "dev";
