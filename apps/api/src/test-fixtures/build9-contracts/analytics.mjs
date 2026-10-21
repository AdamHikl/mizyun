import { z } from "./zod-runtime.mjs";
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
export const dashboardControlSchema = z.enum([
  "nutrition_card",
  "weight_card",
  "training_card",
  "steps_card",
  "quick_log_meal",
  "quick_log_workout",
  "quick_log_weight",
  "quick_log_photo",
  "first_meal_log",
  "first_meal_copy",
  "first_meal_reminder",
  "energy_setup",
  "review_week",
  "review_month",
  "refresh_retry",
  "complete_setup",
]);
/** Static settings destinations only. Never accept typed search text. */
export const analyticsSettingsDestinationSchema = z.enum([
  "profile",
  "goal",
  "energy-setup",
  "food-standards",
  "body",
  "progress-photos",
  "workout",
  "reminders",
  "appearance",
  "health-steps",
  "coach-preferences",
  "ai-usage",
  "memory",
  "account-data",
  "community-settings",
  "analytics",
  "legal",
  "security",
  "identity",
  "setup-wizard",
  "feedback",
  "sign-out",
]);
export const loggingFlowSchema = z.enum([
  "meal",
  "workout",
  "body_measurement",
]);
export const coreRecordKindSchema = z.enum([
  "meal",
  "workout",
  "body_measurement",
]);
export const durationBucketSchema = z.enum([
  "under_30_seconds",
  "30_to_59_seconds",
  "1_to_2_minutes",
  "3_to_5_minutes",
  "over_5_minutes",
]);
export const tapCountBucketSchema = z.enum([
  "0_to_4",
  "5_to_9",
  "10_to_19",
  "20_plus",
]);
export const retryCountBucketSchema = z.enum(["0", "1", "2", "3_plus"]);
export const failureStageSchema = z.enum([
  "validation",
  "load",
  "submit",
  "upload",
]);
export const failureReasonSchema = z.enum([
  "invalid_input",
  "network",
  "session",
  "server",
  "disabled",
  "unexpected",
]);
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
/** Frozen pre-dashboard values. Do not expand the legacy list projection. */
export const legacyOnboardingStepSchema = z.enum([
  "welcome",
  "profile",
  "goals",
  "preferences",
  "notifications",
  "complete",
]);
export const onboardingStepSchema = z.enum([
  ...legacyOnboardingStepSchema.options,
  "display_name",
  "units",
  "baseline_weight",
  "energy_profile",
  "primary_goal",
]);
export const loggingModeSchema = z.enum([
  "manual",
  "quick",
  "voice",
  "photo",
  "barcode",
]);
export const loggingExitReasonSchema = z.enum(["cancel", "navigate_away"]);
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
export const onboardingStartedEventSchema = z
  .object({
    ...baseEventEnvelopeShape,
    name: z.literal("onboarding_started"),
    properties: z.object({}).strict(),
  })
  .strict();
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
export const onboardingFailedEventSchema = z
  .object({
    ...baseEventEnvelopeShape,
    name: z.literal("onboarding_failed"),
    properties: z
      .object({ step: onboardingStepSchema, reason: failureReasonSchema })
      .strict(),
  })
  .strict();
export const onboardingExitedEventSchema = z
  .object({
    ...baseEventEnvelopeShape,
    name: z.literal("onboarding_exited"),
    properties: z
      .object({
        step: onboardingStepSchema,
        duration: durationBucketSchema,
        exit: z.literal("cancel"),
      })
      .strict(),
  })
  .strict();
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
export const dashboardControlClickedEventSchema = z
  .object({
    ...baseEventEnvelopeShape,
    name: z.literal("dashboard_control_clicked"),
    properties: z.object({ control: dashboardControlSchema }).strict(),
  })
  .strict();
export const settingsSearchUsedEventSchema = z
  .object({
    ...baseEventEnvelopeShape,
    name: z.literal("settings_search_used"),
    properties: z
      .object({ resultCount: z.enum(["none", "1_to_5", "6_plus"]) })
      .strict(),
  })
  .strict();
export const settingsSearchSelectedEventSchema = z
  .object({
    ...baseEventEnvelopeShape,
    name: z.literal("settings_search_selected"),
    properties: z
      .object({ destination: analyticsSettingsDestinationSchema })
      .strict(),
  })
  .strict();
export const analyticsEventV2Schema = z.discriminatedUnion("name", [
  appSessionStartedEventSchema,
  screenViewedEventSchema,
  onboardingStartedEventSchema,
  onboardingStepCompletedEventSchema,
  onboardingCompletedEventSchema,
  onboardingFailedEventSchema,
  onboardingExitedEventSchema,
  loggingFlowStartedEventSchema,
  loggingFlowCompletedEventSchema,
  loggingFlowFailedEventSchema,
  loggingFlowExitedEventSchema,
  coreRecordCreatedEventSchema,
  featureActionResultEventSchema,
  dashboardControlClickedEventSchema,
  settingsSearchUsedEventSchema,
  settingsSearchSelectedEventSchema,
]);
/**
 * Transport / API schemas
 */
export const CURRENT_ANALYTICS_CONSENT_VERSION = "product-analytics-v2";
export const ANALYTICS_DASHBOARD_CATALOG = "dashboard-v1";
export const analyticsConsentResponseSchema = z.object({
  version: z.literal(CURRENT_ANALYTICS_CONSENT_VERSION),
  granted: z.boolean(),
  revision: z.number().int().nonnegative(),
  epoch: z.string().uuid(),
  consentedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});
