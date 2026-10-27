import { describe, expect, it } from "vitest";
import {
  CURRENT_ANALYTICS_CONSENT_VERSION,
  analyticsBatchIngestRequestSchema,
  analyticsBatchIngestResponseSchema,
  analyticsClearRequestSchema,
  analyticsClearResponseSchema,
  analyticsConsentRequestSchema,
  analyticsConsentResponseSchema,
  analyticsEventV2Schema,
  analyticsEventsListQuerySchema,
  dashboardV1AnalyticsEventV2Schema,
  legacyAnalyticsEventV2Schema,
  legacyAnalyticsEventsListResponseSchema,
  legacyOnboardingStepSchema,
  projectAnalyticsEventsForCatalog,
  coreRecordKindSchema,
  durationBucketSchema,
  failureReasonSchema,
  failureStageSchema,
  featureActionSchema,
  loggingExitReasonSchema,
  loggingFlowSchema,
  loggingModeSchema,
  onboardingStepSchema,
  retryCountBucketSchema,
  screenNameSchema,
  tapCountBucketSchema,
  type AnalyticsEventV2,
} from "./analytics";
import { accountExportSchema, exportManifestSchema } from "./account";

const validBaseEnvelope = {
  id: "11111111-1111-4111-8111-111111111111",
  schemaVersion: 2 as const,
  recordedAt: "2026-09-13T08:00:00.000Z",
  sessionId: "22222222-2222-4222-8222-222222222222",
  sequence: 0,
  platform: "ios" as const,
  appVersion: "1.0.0",
};

describe("activation scorecard telemetry (GTM-04)", () => {
  const activationEvents = [
    {
      ...validBaseEnvelope,
      name: "first_run_completed",
      properties: { choice: "climb", duration: "under_30_seconds" },
    },
    {
      ...validBaseEnvelope,
      name: "acquisition_source_selected",
      properties: { source: "climbing_gym_or_club" },
    },
    {
      ...validBaseEnvelope,
      name: "first_confirmed_record",
      properties: { recordKind: "bouldering_session" },
    },
    {
      ...validBaseEnvelope,
      name: "return_milestone_reached",
      properties: { milestone: "day_28", cohortWeek: "2026-W44" },
    },
    {
      ...validBaseEnvelope,
      name: "core_record_created",
      properties: { recordKind: "bouldering_session" },
    },
  ];

  it("accepts the payload-free activation events", () => {
    for (const event of activationEvents)
      expect(analyticsEventV2Schema.safeParse(event).success).toBe(true);
  });

  it.each([
    ["free-text source", 1, { source: "my friend Anna" }],
    ["extra source text", 1, { source: "other", detail: "a podcast" }],
    ["food name", 2, { recordKind: "meal", name: "Porridge" }],
    ["health value", 2, { recordKind: "body_measurement", weightKg: 70 }],
    ["unknown kind", 2, { recordKind: "run" }],
    ["exact day", 3, { milestone: "day_9", cohortWeek: "2026-W44" }],
    ["exact date", 3, { milestone: "day_7", cohortWeek: "2026-10-26" }],
    ["week 54", 3, { milestone: "day_7", cohortWeek: "2026-W54" }],
    ["exact duration", 0, { choice: "meal", duration: 42 }],
    ["unknown choice", 0, { choice: "run", duration: "under_30_seconds" }],
  ] as const)("rejects %s", (_label, index, properties) => {
    expect(
      analyticsEventV2Schema.safeParse({
        ...activationEvents[index],
        properties,
      }).success,
    ).toBe(false);
  });

  it("keeps dashboard-v1 frozen for build 10 and serves new events only under activation-v1", () => {
    expect(
      dashboardV1AnalyticsEventV2Schema.options.map((s) => s.shape.name.value),
    ).toHaveLength(16);
    const v1 = projectAnalyticsEventsForCatalog(
      activationEvents,
      "dashboard-v1",
    );
    expect(v1.events).toEqual([]);
    expect(v1.omittedEventCount).toBe(5);
    const legacy = projectAnalyticsEventsForCatalog(activationEvents);
    expect(legacy.omittedEventCount).toBe(5);
    expect(
      projectAnalyticsEventsForCatalog(activationEvents, "activation-v1")
        .events,
    ).toHaveLength(5);
    const meal = {
      ...validBaseEnvelope,
      name: "core_record_created",
      properties: { recordKind: "meal" },
    };
    expect(
      projectAnalyticsEventsForCatalog([meal], "dashboard-v1").events,
    ).toHaveLength(1);
    expect(
      analyticsEventsListQuerySchema.safeParse({ catalog: "activation-v1" })
        .success,
    ).toBe(true);
  });
});

