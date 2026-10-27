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
export type DashboardControl = z.infer<typeof dashboardControlSchema>;

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
export type AnalyticsSettingsDestination = z.infer<
  typeof analyticsSettingsDestinationSchema
>;

export const loggingFlowSchema = z.enum([
  "meal",
  "workout",
  "body_measurement",
]);
export type LoggingFlow = z.infer<typeof loggingFlowSchema>;

/** Frozen record kinds accepted by build-10 and older event parsers. */
export const legacyCoreRecordKindSchema = z.enum([
  "meal",
  "workout",
  "body_measurement",
]);
export const coreRecordKindSchema = z.enum([
  ...legacyCoreRecordKindSchema.options,
  "bouldering_session",
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

/** First-run "What do you want to log first?" options (GTM-04). */
export const firstLogChoiceSchema = z.enum([
  "climb",
  "workout",
  "meal",
  "weight",
]);
export type FirstLogChoice = z.infer<typeof firstLogChoiceSchema>;
/** A first-run outcome: a log choice or "Just look around". */
export const firstRunChoiceSchema = z.enum([
  ...firstLogChoiceSchema.options,
  "explore",
]);
export type FirstRunChoice = z.infer<typeof firstRunChoiceSchema>;

/** Fixed "How did you hear about Mizyun?" answers. No free-text option. */
export const acquisitionSourceSchema = z.enum([
  "friend_or_family",
  "climbing_gym_or_club",
  "instagram",
  "tiktok",
  "youtube",
  "reddit",
  "app_store_search",
  "web_search",
  "press_or_blog",
  "other",
  "prefer_not_to_say",
]);
export type AcquisitionSource = z.infer<typeof acquisitionSourceSchema>;

export const returnMilestoneSchema = z.enum(["day_7", "day_28"]);
export type ReturnMilestone = z.infer<typeof returnMilestoneSchema>;

/** ISO-8601 week of the first confirmed record, e.g. "2026-W44". */
export const cohortWeekSchema = z
  .string()
  .regex(/^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$/);

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

export const onboardingFailedEventSchema = z
  .object({
    ...baseEventEnvelopeShape,
    name: z.literal("onboarding_failed"),
    properties: z
      .object({ step: onboardingStepSchema, reason: failureReasonSchema })
      .strict(),
  })
  .strict();
export type OnboardingFailedEvent = z.infer<typeof onboardingFailedEventSchema>;

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
export type OnboardingExitedEvent = z.infer<typeof onboardingExitedEventSchema>;

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

export const firstRunCompletedEventSchema = z
  .object({
    ...baseEventEnvelopeShape,
    name: z.literal("first_run_completed"),
    properties: z
      .object({ choice: firstRunChoiceSchema, duration: durationBucketSchema })
      .strict(),
  })
  .strict();
export type FirstRunCompletedEvent = z.infer<
  typeof firstRunCompletedEventSchema
>;

export const acquisitionSourceSelectedEventSchema = z
  .object({
    ...baseEventEnvelopeShape,
    name: z.literal("acquisition_source_selected"),
    properties: z.object({ source: acquisitionSourceSchema }).strict(),
  })
  .strict();
export type AcquisitionSourceSelectedEvent = z.infer<
  typeof acquisitionSourceSelectedEventSchema
>;

/** Emitted once per first-run account on this device; the kind only. */
export const firstConfirmedRecordEventSchema = z
  .object({
    ...baseEventEnvelopeShape,
    name: z.literal("first_confirmed_record"),
    properties: z.object({ recordKind: coreRecordKindSchema }).strict(),
  })
  .strict();
export type FirstConfirmedRecordEvent = z.infer<
  typeof firstConfirmedRecordEventSchema
>;

/**
 * A core action on local days 1-7 (`day_7`) or 22-28 (`day_28`) after the
 * first confirmed record. The cohort week lets a later report attribute the
 * return after the 30-day event retention has removed the activation event.
 */
export const returnMilestoneReachedEventSchema = z
  .object({
    ...baseEventEnvelopeShape,
    name: z.literal("return_milestone_reached"),
    properties: z
      .object({
        milestone: returnMilestoneSchema,
        cohortWeek: cohortWeekSchema,
      })
      .strict(),
  })
  .strict();
export type ReturnMilestoneReachedEvent = z.infer<
  typeof returnMilestoneReachedEventSchema
>;

const legacyCoreRecordCreatedEventSchema = coreRecordCreatedEventSchema.extend({
  properties: z.object({ recordKind: legacyCoreRecordKindSchema }).strict(),
});

/** Frozen `dashboard-v1` catalog read by build 10 and earlier. */
export const dashboardV1AnalyticsEventV2Schema = z.discriminatedUnion("name", [
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
  legacyCoreRecordCreatedEventSchema,
  featureActionResultEventSchema,
  dashboardControlClickedEventSchema,
  settingsSearchUsedEventSchema,
  settingsSearchSelectedEventSchema,
]);

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
  firstRunCompletedEventSchema,
  acquisitionSourceSelectedEventSchema,
  firstConfirmedRecordEventSchema,
  returnMilestoneReachedEventSchema,
]);

