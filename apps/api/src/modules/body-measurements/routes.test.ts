import { afterEach, describe, expect, it } from "vitest";

import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import type {
  BodyMeasurementSource,
  StoredBodyMeasurement,
  UserId,
} from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";
import { InMemoryMemoryStore } from "@mizyun/memory";

import { buildApp } from "../../app.js";
import { InMemoryBodyMeasurementRepository } from "../../body-measurement-repository.js";

const userA: UserId = "00000000-0000-4000-8000-000000000001" as UserId;
const userB: UserId = "00000000-0000-4000-8000-000000000002" as UserId;

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const tokenVerifierFor = (
  principal: { readonly userId: UserId } | null,
): AccessTokenVerifier => ({
  verify: async (token) =>
    token === "valid"
      ? {
          userId: principal!.userId,
          role: "authenticated",
          accessToken: "test-token",
        }
      : null,
});

const build = (
  verifier: AccessTokenVerifier,
  bodyMeasurementRepository = new InMemoryBodyMeasurementRepository(),
) => {
  const app = buildApp({
    tokenVerifier: verifier,
    agent: new AgentOrchestrator({
      provider: new DisabledAgentProvider(),
      memories: new InMemoryMemoryStore(),
    }),
    bodyMeasurementRepository,
  });
  apps.push(app);
  return { app, bodyMeasurementRepository };
};

const seedMeasurement = (
  repo: InMemoryBodyMeasurementRepository,
  overrides: Partial<StoredBodyMeasurement> = {},
): StoredBodyMeasurement => {
  const measurement: StoredBodyMeasurement = {
    id: "00000000-0000-4000-8000-00000000a001",
    userId: userA,
    measuredAt: new Date("2026-07-10T08:00:00Z"),
    weightKg: 70,
    measurements: {},
    source: "manual" as BodyMeasurementSource,
    createdAt: new Date("2026-07-10T08:00:00Z"),
    ...overrides,
  };
  repo.__seedForTest(measurement);
  return measurement;
};