describe("closed developer-dashboard telemetry", () => {
  it("keeps a frozen eleven-event legacy catalog with the original six onboarding steps", () => {
    expect(
      legacyAnalyticsEventV2Schema.options.map((s) => s.shape.name.value),
    ).toEqual([
      "app_session_started",
      "screen_viewed",
      "onboarding_started",
      "onboarding_step_completed",
      "onboarding_completed",
      "logging_flow_started",
      "logging_flow_completed",
      "logging_flow_failed",
      "logging_flow_exited",
      "core_record_created",
      "feature_action_result",
    ]);
    expect(legacyOnboardingStepSchema.options).toEqual([
      "welcome",
      "profile",
      "goals",
      "preferences",
      "notifications",
      "complete",
    ]);
    const events = [
      {
        ...validBaseEnvelope,
        name: "onboarding_step_completed",
        properties: { step: "welcome" },
      },
      {
        ...validBaseEnvelope,
        name: "onboarding_step_completed",
        properties: { step: "baseline_weight" },
      },
      {
        ...validBaseEnvelope,
        name: "dashboard_control_clicked",
        properties: { control: "nutrition_card" },
      },
    ];
    expect(
      legacyAnalyticsEventsListResponseSchema.safeParse({ events }).success,
    ).toBe(false);
    const legacy = projectAnalyticsEventsForCatalog(events);
    expect(legacy.omittedEventCount).toBe(2);
    expect(
      legacyAnalyticsEventsListResponseSchema.safeParse({
        events: legacy.events,
      }).success,
    ).toBe(true);
    expect(
      projectAnalyticsEventsForCatalog(events, "dashboard-v1").events,
    ).toHaveLength(3);
  });
  it("accepts only the explicit supported list catalog", () => {
    expect(analyticsEventsListQuerySchema.safeParse({}).success).toBe(true);
    expect(
      analyticsEventsListQuerySchema.safeParse({ catalog: "dashboard-v1" })
        .success,
    ).toBe(true);
    for (const query of [
      { catalog: "unknown" },
      { catalog: ["dashboard-v1"] },
      { query: "private" },
    ])
      expect(analyticsEventsListQuerySchema.safeParse(query).success).toBe(
        false,
      );
  });
  it.each([
    "display_name",
    "units",
    "baseline_weight",
    "energy_profile",
    "primary_goal",
  ])(
    "accepts coarse onboarding progress/failure/exit at %s but excludes it from the legacy projection",
    (step) => {
      const events = [
        {
          ...validBaseEnvelope,
          name: "onboarding_step_completed",
          properties: { step },
        },
        {
          ...validBaseEnvelope,
          name: "onboarding_failed",
          properties: { step, reason: "network" },
        },
        {
          ...validBaseEnvelope,
          name: "onboarding_exited",
          properties: { step, duration: "under_30_seconds", exit: "cancel" },
        },
      ];
      for (const event of events) {
        expect(analyticsEventV2Schema.safeParse(event).success).toBe(true);
        expect(legacyAnalyticsEventV2Schema.safeParse(event).success).toBe(
          false,
        );
        expect(
          analyticsEventV2Schema.safeParse({
            ...event,
            properties: { ...event.properties, weightKg: 70 },
          }).success,
        ).toBe(false);
      }
      expect(
        analyticsEventV2Schema.safeParse({
          ...events[2],
          properties: { ...events[2]!.properties, exit: "navigate_away" },
        }).success,
      ).toBe(false);
    },
  );
  it.each([
    {
      name: "dashboard_control_clicked",
      properties: { control: "weight_card" },
    },
    { name: "settings_search_used", properties: { resultCount: "none" } },
    {
      name: "settings_search_selected",
      properties: { destination: "appearance" },
    },
  ])("accepts only static usage properties for $name", (event) => {
    expect(
      analyticsEventV2Schema.safeParse({ ...validBaseEnvelope, ...event })
        .success,
    ).toBe(true);
    expect(
      analyticsEventV2Schema.safeParse({
        ...validBaseEnvelope,
        ...event,
        properties: { ...event.properties, query: "private input" },
      }).success,
    ).toBe(false);
  });

  it.each([
    {
      name: "dashboard_control_clicked",
      properties: { control: "private-record-id" },
    },
    {
      name: "settings_search_selected",
      properties: { destination: "/settings?query=private" },
    },
    { name: "settings_search_used", properties: { resultCount: 10 } },
  ])("rejects free text and exact counts", (event) => {
    expect(
      analyticsEventV2Schema.safeParse({ ...validBaseEnvelope, ...event })
        .success,
    ).toBe(false);
  });
});

