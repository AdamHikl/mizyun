import { getAppVariant } from "@/composition/app-variant";

/**
 * Only Dev can create imported runs, and older APIs reject `include`, so a
 * Production build keeps the original list query until imports ship there.
 */
export const runListBaseQuery = (): Record<string, string> =>
  getAppVariant() === "dev"
    ? { limit: "50", include: "imports" }
    : { limit: "50" };
