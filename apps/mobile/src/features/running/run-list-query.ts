import { isRunImportsEnabled } from "@/composition/app-variant";

/**
 * Builds that can import runs ask for them; older APIs reject `include`, so
 * a build without imports keeps the original list query.
 */
export const runListBaseQuery = (): Record<string, string> =>
  isRunImportsEnabled() ? { limit: "50", include: "imports" } : { limit: "50" };
