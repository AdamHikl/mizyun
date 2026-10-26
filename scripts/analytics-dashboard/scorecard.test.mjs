import { test } from "node:test";
import assert from "node:assert/strict";
import { SCORECARD_SQL, parseScorecard } from "./scorecard.mjs";

test("scorecard SQL is a read-only, consent-scoped aggregate query", () => {
  assert.match(
    SCORECARD_SQL,
    /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;/,
  );
  assert.match(
    SCORECARD_SQL,
    /c\.granted AND c\.version = 'product-analytics-v2'/,
  );
  assert.match(SCORECARD_SQL, /c\.epoch = e\.epoch/);
  assert.doesNotMatch(
    SCORECARD_SQL,
    /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|GRANT)\b/i,
  );
  const output = SCORECARD_SQL.slice(
    SCORECARD_SQL.lastIndexOf("SELECT metric"),
  );
  assert.doesNotMatch(output, /user_id|properties|recorded_at/);
  // Only enum/label properties are read; no event carries free text.
  const read = [...SCORECARD_SQL.matchAll(/properties->>'([a-zA-Z]+)'/g)].map(
    (m) => m[1],
  );
  assert.deepEqual([...new Set(read)].sort(), [
    "cohortWeek",
    "milestone",
    "recordKind",
    "source",
  ]);
});

test("parser accepts only aggregate rows", () => {
  assert.deepEqual(
    parseScorecard(
      "BEGIN\nSET\nactivated|2026-11-16|2026-11-22|instagram|0|1\nweek_4_return|2026-10-26|2026-11-01|2026-W44|1|\nregistered_accounts||2026-11-29|all|8|\nCOMMIT\n",
    ),
    [
      {
        metric: "activated",
        cohortStart: "2026-11-16",
        cohortEnd: "2026-11-22",
        dimension: "instagram",
        numerator: 0,
        denominator: 1,
      },
      {
        metric: "week_4_return",
        cohortStart: "2026-10-26",
        cohortEnd: "2026-11-01",
        dimension: "2026-W44",
        numerator: 1,
        denominator: null,
      },
      {
        metric: "registered_accounts",
        cohortStart: null,
        cohortEnd: "2026-11-29",
        dimension: "all",
        numerator: 8,
        denominator: null,
      },
    ],
  );
  for (const row of [
    "activated|2026-11-16|2026-11-22|00000000-0000-4000-8000-000000000001|1|1",
    "user_rows|2026-11-16|2026-11-22|all|1|1",
    "mau|2026-10-31|2026-11-29|all|1.5|7",
    "mau|2026-10-31|2026-11-29|all|1|7|extra",
    "installs|2026-11-23|2026-11-29|Porridge with honey|1|",
  ])
    assert.throws(() => parseScorecard(row), /aggregate count/);
});