describe("Product Analytics Enums", () => {
  it("validates screenNameSchema", () => {
    const screens = [
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
    ];
    for (const screen of screens) {
      expect(screenNameSchema.safeParse(screen).success).toBe(true);
    }
    expect(screenNameSchema.safeParse("unknown_screen").success).toBe(false);
  });

  it("validates loggingFlowSchema and coreRecordKindSchema", () => {
    const flows = ["meal", "workout", "body_measurement"];
    for (const flow of flows) {
      expect(loggingFlowSchema.safeParse(flow).success).toBe(true);
      expect(coreRecordKindSchema.safeParse(flow).success).toBe(true);
    }
    expect(loggingFlowSchema.safeParse("sleep").success).toBe(false);
    expect(coreRecordKindSchema.safeParse("sleep").success).toBe(false);
  });

  it("validates duration, tap, and retry bucket schemas", () => {
    expect(durationBucketSchema.safeParse("under_30_seconds").success).toBe(
      true,
    );
    expect(durationBucketSchema.safeParse("30_to_59_seconds").success).toBe(
      true,
    );
    expect(durationBucketSchema.safeParse("1_to_2_minutes").success).toBe(true);
    expect(durationBucketSchema.safeParse("3_to_5_minutes").success).toBe(true);
    expect(durationBucketSchema.safeParse("over_5_minutes").success).toBe(true);
    expect(durationBucketSchema.safeParse("10_minutes").success).toBe(false);

    expect(tapCountBucketSchema.safeParse("0_to_4").success).toBe(true);
    expect(tapCountBucketSchema.safeParse("5_to_9").success).toBe(true);
    expect(tapCountBucketSchema.safeParse("10_to_19").success).toBe(true);
    expect(tapCountBucketSchema.safeParse("20_plus").success).toBe(true);
    expect(tapCountBucketSchema.safeParse("100").success).toBe(false);

    expect(retryCountBucketSchema.safeParse("0").success).toBe(true);
    expect(retryCountBucketSchema.safeParse("1").success).toBe(true);
    expect(retryCountBucketSchema.safeParse("2").success).toBe(true);
    expect(retryCountBucketSchema.safeParse("3_plus").success).toBe(true);
    expect(retryCountBucketSchema.safeParse("4").success).toBe(false);
  });

  it("validates failure stage and reason schemas", () => {
    const stages = ["validation", "load", "submit", "upload"];
    for (const stage of stages) {
      expect(failureStageSchema.safeParse(stage).success).toBe(true);
    }
    expect(failureStageSchema.safeParse("render").success).toBe(false);

    const reasons = [
      "invalid_input",
      "network",
      "session",
      "server",
      "disabled",
      "unexpected",
    ];
    for (const reason of reasons) {
      expect(failureReasonSchema.safeParse(reason).success).toBe(true);
    }
    expect(failureReasonSchema.safeParse("crash").success).toBe(false);
  });

  it("validates feature actions, onboarding steps, logging modes, and exit reasons", () => {
    const actions = [
      "coach_message_request",
      "meal_text_draft",
      "meal_photo_draft",
      "draft_confirm",
      "draft_discard",
      "feedback_submit",
      "progress_photo_upload",
      "progress_photo_delete",
      "energy_setup_save",
    ];
    for (const action of actions) {
      expect(featureActionSchema.safeParse(action).success).toBe(true);
    }

    const steps = [
      "welcome",
      "profile",
      "goals",
      "preferences",
      "notifications",
      "complete",
    ];
    for (const step of steps) {
      expect(onboardingStepSchema.safeParse(step).success).toBe(true);
    }

    const modes = ["manual", "quick", "voice", "photo", "barcode"];
    for (const mode of modes) {
      expect(loggingModeSchema.safeParse(mode).success).toBe(true);
    }

    const exits = ["cancel", "navigate_away"];
    for (const exit of exits) {
      expect(loggingExitReasonSchema.safeParse(exit).success).toBe(true);
    }
  });
});

