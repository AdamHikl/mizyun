import { afterEach, describe, expect, it } from "vitest";
import type { StoredWorkout, UserId } from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";

import { buildApp } from "../../app.js";
import { InMemoryProfileRepository } from "../../profile-repository.js";
import { InMemoryWorkoutRepository } from "../../workout-repository.js";
import { InMemoryCommunityRepository } from "../../community-repository.js";

const userAlice: UserId = "00000000-0000-4000-8000-000000000001" as UserId;
const userBob: UserId = "00000000-0000-4000-8000-000000000002" as UserId;
const userEve: UserId = "00000000-0000-4000-8000-000000000003" as UserId;

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const tokenVerifierFor = (): AccessTokenVerifier => ({
  verify: async (token) => {
    if (token === "token-alice") {
      return {
        userId: userAlice,
        role: "authenticated",
        accessToken: "token-alice",
      };
    }
    if (token === "token-bob") {
      return {
        userId: userBob,
        role: "authenticated",
        accessToken: "token-bob",
      };
    }
    if (token === "token-eve") {
      return {
        userId: userEve,
        role: "authenticated",
        accessToken: "token-eve",
      };
    }
    return null;
  },
});

const setupTestApp = async () => {
  const profileRepository = new InMemoryProfileRepository({
    defaultTimezone: "UTC",
    defaultUnitSystem: "metric",
    defaultBirthYear: 1990,
  });

  const now = new Date();
  await profileRepository.getOrCreate(userAlice, {
    now,
    accessToken: "token-alice",
  });
  await profileRepository.getOrCreate(userBob, {
    now,
    accessToken: "token-bob",
  });
  await profileRepository.getOrCreate(userEve, {
    now,
    accessToken: "token-eve",
  });

  const communityRepository = new InMemoryCommunityRepository();
  const workoutRepository = new InMemoryWorkoutRepository();

  const app = buildApp({
    communityOperations: {
      browsing: true,
      enrollment: true,
      discovery: true,
      publish: true,
      engagement: true,
      delivery: false,
    },
    tokenVerifier: tokenVerifierFor(),
    profileRepository,
    communityRepository,
    workoutRepository,
  });
  apps.push(app);
  await app.ready();
  return { app, communityRepository, workoutRepository };
};

const createCompletedWorkout = async (
  workoutRepository: InMemoryWorkoutRepository,
  userId: UserId,
  workoutId: string = "10000000-0000-4000-8000-000000000001",
): Promise<StoredWorkout> => {
  const startedAt = new Date("2026-09-29T10:00:00Z");
  const completedAt = new Date("2026-09-29T10:45:00Z");
  const workout: StoredWorkout = {
    id: workoutId,
    userId,
    clientOperationId: null,
    source: "manual",
    name: "Heavy Upper Body Bench & Rows",
    startedAt,
    completedAt,
    notes: "Felt strong today, hit a new PR on 100kg bench press!",
    details: {
      workoutLifecycle: { kind: "session" },
    },
    createdAt: startedAt,
    updatedAt: completedAt,
  };
  return workoutRepository.create(userId, workout, {
    accessToken: `token-${userId === userAlice ? "alice" : "bob"}`,
  });
};

