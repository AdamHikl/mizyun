import { z } from "zod";

/**
 * Screen identifiers for product analytics navigation tracking (OBS-002).
 */
export const screenNameSchema = z.enum([
  "dashboard",
  "nutrition_history",
  "workout_history",
  "body_history",
  "progress_photos",
  "settings",
  "coach",
  "feedback",
  "onboarding",
  "log_meal",
  "log_workout",
  "log_body_measurement",
  "energy_setup",
  "meal_detail",
]);

export type ScreenName = z.infer<typeof screenNameSchema>;

export const loggingFlowSchema = z.enum([
  "meal",
  "workout",
  "body_measurement",
]);
export type LoggingFlow = z.infer<typeof loggingFlowSchema>;

export const coreRecordKindSchema = z.enum([
  "meal",
  "workout",
  "body_measurement",
]);
export type CoreRecordKind = z.infer<typeof coreRecordKindSchema>;

export const durationBucketSchema = z.enum([
  "under_30_seconds",
  "30_to_59_seconds",
  "1_to_2_minutes",
  "3_to_5_minutes",
  "over_5_minutes",
]);
export type DurationBucket = z.infer<typeof durationBucketSchema>;

export const tapCountBucketSchema = z.enum([
  "0_to_4",
  "5_to_9",
  "10_to_19",
  "20_plus",
]);
export type TapCountBucket = z.infer<typeof tapCountBucketSchema>;

export const retryCountBucketSchema = z.enum(["0", "1", "2", "3_plus"]);
export type RetryCountBucket = z.infer<typeof retryCountBucketSchema>;

export const failureStageSchema = z.enum([
  "validation",
  "load",
  "submit",
  "upload",
]);
export type FailureStage = z.infer<typeof failureStageSchema>;

export const failureReasonSchema = z.enum([
  "invalid_input",
  "network",
  "session",
  "server",
  "disabled",
  "unexpected",
]);
export type FailureReason = z.infer<typeof failureReasonSchema>;

export const featureActionSchema = z.enum([
  "coach_message_request",
  "meal_text_draft",
  "meal_photo_draft",
  "draft_confirm",
  "draft_discard",
  "feedback_submit",
  "progress_photo_upload",
  "progress_photo_delete",
  "energy_setup_save",
]);
export type FeatureAction = z.infer<typeof featureActionSchema>;

export const onboardingStepSchema = z.enum([
  "welcome",
  "profile",
  "goals",
  "preferences",
  "notifications",
  "complete",
]);
export type OnboardingStep = z.infer<typeof onboardingStepSchema>;

export const loggingModeSchema = z.enum([
  "manual",
  "quick",
  "voice",
  "photo",
  "barcode",
]);
export type LoggingMode = z.infer<typeof loggingModeSchema>;

export const loggingExitReasonSchema = z.enum(["cancel", "navigate_away"]);
export type LoggingExitReason = z.infer<typeof loggingExitReasonSchema>;

const baseEventEnvelopeShape = {
  id: z.string().uuid(),
  schemaVersion: z.literal(2),
  recordedAt: z.string().datetime(),
  sessionId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  flowId: z.string().uuid().optional(),
  platform: z.enum(["ios", "android"]),
  appVersion: z.string().trim().min(1).max(32),
  build: z.string().trim().min(1).max(32).optional(),
};

export const appSessionStartedEventSchema = z
  .object({
    ...baseEventEnvelopeShape,
    name: z.literal("app_session_started"),
    properties: z
      .object({
        entryPoint: z.enum(["cold_start", "foreground"]),
      })
      .strict(),
  })
  .strict();
export type AppSessionStartedEvent = z.infer<
  typeof appSessionStartedEventSchema
>;

export const screenViewedEventSchema = z
  .object({
    ...baseEventEnvelopeShape,
    name: z.literal("screen_viewed"),
    properties: z
      .object({
        screen: screenNameSchema,
      })
      .strict(),
  })
  .strict();
export type ScreenViewedEvent = z.infer<typeof screenViewedEventSchema>;

export const onboardingStartedEventSchema = z
  .object({
    ...baseEventEnvelopeShape,
    name: z.literal("onboarding_started"),
    properties: z.object({}).strict(),
  })
  .strict();
export type OnboardingStartedEvent = z.infer<
  typeof onboardingStartedEventSchema
>;

export const onboardingStepCompletedEventSchema = z
  .object({
    ...baseEventEnvelopeShape,
    name: z.literal("onboarding_step_completed"),
    properties: z
      .object({
        step: onboardingStepSchema,
      })
      .strict(),
  })
  .strict();
export type OnboardingStepCompletedEvent = z.infer<
  typeof onboardingStepCompletedEventSchema
>;

export const onboardingCompletedEventSchema = z
  .object({
    ...baseEventEnvelopeShape,
    name: z.literal("onboarding_completed"),
    properties: z
      .object({
        duration: durationBucketSchema,
        taps: tapCountBucketSchema,
      })
      .strict(),
  })
  .strict();
export type OnboardingCompletedEvent = z.infer<
  typeof onboardingCompletedEventSchema
>;

export const loggingFlowStartedEventSchema = z
  .object({
    ...baseEventEnvelopeShape,
    name: z.literal("logging_flow_started"),
    properties: z
      .object({
        flow: loggingFlowSchema,
        mode: loggingModeSchema.optional(),
      })
      .strict(),
  })
  .strict();
