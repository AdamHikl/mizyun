import {
  analyticsSettingsDestinationSchema,
  type AnalyticsEventV2,
  type AnalyticsShareCardKind,
  type AnalyticsShareCardOutcome,
  type FeatureAction,
} from "@mizyun/contracts";
import { bucketDuration, type FailureReason } from "@mizyun/observability";
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

/** A finished feature attempt: the fixed action, its outcome and buckets only. */
export function trackFeatureActionResult(
  action: FeatureAction,
  result:
    | { readonly outcome: "success"; readonly durationMs: number }
    | {
        readonly outcome: "failure";
        readonly reason: FailureReason;
        readonly durationMs: number;
      },
): void {
  record({
    name: "feature_action_result",
    properties: {
      action,
      outcome: result.outcome,
      ...(result.outcome === "failure" ? { reason: result.reason } : {}),
      duration: bucketDuration(Math.max(0, result.durationMs)),
    },
  });
}

/** The share-card kind and outcome only, never the card's content. */
export function trackShareCardResult(
  card: AnalyticsShareCardKind,
  outcome: AnalyticsShareCardOutcome,
): void {
  record({ name: "share_card_result", properties: { card, outcome } });
}
