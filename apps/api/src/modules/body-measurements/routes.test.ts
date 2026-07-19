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

const build = (verifier: AccessTokenVerifier) => {
  const bodyMeasurementRepository = new InMemoryBodyMeasurementRepository();
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
