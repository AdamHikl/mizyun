import { LocalAnalyticsClient } from "@mizyun/observability";

import {
  ExpoAnalyticsConsentStore,
  ExpoAnalyticsEventStore,
} from "@/features/analytics/local-analytics-storage";

/**
 * Product analytics composition root. No network processor is selected in
 * OBS-001: events remain in the local adapter until user-initiated export.
 */
export const analyticsClient = new LocalAnalyticsClient(
  new ExpoAnalyticsConsentStore(),
  new ExpoAnalyticsEventStore(),
);
