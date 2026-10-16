import { afterEach, describe, expect, it } from "vitest";
import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import { InMemoryMemoryStore } from "@mizyun/memory";
import type { UserId } from "@mizyun/core";
import { buildApp } from "../../app.js";
import { InMemoryWorkoutRepository } from "../../workout-repository.js";
import { InMemoryRunRepository } from "../../run-repository.js";
const A = "00000000-0000-4000-8000-000000000001" as UserId;
const B = "00000000-0000-4000-8000-000000000002" as UserId;
const OP = "00000000-0000-4000-8000-000000000003";
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});
const setup = (runHealthImportsEnabled = false) => {
  const workouts = new InMemoryWorkoutRepository();
  const runs = new InMemoryRunRepository(workouts);
  const make = () => {
    const app = buildApp({
      workoutRepository: workouts,
      runRepository: runs,
      runHealthImportsEnabled,
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
  return { app: make(), make, workouts };
};
const payload = {
  clientOperationId: OP,
  activityDate: "2026-10-01",
  recordingTimezone: "Pacific/Kiritimati",
  durationSeconds: 1800,
  distanceMeters: 5000,
};
const headers = { authorization: "Bearer A" };
describe("manual running mutations", () => {
  it("concurrent taps and an API restart replay one accepted run, preserving date-only precision", async () => {
    const { app, make } = setup();
    const results = await Promise.all([
      app.inject({ method: "POST", url: "/v1/runs", headers, payload }),
      app.inject({ method: "POST", url: "/v1/runs", headers, payload }),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(results[0]!.json().run.id).toBe(results[1]!.json().run.id);
    const replay = await make().inject({
      method: "POST",
      url: "/v1/runs",
      headers,
      payload,
    });
    expect(replay.json().run.id).toBe(results[0]!.json().run.id);
    expect(replay.json().run.summary).toMatchObject({
      activityDate: "2026-10-01",
      startedAt: null,
      timePrecision: "day",
      timestampEnvelope: "date_anchor",
    });
    const conflict = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers,
      payload: { ...payload, durationSeconds: 1801 },
    });
    expect(conflict.statusCode).toBe(409);
  });
  it("cancel-before-create and lost delete response prevent delayed create resurrection", async () => {
    const { app } = setup();
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/v1/runs/operations/${OP}`,
          headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "POST", url: "/v1/runs", headers, payload }))
        .statusCode,
    ).toBe(409);
    const fresh = { ...payload, clientOperationId: crypto.randomUUID() };
    const created = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers,
      payload: fresh,
    });
    const id = created.json().run.id;
    for (let i = 0; i < 2; i++)
      expect(
        (await app.inject({ method: "DELETE", url: `/v1/runs/${id}`, headers }))
          .statusCode,
      ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/runs",
          headers,
          payload: fresh,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await app.inject({ method: "GET", url: "/v1/runs", headers })).json()
        .runs,
    ).toEqual([]);
  });
  it("edits use CAS and replay acknowledgement cannot overwrite a newer edit", async () => {
    const { app } = setup();
    const created = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers,
      payload,
    });
    const id = created.json().run.id;
    const edit = {
      ...payload,
      clientOperationId: crypto.randomUUID(),
      expectedRevision: 1,
      durationSeconds: 1900,
    };
    const first = await app.inject({
      method: "PUT",
      url: `/v1/runs/${id}`,
      headers,
      payload: edit,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().run.summary.revision).toBe(2);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/v1/runs/${id}`,
          headers,
          payload: edit,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/v1/runs/${id}`,
          headers,
          payload: { ...edit, clientOperationId: crypto.randomUUID() },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/v1/runs/${id}`,
          headers,
          payload: {
            ...edit,
            clientOperationId: crypto.randomUUID(),
            expectedRevision: 2,
            durationSeconds: 2000,
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/v1/runs/${id}`,
          headers,
          payload: edit,
        })
      ).statusCode,
    ).toBe(409);
  });
  it("isolates accounts, excludes runs before legacy limits and denies generic mutations", async () => {
    const { app, workouts } = setup();
    const created = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers,
      payload,
    });
    const id = created.json().run.id;
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/runs/${id}`,
          headers: { authorization: "Bearer B" },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/runs",
          headers: { authorization: "Bearer B" },
        })
      ).json().runs,
    ).toEqual([]);
    workouts.__seedForTest({
      id: crypto.randomUUID(),
      userId: A,
      name: "Older strength",
      startedAt: new Date("2020-01-01"),
      completedAt: new Date("2020-01-01"),
      notes: null,
      source: "manual",
      details: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const legacy = await app.inject({
      method: "GET",
      url: "/v1/workouts?limit=1",
      headers,
    });
    expect(legacy.json().workouts.map((w: { name: string }) => w.name)).toEqual(
      ["Older strength"],
    );
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/v1/workouts/${id}`,
          headers,
          payload: { notes: "bypass" },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/v1/workouts/${id}`,
          headers,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/workouts/${id}/sets`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/workouts",
          headers,
          payload: {
            name: "Bypass",
            details: { activityType: "running", runSummary: {} },
          },
        })
      ).statusCode,
    ).toBe(409);
  });
  it("filters activity dates before stable cursor pagination and allows missing distance", async () => {
    const { app } = setup();
    for (let i = 0; i < 3; i++)
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/runs",
            headers,
            payload: {
              ...payload,
              clientOperationId: crypto.randomUUID(),
              distanceMeters: null,
            },
          })
        ).statusCode,
      ).toBe(200);
    const page = (
      await app.inject({
        method: "GET",
        url: "/v1/runs?from=2026-10-01&to=2026-10-01&limit=2",
        headers,
      })
    ).json();
    expect(page.runs).toHaveLength(2);
    const rest = (
      await app.inject({
        method: "GET",
        url: `/v1/runs?from=2026-10-01&to=2026-10-01&limit=2&cursor=${page.nextCursor}`,
        headers,
      })
    ).json();
    expect(rest.runs).toHaveLength(1);
    expect(rest.nextCursor).toBeNull();
    expect(new Set([...page.runs, ...rest.runs].map((r) => r.id)).size).toBe(3);
  });
  it("rejects future completed records, metadata forgery and invalid metrics", async () => {
    const { app } = setup();
    for (const patch of [
      { distanceMeters: 0 },
      { durationSeconds: 0 },
      { activityDate: "2099-01-01" },
      { revision: 42 },
      { activityDate: "2026-02-30" },
      { startedAt: new Date(Date.now() + 60000).toISOString() },
    ])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/runs",
            headers,
            payload: { ...payload, ...patch },
          })
        ).statusCode,
      ).toBe(422);
    expect(
      (await app.inject({ method: "POST", url: "/v1/runs", payload }))
        .statusCode,
    ).toBe(401);
  });
});
const healthRun = {
  clientOperationId: "00000000-0000-4000-8000-000000000010",
  provider: "apple_health",
  sourceAppId: "com.apple.health.watch",
  sourceAppName: "Apple Watch",
  externalId: "HK-0001",
  startedAt: "2026-10-01T22:30:00Z",
  recordingTimezone: "Europe/Bratislava",
  durationSeconds: 1800,
  durationBasis: "active",
  distanceMeters: 5012.37,
  environment: "outdoor",
};
const importRun = (
  app: ReturnType<typeof buildApp>,
  body: Record<string, unknown> = healthRun,
  auth = headers,
) =>
  app.inject({
    method: "POST",
    url: "/v1/runs/imports",
    headers: auth,
    payload: body,
  });
describe("Health running imports", () => {
  it("is not available outside Dev, while existing imports stay readable", async () => {
    const enabled = setup(true);
    const created = await importRun(enabled.app);
    expect(created.statusCode).toBe(201);
    const disabledApp = buildApp({
      workoutRepository: enabled.workouts,
      runRepository: new InMemoryRunRepository(enabled.workouts),
      runHealthImportsEnabled: false,
      tokenVerifier: {
        verify: async (token) =>
          token === "A"
            ? { userId: A, accessToken: token, role: "authenticated" }
            : null,
      },
      agent: new AgentOrchestrator({
        provider: new DisabledAgentProvider(),
        memories: new InMemoryMemoryStore(),
      }),
    });
    apps.push(disabledApp);
    expect(
      (
        await importRun(disabledApp, {
          ...healthRun,
          clientOperationId: crypto.randomUUID(),
          externalId: "HK-0002",
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await disabledApp.inject({
          method: "POST",
          url: "/v1/runs/imports",
          payload: healthRun,
        })
      ).statusCode,
    ).toBe(404);
    const listed = await disabledApp.inject({
      method: "GET",
      url: "/v1/runs?include=imports",
      headers,
    });
    expect(listed.json().runs).toHaveLength(1);
    const id = created.json().run.id;
    expect(
      (
        await disabledApp.inject({
          method: "DELETE",
          url: `/v1/runs/${id}`,
          headers,
        })
      ).statusCode,
    ).toBe(200);
  });
  it("creates once, replays a lost response and returns an existing copy for a new operation", async () => {
    const { app, make } = setup(true);
    const [first, second] = await Promise.all([importRun(app), importRun(app)]);
    expect([first!.statusCode, second!.statusCode]).toEqual([201, 201]);
    const run = first!.json().run;
    expect(second!.json().run.id).toBe(run.id);
    expect(first!.json().created).toBe(true);
    expect(run).toMatchObject({
      name: "Run",
      notes: null,
      summary: {
        activityDate: "2026-10-02",
        timePrecision: "instant",
        startedAt: "2026-10-01T22:30:00Z",
        durationBasis: "active",
        perceivedExertion: null,
        revision: 1,
        origin: {
          kind: "health_import",
          provider: "apple_health",
          sourceAppId: "com.apple.health.watch",
          sourceAppName: "Apple Watch",
          externalId: "HK-0001",
        },
      },
    });
    const again = await importRun(make(), {
      ...healthRun,
      clientOperationId: crypto.randomUUID(),
      durationSeconds: 1700,
    });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ created: false, run: { id: run.id } });
    expect(again.json().run.summary.durationSeconds).toBe(1800);
    expect(
      (await importRun(app, { ...healthRun, durationSeconds: 1700 }))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/runs",
          headers,
          payload: {
            ...payload,
            clientOperationId: healthRun.clientOperationId,
          },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await importRun(app, healthRun, { authorization: "Bearer B" }))
        .statusCode,
    ).toBe(201);
  });
  it("rejects invalid, future and forged imports", async () => {
    const { app } = setup(true);
    for (const patch of [
      { provider: "garmin" },
      { externalId: "" },
      { externalId: "x".repeat(256) },
      { durationBasis: "moving" },
      { startedAt: null },
      { startedAt: new Date(Date.now() - 60_000).toISOString() },
      { recordingTimezone: "Mars/Olympus" },
      { distanceMeters: 0 },
      { activityDate: "2026-10-01" },
      { name: "Forged" },
      { perceivedExertion: 5 },
      { origin: { kind: "manual" } },
    ])
      expect(
        (
          await importRun(app, {
            ...healthRun,
            clientOperationId: crypto.randomUUID(),
            ...patch,
          })
        ).statusCode,
      ).toBe(422);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/runs/imports",
          payload: healthRun,
        })
      ).statusCode,
    ).toBe(401);
  });
  it("lists imports only on request and keeps provider metrics read-only on edit", async () => {
    const { app } = setup(true);
    await app.inject({ method: "POST", url: "/v1/runs", headers, payload });
    const id = (await importRun(app)).json().run.id;
    const plain = await app.inject({ method: "GET", url: "/v1/runs", headers });
    expect(
      plain
        .json()
        .runs.map((r: { summary: { origin: unknown } }) => r.summary.origin),
    ).toEqual([{ kind: "manual" }]);
    const all = await app.inject({
      method: "GET",
      url: "/v1/runs?include=imports",
      headers,
    });
    expect(all.json().runs).toHaveLength(2);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/runs?include=everything",
          headers,
        })
      ).statusCode,
    ).toBe(422);
    const edit = {
      clientOperationId: crypto.randomUUID(),
      expectedRevision: 1,
      activityDate: "2026-10-02",
      recordingTimezone: "Europe/Bratislava",
      startedAt: "2026-10-02T00:30:00+02:00",
      durationSeconds: 1800,
      distanceMeters: 5012.37,
      environment: "treadmill",
      perceivedExertion: 7,
      name: "Evening run",
      notes: "Felt strong",
    };
    const saved = await app.inject({
      method: "PUT",
      url: `/v1/runs/${id}`,
      headers,
      payload: edit,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().run).toMatchObject({
      name: "Evening run",
      notes: "Felt strong",
      summary: {
        environment: "treadmill",
        perceivedExertion: 7,
        revision: 2,
        startedAt: "2026-10-01T22:30:00Z",
        durationBasis: "active",
        origin: { kind: "health_import", externalId: "HK-0001" },
      },
    });
    for (const patch of [
      { durationSeconds: 1700 },
      { distanceMeters: null },
      { distanceMeters: 5000 },
      { startedAt: "2026-10-01T22:00:00Z" },
      { startedAt: null },
      { activityDate: "2026-10-01" },
      { recordingTimezone: "Europe/Vienna" },
    ])
      expect(
        (
          await app.inject({
            method: "PUT",
            url: `/v1/runs/${id}`,
            headers,
            payload: {
              ...edit,
              clientOperationId: crypto.randomUUID(),
              expectedRevision: 2,
              ...patch,
            },
          })
        ).statusCode,
      ).toBe(422);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/v1/runs/${id}`,
          headers: { authorization: "Bearer B" },
          payload: { ...edit, clientOperationId: crypto.randomUUID() },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "DELETE", url: `/v1/runs/${id}`, headers }))
        .statusCode,
    ).toBe(200);
    const reimported = await importRun(app, {
      ...healthRun,
      clientOperationId: crypto.randomUUID(),
    });
    expect(reimported.statusCode).toBe(201);
    expect(reimported.json().run.id).not.toBe(id);
  });
});