describe("Community Workout Publication Routes", () => {
  it("returns the original snapshot on lost-response retry after private duration edits", async () => {
    const { app, communityRepository, workoutRepository } =
      await setupTestApp();
    await communityRepository.saveProfile(
      userAlice,
      { handle: "retry_preview", displayName: "Author", isSearchable: false },
      { accessToken: "token-alice" },
    );
    const workout = await createCompletedWorkout(workoutRepository, userAlice);
    const payload = {
      workoutId: workout.id,
      enrollmentGeneration: 1,
      operationId: "30000000-0000-4000-8000-000000000083",
      category: "strength",
      sharedDay: "2026-09-29",
      includeDuration: true,
      expectedDurationSeconds: 2700,
    };
    const request = {
      method: "POST" as const,
      url: "/v1/community/activities",
      headers: { authorization: "Bearer token-alice" },
      payload,
    };
    const first = await app.inject(request);
    expect(first.statusCode).toBe(201);
    await workoutRepository.update(
      {
        ...workout,
        startedAt: new Date("2026-09-26T09:00:00Z"),
        completedAt: new Date("2026-09-26T10:45:00Z"),
      },
      { accessToken: "token-alice" },
    );
    const replay = await app.inject(request);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    const fresh = await app.inject({
      ...request,
      payload: {
        ...payload,
        operationId: "30000000-0000-4000-8000-000000000084",
        expectedVersion: 1,
      },
    });
    expect(fresh.statusCode).toBe(409);
  });

  it("rejects a changed duration after preview and publishes no card", async () => {
    const { app, communityRepository, workoutRepository } =
      await setupTestApp();
    await communityRepository.saveProfile(
      userAlice,
      { handle: "preview_author", displayName: "Author", isSearchable: false },
      { accessToken: "token-alice" },
    );
    const workout = await createCompletedWorkout(workoutRepository, userAlice);
    const res = await app.inject({
      method: "POST",
      url: "/v1/community/activities",
      headers: { authorization: "Bearer token-alice" },
      payload: {
        workoutId: workout.id,
        enrollmentGeneration: 1,
        operationId: "30000000-0000-4000-8000-000000000081",
        category: "strength",
        sharedDay: "2026-09-29",
        includeDuration: true,
        expectedDurationSeconds: 2600,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(
      await communityRepository.getActivityByWorkoutId(workout.id, userAlice, {
        accessToken: "token-alice",
      }),
    ).toBeNull();
  });

  it("generates workout sharing preview with strict allowlist and privacy projection", async () => {
    const { app, communityRepository, workoutRepository } =
      await setupTestApp();

    await communityRepository.saveProfile(
      userAlice,
      { handle: "alice_runner", displayName: "Alice", isSearchable: true },
      { accessToken: "token-alice" },
    );

    const workout = await createCompletedWorkout(workoutRepository, userAlice);

    const res = await app.inject({
      method: "GET",
      url: `/v1/community/workouts/${workout.id}/preview`,
      headers: { authorization: "Bearer token-alice" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.workoutId).toBe(workout.id);
    expect(body.category).toBe("strength");
    expect(body.sharedDay).toBe("2026-09-29");
    expect(body.durationSeconds).toBe(45 * 60);
    // MUST NOT leak private workout details
    expect(body.name).toBeUndefined();
    expect(body.notes).toBeUndefined();
    expect(body.details).toBeUndefined();
  });

  it("denies preview for incomplete workout", async () => {
    const { app, communityRepository, workoutRepository } =
      await setupTestApp();

    await communityRepository.saveProfile(
      userAlice,
      { handle: "alice_runner", displayName: "Alice", isSearchable: true },
      { accessToken: "token-alice" },
    );

    const incomplete: StoredWorkout = {
      id: "20000000-0000-4000-8000-000000000001",
      userId: userAlice,
      clientOperationId: null,
      source: "manual",
      name: "Live Workout",
      startedAt: new Date(),
      completedAt: null,
      notes: null,
      details: { workoutLifecycle: { kind: "session" } },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await workoutRepository.create(userAlice, incomplete, {
      accessToken: "token-alice",
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/community/workouts/${incomplete.id}/preview`,
      headers: { authorization: "Bearer token-alice" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("WORKOUT_NOT_COMPLETED");
  });

  it("publishes workout activity and allows author to view it", async () => {
    const { app, communityRepository, workoutRepository } =
      await setupTestApp();

    await communityRepository.saveProfile(
      userAlice,
      {
        handle: "alice_runner",
        displayName: "Alice",
        avatarSymbol: "AR",
        isSearchable: true,
      },
      { accessToken: "token-alice" },
    );

    const workout = await createCompletedWorkout(workoutRepository, userAlice);

    const res = await app.inject({
      method: "POST",
      url: "/v1/community/activities",
      headers: { authorization: "Bearer token-alice" },
      payload: {
        workoutId: workout.id,
        enrollmentGeneration: 1,
        operationId: "30000000-0000-4000-8000-000000000001",
        category: "strength",
        sharedDay: "2026-09-29",
        includeDuration: true,
        expectedDurationSeconds: 2700,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.authorUserId).toBe(userAlice);
    expect(body.authorHandle).toBe("alice_runner");
    expect(body.authorDisplayName).toBe("Alice");
    expect(body.category).toBe("strength");
    expect(body.durationSeconds).toBe(45 * 60);
    expect(body.version).toBe(1);
    expect(body.sourceWorkoutId).toBe(workout.id);
    // Crucial check: zero health/exercise/notes leakage
    expect(body.notes).toBeUndefined();
    expect(body.name).toBeUndefined();
  });

  it("keeps publication unchanged when a lost response is retried", async () => {
    const { app, communityRepository, workoutRepository } =
      await setupTestApp();
    await communityRepository.saveProfile(userAlice, {
      handle: "alice_runner",
      displayName: "Alice",
      isSearchable: true,
    });
    const workout = await createCompletedWorkout(workoutRepository, userAlice);
    const request = {
      method: "POST" as const,
      url: "/v1/community/activities",
      headers: { authorization: "Bearer token-alice" },
      payload: {
        workoutId: workout.id,
        category: "strength",
        sharedDay: "2026-09-29",
        includeDuration: true,
        expectedDurationSeconds: 2700,
        enrollmentGeneration: 1,
        operationId: "30000000-0000-4000-8000-000000000001",
      },
    };
    const first = await app.inject(request);
    expect(first.statusCode).toBe(201);
    const second = await app.inject(request);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
  });

  it("uses selected timezone in preview across calendar-day boundary", async () => {
    const { app, communityRepository, workoutRepository } =
      await setupTestApp();
    await communityRepository.saveProfile(userAlice, {
      handle: "alice_runner",
      displayName: "Alice",
      isSearchable: true,
    });
    const workout = await createCompletedWorkout(workoutRepository, userAlice);
    const res = await app.inject({
      method: "GET",
      url: `/v1/community/workouts/${workout.id}/preview?timezone=Pacific/Kiritimati`,
      headers: { authorization: "Bearer token-alice" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sharedDay).toBe("2026-09-30");
    expect(res.json().enrollmentGeneration).toBe(1);
    const invalid = await app.inject({
      method: "GET",
      url: `/v1/community/workouts/${workout.id}/preview?timezone=not_a_zone`,
      headers: { authorization: "Bearer token-alice" },
    });
    expect(invalid.statusCode).toBe(422);
  });

  it("rejects routines with a completed timestamp", async () => {
    const { app, communityRepository, workoutRepository } =
      await setupTestApp();
    await communityRepository.saveProfile(userAlice, {
      handle: "alice_runner",
      displayName: "Alice",
      isSearchable: true,
    });
    const workout = await createCompletedWorkout(workoutRepository, userAlice);
    await workoutRepository.update(
      { ...workout, details: { workoutLifecycle: { kind: "routine" } } },
      { accessToken: "token-alice" },
    );
    const preview = await app.inject({
      method: "GET",
      url: `/v1/community/workouts/${workout.id}/preview`,
      headers: { authorization: "Bearer token-alice" },
    });
    expect(preview.statusCode).toBe(422);
  });

  it("enforces approved follower audience boundary on read", async () => {
    const { app, communityRepository, workoutRepository } =
      await setupTestApp();

    // Alice, Bob, Eve enrolled
    await communityRepository.saveProfile(
      userAlice,
      { handle: "alice_runner", displayName: "Alice", isSearchable: true },
      { accessToken: "token-alice" },
    );
    await communityRepository.saveProfile(
      userBob,
      { handle: "bob_friend", displayName: "Bob", isSearchable: true },
      { accessToken: "token-bob" },
    );
    await communityRepository.saveProfile(
      userEve,
      { handle: "eve_stranger", displayName: "Eve", isSearchable: true },
      { accessToken: "token-eve" },
    );

    // Bob follows Alice (approved)
    const rel = await communityRepository.sendFollowRequest(
      userBob,
      userAlice,
      {
        accessToken: "token-bob",
      },
    );
    await communityRepository.updateRelationshipStatus(
      rel.id,
      userAlice,
      "approved",
      { accessToken: "token-alice" },
    );

    // Alice publishes workout
    const workout = await createCompletedWorkout(workoutRepository, userAlice);
    const pubRes = await app.inject({
      method: "POST",
      url: "/v1/community/activities",
      headers: { authorization: "Bearer token-alice" },
      payload: {
        workoutId: workout.id,
        enrollmentGeneration: 1,
        operationId: "30000000-0000-4000-8000-000000000001",
        category: "strength",
        sharedDay: "2026-09-29",
        includeDuration: true,
        expectedDurationSeconds: 2700,
      },
    });
    const activityId = pubRes.json().id;

    // Bob (approved follower) can read the card
    const bobRes = await app.inject({
      method: "GET",
      url: `/v1/community/activities/${activityId}`,
      headers: { authorization: "Bearer token-bob" },
    });
    expect(bobRes.statusCode).toBe(200);
    expect(bobRes.json().authorHandle).toBe("alice_runner");

    // Eve (stranger) is denied with 404
    const eveRes = await app.inject({
      method: "GET",
      url: `/v1/community/activities/${activityId}`,
      headers: { authorization: "Bearer token-eve" },
    });
    expect(eveRes.statusCode).toBe(404);

    // If Alice blocks Bob, Bob can no longer read the card
    await communityRepository.blockUser(userAlice, userBob, {
      accessToken: "token-alice",
    });

    const bobBlockedRes = await app.inject({
      method: "GET",
      url: `/v1/community/activities/${activityId}`,
      headers: { authorization: "Bearer token-bob" },
    });
    expect(bobBlockedRes.statusCode).toBe(404);
  });

  it("unpublishes activity card upon explicit author revocation", async () => {
    const { app, communityRepository, workoutRepository } =
      await setupTestApp();

    await communityRepository.saveProfile(
      userAlice,
      { handle: "alice_runner", displayName: "Alice", isSearchable: true },
      { accessToken: "token-alice" },
    );

    const workout = await createCompletedWorkout(workoutRepository, userAlice);
    const pubRes = await app.inject({
      method: "POST",
      url: "/v1/community/activities",
      headers: { authorization: "Bearer token-alice" },
      payload: {
        workoutId: workout.id,
        enrollmentGeneration: 1,
        operationId: "30000000-0000-4000-8000-000000000001",
        category: "strength",
        sharedDay: "2026-09-29",
        includeDuration: true,
        expectedDurationSeconds: 2700,
      },
    });
    const activityId = pubRes.json().id;

    // Unpublish
    const delRes = await app.inject({
      method: "DELETE",
      url: `/v1/community/activities/${activityId}`,
      headers: { authorization: "Bearer token-alice" },
    });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json().revoked).toBe(true);

    // Reading now returns 404
    const getRes = await app.inject({
      method: "GET",
      url: `/v1/community/activities/${activityId}`,
      headers: { authorization: "Bearer token-alice" },
    });
    expect(getRes.statusCode).toBe(404);
  });

  it("automatically revokes published activity when the source workout is deleted", async () => {
    const { app, communityRepository, workoutRepository } =
      await setupTestApp();

    await communityRepository.saveProfile(
      userAlice,
      { handle: "alice_runner", displayName: "Alice", isSearchable: true },
      { accessToken: "token-alice" },
    );

    const workout = await createCompletedWorkout(workoutRepository, userAlice);
    const pubRes = await app.inject({
      method: "POST",
      url: "/v1/community/activities",
      headers: { authorization: "Bearer token-alice" },
      payload: {
        workoutId: workout.id,
        enrollmentGeneration: 1,
        operationId: "30000000-0000-4000-8000-000000000001",
        category: "strength",
        sharedDay: "2026-09-29",
        includeDuration: true,
        expectedDurationSeconds: 2700,
      },
    });
    const activityId = pubRes.json().id;

    // Delete the private workout via DELETE /v1/workouts/:id
    const deleteWorkoutRes = await app.inject({
      method: "DELETE",
      url: `/v1/workouts/${workout.id}`,
      headers: { authorization: "Bearer token-alice" },
    });
    expect(deleteWorkoutRes.statusCode).toBe(204);

    // Activity is now revoked in community
    const storedActivity =
      await communityRepository.getActivityById(activityId);
    expect(storedActivity?.revokedAt).not.toBeNull();

    // GET activity card returns 404
    const getRes = await app.inject({
      method: "GET",
      url: `/v1/community/activities/${activityId}`,
      headers: { authorization: "Bearer token-alice" },
    });
    expect(getRes.statusCode).toBe(404);
  });

  it("rejects retry after revocation and stale enrollment confirmations without republishing", async () => {
    const { app, communityRepository, workoutRepository } =
      await setupTestApp();
    await communityRepository.saveProfile(userAlice, {
      handle: "alice_runner",
      displayName: "Alice",
      isSearchable: true,
    });
    const workout = await createCompletedWorkout(workoutRepository, userAlice);
    const request = {
      method: "POST" as const,
      url: "/v1/community/activities",
      headers: { authorization: "Bearer token-alice" },
      payload: {
        workoutId: workout.id,
        category: "strength",
        sharedDay: "2026-09-29",
        includeDuration: true,
        expectedDurationSeconds: 2700,
        enrollmentGeneration: 1,
        operationId: "30000000-0000-4000-8000-000000000001",
      },
    };
    const first = await app.inject(request);
    expect(first.statusCode).toBe(201);
    await communityRepository.revokeActivity(first.json().id, userAlice);
    const retry = await app.inject(request);
    expect(retry.statusCode).toBe(409);
    expect(retry.json().error.code).toBe("CONFLICT");
    expect(
      (await communityRepository.getActivityById(first.json().id))?.revokedAt,
    ).not.toBeNull();
    await communityRepository.withdrawProfile(userAlice);
    await communityRepository.saveProfile(userAlice, {
      handle: "alice_runner",
      displayName: "Alice",
      isSearchable: true,
    });
    const stale = await app.inject({
      ...request,
      payload: {
        ...request.payload,
        operationId: "30000000-0000-4000-8000-000000000002",
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(
      (await communityRepository.getActivityById(first.json().id))?.revokedAt,
    ).not.toBeNull();
  });
});
