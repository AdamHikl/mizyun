import assert from "node:assert/strict";
import test from "node:test";
import {
  generateDemo,
  generateStoreExamples,
  demoOutput,
  DEMO_SHA,
} from "./demo.mjs";
import { validateSnapshot, validateStoreImport } from "./snapshot.mjs";
const now = Date.parse("2026-10-03T12:00:00.000Z");

test("demo is deterministic, bounded, aggregate-only and explicitly synthetic", () => {
  const demo = generateDemo(now);
  assert.deepEqual(generateDemo(now), demo);
  assert.equal(validateSnapshot(demo, now), demo);
  assert.equal(demo.environment, "synthetic");
  assert.equal(demo.sourceSha, DEMO_SHA);
  assert.equal(new Set(demo.metrics.map((r) => r.day)).size, 30);
  assert.deepEqual([...new Set(demo.metrics.map((r) => r.platform))].sort(), [
    "all",
    "android",
    "ios",
  ]);
  assert.ok(demo.metrics.length < 20000);
  const expected = [
    "active_accounts",
    "sessions",
    "meals_logged",
    "workouts_logged",
    "body_records_logged",
    "events",
    "registrations",
    "screen_views",
    "dashboard_clicks",
    "settings_searches",
    "settings_selections",
    "flow_started",
    "flow_completed",
    "flow_failed",
    "flow_exited",
    "navigation",
    "active_days",
    "d1_eligible",
    "d1_returned",
    "d7_eligible",
    "d7_returned",
    "duration_bucket",
    "failures",
    "releases",
    "feature_actions",
    "attempts_started",
    "attempts_completed",
    "attempts_exited",
    "attempts_open",
    "attempts_failed",
    "onboarding_started",
    "onboarding_completed",
    "onboarding_steps",
    "onboarding_failures",
    "onboarding_exits",
  ];
  assert.deepEqual(
    [...new Set(demo.metrics.map((r) => r.metric))].sort(),
    expected.sort(),
  );
  assert.doesNotMatch(
    JSON.stringify(demo),
    /@|user_id|email|password|calories|search_text|photo_url/,
  );
});
test("observed return excludes immature cohorts and preserves distinct platform semantics", () => {
  const { metrics } = generateDemo(now);
  for (const interval of [1, 7]) {
    const cohorts = metrics.filter(
      (r) => r.metric === `d${interval}_eligible` && r.platform === "all",
    );
    assert.equal(cohorts.length, 30 - interval);
    for (const eligible of cohorts) {
      const returned = metrics.find(
        (r) =>
          r.day === eligible.day &&
          r.metric === `d${interval}_returned` &&
          r.platform === "all",
      );
      assert.ok(returned.value <= eligible.value);
    }
  }
  for (const all of metrics.filter(
    (r) => r.metric === "active_accounts" && r.platform === "all",
  )) {
    const same = metrics.filter(
      (r) =>
        r.day === all.day && r.metric === all.metric && r.platform !== "all",
    );
    assert.ok(all.value >= Math.max(...same.map((r) => r.value)));
    assert.ok(all.value < same.reduce((s, r) => s + r.value, 0));
  }
});
test("normalized store examples remain visibly simulated and cannot be imported as a report wrapper", () => {
  const examples = generateStoreExamples(now);
  assert.equal(examples.synthetic, true);
  assert.match(examples.notice, /Never import into reporting.store_metrics/);
  assert.equal(examples.rows.length, 180);
  assert.throws(
    () => validateStoreImport(examples, now),
    /Invalid normalized store/,
  );
  assert.deepEqual(
    new Set(examples.rows.map((r) => r.platform)),
    new Set(["ios", "android"]),
  );
  assert.equal(demoOutput(["--store-examples"], now).synthetic, true);
  assert.throws(
    () => demoOutput(["--env", "prod"], now),
    /synthetic output only/,
  );
});
test("matched simulated attempt cohorts are internally consistent on every platform", () => {
  const { metrics } = generateDemo(now);
  for (const started of metrics.filter(
    (r) => r.metric === "attempts_started",
  )) {
    const value = (name) =>
      metrics.find(
        (r) =>
          r.day === started.day &&
          r.platform === started.platform &&
          r.dimension === started.dimension &&
          r.metric === `attempts_${name}`,
      ).value;
    assert.equal(
      value("completed") + value("exited") + value("open"),
      started.value,
    );
    assert.ok(value("failed") <= started.value);
  }
});
