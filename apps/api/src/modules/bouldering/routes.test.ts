import { afterEach, describe, expect, it } from "vitest";
import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import { InMemoryMemoryStore } from "@mizyun/memory";
import type { UserId } from "@mizyun/core";
import { buildApp } from "../../app.js";
import { InMemoryWorkoutRepository } from "../../workout-repository.js";
import { InMemoryMediaAssetRepository } from "../../media-asset-repository.js";
import { InMemoryBoulderingRepository } from "../../bouldering-repository.js";

const A = "00000000-0000-4000-8000-000000000001" as UserId;
const B = "00000000-0000-4000-8000-000000000002" as UserId;
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

const setup = (boulderingEnabled = true) => {
  const workouts = new InMemoryWorkoutRepository();
  const media = new InMemoryMediaAssetRepository();
  const bouldering = new InMemoryBoulderingRepository(workouts, media);
  const make = () => {
    const app = buildApp({
      workoutRepository: workouts,
      mediaAssetRepository: media,
      boulderingRepository: bouldering,
      boulderingEnabled,
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
    return app;
  };
  return { app: make(), make, workouts, media, bouldering };
};

const asA = { authorization: "Bearer A" };
const asB = { authorization: "Bearer B" };
const op = () => crypto.randomUUID();
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
type App = ReturnType<typeof buildApp>;

const start = (app: App, headers = asA, body: Record<string, unknown> = {}) =>
  app.inject({
    method: "POST",
    url: "/v1/bouldering/sessions",
    headers,
    payload: {
      clientOperationId: op(),
      recordingTimezone: "UTC",
      ...body,
    },
  });
const log = (
  app: App,
  sessionId: string,
  body: Record<string, unknown>,
  headers = asA,
) =>
  app.inject({
    method: "POST",
    url: `/v1/bouldering/sessions/${sessionId}/ascents`,
    headers,
    payload: { clientOperationId: op(), ...body },
  });
const finish = (app: App, sessionId: string, headers = asA) =>
  app.inject({
    method: "POST",
    url: `/v1/bouldering/sessions/${sessionId}/finish`,
    headers,
    payload: { clientOperationId: op() },
  });

const shiftDate = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

describe("bouldering routes", () => {
  it("logs a session, lists it, and finishes with achievements", async () => {
    const { app } = setup();
    const started = await start(app, asA, { gymName: " Boulder Gym " });
    expect(started.statusCode).toBe(201);
    const session = started.json().session;
    expect(session).toMatchObject({
      name: "Bouldering",
      completedAt: null,
      session: { gradeScale: "font", gymName: "Boulder Gym" },
      summary: { boulders: 0, topGrade: null },
    });
    expect(started.json().ascents).toEqual([]);

    const flash = await log(app, session.id, {
      grade: "6a+",
      result: "flash",
      attempts: 1,
    });
    expect(flash.statusCode).toBe(201);
    expect(flash.json().ascent).toMatchObject({
      grade: "6A+",
      gradeRank: 6,
      sequence: 1,
      revision: 1,
    });
    expect(
      (await log(app, session.id, { grade: "6B", result: "sent", attempts: 3 }))
        .statusCode,
    ).toBe(201);
    expect(
      (await log(app, session.id, { grade: "7A", result: "not_yet" }))
        .statusCode,
    ).toBe(201);

    const active = await app.inject({
      method: "GET",
      url: "/v1/bouldering/sessions/active",
      headers: asA,
    });
    expect(active.json().session.id).toBe(session.id);
    expect(active.json().ascents).toHaveLength(3);

    const got = await app.inject({
      method: "GET",
      url: `/v1/bouldering/sessions/${session.id}`,
      headers: asA,
    });
    expect(got.statusCode).toBe(200);
    expect(got.json().session.summary).toEqual({
      boulders: 3,
      sends: 2,
      flashes: 1,
      attempts: 4,
      attemptsComplete: false,
      topGrade: "6B",
    });
    const listed = await app.inject({
      method: "GET",
      url: "/v1/bouldering/sessions",
      headers: asA,
    });
    expect(listed.json()).toMatchObject({
      sessions: [{ id: session.id }],
      nextCursor: null,
    });

    const first = await finish(app, session.id);
    expect(first.statusCode).toBe(200);
    expect(first.json().session.completedAt).not.toBeNull();
    expect(first.json().achievements).toEqual([{ kind: "first_session" }]);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/bouldering/sessions/active",
          headers: asA,
        })
      ).json(),
    ).toEqual({ session: null, ascents: [] });
    // Finishing again with a new operation conflicts (finish once).
    expect((await finish(app, session.id)).statusCode).toBe(409);

    await tick();
    const second = (await start(app)).json().session;
    await log(app, second.id, { grade: "6C", result: "sent", attempts: 2 });
    await log(app, second.id, { grade: "6B", result: "flash", attempts: 1 });
    const finished = await finish(app, second.id);
    expect(finished.json().achievements).toEqual([
      { kind: "personal_best", gradeRank: 9, grade: "6C" },
      { kind: "first_flash", gradeRank: 7, grade: "6B" },
    ]);
  });

  it("replays a lost create response, rejects changed payloads, and never resurrects a deleted boulder", async () => {
    const { app, make } = setup();
    const session = (await start(app)).json().session;
    const body = {
      clientOperationId: op(),
      grade: "5+",
      result: "sent",
      attempts: null,
    };
    const url = `/v1/bouldering/sessions/${session.id}/ascents`;
    const results = await Promise.all([
      app.inject({ method: "POST", url, headers: asA, payload: body }),
      app.inject({ method: "POST", url, headers: asA, payload: body }),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([201, 201]);
    const id = results[0]!.json().ascent.id;
    expect(results[1]!.json().ascent.id).toBe(id);
    const replay = await make().inject({
      method: "POST",
      url,
      headers: asA,
      payload: body,
    });
    expect(replay.json().ascent.id).toBe(id);
    const got = await app.inject({
      method: "GET",
      url: `/v1/bouldering/sessions/${session.id}`,
      headers: asA,
    });
    expect(got.json().ascents).toHaveLength(1);

    const changed = await app.inject({
      method: "POST",
      url,
      headers: asA,
      payload: { ...body, grade: "6A" },
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error.code).toBe("CONFLICT");

    for (let i = 0; i < 2; i++) {
      const removed = await app.inject({
        method: "DELETE",
        url: `/v1/bouldering/ascents/${id}`,
        headers: asA,
      });
      expect(removed.statusCode).toBe(200);
      expect(removed.json()).toEqual({ removed: true });
    }
    const resurrect = await app.inject({
      method: "POST",
      url,
      headers: asA,
      payload: body,
    });
    expect(resurrect.statusCode).toBe(410);
    expect(resurrect.json().error.code).toBe("BOULDER_REMOVED");
    const edit = await app.inject({
      method: "PUT",
      url: `/v1/bouldering/ascents/${id}`,
      headers: asA,
      payload: { ...body, clientOperationId: op(), expectedRevision: 1 },
    });
    expect(edit.statusCode).toBe(410);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/bouldering/sessions/${session.id}`,
          headers: asA,
        })
      ).json().ascents,
    ).toEqual([]);
  });

  it("edits compare-and-swap on revision and replay the accepted edit", async () => {
    const { app } = setup();
    const session = (await start(app)).json().session;
    const ascent = (
      await log(app, session.id, { grade: "6A", result: "not_yet" })
    ).json().ascent;
    const edit = {
      clientOperationId: op(),
      grade: "6A",
      result: "sent",
      attempts: 4,
      expectedRevision: 1,
    };
    const url = `/v1/bouldering/ascents/${ascent.id}`;
    const first = await app.inject({
      method: "PUT",
      url,
      headers: asA,
      payload: edit,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().ascent).toMatchObject({ revision: 2, result: "sent" });
    const replay = await app.inject({
      method: "PUT",
      url,
      headers: asA,
      payload: edit,
    });
    expect(replay.json().ascent.revision).toBe(2);
    const stale = await app.inject({
      method: "PUT",
      url,
      headers: asA,
      payload: { ...edit, clientOperationId: op(), attempts: 5 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("CONFLICT");
  });

  it("allows one active session and replays the start operation", async () => {
    const { app } = setup();
    const payload = { clientOperationId: op(), recordingTimezone: "UTC" };
    const first = await app.inject({
      method: "POST",
      url: "/v1/bouldering/sessions",
      headers: asA,
      payload,
    });
    const replay = await app.inject({
      method: "POST",
      url: "/v1/bouldering/sessions",
      headers: asA,
      payload,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().session.id).toBe(first.json().session.id);
    const second = await start(app);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("BOULDER_SESSION_ACTIVE");
    // Another user is unaffected by A's active session.
    expect((await start(app, asB)).statusCode).toBe(201);
    // Discarding the session tombstones its start receipt.
    await app.inject({
      method: "DELETE",
      url: `/v1/bouldering/sessions/${first.json().session.id}`,
      headers: asA,
    });
    const afterDelete = await app.inject({
      method: "POST",
      url: "/v1/bouldering/sessions",
      headers: asA,
      payload,
    });
    expect(afterDelete.statusCode).toBe(410);
    expect((await start(app)).statusCode).toBe(201);
  });

  it("keeps sessions and boulders owner-only", async () => {
    const { app } = setup();
    const session = (await start(app)).json().session;
    const ascent = (
      await log(app, session.id, { grade: "6A", result: "flash", attempts: 1 })
    ).json().ascent;
    const expect404 = async (
      response: Promise<{ statusCode: number }>,
    ): Promise<void> => {
      expect((await response).statusCode).toBe(404);
    };
    await expect404(
      app.inject({
        method: "GET",
        url: `/v1/bouldering/sessions/${session.id}`,
        headers: asB,
      }),
    );
    await expect404(finish(app, session.id, asB));
    await expect404(log(app, session.id, { grade: "6A", result: "sent" }, asB));
    await expect404(
      app.inject({
        method: "PUT",
        url: `/v1/bouldering/ascents/${ascent.id}`,
        headers: asB,
        payload: {
          clientOperationId: op(),
          grade: "8C+",
          result: "flash",
          attempts: 1,
          expectedRevision: 1,
        },
      }),
    );
    // B's deletes are idempotent no-ops that leave A's data intact.
    for (const url of [
      `/v1/bouldering/ascents/${ascent.id}`,
      `/v1/bouldering/sessions/${session.id}`,
    ])
      expect(
        (await app.inject({ method: "DELETE", url, headers: asB })).statusCode,
      ).toBe(200);
    const listedB = await app.inject({
      method: "GET",
      url: "/v1/bouldering/sessions",
      headers: asB,
    });
    expect(listedB.json().sessions).toEqual([]);
    const got = await app.inject({
      method: "GET",
      url: `/v1/bouldering/sessions/${session.id}`,
      headers: asA,
    });
    expect(got.json().ascents).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/bouldering/sessions",
        })
      ).statusCode,
    ).toBe(401);
  });

  it("validates bodies, grades, attempts, ids and photos", async () => {
    const { app, media } = setup();
    const bodyUser = await start(app, asA, { userId: B });
    expect(bodyUser.statusCode).toBe(400);
    expect(bodyUser.json().error.code).toBe("VALIDATION_ERROR");
    const session = (await start(app)).json().session;
    for (const bad of [
      { grade: "9A", result: "sent" },
      { grade: "6A", result: "flash", attempts: 2 },
      { grade: "6A", result: "flash" },
      { grade: "6A", result: "sent", attempts: 1 },
      { grade: "6A", result: "not_yet", attempts: 100 },
      { grade: "6A", result: "sent", userId: A },
      { grade: "6A", result: "sent", holdColour: "teal" },
    ])
      expect((await log(app, session.id, bad)).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/bouldering/sessions/not-a-uuid",
          headers: asA,
        })
      ).statusCode,
    ).toBe(400);

    const asset = (id: string, userId: UserId, purpose = "workout") => ({
      id,
      userId,
      purpose: purpose as "workout",
      mimeType: "image/jpeg",
      byteSize: 1000,
      width: 100,
      height: 100,
      metadata: {},
      bucketId: "media",
      objectPath: `${userId}/${id}.jpg`,
      createdAt: new Date(),
      deletedAt: null,
    });
    const mine = crypto.randomUUID();
    const theirs = crypto.randomUUID();
    const progress = crypto.randomUUID();
    media.__seedForTest(asset(mine, A));
    media.__seedForTest(asset(theirs, B));
    media.__seedForTest(asset(progress, A, "progress"));
    for (const photoAssetId of [theirs, progress, crypto.randomUUID()])
      expect(
        (
          await log(app, session.id, {
            grade: "6A",
            result: "sent",
            photoAssetId,
          })
        ).statusCode,
      ).toBe(400);
    const withPhoto = await log(app, session.id, {
      grade: "6A",
      result: "sent",
      photoAssetId: mine,
      holdColour: "blue",
      note: "  Crimpy  ",
    });
    expect(withPhoto.statusCode).toBe(201);
    expect(withPhoto.json().ascent).toMatchObject({
      photoAssetId: mine,
      holdColour: "blue",
      note: "Crimpy",
    });
  });

  it("returns FEATURE_DISABLED for every route when the flag is off", async () => {
    const { app } = setup(false);
    const id = crypto.randomUUID();
    for (const [method, url] of [
      ["POST", "/v1/bouldering/sessions"],
      ["GET", "/v1/bouldering/sessions"],
      ["GET", "/v1/bouldering/sessions/active"],
      ["GET", `/v1/bouldering/sessions/${id}`],
      ["POST", `/v1/bouldering/sessions/${id}/finish`],
      ["DELETE", `/v1/bouldering/sessions/${id}`],
      ["POST", `/v1/bouldering/sessions/${id}/ascents`],
      ["PUT", `/v1/bouldering/ascents/${id}`],
      ["DELETE", `/v1/bouldering/ascents/${id}`],
      ["GET", "/v1/bouldering/progress"],
      ["GET", "/v1/bouldering/projects"],
      ["POST", `/v1/bouldering/projects/${id}/archive`],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: asA,
        ...(method === "POST" || method === "PUT" ? { payload: {} } : {}),
      });
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe("FEATURE_DISABLED");
    }
  });

  it("pages history with an opaque keyset cursor", async () => {
    const { app } = setup();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const s = (await start(app)).json().session;
      ids.push(s.id);
      await finish(app, s.id);
      await tick();
    }
    const page1 = await app.inject({
      method: "GET",
      url: "/v1/bouldering/sessions?limit=2",
      headers: asA,
    });
    expect(page1.json().sessions.map((s: { id: string }) => s.id)).toEqual([
      ids[2],
      ids[1],
    ]);
    const cursor = page1.json().nextCursor;
    expect(typeof cursor).toBe("string");
    const page2 = await app.inject({
      method: "GET",
      url: `/v1/bouldering/sessions?limit=2&cursor=${cursor}`,
      headers: asA,
    });
    expect(page2.json()).toEqual({
      sessions: [expect.objectContaining({ id: ids[0] })],
      nextCursor: null,
    });
    for (const bad of [
      "abc|def",
      Buffer.from("not-a-date|nope").toString("base64url"),
      Buffer.from(`2026-01-01T00:00:00Z|${ids[0]}|x`).toString("base64url"),
    ])
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/v1/bouldering/sessions?cursor=${encodeURIComponent(bad)}`,
            headers: asA,
          })
        ).statusCode,
      ).toBe(400);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/bouldering/sessions?limit=0",
          headers: asA,
        })
      ).statusCode,
    ).toBe(400);
  });

  it("reports progress by window", async () => {
    const { app, workouts } = setup();
    const seed = (daysAgo: number) => {
      const id = crypto.randomUUID();
      const at = new Date(Date.now() - daysAgo * 86_400_000);
      workouts.__seedForTest({
        id,
        userId: A,
        clientOperationId: crypto.randomUUID(),
        name: "Bouldering",
        notes: null,
        source: "manual",
        startedAt: at,
        completedAt: new Date(at.getTime() + 3_600_000),
        details: {
          activityType: "bouldering",
          workoutLifecycle: { kind: "session" },
          boulderSession: {
            version: 1,
            gradeScale: "font",
            recordingTimezone: "UTC",
            activityDate: shiftDate(-daysAgo),
            gymName: null,
          },
        },
        createdAt: at,
        updatedAt: at,
      });
      return id;
    };
    const old = seed(200);
    const mid = seed(60);
    await log(app, old, { grade: "7A", result: "sent" });
    await log(app, mid, { grade: "6C", result: "flash", attempts: 1 });
    const recent = (await start(app)).json().session;
    await log(app, recent.id, { grade: "6A", result: "sent" });
    await log(app, recent.id, { grade: "6A", result: "not_yet" });
    await finish(app, recent.id);

    const progress = async (window?: string) =>
      (
        await app.inject({
          method: "GET",
          url: `/v1/bouldering/progress${window ? `?window=${window}` : ""}`,
          headers: asA,
        })
      ).json();
    const d30 = await progress("30d");
    expect(d30.window).toBe("30d");
    expect(d30.pyramid).toEqual([
      { gradeRank: 5, grade: "6A", sends: 1, flashes: 0 },
    ]);
    expect(d30.totals).toEqual({ sessions: 1, sends: 1, flashes: 0 });
    expect(d30.timeline).toEqual([
      {
        sessionId: recent.id,
        activityDate: shiftDate(0),
        topGrade: "6A",
        personalBest: false,
      },
    ]);
    const d90 = await progress();
    expect(d90.window).toBe("90d");
    expect(d90.totals).toEqual({ sessions: 2, sends: 2, flashes: 1 });
    const all = await progress("all");
    expect(all.pyramid.map((r: { grade: string }) => r.grade)).toEqual([
      "7A",
      "6C",
      "6A",
    ]);
    expect(all.totals).toEqual({ sessions: 3, sends: 3, flashes: 1 });
    expect(all.timeline.map((t: { sessionId: string }) => t.sessionId)).toEqual(
      [old, mid, recent.id],
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/bouldering/progress?window=7d",
          headers: asA,
        })
      ).statusCode,
    ).toBe(400);
  });

  it("lists the sends behind one grade row, owner-only", async () => {
    const { app } = setup();
    const first = (await start(app, asA, { gymName: "North Wall" })).json()
      .session;
    const sent = await log(app, first.id, {
      grade: "6A+",
      result: "sent",
      attempts: 3,
      holdColour: "blue",
      note: "Slab",
    });
    await log(app, first.id, { grade: "6A+", result: "not_yet" });
    await log(app, first.id, { grade: "6B", result: "flash", attempts: 1 });
    await finish(app, first.id);
    await tick();
    const second = (await start(app)).json().session;
    const flash = await log(app, second.id, {
      grade: "6a+",
      result: "flash",
      attempts: 1,
    });
    await finish(app, second.id);
    // B's same-grade send never appears in A's list.
    const other = (await start(app, asB)).json().session;
    await log(app, other.id, { grade: "6A+", result: "sent" }, asB);

    const grade = (query: string, headers = asA) =>
      app.inject({
        method: "GET",
        url: `/v1/bouldering/progress/grade?${query}`,
        headers,
      });
    const res = await grade("window=30d&grade=6A%2B");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ window: "30d", grade: "6A+" });
    expect(
      body.sends.map((s: { ascent: { id: string } }) => s.ascent.id),
    ).toEqual([flash.json().ascent.id, sent.json().ascent.id]);
    expect(body.sends[1]).toMatchObject({
      activityDate: shiftDate(0),
      gymName: "North Wall",
      ascent: { holdColour: "blue", note: "Slab", attempts: 3 },
    });
    expect(body.sends[0].gymName).toBeNull();
    // Matches the pyramid row it opens from.
    const progress = (
      await app.inject({
        method: "GET",
        url: "/v1/bouldering/progress?window=30d",
        headers: asA,
      })
    ).json();
    expect(
      progress.pyramid.find((r: { grade: string }) => r.grade === "6A+"),
    ).toMatchObject({ sends: body.sends.length, flashes: 1 });

    // Lowercase is normalised; an unencoded "+" (a space) is rejected, not read as 6A.
    expect((await grade("window=30d&grade=6a%2b")).json().grade).toBe("6A+");
    expect((await grade("window=30d&grade=6A+")).statusCode).toBe(400);
    expect((await grade("window=all&grade=7C", asB)).json()).toEqual({
      window: "all",
      grade: "7C",
      sends: [],
    });
    expect((await grade("grade=9Z")).statusCode).toBe(400);
    expect((await grade("window=30d")).statusCode).toBe(400);
    expect((await grade("grade=6A&window=7d")).statusCode).toBe(400);
    expect((await grade("grade=6A&extra=1")).statusCode).toBe(400);
    expect((await grade("grade=6A", {} as typeof asA)).statusCode).toBe(401);
  });

  it("answers 503 for a stored session whose details fail the contract", async () => {
    const { app, workouts } = setup();
    const id = crypto.randomUUID();
    const now = new Date();
    workouts.__seedForTest({
      id,
      userId: A,
      clientOperationId: crypto.randomUUID(),
      name: "Bouldering",
      notes: null,
      source: "manual",
      startedAt: now,
      completedAt: now,
      details: { activityType: "bouldering", boulderSession: { version: 2 } },
      createdAt: now,
      updatedAt: now,
    });
    const response = await app.inject({
      method: "GET",
      url: `/v1/bouldering/sessions/${id}`,
      headers: asA,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("SERVICE_UNAVAILABLE");
  });
});

