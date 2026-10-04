import {
  analyticsSettingsDestinationSchema,
  type AnalyticsEventV2,
} from "@mizyun/contracts";
import { analyticsClient } from "@/composition/analytics-client";

type DashboardControl = Extract<
  AnalyticsEventV2,
  { name: "dashboard_control_clicked" }
>["properties"]["control"];

/** UI interactions never wait on telemetry or expose personal display values. */
function record(event: Parameters<typeof analyticsClient.track>[0]): void {
  try {
    void analyticsClient.track(event).catch(() => {});
  } catch {}
}

export function trackDashboardControl(control: DashboardControl): void {
  record({ name: "dashboard_control_clicked", properties: { control } });
}

export function trackSettingsSearchUsed(resultCount: number): void {
  record({
    name: "settings_search_used",
    properties: {
      resultCount:
        resultCount === 0 ? "none" : resultCount <= 5 ? "1_to_5" : "6_plus",
    },
  });
}

export function trackSettingsSearchSelected(destination: string): void {
  const parsed = analyticsSettingsDestinationSchema.safeParse(destination);
  if (!parsed.success) return;
  record({
    name: "settings_search_selected",
    properties: { destination: parsed.data },
  });
}
