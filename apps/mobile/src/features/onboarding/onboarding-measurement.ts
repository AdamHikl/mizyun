import { bucketDuration, bucketTaps } from "@mizyun/observability";
import type {
  FailureReason,
  OnboardingStep as AnalyticsOnboardingStep,
} from "@mizyun/contracts";
import type {
  AnalyticsFlowScope,
  NetworkAnalyticsClient,
} from "@/features/analytics/network-analytics-client";
import type { OnboardingStep } from "./onboarding-state";

export const analyticsOnboardingStep: Record<
  OnboardingStep,
  AnalyticsOnboardingStep
> = {
  welcome: "welcome",
  displayName: "display_name",
  units: "units",
  baselineWeight: "baseline_weight",
  energyProfile: "energy_profile",
  primaryGoal: "primary_goal",
};

/** Only coarse wizard outcomes; no form values cross this boundary. */
export class OnboardingMeasurement {
  private finished = false;
  private taps = 0;
  private readonly steps = new Set<OnboardingStep>();
  constructor(
    private readonly analytics: Pick<NetworkAnalyticsClient, "track">,
    private readonly scope: AnalyticsFlowScope,
    private readonly startedAt = Date.now(),
    private readonly now: () => number = Date.now,
  ) {
    this.record({ name: "onboarding_started", properties: {} });
  }
  tap(): void {
    if (!this.finished) this.taps++;
  }
  stepCompleted(step: OnboardingStep): void {
    if (this.finished || this.steps.has(step)) return;
    this.steps.add(step);
    this.record({
      name: "onboarding_step_completed",
      properties: { step: analyticsOnboardingStep[step] },
    });
  }
  fail(step: OnboardingStep, reason: FailureReason): void {
    if (this.finished) return;
    this.record({
      name: "onboarding_failed",
      properties: { step: analyticsOnboardingStep[step], reason },
    });
  }
  complete(): void {
    if (this.finished) return;
    this.finished = true;
    this.record({
      name: "onboarding_completed",
      properties: { duration: this.duration(), taps: bucketTaps(this.taps) },
    });
  }
  exit(step: OnboardingStep): void {
    if (this.finished) return;
    this.finished = true;
    this.record({
      name: "onboarding_exited",
      properties: {
        step: analyticsOnboardingStep[step],
        duration: this.duration(),
        exit: "cancel",
      },
    });
  }
  private duration() {
    return bucketDuration(Math.max(0, this.now() - this.startedAt));
  }
  private record(input: Parameters<NetworkAnalyticsClient["track"]>[0]): void {
    try {
      void Promise.resolve(this.analytics.track(input, this.scope)).catch(
        () => undefined,
      );
    } catch {
      /* Analytics cannot interrupt onboarding. */
    }
  }
}
