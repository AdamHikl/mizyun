import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import { InMemoryMemoryStore } from "@mizyun/memory";
import {
  HistoryImportRepositoryError,
  type HistoryImportRepository,
  type UserId,
} from "@mizyun/core";
import { buildApp } from "../../app.js";
import { InMemoryWorkoutRepository } from "../../workout-repository.js";
import { InMemoryWorkoutSetRepository } from "../../workout-set-repository.js";
import { InMemoryExerciseRepository } from "../../exercise-repository.js";
import { InMemoryRunRepository } from "../../run-repository.js";
import { InMemoryHistoryImportRepository } from "../../history-import-repository.js";

const A = "00000000-0000-4000-8000-0000000000a1" as UserId;
const B = "00000000-0000-4000-8000-0000000000b2" as UserId;
const BATCH = "6f1c2c8e-0d55-4a8e-9a43-0a6b8d6f0001";
const BATCH_2 = "6f1c2c8e-0d55-4a8e-9a43-0a6b8d6f0002";
const A_HEADERS = { authorization: "Bearer A" };
const B_HEADERS = { authorization: "Bearer B" };

const fixture = (name: string): string =>
  readFileSync(
    new URL(
      `../../../../../packages/core/fixtures/history-import/${name}`,
      import.meta.url,
    ),
    "utf8",
  );

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

const setup = (
  options: {
    enabled?: boolean;
    wrap?: (repo: HistoryImportRepository) => HistoryImportRepository;
  } = {},
) => {
  const workouts = new InMemoryWorkoutRepository();
  const sets = new InMemoryWorkoutSetRepository();
  const exercises = new InMemoryExerciseRepository();
  const runs = new InMemoryRunRepository(workouts);
  const base = new InMemoryHistoryImportRepository(workouts, sets, exercises);
  const imports = options.wrap ? options.wrap(base) : base;
  const app = buildApp({
    workoutRepository: workouts,
    workoutSetRepository: sets,
    exerciseRepository: exercises,
    runRepository: runs,
    historyImportRepository: imports,
    historyImportsEnabled: options.enabled ?? true,
    tokenVerifier: {
      verify: async (token) =>
        token === "A" || token === "B"
          ? {
              userId: token === "A" ? A : B,
              accessToken: token,
              role: "authenticated",
            }
          : null,
    },
    agent: new AgentOrchestrator({
      provider: new DisabledAgentProvider(),
      memories: new InMemoryMemoryStore(),
    }),
  });
  apps.push(app);
  return { app, workouts, sets, exercises };
};

const file = {
  content: fixture("hevy-kg.csv"),
  fileName: "hevy.csv",
  timezone: "Europe/Bratislava",
  weightUnit: "kg",
  distanceUnit: "km",
};

const preview = async (
  app: ReturnType<typeof buildApp>,
  body: Record<string, unknown> = file,
  headers = A_HEADERS,
) =>
  app.inject({
    method: "POST",
    url: "/v1/history-imports/preview",
    headers,
    payload: body,
  });

/** Accept every suggestion; create custom exercises for the rest. */
const defaultMappings = (
  exercises: readonly {
    sourceName: string;
    match: { catalogId: string } | null;
  }[],
) =>
  exercises.map((exercise) => ({
    sourceName: exercise.sourceName,
    target: exercise.match
      ? { kind: "catalog", catalogId: exercise.match.catalogId }
      : { kind: "custom", name: exercise.sourceName },
  }));

const confirm = async (
  app: ReturnType<typeof buildApp>,
  body: Record<string, unknown>,
  headers = A_HEADERS,
) =>
  app.inject({
    method: "POST",
    url: "/v1/history-imports",
    headers,
    payload: body,
  });

const strengthWorkouts = async (
  workouts: InMemoryWorkoutRepository,
  user: UserId,
) =>
  (
    await workouts.list(user, {
      from: null,
      to: null,
      limit: 10_000,
      accessToken: "A",
    })
  ).filter((w) => w.details.activityType === undefined);

