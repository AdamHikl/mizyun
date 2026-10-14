import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoredFoodEntry, UserId } from "@mizyun/core";
import { buildApp } from "../../app.js";
import { InMemoryCommunityRepository } from "../../community-repository.js";
import { InMemoryFoodEntryRepository } from "../../food-entry-repository.js";
import { InMemoryProfileRepository } from "../../profile-repository.js";

const alice = "c2380000-0000-4000-8000-000000000001" as UserId;
const bob = "c2380000-0000-4000-8000-000000000002" as UserId;
const eve = "c2380000-0000-4000-8000-000000000003" as UserId;
const mealId = "d2380000-0000-4000-8000-000000000001";
const headers = (user: UserId) => ({ authorization: `Bearer ${user}` });
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const setup = async () => {
  const communityRepository = new InMemoryCommunityRepository();
  const foodEntryRepository = new InMemoryFoodEntryRepository();
  const profileRepository = new InMemoryProfileRepository({
    defaultTimezone: "UTC",
    defaultUnitSystem: "metric",
    defaultBirthYear: 1990,
  });
  for (const [user, handle] of [
    [alice, "meal_alice"],
    [bob, "meal_bob"],
    [eve, "meal_eve"],
  ] as const)
    await communityRepository.saveProfile(user, {
      handle,
      displayName: handle,
      isSearchable: true,
    });
  const rel = await communityRepository.sendFollowRequest(bob, alice);
  await communityRepository.updateRelationshipStatus(rel.id, alice, "approved");
  const date = new Date("2026-10-10T12:00:00Z");
  const meal: StoredFoodEntry = {
    id: mealId,
    userId: alice,
    name: "Rice bowl",
    consumedAt: date,
    caloriesKcal: 450,
    proteinG: 20,
    carbohydrateG: 60,
    fatG: 12,
    source: "manual",
    confidence: null,
    confirmedByUser: true,
    createdAt: date,
    updatedAt: date,
    photoAssetId: "private-photo",
    details: {
      privateNotes: "private notes",
      provider: "private provider",
      ingredients: ["private recipe"],
    },
  };
  foodEntryRepository.__seedForTest(meal);
  const app = buildApp({
    communityRepository,
    foodEntryRepository,
    profileRepository,
    communityOperations: {
      browsing: true,
      enrollment: true,
      discovery: true,
      publish: true,
      engagement: true,
      delivery: false,
    },
    tokenVerifier: {
      verify: async (token) =>
        [alice, bob, eve].includes(token as UserId)
          ? {
              userId: token as UserId,
              role: "authenticated",
              accessToken: token,
            }
          : null,
    },
  });
  apps.push(app);
  await app.ready();
  const preview = await app.inject({
    method: "GET",
    url: `/v1/community/meals/${mealId}/preview`,
    headers: headers(alice),
  });
  expect(preview.statusCode).toBe(200);
  const publish = (overrides: Record<string, unknown> = {}) =>
    app.inject({
      method: "POST",
      url: "/v1/community/meal-activities",
      headers: headers(alice),
      payload: {
        mealId,
        enrollmentGeneration: 1,
        operationId: "a2380000-0000-4000-8000-000000000001",
        expectedVersion: 0,
        expectedRevoked: false,
        sharedDay: preview.json().sharedDay,
        includeNutrition: false,
        expectedMealDetails: {
          name: "Rice bowl",
          caloriesKcal: null,
          proteinG: null,
          carbsG: null,
          fatG: null,
        },
        ...overrides,
      },
    });
  return {
    app,
    communityRepository,
    foodEntryRepository,
    meal,
    preview: preview.json(),
    publish,
  };
};

