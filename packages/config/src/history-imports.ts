/**
 * Previewing and saving history imports (ADR-0083) is on in Dev. Other
 * environments need the explicit `MIZYUN_HISTORY_IMPORTS_ENABLED=true` flag.
 * Listing and deleting batches already imported stays available everywhere.
 */
export const historyImportsEnabled = (
  env: Readonly<Record<string, string | undefined>>,
): boolean =>
  env.MIZYUN_ENVIRONMENT === "dev" ||
  env.MIZYUN_HISTORY_IMPORTS_ENABLED === "true";
