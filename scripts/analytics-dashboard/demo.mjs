#!/usr/bin/env node
/** Explicitly simulated aggregates. No accounts, identities or source access. */
import { fileURLToPath } from "node:url";
import {
  screenNameSchema,
  dashboardControlSchema,
  analyticsSettingsDestinationSchema,
  durationBucketSchema,
  failureReasonSchema,
  featureActionSchema,
  onboardingStepSchema,
} from "../../packages/contracts/src/index.ts";
import { validateSnapshot, validateStoreImport } from "./snapshot.mjs";

export const DEMO_SHA = "d".repeat(40);
export const AUTOMATED_FIXTURE_SHA = "a".repeat(40);
const DAY_MS = 86400000;
const flows = ["meal", "workout", "body_measurement"];

export function generateDemo(now = Date.now()) {
  const generatedAt = new Date(now).toISOString();
  const metrics = [];
  const append = (day, metric, dimension, total, distinct = false) => {
    // Some simulated people use both platforms; distinct all is not platform sum.
    const ios = Math.round(total * (distinct ? 0.61 : 0.58));
    const android = distinct ? Math.round(total * 0.45) : total - ios;
    for (const [platform, value] of [
      ["ios", ios],
      ["android", android],
      ["all", total],
    ])
      metrics.push({ day, platform, metric, dimension, value });
  };
  const appendAttempts = (day, flow, completed, exited, open, failed) => {
    const totals = { completed, exited, open };
    const ios = Object.fromEntries(
      Object.entries(totals).map(([key, value]) => [
        key,
        Math.round(value * 0.58),
      ]),
    );
    const android = Object.fromEntries(
      Object.entries(totals).map(([key, value]) => [key, value - ios[key]]),
    );
    for (const [platform, values] of [
      ["ios", ios],
      ["android", android],
      ["all", totals],
    ]) {
      const started = values.completed + values.exited + values.open;
      const failedCount =
        platform === "ios"
          ? Math.round(failed * 0.58)
          : platform === "android"
            ? failed - Math.round(failed * 0.58)
            : failed;
      for (const [metric, value] of Object.entries({
        ...values,
        started,
        failed: Math.min(started, failedCount),
      }))
        metrics.push({
          day,
          platform,
          metric: `attempts_${metric}`,
          dimension: flow,
          value,
        });
    }
  };
  for (let i = 0; i < 30; i++) {
    const date = new Date(now - (29 - i) * DAY_MS);
    const day = date.toISOString().slice(0, 10);
    const weekend = [0, 6].includes(date.getUTCDay());
    const active = Math.round((95 + i * 7) * (weekend ? 0.83 : 1));
    const meal = Math.round(active * 1.7);
    const workout = Math.round(active * 0.32);
    const body = Math.round(active * 0.14);
    const counts = {
      active_accounts: active,
      sessions: Math.round(active * 2.3),
      meals_logged: meal,
      workouts_logged: workout,
      body_records_logged: body,
      events: active * 18,
      registrations: 24 + Math.round(i * 1.4),
    };
    for (const [metric, total] of Object.entries(counts))
      append(day, metric, "all", total, metric === "active_accounts");
    const onboardStarted = counts.registrations;
    const onboardCompleted = Math.round(onboardStarted * 0.72);
    const onboardExited = Math.round(onboardStarted * 0.12);
    append(day, "onboarding_started", "all", onboardStarted);
    append(day, "onboarding_completed", "all", onboardCompleted);
    appendAttempts(
      day,
      "onboarding",
      onboardCompleted,
      onboardExited,
      onboardStarted - onboardCompleted - onboardExited,
      Math.round(onboardStarted * 0.15),
    );
    for (const [index, step] of onboardingStepSchema.options.entries()) {
      append(
        day,
        "onboarding_steps",
        step,
        index === onboardingStepSchema.options.length - 1
          ? onboardCompleted
          : Math.round(onboardStarted * (1 - index * 0.05)),
      );
      append(
        day,
        "onboarding_failures",
        step,
        index === 2
          ? Math.round(onboardStarted * 0.09)
          : Math.round(onboardStarted * 0.015),
      );
      append(
        day,
        "onboarding_exits",
        step,
        index === 2
          ? Math.round(onboardStarted * 0.07)
          : index === onboardingStepSchema.options.length - 1
            ? 0
            : Math.round(onboardStarted * 0.01),
      );
    }
    // First-observed cohorts mature at D1/D7; recent cohorts remain unavailable.
    for (const interval of [1, 7])
      if (i <= 29 - interval) {
        const eligible = 18 + Math.round(i * 0.8);
        append(day, `d${interval}_eligible`, "all", eligible, true);
        append(
          day,
          `d${interval}_returned`,
          "all",
          Math.round(eligible * (interval === 1 ? 0.54 : 0.32)),
          true,
        );
      }
    for (const [index, screen] of screenNameSchema.options.entries())
      append(
        day,
        "screen_views",
        screen,
        Math.max(
          1,
          Math.round(active * (index === 0 ? 3.4 : 1.3 / (1 + index * 0.45))),
        ),
      );
    for (const [index, control] of dashboardControlSchema.options.entries())
      append(
        day,
        "dashboard_clicks",
        control,
        Math.max(1, Math.round((active * 0.9) / (1 + index * 0.7))),
      );
    for (const [bucket, fraction] of [
      ["none", 0.06],
      ["1_to_5", 0.18],
      ["6_plus", 0.1],
    ])
      append(day, "settings_searches", bucket, Math.round(active * fraction));
    for (const [
      index,
      destination,
    ] of analyticsSettingsDestinationSchema.options.entries())
      append(
        day,
        "settings_selections",
        destination,
        Math.max(1, Math.round((active * 0.12) / (1 + index * 0.35))),
      );
    for (const [index, flow] of flows.entries()) {
      const completed = [meal, workout, body][index];
      appendAttempts(
        day,
        flow,
        completed,
        Math.round(completed * 0.07),
        Math.round(completed * 0.04),
        Math.round(completed * 0.09),
      );
      for (const [metric, total] of [
        ["flow_started", Math.round(completed * 1.16)],
        ["flow_completed", completed],
        ["flow_failed", Math.round(completed * 0.06)],
        ["flow_exited", Math.round(completed * 0.09)],
      ])
        append(day, metric, flow, total);
      for (const [
        bucketIndex,
        bucket,
      ] of durationBucketSchema.options.entries())
        append(
          day,
          "duration_bucket",
          `${flow}>${bucket}`,
          Math.round(completed * [0.38, 0.28, 0.2, 0.1, 0.04][bucketIndex]),
        );
      for (const [reasonIndex, reason] of failureReasonSchema.options.entries())
        append(
          day,
          "failures",
          `${flow}>${reason}`,
          Math.round(
            completed * [0.026, 0.017, 0.008, 0.004, 0.003, 0.002][reasonIndex],
          ),
        );
    }
    for (const [index, pair] of [
      "dashboard>log_meal",
      "log_meal>dashboard",
      "dashboard>coach",
      "settings>dashboard",
      "dashboard>settings",
    ].entries())
      append(
        day,
        "navigation",
        pair,
        Math.round(active * (1.6 - index * 0.24)),
      );
    for (const [index, action] of featureActionSchema.options.entries()) {
      append(
        day,
        "feature_actions",
        `${action}>success`,
        Math.round((active * 0.3) / (index + 1)),
      );
      append(
        day,
        "feature_actions",
        `${action}>failure`,
        Math.round((active * 0.025) / (index + 1)),
      );
    }
    for (const [release, fraction] of [
      ["1.0.6/6", i < 20 ? 0.8 : 0.25],
      ["1.0.7/7", i < 20 ? 0.18 : 0.73],
      ["unknown", 0.02],
    ])
      append(day, "releases", release, Math.round(active * 18 * fraction));
    // Source reports the rolling active-day distribution only on snapshot day.
    // This is simulated activity, not evidence of actual adherence.
    for (let activeDays = 1; i === 29 && activeDays <= 30; activeDays++)
      append(
        day,
        "active_days",
        String(activeDays),
        Math.max(1, Math.round(70 * Math.exp(-activeDays / 9))),
        true,
      );
  }
  return validateSnapshot(
    {
      environment: "synthetic",
      generatedAt,
      sourceSha: DEMO_SHA,
      totalAccounts: 2600,
      consentingAccounts: 1840,
      metrics,
    },
    now,
  );
}