export type AnalyticsEventV2 = z.infer<typeof analyticsEventV2Schema>;

/** Exactly the original eleven event kinds and original onboarding steps. */
export const legacyAnalyticsEventV2Schema = z.discriminatedUnion("name", [
  appSessionStartedEventSchema,
  screenViewedEventSchema,
  onboardingStartedEventSchema,
  onboardingStepCompletedEventSchema.extend({
    properties: z.object({ step: legacyOnboardingStepSchema }).strict(),
  }),
  onboardingCompletedEventSchema,
  loggingFlowStartedEventSchema,
  loggingFlowCompletedEventSchema,
  loggingFlowFailedEventSchema,
  loggingFlowExitedEventSchema,
  legacyCoreRecordCreatedEventSchema,
  featureActionResultEventSchema,
]);
export type LegacyAnalyticsEventV2 = z.infer<
  typeof legacyAnalyticsEventV2Schema
>;

/**
 * Transport / API schemas
 */
export const CURRENT_ANALYTICS_CONSENT_VERSION = "product-analytics-v2";
/** Catalog requested by build 10 and earlier; frozen. */
export const ANALYTICS_DASHBOARD_V1_CATALOG = "dashboard-v1";
/** Current catalog: adds first-run, acquisition and return events. */
export const ANALYTICS_DASHBOARD_CATALOG = "activation-v1";
export const analyticsCatalogSchema = z.enum([
  ANALYTICS_DASHBOARD_V1_CATALOG,
  ANALYTICS_DASHBOARD_CATALOG,
]);
export type AnalyticsCatalog = z.infer<typeof analyticsCatalogSchema>;
export const analyticsEventsListQuerySchema = z
  .object({
    catalog: analyticsCatalogSchema.optional(),
  })
  .strict();
export type AnalyticsEventsListQuery = z.infer<
  typeof analyticsEventsListQuerySchema
>;

/** Shared wire projection; never relabel a new event as a legacy event. */
export function projectAnalyticsEventsForCatalog(
  events: readonly unknown[],
  catalog?: AnalyticsEventsListQuery["catalog"],
): { events: AnalyticsEventV2[]; omittedEventCount: number } {
  const schema =
    catalog === ANALYTICS_DASHBOARD_CATALOG
      ? analyticsEventV2Schema
      : catalog === ANALYTICS_DASHBOARD_V1_CATALOG
        ? dashboardV1AnalyticsEventV2Schema
        : legacyAnalyticsEventV2Schema;
  const projected = events.flatMap((event) => {
    const parsed = schema.safeParse(event);
    return parsed.success ? [parsed.data] : [];
  });
  return {
    events: projected,
    omittedEventCount: events.length - projected.length,
  };
}

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
export const legacyAnalyticsEventsListResponseSchema = z.object({
  events: z.array(legacyAnalyticsEventV2Schema),
});

export type AnalyticsEventsListResponse = z.infer<
  typeof analyticsEventsListResponseSchema
>;