describe("history import preview", () => {
  it("parses the file, suggests catalog matches and writes nothing", async () => {
    const { app, workouts } = setup();
    const response = await preview(app);
    expect(response.statusCode).toBe(200);
    const body = response.json().preview;
    expect(body).toMatchObject({
      format: "hevy",
      workouts: 2,
      runs: 0,
      alreadyImported: 0,
      overlapping: 0,
      unitsFromFile: true,
    });
    expect(body.sets).toBe(8);
    expect(body.firstStartedAt < body.lastStartedAt).toBe(true);
    const bench = body.exercises.find(
      (e: { sourceName: string }) => e.sourceName === "Bench Press (Barbell)",
    );
    expect(bench).toMatchObject({
      setCount: 4,
      workoutCount: 1,
      match: { confidence: "exact" },
    });
    expect(await strengthWorkouts(workouts, A)).toHaveLength(0);
  });

  it("explains unusable files and refuses oversized ones", async () => {
    const { app } = setup();
    const unknown = await preview(app, { ...file, content: "a,b\n1,2\n" });
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json().error.message).toMatch(/not a Hevy, Strong/);
    const zone = await preview(app, { ...file, timezone: "+02:00" });
    expect(zone.statusCode).toBe(422);
    const tooLong = await preview(app, {
      ...file,
      content: "x".repeat(8_000_001),
    });
    expect(tooLong.statusCode).toBe(422);
    const tooBig = await preview(app, {
      ...file,
      content: "x".repeat(27 * 1024 * 1024),
    });
    expect(tooBig.statusCode).toBe(413);
  });

  it("requires authentication before reading a large body", async () => {
    const { app } = setup();
    const response = await preview(app, file, { authorization: "Bearer X" });
    expect(response.statusCode).toBe(401);
    const large = await preview(
      app,
      { ...file, content: "x".repeat(27 * 1024 * 1024) },
      { authorization: "Bearer X" },
    );
    expect(large.statusCode).toBe(401);
  });

  it("is not registered while imports are disabled, but batches stay listable", async () => {
    const { app } = setup({ enabled: false });
    expect((await preview(app)).statusCode).toBe(404);
    const list = await app.inject({
      method: "GET",
      url: "/v1/history-imports",
      headers: A_HEADERS,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().batches).toEqual([]);
  });
});