describe("GET /v1/body-measurements", () => {
  it("returns an empty list for a fresh user", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/body-measurements",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ bodyMeasurements: [] });
  });

  it("returns 401 without a bearer token", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/body-measurements",
    });
    expect(response.statusCode).toBe(401);
  });

  it("returns the verified user's measurements newest-first", async () => {
    const { app, bodyMeasurementRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedMeasurement(bodyMeasurementRepository, {
      id: "00000000-0000-4000-8000-00000000a001",
      measuredAt: new Date("2026-07-10T08:00:00Z"),
    });
    seedMeasurement(bodyMeasurementRepository, {
      id: "00000000-0000-4000-8000-00000000a002",
      measuredAt: new Date("2026-07-12T08:00:00Z"),
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/body-measurements",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    const ids = response
      .json()
      .bodyMeasurements.map((m: { id: string }) => m.id);
    expect(ids).toEqual([
      "00000000-0000-4000-8000-00000000a002",
      "00000000-0000-4000-8000-00000000a001",
    ]);
  });

  it("never returns another user's measurements", async () => {
    const { app, bodyMeasurementRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedMeasurement(bodyMeasurementRepository);
    const { app: appB } = build(tokenVerifierFor({ userId: userB }));
    const response = await appB.inject({
      method: "GET",
      url: "/v1/body-measurements",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ bodyMeasurements: [] });
  });

  it("filters by `from` and `to` inclusive", async () => {
    const { app, bodyMeasurementRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedMeasurement(bodyMeasurementRepository, {
      id: "00000000-0000-4000-8000-00000000a001",
      measuredAt: new Date("2026-07-09T08:00:00Z"),
    });
    seedMeasurement(bodyMeasurementRepository, {
      id: "00000000-0000-4000-8000-00000000a002",
      measuredAt: new Date("2026-07-11T12:00:00Z"),
    });
    seedMeasurement(bodyMeasurementRepository, {
      id: "00000000-0000-4000-8000-00000000a003",
      measuredAt: new Date("2026-07-13T08:00:00Z"),
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/body-measurements?from=2026-07-11&to=2026-07-13",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    const ids = response
      .json()
      .bodyMeasurements.map((m: { id: string }) => m.id);
    expect(ids).toContain("00000000-0000-4000-8000-00000000a002");
    expect(ids).toContain("00000000-0000-4000-8000-00000000a003");
    expect(ids).not.toContain("00000000-0000-4000-8000-00000000a001");
  });

  it("rejects `from > to` with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/body-measurements?from=2026-07-15&to=2026-07-10",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(422);
  });

  it("caps the limit at the maximum page size", async () => {
    const { app, bodyMeasurementRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedMeasurement(bodyMeasurementRepository, {
      id: "00000000-0000-4000-8000-00000000a001",
    });
    seedMeasurement(bodyMeasurementRepository, {
      id: "00000000-0000-4000-8000-00000000a002",
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/body-measurements?limit=1",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().bodyMeasurements).toHaveLength(1);
  });
});

describe("body measurement operation replay", () => {
  const operation = "11111111-1111-4111-8111-111111111111";
  const payload = {
    clientOperationId: operation,
    measuredAt: "2026-10-08T10:00:00.000Z",
    weightKg: 72,
    measurements: { waist_cm: 81, nested: { a: 1, b: 2 } },
  };
  const request = (
    app: ReturnType<typeof buildApp>,
    body: Record<string, unknown> = payload,
    header = operation,
  ) =>
    app.inject({
      method: "POST",
      url: "/v1/body-measurements",
      headers: { authorization: "Bearer valid", "idempotency-key": header },
      payload: body,
    });
  const rowCount = async (
    repo: InMemoryBodyMeasurementRepository,
    userId = userA,
  ) =>
    (
      await repo.list(userId, {
        from: null,
        to: null,
        limit: 200,
        accessToken: "test-token",
      })
    ).length;

  it("rejects excess numeric(6,3) precision before insert and replays a valid three-decimal weight", async () => {
    const { app, bodyMeasurementRepository: repo } = build(
      tokenVerifierFor({ userId: userA }),
    );
    const invalid = await request(app, { ...payload, weightKg: 72.1234 });
    expect(invalid.statusCode).toBe(422);
    expect(await rowCount(repo)).toBe(0);
    const valid = { ...payload, weightKg: 72.123 };
    const first = await request(app, valid);
    const replay = await request(app, valid);
    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().bodyMeasurement.id).toBe(
      first.json().bodyMeasurement.id,
    );
    expect(replay.json().bodyMeasurement.weightKg).toBe(72.123);
    expect(await rowCount(repo)).toBe(1);
  });

  it("returns the same row after a lost response and API process restart", async () => {
    const first = build(tokenVerifierFor({ userId: userA }));
    const committed = await request(first.app);
    expect(committed.statusCode).toBe(200);
    // Drop this response at the transport boundary; retain the durable repository.
    await first.app.close();
    apps.splice(apps.indexOf(first.app), 1);
    const restarted = build(
      tokenVerifierFor({ userId: userA }),
      first.bodyMeasurementRepository,
    );
    const replay = await request(restarted.app);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().bodyMeasurement.id).toBe(
      committed.json().bodyMeasurement.id,
    );
    expect(await rowCount(first.bodyMeasurementRepository)).toBe(1);
  });

  it("deduplicates simultaneous requests and rejects a changed concurrent payload", async () => {
    const { app, bodyMeasurementRepository: repo } = build(
      tokenVerifierFor({ userId: userA }),
    );
    const responses = await Promise.all([request(app), request(app)]);
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(responses[0]!.json().bodyMeasurement.id).toBe(
      responses[1]!.json().bodyMeasurement.id,
    );
    expect(await rowCount(repo)).toBe(1);
    const next = "22222222-2222-4222-8222-222222222222";
    const race = await Promise.all([
      request(app, { ...payload, clientOperationId: next }, next),
      request(app, { ...payload, clientOperationId: next, weightKg: 73 }, next),
    ]);
    expect(race.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await rowCount(repo)).toBe(2);
  });

  it("conflicts on changed values or time, but ignores JSON object key order", async () => {
    const { app, bodyMeasurementRepository: repo } = build(
      tokenVerifierFor({ userId: userA }),
    );
    await request(app);
    for (const body of [
      { ...payload, weightKg: 73 },
      { ...payload, measuredAt: "2026-10-08T10:01:00Z" },
      { ...payload, measurements: { waist_cm: 82 } },
    ]) {
      const response = await request(app, body);
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("CONFLICT");
    }
    expect(
      (
        await request(app, {
          ...payload,
          measuredAt: "2026-10-08T12:00:00+02:00",
          measurements: { nested: { b: 2, a: 1 }, waist_cm: 81 },
        })
      ).statusCode,
    ).toBe(200);
    expect(await rowCount(repo)).toBe(1);
  });

  it("normalizes omitted/null weight and empty measurements for a replay", async () => {
    const { app, bodyMeasurementRepository: repo } = build(
      tokenVerifierFor({ userId: userA }),
    );
    const body = {
      clientOperationId: operation,
      measuredAt: payload.measuredAt,
      measurements: { waist_cm: 81 },
    };
    const first = await request(app, body);
    const replay = await request(app, { ...body, weightKg: null });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().bodyMeasurement.id).toBe(
      first.json().bodyMeasurement.id,
    );
    expect(await rowCount(repo)).toBe(1);
  });

  it("scopes the same UUID to each authenticated owner and allows an intentional new entry", async () => {
    const first = build(tokenVerifierFor({ userId: userA }));
    const second = build(
      tokenVerifierFor({ userId: userB }),
      first.bodyMeasurementRepository,
    );
    const a = await request(first.app);
    const b = await request(second.app);
    expect(a.json().bodyMeasurement.userId).toBe(userA);
    expect(b.json().bodyMeasurement.userId).toBe(userB);
    expect(a.json().bodyMeasurement.id).not.toBe(b.json().bodyMeasurement.id);
    const next = "22222222-2222-4222-8222-222222222222";
    expect(
      (await request(first.app, { ...payload, clientOperationId: next }, next))
        .statusCode,
    ).toBe(200);
    expect(await rowCount(first.bodyMeasurementRepository)).toBe(2);
    expect(await rowCount(first.bodyMeasurementRepository, userB)).toBe(1);
  });

  it("rejects invalid/mismatched identity or a keyed request without its fixed time", async () => {
    const { app, bodyMeasurementRepository: repo } = build(
      tokenVerifierFor({ userId: userA }),
    );
    expect((await request(app, payload, "bad")).statusCode).toBe(422);
    expect(
      (await request(app, payload, "22222222-2222-4222-8222-222222222222"))
        .statusCode,
    ).toBe(409);
    expect(
      (await request(app, { clientOperationId: operation, weightKg: 72 }))
        .statusCode,
    ).toBe(422);
    expect((await request(app, { weightKg: 72 })).statusCode).toBe(422);
    expect(await rowCount(repo)).toBe(0);
  });

  it("keeps older unkeyed clients compatible without claiming retry deduplication", async () => {
    const { app, bodyMeasurementRepository: repo } = build(
      tokenVerifierFor({ userId: userA }),
    );
    for (let i = 0; i < 2; i++) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/body-measurements",
        headers: { authorization: "Bearer valid" },
        payload: { weightKg: 72 },
      });
      expect(response.statusCode).toBe(200);
    }
    expect(await rowCount(repo)).toBe(2);
  });
});

describe("POST /v1/body-measurements", () => {
  it("creates a weight-only observation", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/body-measurements",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        weightKg: 72,
        measuredAt: "2026-07-10T08:00:00Z",
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.bodyMeasurement.weightKg).toBe(72);
    expect(body.bodyMeasurement.source).toBe("manual");
    expect(body.bodyMeasurement.userId).toBe(userA);
  });

  it("creates a measurements-only observation", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/body-measurements",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        measurements: { waist_cm: 80, chest_cm: 100 },
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.bodyMeasurement.weightKg).toBeNull();
    expect(body.bodyMeasurement.measurements).toEqual({
      waist_cm: 80,
      chest_cm: 100,
    });
  });

  it("creates an observation with both weight and measurements", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/body-measurements",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        weightKg: 72,
        measurements: { waist_cm: 80 },
      },
    });
    expect(response.statusCode).toBe(200);
  });

  it("defaults `measuredAt` to now when omitted", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/body-measurements",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { weightKg: 72 },
    });
    expect(response.statusCode).toBe(200);
    const ms = Date.parse(response.json().bodyMeasurement.measuredAt);
    expect(Math.abs(Date.now() - ms)).toBeLessThan(10_000);
  });

  it("rejects an empty observation with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/body-measurements",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {},
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("rejects a weight outside the range with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/body-measurements",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { weightKg: 5 },
    });
    expect(response.statusCode).toBe(422);
  });

  it("rejects an unknown field with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/body-measurements",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { weightKg: 70, mystery: "x" },
    });
    expect(response.statusCode).toBe(422);
  });
});

