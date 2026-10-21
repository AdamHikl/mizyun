/**
 * Saving user-selected Health running workouts is on in Dev. Other
 * environments need the explicit `MIZYUN_RUN_IMPORTS_ENABLED=true` flag.
 * Reading, editing and deleting runs already saved stays available in every
 * environment.
 */
export const runHealthImportsEnabled = (
  env: Readonly<Record<string, string | undefined>>,
): boolean =>
  env.MIZYUN_ENVIRONMENT === "dev" || env.MIZYUN_RUN_IMPORTS_ENABLED === "true";