describe("history import confirm", () => {
  it("writes workouts with typed sets once, replays the same batch and conflicts on a changed request", async () => {
    const { app, workouts, sets, exercises } = setup();
    const { exercises: summary } = (await preview(app)).json().preview;
    const body = {
      ...file,
      batchId: BATCH,
      mappings: defaultMappings(summary),
    };
    const first = await confirm(app, body);
    expect(first.statusCode).toBe(200);
    expect(first.json().batch).toMatchObject({
      id: BATCH,
      format: "hevy",
      status: "complete",
      workoutCount: 2,
      setCount: 8,
      runCount: 0,
      duplicateCount: 0,
    });
    const stored = await strengthWorkouts(workouts, A);
    expect(stored).toHaveLength(2);
    const push = stored.find((w) => w.name === "Push Day")!;
    expect(push.details).toMatchObject({
      entryMode: "history_import",
      importSource: { format: "hevy" },
      workoutLifecycle: { kind: "session" },
    });
    const pushSets = await sets.listForWorkout(push.id, { accessToken: "A" });
    expect(pushSets.map((s) => s.setType)).toEqual([
      "warmup",
      "normal",
      "drop",
      "failure",
      "normal",
      "normal",
    ]);
    expect(pushSets[1]).toMatchObject({ loadKg: 80, repetitions: 8 });
    expect(pushSets[4]).toMatchObject({ durationSeconds: 60, loadKg: null });

    const replay = await confirm(app, body);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().batch.id).toBe(BATCH);
    expect(await strengthWorkouts(workouts, A)).toHaveLength(2);
    const saved = await exercises.list(A, { limit: 100, accessToken: "A" });
    const changed = await confirm(app, {
      ...body,
      mappings: body.mappings.map((m, i) =>
        i === 0 ? { ...m, target: { kind: "skip" } } : m,
      ),
    });
    expect(changed.statusCode).toBe(409);
    expect(await exercises.list(A, { limit: 100, accessToken: "A" })).toEqual(
      saved,
    );
  });

  it("refuses incomplete or invalid mappings before writing", async () => {
    const { app, workouts } = setup();
    const { exercises: summary } = (await preview(app)).json().preview;
    const mappings = defaultMappings(summary);
    const missing = await confirm(app, {
      ...file,
      batchId: BATCH,
      mappings: mappings.slice(1),
    });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().error.message).toMatch(/Choose what to do/);
    const unknownCatalog = await confirm(app, {
      ...file,
      batchId: BATCH,
      mappings: mappings.map((m, i) =>
        i === 0
          ? { ...m, target: { kind: "catalog", catalogId: "no-such-id" } }
          : m,
      ),
    });
    expect(unknownCatalog.statusCode).toBe(422);
    const catalogName = await confirm(app, {
      ...file,
      batchId: BATCH,
      mappings: mappings.map((m, i) =>
        i === 0
          ? { ...m, target: { kind: "custom", name: "Barbell Bench Press" } }
          : m,
      ),
    });
    expect(catalogName.statusCode).toBe(422);
    const allSkipped = await confirm(app, {
      ...file,
      batchId: BATCH,
      mappings: mappings.map((m) => ({ ...m, target: { kind: "skip" } })),
    });
    expect(allSkipped.statusCode).toBe(422);
    expect(await strengthWorkouts(workouts, A)).toHaveLength(0);
  });

  it("resumes after a lost response without writing a record twice", async () => {
    const lines = [
      "title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe",
    ];
    for (let day = 0; day < 205; day++) {
      const date = new Date(Date.UTC(2025, 0, 1 + day));
      const stamp = date.toISOString().slice(0, 10);
      lines.push(
        `Session,${stamp} 07:00,${stamp} 08:00,,Bench Press (Barbell),,,0,normal,60,5,,,`,
      );
    }
    let failures = 1;
    const { app, workouts } = setup({
      wrap: (repo) => ({
        begin: repo.begin.bind(repo),
        resolveExercises: repo.resolveExercises.bind(repo),
        finish: repo.finish.bind(repo),
        list: repo.list.bind(repo),
        remove: repo.remove.bind(repo),
        check: repo.check.bind(repo),
        writeChunk: async (userId, batchId, chunk, options) => {
          const result = await repo.writeChunk(userId, batchId, chunk, options);
          // The second chunk lands but its response is lost once.
          if (chunk.index === 1 && failures-- > 0)
            throw new HistoryImportRepositoryError("unavailable");
          return result;
        },
      }),
    });
    const body = { ...file, content: lines.join("\n") };
    const { exercises: summary } = (await preview(app, body)).json().preview;
    const request = {
      ...body,
      batchId: BATCH,
      mappings: defaultMappings(summary),
    };
    const lost = await confirm(app, request);
    expect(lost.statusCode).toBe(503);
    expect(await strengthWorkouts(workouts, A)).toHaveLength(205);
    const retry = await confirm(app, request);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().batch).toMatchObject({
      status: "complete",
      workoutCount: 205,
      setCount: 205,
      duplicateCount: 0,
    });
    expect(await strengthWorkouts(workouts, A)).toHaveLength(205);
  });

  it("counts records from an earlier batch as duplicates and skips overlaps unless asked", async () => {
    const { app, workouts } = setup();
    // A manual session that overlaps Leg Day (24 Oct 18:00-19:00 local).
    const manual = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: A_HEADERS,
      payload: {
        name: "Logged here",
        startedAt: "2026-10-24T16:30:00Z",
        completedAt: "2026-10-24T17:30:00Z",
        details: { workoutLifecycle: { kind: "session" } },
      },
    });
    expect(manual.statusCode).toBe(200);
    const first = (await preview(app)).json().preview;
    expect(first.overlapping).toBe(1);
    const mappings = defaultMappings(first.exercises);
    const imported = await confirm(app, { ...file, batchId: BATCH, mappings });
    expect(imported.json().batch).toMatchObject({
      workoutCount: 1,
      overlapCount: 1,
    });
    const again = (await preview(app)).json().preview;
    expect(again).toMatchObject({ alreadyImported: 1, overlapping: 1 });
    const second = await confirm(app, {
      ...file,
      batchId: BATCH_2,
      mappings,
      skipOverlaps: false,
    });
    expect(second.json().batch).toMatchObject({
      workoutCount: 1,
      duplicateCount: 1,
      overlapCount: 0,
    });
    expect(await strengthWorkouts(workouts, A)).toHaveLength(3);
  });

  it("imports Strava runs as read-only file-import runs visible only to new clients", async () => {
    const { app } = setup();
    const strava = { ...file, content: fixture("strava-activities.csv") };
    const response = (await preview(app, strava)).json().preview;
    expect(response).toMatchObject({ format: "strava", runs: 4, workouts: 0 });
    expect(response.skippedActivities).toEqual([
      { type: "Ride", count: 2 },
      { type: "Swim", count: 1 },
    ]);
    const imported = await confirm(app, {
      ...strava,
      batchId: BATCH,
      mappings: [],
    });
    expect(imported.json().batch).toMatchObject({ runCount: 4 });
    const legacy = await app.inject({
      method: "GET",
      url: "/v1/runs?include=imports",
      headers: A_HEADERS,
    });
    expect(legacy.json().runs).toHaveLength(0);
    const current = await app.inject({
      method: "GET",
      url: "/v1/runs?include=all_imports",
      headers: A_HEADERS,
    });
    const runs = current.json().runs;
    expect(runs).toHaveLength(4);
    const morning = runs.find(
      (r: { name: string }) => r.name === "Morning Run",
    );
    expect(morning.summary).toMatchObject({
      origin: { kind: "file_import", format: "strava", externalId: "1001" },
      durationBasis: "elapsed",
      durationSeconds: 1850,
      distanceMeters: 5012.3,
      environment: "outdoor",
    });
    const edit = await app.inject({
      method: "PUT",
      url: `/v1/runs/${morning.id}`,
      headers: A_HEADERS,
      payload: {
        clientOperationId: "6f1c2c8e-0d55-4a8e-9a43-0a6b8d6f0099",
        expectedRevision: 1,
        activityDate: morning.summary.activityDate,
        recordingTimezone: morning.summary.recordingTimezone,
        startedAt: morning.summary.startedAt,
        durationSeconds: 1700,
        distanceMeters: morning.summary.distanceMeters,
        environment: "outdoor",
        name: "Morning Run",
      },
    });
    expect(edit.statusCode).toBe(422);
  });
});

