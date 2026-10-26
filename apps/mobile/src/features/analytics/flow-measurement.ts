import { useEffect, useRef } from "react";
import { useNavigation } from "expo-router";
import {
  bucketDuration,
  bucketRetries,
  bucketTaps,
  type FailureReason,
  type FailureStage,
  type LoggingFlow,
} from "@mizyun/observability";
import type { CoreRecordKind } from "@mizyun/contracts";
import {
  activationMilestones,
  analyticsClient,
} from "@/composition/analytics-client";
import type {
  AnalyticsEventInput,
  AnalyticsFlowScope,
  NetworkAnalyticsClient,
} from "./network-analytics-client";
import type { ActivationMilestones } from "./activation-milestones";

type FlowAnalyticsClient = Pick<
  NetworkAnalyticsClient,
  "createFlowScope" | "track"
>;
type CoreActionReporter = Pick<ActivationMilestones, "recordCoreAction">;

/** A logging visit, not a durable health record or workout identity. */
export class LoggingFlowMeasurement {
  private readonly scope: AnalyticsFlowScope | null;
  private taps = 0;
  private retries = 0;
  private finished = false;

  constructor(
    private readonly flow: LoggingFlow,
    private readonly analytics: FlowAnalyticsClient = analyticsClient,
    private readonly startedAt = Date.now(),
    private readonly now: () => number = Date.now,
    private readonly owner: string | null = null,
    private readonly milestones?: CoreActionReporter,
  ) {
    try {
      this.scope = analytics.createFlowScope();
    } catch {
      this.scope = null;
    }
    this.record({ name: "logging_flow_started", properties: { flow } });
  }
  tap(): void {
    if (!this.finished) this.taps += 1;
  }
  retry(): void {
    if (!this.finished) this.retries += 1;
  }
  complete(): void {
    if (this.finished) return;
    this.finished = true;
    this.record({
      name: "logging_flow_completed",
      properties: {
        flow: this.flow,
        duration: bucketDuration(Math.max(0, this.now() - this.startedAt)),
        taps: bucketTaps(this.taps),
        retries: bucketRetries(this.retries),
      },
    });
    this.record({
      name: "core_record_created",
      properties: { recordKind: this.flow },
    });
    try {
      void (this.milestones ?? activationMilestones).recordCoreAction(
        this.owner,
        this.flow,
      );
    } catch {}
  }
  fail(stage: FailureStage, reason: FailureReason, retryable: boolean): void {
    if (this.finished) return;
    this.record({
      name: "logging_flow_failed",
      properties: {
        flow: this.flow,
        stage,
        reason,
        retryable,
        retries: bucketRetries(this.retries),
      },
    });
  }
  exit(exit: "cancel" | "navigate_away"): void {
    if (this.finished) return;
    this.finished = true;
    this.record({
      name: "logging_flow_exited",
      properties: {
        flow: this.flow,
        duration: bucketDuration(Math.max(0, this.now() - this.startedAt)),
        exit,
      },
    });
  }
  private record(event: AnalyticsEventInput): void {
    if (!this.scope) return;
    try {
      void this.analytics.track(event, this.scope).catch(() => {});
    } catch {}
  }
}

/**
 * A confirmed save outside the measured logging flows (a finished bouldering
 * session). Only the record kind is reported, and only under current consent.
 */
export function recordCoreRecordSaved(
  kind: CoreRecordKind,
  owner: string | null,
  analytics: Pick<NetworkAnalyticsClient, "track"> = analyticsClient,
  milestones?: CoreActionReporter,
): void {
  try {
    void analytics
      .track({ name: "core_record_created", properties: { recordKind: kind } })
      .catch(() => {});
  } catch {}
  try {
    void (milestones ?? activationMilestones).recordCoreAction(owner, kind);
  } catch {}
}

/** Only an observed route removal is an exit; effect cleanup is not one. */
export function useLoggingFlowMeasurement(
  flow: LoggingFlow,
  owner: string | null,
  enabled = true,
) {
  const navigation = useNavigation();
  const measurement = useRef<LoggingFlowMeasurement | null>(null);
  const currentOwner = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    if (!measurement.current || currentOwner.current !== owner) {
      measurement.current = new LoggingFlowMeasurement(
        flow,
        analyticsClient,
        Date.now(),
        Date.now,
        owner,
      );
      currentOwner.current = owner;
    }
    const attempt = measurement.current;
    const unsubscribe = navigation.addListener("beforeRemove", (event) => {
      // All listeners receive the same event. A later listener may prevent the
      // removal, so inspect its final state after synchronous dispatch ends.
      void Promise.resolve().then(() => {
        if (!event?.defaultPrevented) attempt.exit("navigate_away");
      });
    });
    return unsubscribe;
  }, [enabled, flow, navigation, owner]);
  return measurement;
}
