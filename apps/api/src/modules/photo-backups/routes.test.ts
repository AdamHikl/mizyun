import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import { InMemoryMemoryStore } from "@mizyun/memory";
import type {
  MealPhotoService,
  StoredFoodEntry,
  StoredMediaAsset,
  UserId,
} from "@mizyun/core";
import { buildApp } from "../../app.js";
import { InMemoryWorkoutRepository } from "../../workout-repository.js";
import { InMemoryMediaAssetRepository } from "../../media-asset-repository.js";
import { InMemoryBoulderingRepository } from "../../bouldering-repository.js";
import { InMemoryFoodEntryRepository } from "../../food-entry-repository.js";
import { InMemoryProfileRepository } from "../../profile-repository.js";
import { InMemoryBetaProRepository } from "../../beta-pro-repository.js";
import type { MediaStorage } from "../../media-storage.js";

const A = "00000000-0000-4000-8000-000000000001" as UserId;
const B = "00000000-0000-4000-8000-000000000002" as UserId;
const asA = { authorization: "Bearer A" };
const asB = { authorization: "Bearer B" };
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

const mealService = (): MealPhotoService => ({
  save: vi.fn(),
  get: vi.fn().mockResolvedValue(null),
  remove: vi.fn(),
  cleanup: vi.fn(),
});