describe("history import replays and file hygiene", () => {
  it("lets a late replay of a finished batch resolve and no-op instead of conflicting", async () => {
    const workouts = new InMemoryWorkoutRepository();
    const sets = new InMemoryWorkoutSetRepository();
    const exercises = new InMemoryExerciseRepository();
    const repo = new InMemoryHistoryImportRepository(workouts, sets, exercises);
    const options = { accessToken: "A" };
    await repo.begin(A, {
      batchId: BATCH,
      format: "hevy",
      fileName: null,
      digest: "d",
    });
    const spec = {
      key: "custom:x",
      kind: "custom" as const,
      name: "X",
      trackingMode: "load_reps" as const,
    };
    const ids = await repo.resolveExercises(A, BATCH, [spec], options);
    const chunk = {
      index: 0,
      timezone: "Europe/Bratislava",
      skipOverlaps: true,
      runs: [],
      workouts: [
        {
          key: "hevy:2026-01-01T07:00:00.000Z",
          name: "W",
          startedAt: "2026-01-01T07:00:00.000Z",
          completedAt: "2026-01-01T08:00:00.000Z",
          notes: null,
          sets: [
            {
              exerciseId: ids.get("custom:x")!,
              setType: "normal" as const,
              repetitions: 5,
              loadKg: 50,
              durationSeconds: null,
              distanceMeters: null,
              perceivedExertion: null,
            },
          ],
        },
      ],
    };
    expect((await repo.writeChunk(A, BATCH, chunk, options)).workouts).toBe(1);
    expect((await repo.finish(A, BATCH, 1, options)).status).toBe("complete");
    // The late request saw the batch as importing and now replays its steps.
    expect(await repo.resolveExercises(A, BATCH, [spec], options)).toEqual(ids);
    expect(await repo.writeChunk(A, BATCH, chunk, options)).toEqual({
      workouts: 0,
      sets: 0,
      runs: 0,
      duplicates: 0,
      overlapping: 0,
    });
    expect((await repo.finish(A, BATCH, 0, options)).workoutCount).toBe(1);
  });

  it("rejects a whole chunk when one record is invalid, writing nothing", async () => {
    const workouts = new InMemoryWorkoutRepository();
    const repo = new InMemoryHistoryImportRepository(
      workouts,
      new InMemoryWorkoutSetRepository(),
      new InMemoryExerciseRepository(),
    );
    const options = { accessToken: "A" };
    await repo.begin(A, {
      batchId: BATCH,
      format: "hevy",
      fileName: null,
      digest: "d",
    });
    const ids = await repo.resolveExercises(
      A,
      BATCH,
      [{ key: "k", kind: "custom", name: "X", trackingMode: "load_reps" }],
      options,
    );
    const workout = (key: string, loadKg: number) => ({
      key,
      name: "W",
      startedAt: "2026-01-01T07:00:00.000Z",
      completedAt: "2026-01-01T08:00:00.000Z",
      notes: null,
      sets: [
        {
          exerciseId: ids.get("k")!,
          setType: "normal" as const,
          repetitions: 5,
          loadKg,
          durationSeconds: null,
          distanceMeters: null,
          perceivedExertion: null,
        },
      ],
    });
    await expect(
      repo.writeChunk(
        A,
        BATCH,
        {
          index: 0,
          timezone: "UTC",
          skipOverlaps: true,
          runs: [],
          workouts: [workout("hevy:a", 50), workout("hevy:b", -1)],
        },
        options,
      ),
    ).rejects.toMatchObject({ kind: "invalid" });
    expect(
      await workouts.list(A, {
        from: null,
        to: null,
        limit: 10,
        accessToken: "A",
      }),
    ).toEqual([]);
  });

  it("strips control characters from file text before saving", async () => {
    const { app, workouts } = setup();
    const content = fixture("hevy-kg.csv").replace(
      "Felt strong",
      "Felt\u0000 strong",
    );
    const body = { ...file, content };
    const { exercises: summary } = (await preview(app, body)).json().preview;
    const imported = await confirm(app, {
      ...body,
      batchId: BATCH,
      mappings: defaultMappings(summary),
    });
    expect(imported.statusCode).toBe(200);
    const push = (await strengthWorkouts(workouts, A)).find(
      (w) => w.name === "Push Day",
    );
    expect(push?.notes).toBe("Felt strong");
  });
});