describe("analyticsEventV2Schema — Valid event kinds", () => {
  it("validates app_session_started", () => {
    const coldStart = {
      ...validBaseEnvelope,
      name: "app_session_started",
      properties: { entryPoint: "cold_start" },
    };
    expect(analyticsEventV2Schema.safeParse(coldStart).success).toBe(true);

    const foreground = {
      ...validBaseEnvelope,
      name: "app_session_started",
      properties: { entryPoint: "foreground" },
    };
    expect(analyticsEventV2Schema.safeParse(foreground).success).toBe(true);
  });

  it("validates screen_viewed", () => {
    const event = {
      ...validBaseEnvelope,
      name: "screen_viewed",
      properties: { screen: "dashboard" },
    };
    expect(analyticsEventV2Schema.safeParse(event).success).toBe(true);
  });

  it("validates onboarding_started", () => {
    const event = {
      ...validBaseEnvelope,
      name: "onboarding_started",
      properties: {},
    };
    expect(analyticsEventV2Schema.safeParse(event).success).toBe(true);
  });

  it("validates onboarding_step_completed", () => {
    const event = {
      ...validBaseEnvelope,
      name: "onboarding_step_completed",
      properties: { step: "welcome" },
    };
    expect(analyticsEventV2Schema.safeParse(event).success).toBe(true);
  });

  it("validates onboarding_completed", () => {
    const event = {
      ...validBaseEnvelope,
      name: "onboarding_completed",
      properties: {
        duration: "1_to_2_minutes",
        taps: "5_to_9",
      },
    };
    expect(analyticsEventV2Schema.safeParse(event).success).toBe(true);
  });

  it("validates logging_flow_started with and without mode", () => {
    const withMode = {
      ...validBaseEnvelope,
      flowId: "33333333-3333-4333-8333-333333333333",
      name: "logging_flow_started",
      properties: { flow: "meal", mode: "photo" },
    };
    expect(analyticsEventV2Schema.safeParse(withMode).success).toBe(true);

    const withoutMode = {
      ...validBaseEnvelope,
      flowId: "33333333-3333-4333-8333-333333333333",
      name: "logging_flow_started",
      properties: { flow: "workout" },
    };
    expect(analyticsEventV2Schema.safeParse(withoutMode).success).toBe(true);
  });

  it("validates logging_flow_completed", () => {
    const event = {
      ...validBaseEnvelope,
      flowId: "33333333-3333-4333-8333-333333333333",
      name: "logging_flow_completed",
      properties: {
        flow: "meal",
        duration: "under_30_seconds",
        taps: "0_to_4",
        retries: "0",
      },
    };
    expect(analyticsEventV2Schema.safeParse(event).success).toBe(true);
  });

  it("validates logging_flow_failed", () => {
    const event = {
      ...validBaseEnvelope,
      flowId: "33333333-3333-4333-8333-333333333333",
      name: "logging_flow_failed",
      properties: {
        flow: "workout",
        stage: "submit",
        reason: "network",
        retryable: true,
        retries: "1",
      },
    };
    expect(analyticsEventV2Schema.safeParse(event).success).toBe(true);
  });

  it("validates logging_flow_exited", () => {
    const event = {
      ...validBaseEnvelope,
      flowId: "33333333-3333-4333-8333-333333333333",
      name: "logging_flow_exited",
      properties: {
        flow: "body_measurement",
        duration: "30_to_59_seconds",
        exit: "cancel",
      },
    };
    expect(analyticsEventV2Schema.safeParse(event).success).toBe(true);
  });

  it("validates core_record_created", () => {
    for (const recordKind of ["meal", "workout", "body_measurement"] as const) {
      const event = {
        ...validBaseEnvelope,
        flowId: "33333333-3333-4333-8333-333333333333",
        name: "core_record_created",
        properties: { recordKind },
      };
      expect(analyticsEventV2Schema.safeParse(event).success).toBe(true);
    }
  });

  it("validates feature_action_result with required and optional fields", () => {
    const minimal = {
      ...validBaseEnvelope,
      name: "feature_action_result",
      properties: {
        action: "draft_confirm",
        outcome: "success",
      },
    };
    expect(analyticsEventV2Schema.safeParse(minimal).success).toBe(true);

    const full = {
      ...validBaseEnvelope,
      name: "feature_action_result",
      properties: {
        action: "coach_message_request",
        outcome: "failure",
        reason: "server",
        duration: "3_to_5_minutes",
      },
    };
    expect(analyticsEventV2Schema.safeParse(full).success).toBe(true);
  });

  it("validates envelope optional fields: flowId, build, and platform android", () => {
    const event = {
      ...validBaseEnvelope,
      flowId: "44444444-4444-4444-8444-444444444444",
      platform: "android",
      build: "123",
      name: "screen_viewed",
      properties: { screen: "coach" },
    };
    const parsed = analyticsEventV2Schema.safeParse(event);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.flowId).toBe("44444444-4444-4444-8444-444444444444");
      expect(parsed.data.platform).toBe("android");
      expect(parsed.data.build).toBe("123");
    }
  });

  it("rejects invalid envelope values", () => {
    // schemaVersion != 2
    expect(
      analyticsEventV2Schema.safeParse({
        ...validBaseEnvelope,
        schemaVersion: 1,
        name: "screen_viewed",
        properties: { screen: "dashboard" },
      }).success,
    ).toBe(false);

    // negative sequence
    expect(
      analyticsEventV2Schema.safeParse({
        ...validBaseEnvelope,
        sequence: -1,
        name: "screen_viewed",
        properties: { screen: "dashboard" },
      }).success,
    ).toBe(false);

    // non-integer sequence
    expect(
      analyticsEventV2Schema.safeParse({
        ...validBaseEnvelope,
        sequence: 1.5,
        name: "screen_viewed",
        properties: { screen: "dashboard" },
      }).success,
    ).toBe(false);

    // invalid platform
    expect(
      analyticsEventV2Schema.safeParse({
        ...validBaseEnvelope,
        platform: "web",
        name: "screen_viewed",
        properties: { screen: "dashboard" },
      }).success,
    ).toBe(false);

    // invalid UUID
    expect(
      analyticsEventV2Schema.safeParse({
        ...validBaseEnvelope,
        id: "not-a-uuid",
        name: "screen_viewed",
        properties: { screen: "dashboard" },
      }).success,
    ).toBe(false);

    // invalid recordedAt
    expect(
      analyticsEventV2Schema.safeParse({
        ...validBaseEnvelope,
        recordedAt: "yesterday",
        name: "screen_viewed",
        properties: { screen: "dashboard" },
      }).success,
    ).toBe(false);
  });
});