const setup = (
  options: {
    boulderingEnabled?: boolean;
    mealPhotosEnabled?: boolean;
    mealPhotoService?: MealPhotoService | null;
  } = {},
) => {
  const events: string[] = [];
  const workouts = new InMemoryWorkoutRepository();
  const media = new InMemoryMediaAssetRepository();
  const bouldering = new InMemoryBoulderingRepository(workouts, media);
  const foodEntries = new InMemoryFoodEntryRepository();
  const failures = { remove: false, softDelete: false };
  const storage: MediaStorage = {
    signUploadUrl: vi.fn(),
    signDownloadUrl: vi.fn(),
    remove: vi.fn(async (_bucket: string, path: string) => {
      events.push(`bytes:${path}`);
      if (failures.remove) throw new Error("storage down");
    }),
  };
  const softDelete = media.softDelete.bind(media);
  media.softDelete = async (id, now, opts) => {
    events.push(`asset:${id}`);
    if (failures.softDelete) throw new Error("db down");
    return softDelete(id, now, opts);
  };
  const service =
    options.mealPhotoService === undefined
      ? mealService()
      : options.mealPhotoService;
  const app = buildApp({
    workoutRepository: workouts,
    mediaAssetRepository: media,
    mediaStorage: storage,
    boulderingRepository: bouldering,
    boulderingEnabled: options.boulderingEnabled ?? true,
    foodEntryRepository: foodEntries,
    mealPhotosEnabled: options.mealPhotosEnabled ?? true,
    ...(service ? { mealPhotoService: service } : {}),
    // Free tier with no Beta Pro pass: erasure must not need Pro.
    profileRepository: new InMemoryProfileRepository({
      defaultTimezone: "UTC",
      defaultUnitSystem: "metric",
      defaultPlanTier: "free",
    }),
    betaProRepository: new InMemoryBetaProRepository(),
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
  return { app, media, bouldering, foodEntries, storage, events, failures };
};
type Setup = ReturnType<typeof setup>;

const asset = (
  userId: UserId,
  purpose: "workout" | "food",
): StoredMediaAsset => {
  const id = crypto.randomUUID();
  return {
    id,
    userId,
    purpose,
    mimeType: "image/jpeg",
    byteSize: 1000,
    width: 100,
    height: 100,
    metadata: {},
    bucketId: "private-media",
    objectPath: `${userId}/${id}.jpg`,
    createdAt: new Date(),
    deletedAt: null,
  };
};

/** One owner boulder with a backed-up photo; returns the ids. */
const boulderWithPhoto = async (
  { app, media }: Setup,
  headers = asA,
  userId = A,
) => {
  const photo = asset(userId, "workout");
  media.__seedForTest(photo);
  // One active session per climber: reuse it for further boulders.
  const active = await app.inject({
    method: "GET",
    url: "/v1/bouldering/sessions/active",
    headers,
  });
  let sessionId = active.json().session?.id as string | undefined;
  if (!sessionId) {
    const session = await app.inject({
      method: "POST",
      url: "/v1/bouldering/sessions",
      headers,
      payload: {
        clientOperationId: crypto.randomUUID(),
        recordingTimezone: "UTC",
      },
    });
    expect(session.statusCode).toBe(201);
    sessionId = session.json().session.id as string;
  }
  const ascent = await app.inject({
    method: "POST",
    url: `/v1/bouldering/sessions/${sessionId}/ascents`,
    headers,
    payload: {
      clientOperationId: crypto.randomUUID(),
      grade: "6A",
      result: "sent",
      attempts: 3,
      holdColour: "blue",
      note: "Crimpy",
      photoAssetId: photo.id,
    },
  });
  expect(ascent.statusCode).toBe(201);
  return {
    sessionId,
    ascentId: ascent.json().ascent.id as string,
    assetId: photo.id,
    objectPath: photo.objectPath,
  };
};

/** One owner meal with a ready photo (the DB only links ready photos). */
const mealWithPhoto = ({ media, foodEntries }: Setup, userId = A) => {
  const photo = asset(userId, "food");
  media.__seedForTest(photo);
  const entryId = crypto.randomUUID();
  foodEntries.__seedForTest({
    id: entryId,
    userId,
    name: "Toast",
    consumedAt: new Date(),
    caloriesKcal: 200,
    proteinG: null,
    carbohydrateG: null,
    fatG: null,
    source: "manual",
    confidence: null,
    confirmedByUser: true,
    details: {},
    photoAssetId: photo.id,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as StoredFoodEntry);
  return { entryId, assetId: photo.id };
};

const list = (app: Setup["app"], headers: Record<string, string> = asA) =>
  app.inject({ method: "GET", url: "/v1/photo-backups", headers });
const removeBoulderPhoto = (
  app: Setup["app"],
  ascentId: string,
  headers: Record<string, string> = asA,
) =>
  app.inject({
    method: "DELETE",
    url: `/v1/bouldering/ascents/${ascentId}/photo`,
    headers,
  });

describe("GET /v1/photo-backups", () => {
  it("requires authentication", async () => {
    const { app } = setup();
    expect((await list(app, {})).statusCode).toBe(401);
    expect((await list(app, { authorization: "Bearer nope" })).statusCode).toBe(
      401,
    );
  });

  it("lists only the caller's live meal and boulder backups without Pro", async () => {
    const s = setup();
    const boulder = await boulderWithPhoto(s);
    const meal = mealWithPhoto(s);
    // Another user's rows, and a soft-deleted asset, never appear.
    await boulderWithPhoto(s, asB, B);
    mealWithPhoto(s, B);
    const gone = await boulderWithPhoto(s);
    await s.media.softDelete(gone.assetId, new Date(), { accessToken: "A" });

    const response = await list(s.app);
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      meals: [meal],
      boulders: [
        {
          ascentId: boulder.ascentId,
          sessionId: boulder.sessionId,
          assetId: boulder.assetId,
        },
      ],
      truncated: false,
    });
    const other = (await list(s.app, asB)).json();
    expect(other.meals).toHaveLength(1);
    expect(other.boulders).toHaveLength(1);
    expect(other.meals[0].entryId).not.toBe(meal.entryId);
    expect(other.boulders[0].ascentId).not.toBe(boulder.ascentId);
  });

  it("lists no meals when meal-photo storage is not configured", async () => {
    const s = setup({ mealPhotoService: null });
    mealWithPhoto(s);
    const boulder = await boulderWithPhoto(s);
    const body = (await list(s.app)).json();
    expect(body.meals).toEqual([]);
    expect(body.boulders).toEqual([
      expect.objectContaining({ ascentId: boulder.ascentId }),
    ]);
  });

  it("still lists erasable meal backups while the meal-photo flag is off", async () => {
    // DELETE /v1/food-entries/:id/photo stays available with the flag off.
    const s = setup({ mealPhotosEnabled: false });
    const meal = mealWithPhoto(s);
    expect((await list(s.app)).json().meals).toEqual([meal]);
  });

  it("still lists boulder backups while bouldering is switched off", async () => {
    const s = setup();
    const boulder = await boulderWithPhoto(s);
    const off = setup({ boulderingEnabled: false });
    expect((await list(off.app)).json().boulders).toEqual([]);
    expect((await list(s.app)).json().boulders).toEqual([
      expect.objectContaining({ ascentId: boulder.ascentId }),
    ]);
  });
});

describe("DELETE /v1/bouldering/ascents/:id/photo", () => {
  it("requires authentication", async () => {
    const s = setup();
    const { ascentId } = await boulderWithPhoto(s);
    expect((await removeBoulderPhoto(s.app, ascentId, {})).statusCode).toBe(
      401,
    );
  });

  it("removes bytes, then the asset, then the link, and is idempotent", async () => {
    const s = setup();
    const boulder = await boulderWithPhoto(s);
    const first = await removeBoulderPhoto(s.app, boulder.ascentId);
    expect(first.statusCode).toBe(204);
    expect(s.events).toEqual([
      `bytes:${boulder.objectPath}`,
      `asset:${boulder.assetId}`,
    ]);
    expect(
      (await s.media.getById(boulder.assetId, { accessToken: "A" }))?.deletedAt,
    ).not.toBeNull();
    const ascent = await s.bouldering.getAscent(A, boulder.ascentId, {
      accessToken: "A",
    });
    // Only the link changes; the boulder itself is kept as logged.
    expect(ascent).toMatchObject({
      photoAssetId: null,
      grade: "6A",
      result: "sent",
      attempts: 3,
      holdColour: "blue",
      note: "Crimpy",
      revision: 2,
    });
    expect((await list(s.app)).json().boulders).toEqual([]);

    const again = await removeBoulderPhoto(s.app, boulder.ascentId);
    expect(again.statusCode).toBe(204);
    expect(s.events).toHaveLength(2);
  });

  it("returns 404 for another user's or an unknown boulder and leaves it intact", async () => {
    const s = setup();
    const boulder = await boulderWithPhoto(s);
    expect(
      (await removeBoulderPhoto(s.app, boulder.ascentId, asB)).statusCode,
    ).toBe(404);
    expect(
      (await removeBoulderPhoto(s.app, crypto.randomUUID())).statusCode,
    ).toBe(404);
    expect(s.storage.remove).not.toHaveBeenCalled();
    expect((await list(s.app)).json().boulders).toHaveLength(1);
  });

  it("keeps the asset and link when byte removal fails, then completes on retry", async () => {
    const s = setup();
    const boulder = await boulderWithPhoto(s);
    s.failures.remove = true;
    const failed = await removeBoulderPhoto(s.app, boulder.ascentId);
    expect(failed.statusCode).toBeGreaterThanOrEqual(500);
    expect(s.events).toEqual([`bytes:${boulder.objectPath}`]);
    expect(
      (await s.media.getById(boulder.assetId, { accessToken: "A" }))?.deletedAt,
    ).toBeNull();
    expect((await list(s.app)).json().boulders).toHaveLength(1);

    s.failures.remove = false;
    expect((await removeBoulderPhoto(s.app, boulder.ascentId)).statusCode).toBe(
      204,
    );
    expect(
      (await s.bouldering.getAscent(A, boulder.ascentId, { accessToken: "A" }))
        ?.photoAssetId,
    ).toBeNull();
  });

  it("keeps the link when the metadata update fails after bytes are gone; retry finishes", async () => {
    const s = setup();
    const boulder = await boulderWithPhoto(s);
    s.failures.softDelete = true;
    const failed = await removeBoulderPhoto(s.app, boulder.ascentId);
    expect(failed.statusCode).toBeGreaterThanOrEqual(500);
    expect(s.events).toEqual([
      `bytes:${boulder.objectPath}`,
      `asset:${boulder.assetId}`,
    ]);
    expect(
      (await s.bouldering.getAscent(A, boulder.ascentId, { accessToken: "A" }))
        ?.photoAssetId,
    ).toBe(boulder.assetId);

    s.failures.softDelete = false;
    expect((await removeBoulderPhoto(s.app, boulder.ascentId)).statusCode).toBe(
      204,
    );
    // The retry repeats the idempotent byte removal before the metadata.
    expect(s.events.slice(2)).toEqual([
      `bytes:${boulder.objectPath}`,
      `asset:${boulder.assetId}`,
    ]);
  });

  it("unlinks an already soft-deleted asset without re-deleting its metadata", async () => {
    const s = setup();
    const boulder = await boulderWithPhoto(s);
    await s.media.softDelete(boulder.assetId, new Date(), { accessToken: "A" });
    s.events.length = 0;
    expect((await removeBoulderPhoto(s.app, boulder.ascentId)).statusCode).toBe(
      204,
    );
    expect(s.events).toEqual([`bytes:${boulder.objectPath}`]);
    expect(
      (await s.bouldering.getAscent(A, boulder.ascentId, { accessToken: "A" }))
        ?.photoAssetId,
    ).toBeNull();
  });

  it("stays available while bouldering is switched off", async () => {
    const s = setup({ boulderingEnabled: false });
    // Seed through the repository: the switched-off routes refuse writes.
    const photo = asset(A, "workout");
    s.media.__seedForTest(photo);
    const session = await s.bouldering.startSession(
      A,
      {
        clientOperationId: crypto.randomUUID(),
        recordingTimezone: "UTC",
        gymName: null,
      },
      { accessToken: "A" },
    );
    const ascent = await s.bouldering.createAscent(
      A,
      session.id,
      {
        clientOperationId: crypto.randomUUID(),
        grade: "6A",
        result: "sent",
        attempts: null,
        holdColour: null,
        note: null,
        photoAssetId: photo.id,
      },
      { accessToken: "A" },
    );
    expect((await removeBoulderPhoto(s.app, ascent.id)).statusCode).toBe(204);
    expect(
      (await s.bouldering.getAscent(A, ascent.id, { accessToken: "A" }))
        ?.photoAssetId,
    ).toBeNull();
  });

  it("rejects a malformed id", async () => {
    const s = setup();
    expect((await removeBoulderPhoto(s.app, "not-a-uuid")).statusCode).toBe(
      400,
    );
  });
});

describe("PUT /v1/bouldering/ascents/:id/photo", () => {
  const link = (
    app: Setup["app"],
    ascentId: string,
    assetId: unknown,
    headers: Record<string, string> = asA,
  ) =>
    app.inject({
      method: "PUT",
      url: `/v1/bouldering/ascents/${ascentId}/photo`,
      headers,
      payload: { assetId },
    });
  /** An owner boulder that has no server photo yet. */
  const bareBoulder = async (s: Setup) => {
    const boulder = await boulderWithPhoto(s);
    expect((await removeBoulderPhoto(s.app, boulder.ascentId)).statusCode).toBe(
      204,
    );
    s.events.length = 0;
    return boulder;
  };

  it("links an owned workout asset and answers the updated ascent", async () => {
    const s = setup();
    const boulder = await bareBoulder(s);
    const photo = asset(A, "workout");
    s.media.__seedForTest(photo);
    const response = await link(s.app, boulder.ascentId, photo.id);
    expect(response.statusCode).toBe(200);
    expect(response.json().ascent).toMatchObject({
      id: boulder.ascentId,
      sessionId: boulder.sessionId,
      photoAssetId: photo.id,
      grade: "6A",
      note: "Crimpy",
    });
    expect((await list(s.app)).json().boulders).toEqual([
      {
        ascentId: boulder.ascentId,
        sessionId: boulder.sessionId,
        assetId: photo.id,
      },
    ]);
    // Re-linking the same asset is a no-op with the same answer.
    const again = await link(s.app, boulder.ascentId, photo.id);
    expect(again.statusCode).toBe(200);
    expect(again.json().ascent.revision).toBe(response.json().ascent.revision);
    expect(s.events).toEqual([]);
  });

  it("requires authentication and isolates owners", async () => {
    const s = setup();
    const boulder = await bareBoulder(s);
    const mine = asset(A, "workout");
    const theirs = asset(B, "workout");
    s.media.__seedForTest(mine);
    s.media.__seedForTest(theirs);
    expect((await link(s.app, boulder.ascentId, mine.id, {})).statusCode).toBe(
      401,
    );
    // B cannot link to A's boulder, even with B's own asset.
    expect(
      (await link(s.app, boulder.ascentId, theirs.id, asB)).statusCode,
    ).toBe(404);
    // A cannot link B's asset, or an unknown/deleted one.
    expect((await link(s.app, boulder.ascentId, theirs.id)).statusCode).toBe(
      404,
    );
    expect(
      (await link(s.app, boulder.ascentId, crypto.randomUUID())).statusCode,
    ).toBe(404);
    const deleted = asset(A, "workout");
    s.media.__seedForTest({ ...deleted, deletedAt: new Date() });
    expect((await link(s.app, boulder.ascentId, deleted.id)).statusCode).toBe(
      404,
    );
    expect((await link(s.app, crypto.randomUUID(), mine.id)).statusCode).toBe(
      404,
    );
    expect((await list(s.app)).json().boulders).toEqual([]);
  });

  it("rejects a non-workout asset and a malformed body", async () => {
    const s = setup();
    const boulder = await bareBoulder(s);
    const food = asset(A, "food");
    s.media.__seedForTest(food);
    const wrong = await link(s.app, boulder.ascentId, food.id);
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json().error.code).toBe("VALIDATION_ERROR");
    expect((await link(s.app, boulder.ascentId, "nope")).statusCode).toBe(400);
  });

  it("replaces a different photo and erases the previous asset first", async () => {
    const s = setup();
    const boulder = await boulderWithPhoto(s);
    const next = asset(A, "workout");
    s.media.__seedForTest(next);
    const response = await link(s.app, boulder.ascentId, next.id);
    expect(response.statusCode).toBe(200);
    expect(response.json().ascent.photoAssetId).toBe(next.id);
    expect(s.events).toEqual([
      `bytes:${boulder.objectPath}`,
      `asset:${boulder.assetId}`,
    ]);
    expect(
      (await s.media.getById(boulder.assetId, { accessToken: "A" }))?.deletedAt,
    ).not.toBeNull();
    expect(
      (await s.media.getById(next.id, { accessToken: "A" }))?.deletedAt,
    ).toBeNull();
  });

  it("keeps the old link when erasing the replaced photo fails", async () => {
    const s = setup();
    const boulder = await boulderWithPhoto(s);
    const next = asset(A, "workout");
    s.media.__seedForTest(next);
    s.failures.remove = true;
    expect(
      (await link(s.app, boulder.ascentId, next.id)).statusCode,
    ).toBeGreaterThanOrEqual(500);
    expect(
      (await s.bouldering.getAscent(A, boulder.ascentId, { accessToken: "A" }))
        ?.photoAssetId,
    ).toBe(boulder.assetId);
    s.failures.remove = false;
    expect((await link(s.app, boulder.ascentId, next.id)).statusCode).toBe(200);
  });

  it("stays available while bouldering is switched off", async () => {
    const s = setup({ boulderingEnabled: false });
    const session = await s.bouldering.startSession(
      A,
      {
        clientOperationId: crypto.randomUUID(),
        recordingTimezone: "UTC",
        gymName: null,
      },
      { accessToken: "A" },
    );
    const ascent = await s.bouldering.createAscent(
      A,
      session.id,
      {
        clientOperationId: crypto.randomUUID(),
        grade: "6A",
        result: "sent",
        attempts: null,
        holdColour: null,
        note: null,
        photoAssetId: null,
      },
      { accessToken: "A" },
    );
    const photo = asset(A, "workout");
    s.media.__seedForTest(photo);
    expect((await link(s.app, ascent.id, photo.id)).statusCode).toBe(200);
  });
});