describe("GET /v1/body-measurements/:id", () => {
  it("returns the measurement by id for the verified user", async () => {
    const { app, bodyMeasurementRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedMeasurement(bodyMeasurementRepository);
    const response = await app.inject({
      method: "GET",
      url: "/v1/body-measurements/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().bodyMeasurement.weightKg).toBe(70);
  });

  it("returns 404 when another user's id is requested", async () => {
    const { app, bodyMeasurementRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedMeasurement(bodyMeasurementRepository);
    const { app: appB } = build(tokenVerifierFor({ userId: userB }));
    const response = await appB.inject({
      method: "GET",
      url: "/v1/body-measurements/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 404 for a non-UUID id", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/body-measurements/not-a-uuid",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("DELETE /v1/body-measurements/:id", () => {
  it("removes the measurement and a follow-up GET returns 404", async () => {
    const { app, bodyMeasurementRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedMeasurement(bodyMeasurementRepository);
    const del = await app.inject({
      method: "DELETE",
      url: "/v1/body-measurements/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    expect(del.statusCode).toBe(204);
    const read = await app.inject({
      method: "GET",
      url: "/v1/body-measurements/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    expect(read.statusCode).toBe(404);
  });

  it("returns 404 when another user tries to delete", async () => {
    const { app, bodyMeasurementRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedMeasurement(bodyMeasurementRepository);
    const close: Promise<void>[] = apps.map((a) => a.close());
    await Promise.all(close);
    apps.length = 0;
    const second = build(tokenVerifierFor({ userId: userB }));
    const response = await second.app.inject({
      method: "DELETE",
      url: "/v1/body-measurements/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(404);
  });
});