describe("analyticsEventV2Schema — Strict extra property rejection", () => {
  it("rejects extra properties at event root level", () => {
    const withFoodName = {
      ...validBaseEnvelope,
      name: "screen_viewed",
      properties: { screen: "dashboard" },
      foodName: "oatmeal with berries",
    };
    expect(analyticsEventV2Schema.safeParse(withFoodName).success).toBe(false);

    const withToken = {
      ...validBaseEnvelope,
      name: "screen_viewed",
      properties: { screen: "dashboard" },
      token: "secret-token",
    };
    expect(analyticsEventV2Schema.safeParse(withToken).success).toBe(false);

    const withHealthValue = {
      ...validBaseEnvelope,
      name: "screen_viewed",
      properties: { screen: "dashboard" },
      weightKg: 75.5,
    };
    expect(analyticsEventV2Schema.safeParse(withHealthValue).success).toBe(
      false,
    );
  });

  it("rejects extra properties inside properties object", () => {
    // app_session_started extra property
    expect(
      analyticsEventV2Schema.safeParse({
        ...validBaseEnvelope,
        name: "app_session_started",
        properties: {
          entryPoint: "cold_start",
          foodName: "banana",
        },
      }).success,
    ).toBe(false);

    // screen_viewed extra property
    expect(
      analyticsEventV2Schema.safeParse({
        ...validBaseEnvelope,
        name: "screen_viewed",
        properties: {
          screen: "dashboard",
          url: "https://mizyun.app/dashboard",
        },
      }).success,
    ).toBe(false);

    // onboarding_started extra property
    expect(
      analyticsEventV2Schema.safeParse({
        ...validBaseEnvelope,
        name: "onboarding_started",
        properties: { extra: true },
      }).success,
    ).toBe(false);

    // logging_flow_completed extra property (e.g. food calories)
    expect(
      analyticsEventV2Schema.safeParse({
        ...validBaseEnvelope,
        name: "logging_flow_completed",
        properties: {
          flow: "meal",
          duration: "under_30_seconds",
          taps: "0_to_4",
          retries: "0",
          calories: 550,
        },
      }).success,
    ).toBe(false);

    // core_record_created extra property
    expect(
      analyticsEventV2Schema.safeParse({
        ...validBaseEnvelope,
        name: "core_record_created",
        properties: {
          recordKind: "meal",
          mealTitle: "Lunch",
        },
      }).success,
    ).toBe(false);

    // feature_action_result extra property
    expect(
      analyticsEventV2Schema.safeParse({
        ...validBaseEnvelope,
        name: "feature_action_result",
        properties: {
          action: "coach_message_request",
          outcome: "success",
          userPrompt: "Give me a workout",
        },
      }).success,
    ).toBe(false);
  });
});

