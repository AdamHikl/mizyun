import { afterEach, describe, expect, it } from "vitest";

import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import type { StoredExercise, UserId } from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";
import { InMemoryMemoryStore } from "@mizyun/memory";

import { buildApp } from "../../app.js";
import { InMemoryExerciseRepository } from "../../exercise-repository.js";

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
  const exerciseRepository = new InMemoryExerciseRepository();
  const app = buildApp({
    tokenVerifier: verifier,
    agent: new AgentOrchestrator({
      provider: new DisabledAgentProvider(),
      memories: new InMemoryMemoryStore(),
    }),
    exerciseRepository,
  });
  apps.push(app);
  return { app, exerciseRepository };
};

const seedExercise = (
  repo: InMemoryExerciseRepository,
  overrides: Partial<StoredExercise> = {},
): StoredExercise => {
  const exercise: StoredExercise = {
    id: "00000000-0000-4000-8000-00000000a001",
    userId: userA,
    name: "Back squat",
    instructions: "Keep your back flat.",
    metadata: { equipment: "barbell" },
    createdAt: new Date("2026-07-10T08:00:00Z"),
    updatedAt: new Date("2026-07-10T08:00:00Z"),
    ...overrides,
  };
  repo.__seedForTest(exercise);
  return exercise;
};