describe("history import ownership and undo", () => {
  it("isolates batches between accounts", async () => {
    const { app, workouts } = setup();
    const { exercises: summary } = (await preview(app)).json().preview;
    const body = {
      ...file,
      batchId: BATCH,
      mappings: defaultMappings(summary),
    };
    expect((await confirm(app, body)).statusCode).toBe(200);
    const list = await app.inject({
      method: "GET",
      url: "/v1/history-imports",
      headers: B_HEADERS,
    });
    expect(list.json().batches).toEqual([]);
    const remove = await app.inject({
      method: "DELETE",
      url: `/v1/history-imports/${BATCH}`,
      headers: B_HEADERS,
    });
    expect(remove.statusCode).toBe(404);
    expect((await preview(app, file, B_HEADERS)).json().preview).toMatchObject({
      alreadyImported: 0,
      overlapping: 0,
    });
    const reuse = await confirm(app, body, B_HEADERS);
    expect(reuse.statusCode).toBe(409);
    expect(await strengthWorkouts(workouts, B)).toHaveLength(0);
    expect(await strengthWorkouts(workouts, A)).toHaveLength(2);
  });

  it("undoes a batch: its workouts, sets and created exercises go, other data stays", async () => {
    const { app, workouts, sets, exercises } = setup();
    const manual = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: A_HEADERS,
      payload: {
        name: "Mine",
        startedAt: "2026-09-01T08:00:00Z",
        completedAt: "2026-09-01T09:00:00Z",
      },
    });
    const { exercises: summary } = (await preview(app)).json().preview;
    await confirm(app, {
      ...file,
      batchId: BATCH,
      mappings: defaultMappings(summary),
    });
    const imported = await strengthWorkouts(workouts, A);
    expect(imported).toHaveLength(3);
    expect(
      (await exercises.list(A, { limit: 100, accessToken: "A" })).length,
    ).toBeGreaterThan(0);
    const removed = await app.inject({
      method: "DELETE",
      url: `/v1/history-imports/${BATCH}`,
      headers: A_HEADERS,
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({
      removed: true,
      workouts: 2,
      runs: 0,
    });
    expect(removed.json().exercises).toBeGreaterThan(0);
    const left = await strengthWorkouts(workouts, A);
    expect(left.map((w) => w.id)).toEqual([manual.json().workout.id]);
    for (const w of imported)
      if (w.id !== manual.json().workout.id)
        expect(
          await sets.listForWorkout(w.id, { accessToken: "A" }),
        ).toHaveLength(0);
    expect(await exercises.list(A, { limit: 100, accessToken: "A" })).toEqual(
      [],
    );
    const again = await app.inject({
      method: "DELETE",
      url: `/v1/history-imports/${BATCH}`,
      headers: A_HEADERS,
    });
    expect(again.statusCode).toBe(404);
    // A deleted batch frees its records for a fresh explicit import.
    expect((await preview(app)).json().preview.alreadyImported).toBe(0);
  });

  it("includes batches and record provenance in the account export", async () => {
    const { app } = setup();
    const { exercises: summary } = (await preview(app)).json().preview;
    await confirm(app, {
      ...file,
      batchId: BATCH,
      mappings: defaultMappings(summary),
    });
    const exported = await app.inject({
      method: "GET",
      url: "/v1/account/export",
      headers: A_HEADERS,
    });
    expect(exported.statusCode).toBe(200);
    const section = exported.json().export.historyImports;
    expect(section.batches).toHaveLength(1);
    expect(section.batches[0]).toMatchObject({ id: BATCH, format: "hevy" });
    expect(section.records).toHaveLength(2);
    expect(section.records[0].import_key).toMatch(/^hevy:/);
  });
});
