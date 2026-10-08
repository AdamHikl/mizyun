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
import { analyticsClient } from "@/composition/analytics-client";
import type {
  AnalyticsEventInput,
  AnalyticsFlowScope,
  NetworkAnalyticsClient,
} from "./network-analytics-client";

type FlowAnalyticsClient = Pick<
  NetworkAnalyticsClient,
  "createFlowScope" | "track"
>;

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
      measurement.current = new LoggingFlowMeasurement(flow);
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
