import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  adaptExerciseSnapshot,
  LEGACY_EXERCISE_ALIASES,
  renderCatalogModule,
} from "./import-exercise-catalog.mjs";

function snapshot(special = []) {
  const base = {
    name_en: "Test movement",
    description_en: "An isolated synthetic movement for importer verification.",
    category: "strength",
    difficulty: "beginner",
    mechanic: "isolation",
    body_part: "core",
    force_type: "static",
    primary_muscles: ["rectus_abdominis"],
    instructions_en: [
      "Start on the floor.",
      "Move with control.",
      "Return with control.",
    ],
    tips_en: ["Keep your trunk steady.", "Move slowly."],
  };
  return {
    schema_version: 3,
    count: 609,
    exercises: Array.from({ length: 609 }, (_, i) => ({
      ...base,
      id: `synthetic-${i}`,
      ...(special[i] ?? {}),
    })),
  };
}

test("missing/changed source schema, blank form content and duplicate IDs fail closed", () => {
  assert.throws(() =>
    adaptExerciseSnapshot({ ...snapshot(), schema_version: 4 }),
  );
  assert.throws(() => adaptExerciseSnapshot({ ...snapshot(), count: 610 }));
  assert.throws(() =>
    adaptExerciseSnapshot(snapshot([{ instructions_en: [] }])),
  );
  assert.throws(() => adaptExerciseSnapshot(snapshot([{ tips_en: [" "] }])));
  assert.throws(() =>
    adaptExerciseSnapshot(snapshot([{ id: "same" }, { id: "same" }])),
  );
});

test("CLI rejects changed source bytes before writing any catalog", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mizyun-catalog-import-"));
  const input = join(directory, "source.json");
  const output = join(directory, "catalog.ts");
  try {
    await writeFile(input, JSON.stringify(snapshot()));
    await assert.rejects(
      promisify(execFile)(process.execPath, [
        "scripts/import-exercise-catalog.mjs",
        input,
        output,
      ]),
      /Source checksum differs/,
    );
    await assert.rejects(readFile(output), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("equipment is not inferred from missing supplier field or broad safety tags", () => {
  const records = adaptExerciseSnapshot(
    snapshot([
      {
        id: "incline-push-ups",
        instructions_en: [
          "Place hands on a bench.",
          "Lower with control.",
          "Press back up.",
        ],
      },
      { id: "captains-chair-knee-raise" },
      {
        id: "kettlebell-squat",
        body_part: "upper_legs",
        equipment: "kettlebell",
        tags: ["knee_safe", "lower_back_safe", "shoulder_safe"],
      },
      {
        id: "hip-thrust",
        equipment: "barbell",
        instructions_en: [
          "Place a barbell across your hips with upper back on a bench.",
          "Lift your hips.",
          "Lower with control.",
        ],
      },
    ]),
  );
  assert.ok(records[0].equipment.includes("bench"));
  assert.ok(records[1].equipment.includes("full_gym"));
  assert.ok(records[2].equipment.includes("full_gym"));
  assert.ok(!records[2].equipment.includes("dumbbells"));
  assert.ok(records[2].blockedBy.includes("limited_knee_flexion"));
  assert.ok(records[2].blockedBy.includes("limited_spinal_loading"));
  assert.ok(!records[3].equipment.includes("rack"));
  assert.ok(records[3].requiredEquipment.some((s) => s.includes("bench")));
});

test("overhead and impact controls remain conservative without blanket cardio exclusions", () => {
  const records = adaptExerciseSnapshot(
    snapshot([
      {
        id: "pull-up",
        body_part: "back",
        force_type: "pull",
        equipment: "pull_up_bar",
      },
      {
        id: "one-arm-lat-pulldown",
        body_part: "back",
        force_type: "pull",
        equipment: "cable",
      },
      {
        id: "straight-arm-pulldown",
        body_part: "back",
        force_type: "pull",
        equipment: "cable",
      },
      { id: "mountain-climbers" },
      { id: "running", category: "cardio" },
      {
        id: "stationary-bike",
        category: "cardio",
        equipment: "stationary_bike",
      },
    ]),
  );
  for (const record of records.slice(0, 3))
    assert.ok(record.blockedBy.includes("no_overhead_work"));
  assert.ok(records[3].blockedBy.includes("limited_knee_flexion"));
  assert.ok(records[4].blockedBy.includes("no_running"));
  assert.ok(records[4].blockedBy.includes("low_impact_only"));
  assert.ok(!records[5].blockedBy.includes("no_running"));
  assert.ok(!records[5].blockedBy.includes("low_impact_only"));
});

test("corrected pike steps remove the erroneous source wall equipment requirement", () => {
  const [exercise] = adaptExerciseSnapshot(
    snapshot([
      {
        id: "bodyweight-overhead-press",
        instructions_en: [
          "Stand facing a wall in a pike position.",
          "Lower with control.",
          "Press back up.",
        ],
      },
    ]),
  );
  assert.deepEqual(exercise.equipment, ["bodyweight"]);
  assert.deepEqual(exercise.requiredEquipment, ["no equipment"]);
  assert.ok(!exercise.instructions.some((step) => /wall/.test(step)));
  assert.deepEqual(exercise.contentReview, {
    status: "pending_professional",
    reviewedAt: null,
  });
});

test("cue adaptations respect kneeling vs standing movements and preserve exact variants", () => {
  const records = adaptExerciseSnapshot(
    snapshot([
      {
        id: "bodyweight-squat",
        instructions_en: [
          "Stand tall.",
          "Lower until your thighs are parallel to the floor.",
          "Drive through your heels to stand.",
        ],
      },
      { id: "banded-fire-hydrant", equipment: "loop_band" },
      { id: "box-squat" },
      { id: "goblet-squat", equipment: "kettlebell" },
      { id: "db-kickstand-deadlift", equipment: "dumbbell" },
      { id: "double-db-kickstand-deadlift", equipment: "dumbbell" },
    ]),
  );
  assert.ok(
    records[0].instructions.some((s) => s.includes("depth you can control")),
  );
  assert.ok(records[0].instructions.some((s) => s.includes("whole foot")));
  assert.ok(!records[1].instructions.some((s) => s.includes("feet planted")));
  assert.equal(records[2].id, "exercise-box-squat");
  assert.equal(records[3].id, "exercise-goblet-squat");
  assert.notEqual(records[4].id, records[5].id);
  assert.notEqual(records[4].name, records[5].name);
  assert.deepEqual(LEGACY_EXERCISE_ALIASES, {
    "romanian-deadlift": "barbell-rdl",
    plank: "front-plank",
  });
});

test("render is deterministic, retains attribution, leaves review and media acceptance pending", () => {
  const first = adaptExerciseSnapshot(snapshot());
  const second = adaptExerciseSnapshot(snapshot());
  assert.equal(renderCatalogModule(first), renderCatalogModule(second));
  assert.match(renderCatalogModule(first), /Exercise data by RepDB/);
  assert.equal(first.length, 609);
  assert.equal(new Set(first.map((s) => s.id)).size, 609);
  for (const item of first) {
    assert.deepEqual(item.contentReview, {
      status: "pending_professional",
      reviewedAt: null,
    });
    assert.equal(item.demonstration, null);
    assert.ok(!("images" in item));
    assert.ok(item.instructions.length >= 3 && item.instructions.length <= 6);
    assert.deepEqual(item.commonMistakes, []);
  }
});