export type LoggingFlowStartedEvent = z.infer<
  typeof loggingFlowStartedEventSchema
>;

export const loggingFlowCompletedEventSchema = z
  .object({
    ...baseEventEnvelopeShape,
    name: z.literal("logging_flow_completed"),
    properties: z
      .object({
        flow: loggingFlowSchema,
        duration: durationBucketSchema,
        taps: tapCountBucketSchema,
        retries: retryCountBucketSchema,
      })
      .strict(),
  })
  .strict();
export type LoggingFlowCompletedEvent = z.infer<
  typeof loggingFlowCompletedEventSchema
>;

export const loggingFlowFailedEventSchema = z
  .object({
    ...baseEventEnvelopeShape,
    name: z.literal("logging_flow_failed"),
    properties: z
      .object({
        flow: loggingFlowSchema,
        stage: failureStageSchema,
        reason: failureReasonSchema,
        retryable: z.boolean(),
        retries: retryCountBucketSchema,
      })
      .strict(),
  })
  .strict();
export type LoggingFlowFailedEvent = z.infer<
  typeof loggingFlowFailedEventSchema
>;

export const loggingFlowExitedEventSchema = z
  .object({
    ...baseEventEnvelopeShape,
    name: z.literal("logging_flow_exited"),
    properties: z
      .object({
        flow: loggingFlowSchema,
        duration: durationBucketSchema,
        exit: loggingExitReasonSchema,
      })
      .strict(),
  })
  .strict();
export type LoggingFlowExitedEvent = z.infer<
  typeof loggingFlowExitedEventSchema
>;

export const coreRecordCreatedEventSchema = z
  .object({
    ...baseEventEnvelopeShape,
    name: z.literal("core_record_created"),
    properties: z
      .object({
        recordKind: coreRecordKindSchema,
      })
      .strict(),
  })
  .strict();
export type CoreRecordCreatedEvent = z.infer<
  typeof coreRecordCreatedEventSchema
>;

export const featureActionResultEventSchema = z
  .object({
    ...baseEventEnvelopeShape,
    name: z.literal("feature_action_result"),
    properties: z
      .object({
        action: featureActionSchema,
        outcome: z.enum(["success", "failure"]),
        reason: failureReasonSchema.optional(),
        duration: durationBucketSchema.optional(),
      })
      .strict(),
  })
  .strict();
export type FeatureActionResultEvent = z.infer<
  typeof featureActionResultEventSchema
>;

export const analyticsEventV2Schema = z.discriminatedUnion("name", [
  appSessionStartedEventSchema,
  screenViewedEventSchema,
  onboardingStartedEventSchema,
  onboardingStepCompletedEventSchema,
  onboardingCompletedEventSchema,
  loggingFlowStartedEventSchema,
  loggingFlowCompletedEventSchema,
  loggingFlowFailedEventSchema,
  loggingFlowExitedEventSchema,
  coreRecordCreatedEventSchema,
  featureActionResultEventSchema,
]);

export type AnalyticsEventV2 = z.infer<typeof analyticsEventV2Schema>;

/**
 * Transport / API schemas
 */
export const CURRENT_ANALYTICS_CONSENT_VERSION = "product-analytics-v2";

export const analyticsConsentRequestSchema = z
  .object({
    version: z.literal(CURRENT_ANALYTICS_CONSENT_VERSION),
    granted: z.boolean(),
    expectedRevision: z.number().int().nonnegative(),
    operationId: z.string().uuid(),
  })
  .strict();

export type AnalyticsConsentRequest = z.infer<
  typeof analyticsConsentRequestSchema
>;

export const analyticsConsentResponseSchema = z.object({
  version: z.literal(CURRENT_ANALYTICS_CONSENT_VERSION),
  granted: z.boolean(),
  revision: z.number().int().nonnegative(),
  epoch: z.string().uuid(),
  consentedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});

export type AnalyticsConsentResponse = z.infer<
  typeof analyticsConsentResponseSchema
>;

export const analyticsBatchIngestRequestSchema = z
  .object({
    consentVersion: z.literal(CURRENT_ANALYTICS_CONSENT_VERSION),
    epoch: z.string().uuid(),
    events: z.array(analyticsEventV2Schema).min(1).max(50),
  })
  .strict();

export type AnalyticsBatchIngestRequest = z.infer<
  typeof analyticsBatchIngestRequestSchema
>;

export const analyticsBatchIngestResponseSchema = z.object({
  acceptedIds: z.array(z.string().uuid()),
  rejectedCount: z.number().int().nonnegative(),
});

export type AnalyticsBatchIngestResponse = z.infer<
  typeof analyticsBatchIngestResponseSchema
>;

export const analyticsClearRequestSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    operationId: z.string().uuid(),
  })
  .strict();

export type AnalyticsClearRequest = z.infer<typeof analyticsClearRequestSchema>;

export const analyticsClearResponseSchema = z.object({
  cleared: z.literal(true),
  newEpoch: z.string().uuid(),
  revision: z.number().int().nonnegative(),
});

export type AnalyticsClearResponse = z.infer<
  typeof analyticsClearResponseSchema
>;

export const analyticsEventsListResponseSchema = z.object({
  events: z.array(analyticsEventV2Schema),
});

export type AnalyticsEventsListResponse = z.infer<
  typeof analyticsEventsListResponseSchema
>;
