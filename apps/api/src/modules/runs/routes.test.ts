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
const setup = () => {
  const workouts = new InMemoryWorkoutRepository();
  const runs = new InMemoryRunRepository(workouts);
  const make = () => {
    const app = buildApp({
      workoutRepository: workouts,
      runRepository: runs,
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