describe("Community meal publication", () => {
  it("rejects malformed source IDs before querying the repository", async () => {
    const { app, foodEntryRepository } = await setup();
    const read = vi.spyOn(foodEntryRepository, "getById");
    const response = await app.inject({
      method: "GET",
      url: `/v1/community/meals/${"-".repeat(36)}/preview`,
      headers: headers(alice),
    });
    expect(response.statusCode).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });
  it("shares only the confirmed allowlist and keeps source context owner-only across detail/feed/profile", async () => {
    const { app, publish, preview } = await setup();
    expect(Object.keys(preview.mealDetails).sort()).toEqual([
      "caloriesKcal",
      "carbsG",
      "fatG",
      "name",
      "proteinG",
    ]);
    const response = await publish();
    expect(response.statusCode).toBe(201);
    const card = response.json();
    expect(card.activityKind).toBe("meal");
    expect(card.sourceWorkoutId).toBeNull();
    expect(card.sourceMealId).toBe(mealId);
    for (const url of [
      `/v1/community/activities/${card.id}`,
      "/v1/community/feed",
      `/v1/community/profiles/${alice}/activities`,
    ]) {
      const read = await app.inject({
        method: "GET",
        url,
        headers: headers(bob),
      });
      expect(read.statusCode, url).toBe(200);
      expect(read.body).toContain('"activityKind":"meal"');
      expect(read.body).toContain('"caloriesKcal":null');
      for (const privateValue of [
        mealId,
        "privateNotes",
        "private notes",
        "private-photo",
        "private provider",
        "private recipe",
      ])
        expect(read.body).not.toContain(privateValue);
    }
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/community/activities/${card.id}/manage`,
          headers: headers(alice),
        })
      ).json().sourceMealId,
    ).toBe(mealId);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/community/activities/${card.id}/manage`,
          headers: headers(bob),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/community/activities/${card.id}`,
          headers: headers(eve),
        })
      ).statusCode,
    ).toBe(404);
  });
  it("requires explicit nutrition opt-in and rejects cross-owner or unconfirmed sources", async () => {
    const { app, preview, publish, foodEntryRepository, meal } = await setup();
    expect(
      (await publish({ expectedMealDetails: preview.mealDetails })).statusCode,
    ).toBe(422);
    const nutrition = await publish({
      includeNutrition: true,
      expectedMealDetails: preview.mealDetails,
    });
    expect(nutrition.statusCode).toBe(201);
    expect(nutrition.json().mealDetails.caloriesKcal).toBe(450);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/community/meals/${mealId}/preview`,
          headers: headers(bob),
        })
      ).statusCode,
    ).toBe(404);
    await foodEntryRepository.update(
      { ...meal, confirmedByUser: false },
      { accessToken: alice },
    );
    expect(
      (await publish({ operationId: "a2380000-0000-4000-8000-000000000002" }))
        .statusCode,
    ).toBe(422);
  });
  it("rejects stale previews, preserves durable retries, and prevents retries after source edit or unpublish", async () => {
    const { app, publish, foodEntryRepository, meal } = await setup();
    expect(
      (
        await publish({
          expectedMealDetails: {
            name: "Wrong name",
            caloriesKcal: null,
            proteinG: null,
            carbsG: null,
            fatG: null,
          },
        })
      ).statusCode,
    ).toBe(409);
    const first = await publish();
    expect(first.statusCode).toBe(201);
    const retry = await publish();
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    const changed = await publish({
      expectedVersion: 1,
      operationId: "a2380000-0000-4000-8000-000000000002",
      includeNutrition: true,
      expectedMealDetails: {
        name: "Rice bowl",
        caloriesKcal: 450,
        proteinG: 20,
        carbsG: 60,
        fatG: 12,
      },
    });
    expect(changed.statusCode).toBe(201);
    expect(changed.json().version).toBe(2);
    expect((await publish()).statusCode).toBe(409);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/v1/community/activities/${first.json().id}`,
          headers: headers(alice),
          payload: { includeDuration: false, expectedVersion: 2 },
        })
      ).statusCode,
    ).toBe(422);
    await foodEntryRepository.update(
      { ...meal, name: "Updated rice bowl" },
      { accessToken: alice },
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/community/activities/${first.json().id}`,
          headers: headers(bob),
        })
      ).statusCode,
    ).toBe(404);
    expect((await publish()).statusCode).toBe(409);
  });
  it("uses the common reaction/block lifecycle and revokes on source deletion", async () => {
    const { app, publish, communityRepository, foodEntryRepository } =
      await setup();
    const card = (await publish()).json();
    await communityRepository.setReaction(card.id, bob, "clap");
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/community/activities/${card.id}`,
          headers: headers(bob),
        })
      ).json().reactionCounts.clap,
    ).toBe(1);
    await communityRepository.blockUser(bob, alice);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/community/activities/${card.id}`,
          headers: headers(bob),
        })
      ).statusCode,
    ).toBe(404);
    await foodEntryRepository.delete(mealId, { accessToken: alice });
    expect(
      (await communityRepository.getActivityById(card.id))?.revokedAt,
    ).not.toBeNull();
    expect((await publish()).statusCode).toBe(404);
  });
});
