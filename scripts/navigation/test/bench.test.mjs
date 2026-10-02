import test from "node:test";
import assert from "node:assert/strict";
import { median, parseBenchArgs, benchmarkNavigation } from "../bench.mjs";

test("medians retain fractional values and do not mutate samples", () => {
  const values = [5.4, 1.1, 4, 2];
  assert.equal(median(values), 3);
  assert.deepEqual(values, [5.4, 1.1, 4, 2]);
  assert.equal(median([3, 1, 2]), 2);
  assert.throws(() => median([]), /finite/);
  assert.throws(() => median([Infinity]), /finite/);
});

test("benchmark rejects excessive work, duplicate and unknown options", () => {
  assert.deepEqual(parseBenchArgs(["--samples", "3", "--json"]), {
    samples: 3,
    json: true,
  });
  for (const args of [
    ["--samples"],
    ["--samples", "0"],
    ["--samples", "11"],
    ["--samples", "1.5"],
    ["--samples", "NaN"],
    ["--json", "--json"],
    ["--all"],
  ])
    assert.throws(() => parseBenchArgs(args));
  assert.throws(
    () => benchmarkNavigation("/absent", { samples: 9999 }),
    /integer/,
  );
});