describe("bouldering boundaries with strength routes and account export", () => {
  it("keeps sessions out of legacy workout lists and generic mutations", async () => {
    const { app } = setup();
    const session = (await start(app)).json().session;
    const sent = await log(app, session.id, {
      grade: "6B",
      result: "flash",
      attempts: 1,
    });
    expect(sent.statusCode).toBe(201);

    const legacy = await app.inject({
      method: "GET",
      url: "/v1/workouts",
      headers: asA,
    });
    expect(legacy.statusCode).toBe(200);
    expect(
      legacy.json().workouts.map((w: { id: string }) => w.id),
    ).not.toContain(session.id);

    const patched = await app.inject({
      method: "PUT",
      url: `/v1/workouts/${session.id}`,
      headers: asA,
      payload: { name: "Strength", details: {} },
    });
    expect(patched.statusCode).toBe(409);
    const removed = await app.inject({
      method: "DELETE",
      url: `/v1/workouts/${session.id}`,
      headers: asA,
    });
    expect(removed.statusCode).toBe(409);
    const set = await app.inject({
      method: "POST",
      url: `/v1/workouts/${session.id}/sets`,
      headers: asA,
      payload: {
        exerciseId: crypto.randomUUID(),
        sequence: 1,
        repetitions: 5,
      },
    });
    expect(set.statusCode).toBe(404);

    const still = await app.inject({
      method: "GET",
      url: `/v1/bouldering/sessions/${session.id}`,
      headers: asA,
    });
    expect(still.json().session.name).toBe("Bouldering");
    expect(still.json().ascents).toHaveLength(1);
  });

  it("exports sessions, boulders and receipts, with tombstones after removal", async () => {
    const { app } = setup();
    const session = (await start(app)).json().session;
    const ascent = (
      await log(app, session.id, { grade: "7A", result: "not_yet" })
    ).json().ascent;
    const exported = await app.inject({
      method: "GET",
      url: "/v1/account/export",
      headers: asA,
    });
    expect(exported.statusCode).toBe(200);
    const doc = exported.json().export;
    expect(
      doc.workouts.some(
        (w: { id: string; details: Record<string, unknown> }) =>
          w.id === session.id && w.details.activityType === "bouldering",
      ),
    ).toBe(true);
    expect(doc.bouldering.ascents).toHaveLength(1);
    expect(doc.bouldering.receipts.length).toBeGreaterThanOrEqual(2);

    await app.inject({
      method: "DELETE",
      url: `/v1/bouldering/ascents/${ascent.id}`,
      headers: asA,
    });
    const after = (
      await app.inject({
        method: "GET",
        url: "/v1/account/export",
        headers: asA,
      })
    ).json().export;
    expect(after.bouldering.ascents).toHaveLength(0);
    expect(
      after.bouldering.receipts.some(
        (r: Record<string, unknown>) => r.deleted === true,
      ),
    ).toBe(true);
    const other = (
      await app.inject({
        method: "GET",
        url: "/v1/account/export",
        headers: asB,
      })
    ).json().export;
    expect(other.bouldering.ascents).toHaveLength(0);
    expect(other.bouldering.receipts).toHaveLength(0);
  });
});

