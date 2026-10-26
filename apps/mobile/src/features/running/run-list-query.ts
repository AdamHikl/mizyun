import {
  isHistoryImportsEnabled,
  isRunImportsEnabled,
} from "@/composition/app-variant";

/**
 * Builds that can import runs ask for them; older APIs reject `include`, so
 * a build without imports keeps the original list query. Builds that can also
 * import history files ask for those runs too (older builds would reject the
 * new origin kind, so they never receive it).
 */
export const runListBaseQuery = (): Record<string, string> =>
  isHistoryImportsEnabled()
    ? { limit: "50", include: "all_imports" }
    : isRunImportsEnabled()
      ? { limit: "50", include: "imports" }
      : { limit: "50" };
