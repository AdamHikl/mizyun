import { invalidateSessionReads } from "@/composition/api-client";
import { publishSessionReadUpdate } from "@/composition/personal-read-events";

/** After a weekly-review decision the calorie target changed server-side. */
export const refreshEnergyAfterDecision = (): void => {
  invalidateSessionReads();
  publishSessionReadUpdate("/v1/energy/summary");
};