describe("Transport / API schemas", () => {
  const sampleEvent: AnalyticsEventV2 = {
    id: "11111111-1111-4111-8111-111111111111",
    schemaVersion: 2,
    recordedAt: "2026-09-13T08:00:00.000Z",
    sessionId: "22222222-2222-4222-8222-222222222222",
    sequence: 0,
    platform: "ios",
    appVersion: "1.0.0",
    name: "screen_viewed",
    properties: { screen: "dashboard" },
  };

  it("validates analyticsConsentRequestSchema", () => {
    const valid = {
      version: CURRENT_ANALYTICS_CONSENT_VERSION,
      granted: true,
      expectedRevision: 0,
      operationId: "55555555-5555-4555-8555-555555555555",
    };
    expect(analyticsConsentRequestSchema.safeParse(valid).success).toBe(true);

    // Rejects wrong version
    expect(
      analyticsConsentRequestSchema.safeParse({
        ...valid,
        version: "product-analytics-v1",
      }).success,
    ).toBe(false);

    // Rejects negative revision
    expect(
      analyticsConsentRequestSchema.safeParse({
        ...valid,
        expectedRevision: -1,
      }).success,
    ).toBe(false);

    // Rejects non-UUID operationId
    expect(
      analyticsConsentRequestSchema.safeParse({
        ...valid,
        operationId: "invalid",
      }).success,
    ).toBe(false);

    // Rejects extra properties
    expect(
      analyticsConsentRequestSchema.safeParse({
        ...valid,
        extra: "unwanted",
      }).success,
    ).toBe(false);
  });

  it("validates analyticsConsentResponseSchema", () => {
    const validGranted = {
      version: CURRENT_ANALYTICS_CONSENT_VERSION,
      granted: true,
      revision: 1,
      epoch: "66666666-6666-4666-8666-666666666666",
      consentedAt: "2026-09-13T08:00:00.000Z",
      revokedAt: null,
      updatedAt: "2026-09-13T08:00:00.000Z",
    };
    expect(analyticsConsentResponseSchema.safeParse(validGranted).success).toBe(
      true,
    );

    const validRevoked = {
      version: CURRENT_ANALYTICS_CONSENT_VERSION,
      granted: false,
      revision: 2,
      epoch: "77777777-7777-4777-8777-777777777777",
      consentedAt: null,
      revokedAt: "2026-09-13T08:30:00.000Z",
      updatedAt: "2026-09-13T08:30:00.000Z",
    };
    expect(analyticsConsentResponseSchema.safeParse(validRevoked).success).toBe(
      true,
    );
  });

  it("enforces ingestion batch limits (min 1, max 50)", () => {
    const baseRequest = {
      consentVersion: CURRENT_ANALYTICS_CONSENT_VERSION,
      epoch: "88888888-8888-4888-8888-888888888888",
    };

    // Empty batch fails (min 1)
    expect(
      analyticsBatchIngestRequestSchema.safeParse({
        ...baseRequest,
        events: [],
      }).success,
    ).toBe(false);

    // 1 event passes
    expect(
      analyticsBatchIngestRequestSchema.safeParse({
        ...baseRequest,
        events: [sampleEvent],
      }).success,
    ).toBe(true);

    // 50 events passes
    const fiftyEvents = Array.from({ length: 50 }, (_, i) => ({
      ...sampleEvent,
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      sequence: i,
    }));
    expect(
      analyticsBatchIngestRequestSchema.safeParse({
        ...baseRequest,
        events: fiftyEvents,
      }).success,
    ).toBe(true);

    // 51 events fails (max 50)
    const fiftyOneEvents = Array.from({ length: 51 }, (_, i) => ({
      ...sampleEvent,
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      sequence: i,
    }));
    expect(
      analyticsBatchIngestRequestSchema.safeParse({
        ...baseRequest,
        events: fiftyOneEvents,
      }).success,
    ).toBe(false);

    // Rejects wrong consentVersion
    expect(
      analyticsBatchIngestRequestSchema.safeParse({
        consentVersion: "wrong-version",
        epoch: "88888888-8888-4888-8888-888888888888",
        events: [sampleEvent],
      }).success,
    ).toBe(false);

    // Rejects extra properties on batch request
    expect(
      analyticsBatchIngestRequestSchema.safeParse({
        ...baseRequest,
        events: [sampleEvent],
        extra: "not allowed",
      }).success,
    ).toBe(false);
  });

  it("validates analyticsBatchIngestResponseSchema", () => {
    const valid = {
      acceptedIds: ["11111111-1111-4111-8111-111111111111"],
      rejectedCount: 0,
    };
    expect(analyticsBatchIngestResponseSchema.safeParse(valid).success).toBe(
      true,
    );
  });

  it("validates analyticsClearRequestSchema and response", () => {
    const validRequest = {
      expectedRevision: 1,
      operationId: "99999999-9999-4999-8999-999999999999",
    };
    expect(analyticsClearRequestSchema.safeParse(validRequest).success).toBe(
      true,
    );

    // Rejects extra property
    expect(
      analyticsClearRequestSchema.safeParse({
        ...validRequest,
        unexpected: 1,
      }).success,
    ).toBe(false);

    const validResponse = {
      cleared: true as const,
      newEpoch: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      revision: 2,
    };
    expect(analyticsClearResponseSchema.safeParse(validResponse).success).toBe(
      true,
    );

    // Rejects cleared: false
    expect(
      analyticsClearResponseSchema.safeParse({
        ...validResponse,
        cleared: false,
      }).success,
    ).toBe(false);
  });
});