describe("bouldering review regressions", () => {
  it("excludes bouldering from legacy lists before the page limit", async () => {
    const { app } = setup();
    const strength = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: asA,
      payload: {
        name: "Push",
        startedAt: new Date(Date.now() - 86_400_000).toISOString(),
      },
    });
    expect(strength.statusCode).toBe(200);
    for (let i = 0; i < 3; i += 1) {
      const id = (await start(app)).json().session.id;
      expect((await finish(app, id)).statusCode).toBe(200);
      await tick();
    }
    const page = await app.inject({
      method: "GET",
      url: "/v1/workouts?limit=2",
      headers: asA,
    });
    expect(page.statusCode).toBe(200);
    expect(page.json().workouts.map((w: { id: string }) => w.id)).toEqual([
      strength.json().workout.id,
    ]);
  });

  it("finishes a session after one of its boulders was deleted", async () => {
    const { app } = setup();
    const session = (await start(app)).json().session;
    const ascent = (
      await log(app, session.id, { grade: "5+", result: "sent", attempts: 2 })
    ).json().ascent;
    await app.inject({
      method: "DELETE",
      url: `/v1/bouldering/ascents/${ascent.id}`,
      headers: asA,
    });
    expect((await finish(app, session.id)).statusCode).toBe(200);
  });

  it("answers BOULDER_REMOVED for new writes against a deleted session", async () => {
    const { app } = setup();
    const session = (await start(app)).json().session;
    await app.inject({
      method: "DELETE",
      url: `/v1/bouldering/sessions/${session.id}`,
      headers: asA,
    });
    const created = await log(app, session.id, {
      grade: "6A",
      result: "flash",
      attempts: 1,
    });
    expect(created.statusCode).toBe(410);
    expect(created.json().error.code).toBe("BOULDER_REMOVED");
    const finished = await finish(app, session.id);
    expect(finished.statusCode).toBe(410);
  });

  it("erases sessions, boulders and receipts with the account", async () => {
    const { app } = setup();
    const session = (await start(app)).json().session;
    await log(app, session.id, { grade: "6A", result: "flash", attempts: 1 });
    const challenge = await app.inject({
      method: "POST",
      url: "/v1/account/delete/request",
      headers: asA,
    });
    expect(challenge.statusCode).toBe(200);
    const deleted = await app.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: { ...asA, "content-type": "application/json" },
      payload: { confirmationToken: challenge.json().confirmationToken },
    });
    expect(deleted.statusCode).toBeLessThan(300);
    const after = (
      await app.inject({
        method: "GET",
        url: "/v1/account/export",
        headers: asA,
      })
    ).json().export;
    expect(
      after.workouts.filter(
        (w: { details: Record<string, unknown> }) =>
          w.details.activityType === "bouldering",
      ),
    ).toHaveLength(0);
    expect(after.bouldering.ascents).toHaveLength(0);
    expect(after.bouldering.receipts).toHaveLength(0);
  });
});