export function generateStoreExamples(now = Date.now()) {
  const rows = [];
  for (let i = 0; i < 30; i++) {
    const day = new Date(now - (29 - i) * DAY_MS).toISOString().slice(0, 10);
    for (const [platform, metric, value, source] of [
      ["ios", "first_time_downloads", 40 + i, "apple_app_store_connect"],
      ["ios", "redownloads", 3 + (i % 4), "apple_app_store_connect"],
      ["android", "user_acquisitions", 33 + i, "google_play_console"],
      ["android", "device_installs", 38 + i, "google_play_console"],
      ["android", "listing_visitors", 180 + i * 4, "google_play_console"],
      ["android", "install_clicks", 50 + i * 2, "google_play_console"],
    ])
      rows.push({ platform, day, metric, value, source });
  }
  return {
    synthetic: true,
    notice:
      "SIMULATED FORMAT EXAMPLES ONLY. These counts did not come from Apple or Google. Never import into reporting.store_metrics or present as official metrics.",
    rows: validateStoreImport(rows, now),
  };
}

export function demoOutput(args, now = Date.now()) {
  if (args.length === 0 || (args.length === 1 && args[0] === "--snapshot"))
    return generateDemo(now);
  if (args.length === 1 && args[0] === "--store-examples")
    return generateStoreExamples(now);
  throw new Error("Use --snapshot or --store-examples; synthetic output only");
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(demoOutput(process.argv.slice(2))));
  } catch {
    console.error("Synthetic demo generation failed; no source data accessed");
    process.exitCode = 1;
  }
}