describe("Account export analytics schema integration", () => {
  it("parses export manifest with productAnalyticsEvents count", () => {
    const manifest = {
      schemaVersion: "2026-09-08" as const,
      generatedAt: "2026-09-13T08:00:00.000Z",
      completeness: "complete" as const,
      counts: {
        profiles: 1,
        goals: 1,
        foodEntries: 10,
        exercises: 5,
        workouts: 3,
        workoutSets: 9,
        bodyMeasurements: 2,
        conversations: 1,
        messages: 2,
        memories: 0,
        privateMedia: 0,
        feedback: 0,
        aiConsents: 1,
        productAnalyticsEvents: 25,
      },
    };
    const parsed = exportManifestSchema.safeParse(manifest);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.counts.productAnalyticsEvents).toBe(25);
    }
  });

  it("parses accountExportSchema with productAnalytics", () => {
    const fullExport = {
      userId: "11111111-1111-4111-8111-111111111111",
      generatedAt: "2026-09-13T08:00:00.000Z",
      profile: null,
      goals: [],
      foodEntries: [],
      exercises: [],
      workouts: [],
      workoutSets: [],
      bodyMeasurements: [],
      conversations: [],
      memories: [],
      privateMedia: [],
      feedback: [],
      productAnalytics: {
        consent: {
          version: CURRENT_ANALYTICS_CONSENT_VERSION,
          granted: true,
          revision: 1,
          epoch: "22222222-2222-4222-8222-222222222222",
          consentedAt: "2026-09-13T08:00:00.000Z",
          revokedAt: null,
          updatedAt: "2026-09-13T08:00:00.000Z",
        },
        events: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            schemaVersion: 2,
            recordedAt: "2026-09-13T08:00:00.000Z",
            sessionId: "44444444-4444-4444-8444-444444444444",
            sequence: 0,
            platform: "ios",
            appVersion: "1.0.0",
            name: "screen_viewed",
            properties: { screen: "dashboard" },
          },
        ],
      },
    };
    const parsed = accountExportSchema.safeParse(fullExport);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.productAnalytics?.events).toHaveLength(1);
      expect(parsed.data.productAnalytics?.consent?.granted).toBe(true);
    }
  });
});