describe("GET /v1/exercises", () => {
  it("returns an empty list for a fresh user", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ exercises: [] });
  });

  it("returns 401 without a bearer token", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({ method: "GET", url: "/v1/exercises" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  });

  it("returns 401 when the bearer token is invalid", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: { authorization: "Bearer wrong" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: "INVALID_ACCESS_TOKEN" },
    });
  });

  it("returns the verified user's exercises sorted by name (case-insensitive)", async () => {
    const { app, exerciseRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedExercise(exerciseRepository, {
      id: "00000000-0000-4000-8000-00000000a001",
      name: "back squat",
    });
    seedExercise(exerciseRepository, {
      id: "00000000-0000-4000-8000-00000000a002",
      name: "Front squat",
    });
    seedExercise(exerciseRepository, {
      id: "00000000-0000-4000-8000-00000000a003",
      name: "Bench press",
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.exercises.map((e: { name: string }) => e.name)).toEqual([
      "back squat",
      "Bench press",
      "Front squat",
    ]);
  });

  it("never returns another user's exercises", async () => {
    const { app, exerciseRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedExercise(exerciseRepository);
    const { app: appB } = build(tokenVerifierFor({ userId: userB }));
    const response = await appB.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ exercises: [] });
  });

  it("caps the limit at the maximum page size", async () => {
    const { app, exerciseRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedExercise(exerciseRepository, {
      id: "00000000-0000-4000-8000-00000000a001",
      name: "A",
    });
    seedExercise(exerciseRepository, {
      id: "00000000-0000-4000-8000-00000000a002",
      name: "B",
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/exercises?limit=1",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().exercises).toHaveLength(1);
  });

  it("rejects an out-of-range `limit` with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/exercises?limit=999",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });
});

describe("POST /v1/exercises", () => {
  it("creates an exercise with instructions and metadata", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/exercises",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        name: "Front squat",
        instructions: "Elbows up.",
        metadata: { equipment: "barbell" },
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.exercise.name).toBe("Front squat");
    expect(body.exercise.instructions).toBe("Elbows up.");
    expect(body.exercise.metadata).toEqual({ equipment: "barbell" });
    expect(body.exercise.userId).toBe(userA);
    expect(typeof body.exercise.id).toBe("string");
  });

  it("creates a minimal exercise when only `name` is provided", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/exercises",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { name: "Quick exercise" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.exercise.name).toBe("Quick exercise");
    expect(body.exercise.instructions).toBeNull();
    expect(body.exercise.metadata).toEqual({});
  });

  it("rejects a blank name with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/exercises",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { name: "   " },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("rejects an unknown field with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/exercises",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { name: "Front squat", mystery: "x" },
    });
    expect(response.statusCode).toBe(422);
  });

  it("returns 401 when the bearer token is missing", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/exercises",
      headers: { "content-type": "application/json" },
      payload: { name: "Front squat" },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("GET /v1/exercises/:id", () => {
  it("returns the exercise by id for the verified user", async () => {
    const { app, exerciseRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedExercise(exerciseRepository);
    const response = await app.inject({
      method: "GET",
      url: "/v1/exercises/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().exercise.name).toBe("Back squat");
  });

  it("returns 404 when another user's id is requested", async () => {
    const { app, exerciseRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedExercise(exerciseRepository);
    const { app: appB } = build(tokenVerifierFor({ userId: userB }));
    const response = await appB.inject({
      method: "GET",
      url: "/v1/exercises/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("returns 404 for a non-UUID id", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/exercises/not-a-uuid",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 404 for an unknown UUID", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/exercises/00000000-0000-4000-8000-000000000099",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("PUT /v1/exercises/:id", () => {
  it("applies a single-field patch and persists it", async () => {
    const { app, exerciseRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedExercise(exerciseRepository);
    const patch = await app.inject({
      method: "PUT",
      url: "/v1/exercises/00000000-0000-4000-8000-00000000a001",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { name: "Front squat" },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().exercise.name).toBe("Front squat");

    const read = await app.inject({
      method: "GET",
      url: "/v1/exercises/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    expect(read.json().exercise.name).toBe("Front squat");
  });

  it("rejects an empty patch with a 422 VALIDATION_ERROR", async () => {
    const { app, exerciseRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedExercise(exerciseRepository);
    const response = await app.inject({
      method: "PUT",
      url: "/v1/exercises/00000000-0000-4000-8000-00000000a001",
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

  it("clears instructions when the patch sets it to null", async () => {
    const { app, exerciseRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedExercise(exerciseRepository);
    const cleared = await app.inject({
      method: "PUT",
      url: "/v1/exercises/00000000-0000-4000-8000-00000000a001",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { instructions: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().exercise.instructions).toBeNull();
  });

  it("returns 404 when another user tries to patch", async () => {
    const { app, exerciseRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedExercise(exerciseRepository);
    const close: Promise<void>[] = apps.map((a) => a.close());
    await Promise.all(close);
    apps.length = 0;
    const second = build(tokenVerifierFor({ userId: userB }));
    const response = await second.app.inject({
      method: "PUT",
      url: "/v1/exercises/00000000-0000-4000-8000-00000000a001",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { name: "Hacked" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("rejects an unknown field with a 422", async () => {
    const { app, exerciseRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedExercise(exerciseRepository);
    const response = await app.inject({
      method: "PUT",
      url: "/v1/exercises/00000000-0000-4000-8000-00000000a001",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { name: "Front squat", mystery: "x" },
    });
    expect(response.statusCode).toBe(422);
  });
});

describe("DELETE /v1/exercises/:id", () => {
  it("removes the exercise and a follow-up GET returns 404", async () => {
    const { app, exerciseRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedExercise(exerciseRepository);
    const del = await app.inject({
      method: "DELETE",
      url: "/v1/exercises/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    expect(del.statusCode).toBe(204);
    const read = await app.inject({
      method: "GET",
      url: "/v1/exercises/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    expect(read.statusCode).toBe(404);
  });

  it("returns 404 when another user tries to delete", async () => {
    const { app, exerciseRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedExercise(exerciseRepository);
    const close: Promise<void>[] = apps.map((a) => a.close());
    await Promise.all(close);
    apps.length = 0;
    const second = build(tokenVerifierFor({ userId: userB }));
    const response = await second.app.inject({
      method: "DELETE",
      url: "/v1/exercises/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 404 for a non-UUID id", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "DELETE",
      url: "/v1/exercises/not-a-uuid",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("GET /v1/exercises/catalog", () => {
  it("returns search results from the prefilled catalog", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/exercises/catalog?query=bench+press",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.exercises.length).toBeGreaterThan(0);
    expect(
      body.exercises.some((e: { name: string }) =>
        e.name.toLowerCase().includes("bench"),
      ),
    ).toBe(true);
  });

  it("filters catalog exercises by movementPattern", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/exercises/catalog?movementPattern=knee_dominant",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.exercises.length).toBeGreaterThan(0);
    expect(
      body.exercises.every(
        (e: { movementPattern: string }) =>
          e.movementPattern === "knee_dominant",
      ),
    ).toBe(true);
  });
});