describe("bouldering projects", () => {
  const projects = (app: App, status = "open", headers = asA) =>
    app.inject({
      method: "GET",
      url: `/v1/bouldering/projects?status=${status}`,
      headers,
    });
  const archive = (app: App, id: string, archived: boolean, headers = asA) =>
    app.inject({
      method: "POST",
      url: `/v1/bouldering/projects/${id}/archive`,
      headers,
      payload: { archived },
    });
  const removeAscent = (app: App, id: string, headers = asA) =>
    app.inject({
      method: "DELETE",
      url: `/v1/bouldering/ascents/${id}`,
      headers,
    });
  /** Starts, logs and finishes one session; returns the logged ascents. */
  const session = async (
    app: App,
    boulders: Record<string, unknown>[],
    headers = asA,
  ) => {
    const id = (await start(app, headers)).json().session.id as string;
    const ascents = [];
    for (const body of boulders) {
      const res = await log(app, id, body, headers);
      expect(res.statusCode).toBe(201);
      ascents.push(res.json().ascent);
      await tick();
    }
    expect((await finish(app, id, headers)).statusCode).toBe(200);
    return { id, ascents };
  };

  it("opens a project for a not-yet boulder but not for a send", async () => {
    const { app } = setup();
    const { ascents } = await session(app, [
      { grade: "6b", result: "not_yet", attempts: 3, holdColour: "blue" },
      { grade: "6A", result: "sent", attempts: 2 },
    ]);
    expect(ascents[0].projectId).toEqual(expect.any(String));
    expect(ascents[1].projectId).toBeNull();
    const listed = await projects(app);
    expect(listed.statusCode).toBe(200);
    expect(listed.json().projects).toEqual([
      expect.objectContaining({
        id: ascents[0].projectId,
        grade: "6B",
        gradeRank: 7,
        holdColour: "blue",
        status: "open",
        attempts: 3,
        attemptsComplete: true,
        sessions: 1,
        sentAfterSessions: null,
        sentAt: null,
        older: false,
      }),
    ]);
    expect((await projects(app, "sent")).json().projects).toEqual([]);
    expect((await projects(app, "bogus")).statusCode).toBe(400);
  });

  it("links Try again and reports sent after N distinct sessions", async () => {
    const { app } = setup();
    const first = await session(app, [
      { grade: "7A", result: "not_yet", attempts: 4 },
    ]);
    const projectId = first.ascents[0].projectId as string;
    await session(app, [
      { grade: "7A", result: "not_yet", attempts: 3, projectId },
      { grade: "7A", result: "not_yet", attempts: 2, projectId },
    ]);
    // An unrelated not-yet in between opens its own project; no auto-matching.
    const unrelated = await session(app, [{ grade: "7A", result: "not_yet" }]);
    expect(unrelated.ascents[0].projectId).not.toBe(projectId);
    const sending = await session(app, [
      { grade: "7A", result: "sent", attempts: 2, projectId },
    ]);
    expect(sending.ascents[0].projectId).toBe(projectId);

    const sent = (await projects(app, "sent")).json().projects;
    expect(sent).toEqual([
      expect.objectContaining({
        id: projectId,
        status: "sent",
        sentAscentId: sending.ascents[0].id,
        sentAt: sending.ascents[0].loggedAt,
        attempts: 11,
        sessions: 3,
        sentAfterSessions: 3,
        lastTriedAt: sending.ascents[0].loggedAt,
      }),
    ]);
    const open = (await projects(app)).json().projects;
    expect(open.map((p: { id: string }) => p.id)).toEqual([
      unrelated.ascents[0].projectId,
    ]);
    expect((await projects(app, "all")).json().projects).toHaveLength(2);

    // A sent project can no longer be linked.
    const later = (await start(app)).json().session.id;
    const relink = await log(app, later, {
      grade: "7A",
      result: "not_yet",
      projectId,
    });
    expect(relink.statusCode).toBe(409);
    expect(relink.json().error.code).toBe("BOULDER_PROJECT_UNAVAILABLE");

    // Deleting the sending boulder reopens the project.
    expect((await removeAscent(app, sending.ascents[0].id)).statusCode).toBe(
      200,
    );
    const reopened = (await projects(app)).json().projects;
    expect(reopened).toContainEqual(
      expect.objectContaining({
        id: projectId,
        status: "open",
        sentAt: null,
        sentAscentId: null,
        sentAfterSessions: null,
        sessions: 2,
        attempts: 9,
      }),
    );
  });

  it("removes a project whose only boulder is deleted, and when its session is deleted", async () => {
    const { app } = setup();
    const one = await session(app, [{ grade: "6C", result: "not_yet" }]);
    expect((await projects(app)).json().projects).toHaveLength(1);
    expect((await removeAscent(app, one.ascents[0].id)).statusCode).toBe(200);
    expect((await projects(app, "all")).json().projects).toEqual([]);

    const two = await session(app, [{ grade: "6C", result: "not_yet" }]);
    const projectId = two.ascents[0].projectId as string;
    const kept = await session(app, [
      { grade: "6C+", result: "not_yet", projectId },
    ]);
    await app.inject({
      method: "DELETE",
      url: `/v1/bouldering/sessions/${two.id}`,
      headers: asA,
    });
    // The remaining boulder now defines the project's grade and first try.
    expect((await projects(app)).json().projects).toEqual([
      expect.objectContaining({
        id: projectId,
        grade: "6C+",
        firstLoggedAt: kept.ascents[0].loggedAt,
        sessions: 1,
      }),
    ]);
    await app.inject({
      method: "DELETE",
      url: `/v1/bouldering/sessions/${kept.id}`,
      headers: asA,
    });
    expect((await projects(app, "all")).json().projects).toEqual([]);
  });

  it("marks a project sent when a linked boulder is edited to a send, and keeps the link", async () => {
    const { app } = setup();
    const { ascents } = await session(app, [
      { grade: "6B+", result: "not_yet", attempts: 2 },
    ]);
    const ascent = ascents[0];
    const edited = await app.inject({
      method: "PUT",
      url: `/v1/bouldering/ascents/${ascent.id}`,
      headers: asA,
      payload: {
        clientOperationId: op(),
        expectedRevision: ascent.revision,
        grade: "6B+",
        result: "sent",
        attempts: 3,
      },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().ascent.projectId).toBe(ascent.projectId);
    expect((await projects(app, "sent")).json().projects).toEqual([
      expect.objectContaining({
        id: ascent.projectId,
        status: "sent",
        sentAscentId: ascent.id,
        sentAfterSessions: 1,
      }),
    ]);
    // Edits cannot relink a boulder.
    const relink = await app.inject({
      method: "PUT",
      url: `/v1/bouldering/ascents/${ascent.id}`,
      headers: asA,
      payload: {
        clientOperationId: op(),
        expectedRevision: edited.json().ascent.revision,
        grade: "6B+",
        result: "sent",
        attempts: 3,
        projectId: null,
      },
    });
    expect(relink.statusCode).toBe(400);
  });

  it("archives and reopens, keeps archived on a not-yet retry, and refuses sent projects", async () => {
    const { app } = setup();
    const { ascents } = await session(app, [
      { grade: "7B", result: "not_yet" },
    ]);
    const projectId = ascents[0].projectId as string;
    const archived = await archive(app, projectId, true);
    expect(archived.statusCode).toBe(200);
    expect(archived.json().project).toMatchObject({
      id: projectId,
      status: "archived",
    });
    expect((await projects(app)).json().projects).toEqual([]);
    expect((await projects(app, "archived")).json().projects).toHaveLength(1);
    // Archiving again is idempotent.
    expect((await archive(app, projectId, true)).json().project.status).toBe(
      "archived",
    );

    // Try again on an archived project links it and it stays archived.
    const retry = await session(app, [
      { grade: "7B", result: "not_yet", projectId },
    ]);
    expect(retry.ascents[0].projectId).toBe(projectId);
    expect((await projects(app, "archived")).json().projects).toEqual([
      expect.objectContaining({ id: projectId, sessions: 2 }),
    ]);

    const reopened = await archive(app, projectId, false);
    expect(reopened.json().project.status).toBe("open");

    await session(app, [
      { grade: "7B", result: "sent", attempts: 2, projectId },
    ]);
    const refused = await archive(app, projectId, true);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe("CONFLICT");

    expect((await archive(app, crypto.randomUUID(), true)).statusCode).toBe(
      404,
    );
    expect((await archive(app, "not-a-uuid", true)).statusCode).toBe(400);
    const badBody = await app.inject({
      method: "POST",
      url: `/v1/bouldering/projects/${projectId}/archive`,
      headers: asA,
      payload: { archived: "yes" },
    });
    expect(badBody.statusCode).toBe(400);
  });

  it("keeps projects owner-only for list, archive and linking", async () => {
    const { app } = setup();
    const { ascents } = await session(app, [
      { grade: "6A", result: "not_yet" },
    ]);
    const projectId = ascents[0].projectId as string;
    expect((await projects(app, "all", asB)).json().projects).toEqual([]);
    expect((await archive(app, projectId, true, asB)).statusCode).toBe(404);
    const bSession = (await start(app, asB)).json().session.id;
    const linked = await log(
      app,
      bSession,
      { grade: "6A", result: "not_yet", projectId },
      asB,
    );
    expect(linked.statusCode).toBe(409);
    expect(linked.json().error.code).toBe("BOULDER_PROJECT_UNAVAILABLE");
    // A's project is untouched.
    expect((await projects(app)).json().projects).toEqual([
      expect.objectContaining({ id: projectId, status: "open", sessions: 1 }),
    ]);
  });

  it("includes the project in the create digest so a changed link is a conflict", async () => {
    const { app } = setup();
    const { ascents } = await session(app, [
      { grade: "6A", result: "not_yet" },
    ]);
    const projectId = ascents[0].projectId as string;
    const id = (await start(app)).json().session.id;
    const body = {
      clientOperationId: op(),
      grade: "6A",
      result: "not_yet",
      projectId,
    };
    const first = await app.inject({
      method: "POST",
      url: `/v1/bouldering/sessions/${id}/ascents`,
      headers: asA,
      payload: body,
    });
    expect(first.statusCode).toBe(201);
    const replay = await app.inject({
      method: "POST",
      url: `/v1/bouldering/sessions/${id}/ascents`,
      headers: asA,
      payload: body,
    });
    expect(replay.json().ascent.id).toBe(first.json().ascent.id);
    const changed = await app.inject({
      method: "POST",
      url: `/v1/bouldering/sessions/${id}/ascents`,
      headers: asA,
      payload: { ...body, projectId: null },
    });
    expect(changed.statusCode).toBe(409);
  });

  it("exports projects and the ascent links, and erases them with the account", async () => {
    const { app, bouldering } = setup();
    const { ascents } = await session(app, [
      { grade: "6A", result: "not_yet" },
    ]);
    const doc = (
      await app.inject({
        method: "GET",
        url: "/v1/account/export",
        headers: asA,
      })
    ).json().export;
    expect(doc.bouldering.projects).toEqual([
      expect.objectContaining({
        id: ascents[0].projectId,
        user_id: A,
        grade_code: "6A",
        status: "open",
      }),
    ]);
    expect(doc.bouldering.ascents[0].project_id).toBe(ascents[0].projectId);
    const other = (
      await app.inject({
        method: "GET",
        url: "/v1/account/export",
        headers: asB,
      })
    ).json().export;
    expect(other.bouldering.projects).toEqual([]);
    await bouldering.clearForUser(A);
    expect(
      await bouldering.listProjects(A, { accessToken: "A", status: "all" }),
    ).toEqual([]);
  });
});

describe("bouldering project review regressions", () => {
  it("refuses a flash linked to a project and keeps unlinked digests stable", async () => {
    const { app } = setup();
    const id = (await start(app)).json().session.id;
    const first = (
      await log(app, id, { grade: "7A", result: "not_yet" })
    ).json().ascent;
    const flash = await log(app, id, {
      grade: "7A",
      result: "flash",
      attempts: 1,
      projectId: first.projectId,
    });
    expect(flash.statusCode).toBe(400);
    const opId = crypto.randomUUID();
    const body = {
      clientOperationId: opId,
      grade: "6A",
      result: "sent",
      attempts: 2,
    };
    const once = await app.inject({
      method: "POST",
      url: `/v1/bouldering/sessions/${id}/ascents`,
      headers: asA,
      payload: body,
    });
    const replay = await app.inject({
      method: "POST",
      url: `/v1/bouldering/sessions/${id}/ascents`,
      headers: asA,
      payload: { ...body, projectId: null },
    });
    expect(replay.json().ascent.id).toBe(once.json().ascent.id);
  });
});
