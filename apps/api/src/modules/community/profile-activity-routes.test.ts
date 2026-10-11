import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserId } from "@mizyun/core";
import { buildApp } from "../../app.js";
import { InMemoryCommunityRepository } from "../../community-repository.js";
import { InMemoryProfileRepository } from "../../profile-repository.js";
const alice = "00000000-0000-4000-8000-000000000001" as UserId;
const bob = "00000000-0000-4000-8000-000000000002" as UserId;
const outsider = "00000000-0000-4000-8000-000000000003" as UserId;
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function setup() {
  const repository = new InMemoryCommunityRepository();
  for (const [userId, handle] of [
    [alice, "alice"],
    [bob, "bob"],
    [outsider, "outsider"],
  ] as const)
    await repository.saveProfile(userId, {
      handle,
      displayName: handle,
      isSearchable: true,
    });
  const app = buildApp({
    communityRepository: repository,
    profileRepository: new InMemoryProfileRepository({
      defaultTimezone: "UTC",
      defaultUnitSystem: "metric",
      defaultBirthYear: 1990,
    }),
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
        [alice, bob, outsider].includes(token as UserId)
          ? {
              userId: token as UserId,
              role: "authenticated",
              accessToken: token,
            }
          : null,
    },
  });
  apps.push(app);
  const read = (viewer: UserId, author: UserId, query = "") =>
    app.inject({
      method: "GET",
      url: `/v1/community/profiles/${author}/activities${query}`,
      headers: { authorization: `Bearer ${viewer}` },
    });
  const publish = (author: UserId, n: number) =>
    repository.publishActivity(author, {
      sourceWorkoutId: `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      category: "strength",
      sharedDay: "2026-10-07",
      durationSeconds: 1200,
      enrollmentGeneration: 1,
      operationId: `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    });
  return { app, repository, read, publish };
}
describe("bounded profile activity audience", () => {
  it("requires current approved outgoing access and remains neutral to strangers/pending/reverse-only", async () => {
    const { repository, read, publish } = await setup();
    await publish(alice, 1);
    expect((await read(outsider, alice)).statusCode).toBe(404);
    const reverse = await repository.sendFollowRequest(alice, bob);
    await repository.updateRelationshipStatus(reverse.id, bob, "approved");
    expect((await read(bob, alice)).statusCode).toBe(404);
    const edge = await repository.sendFollowRequest(bob, alice);
    expect((await read(bob, alice)).statusCode).toBe(404);
    await repository.updateRelationshipStatus(edge.id, alice, "approved");
    const allowed = await read(bob, alice);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().items).toHaveLength(1);
    await repository.blockUser(alice, bob);
    expect((await read(bob, alice)).statusCode).toBe(404);
  });
  it("filters author before paging and keeps private source context absent from owner and peer DTOs", async () => {
    const { repository, read, publish } = await setup();
    const first = await publish(alice, 1);
    const second = await publish(alice, 2);
    await publish(bob, 3);
    const edge = await repository.sendFollowRequest(bob, alice);
    await repository.updateRelationshipStatus(edge.id, alice, "approved");
    for (const viewer of [alice, bob]) {
      const response = await read(viewer, alice, "?limit=1");
      expect(response.statusCode).toBe(200);
      const page = response.json();
      expect(page.items).toHaveLength(1);
      expect(page.items[0].authorUserId).toBe(alice);
      expect(page.items[0]).not.toHaveProperty("sourceWorkoutId");
      expect(page.items[0]).not.toHaveProperty("version");
      const next = await read(
        viewer,
        alice,
        `?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`,
      );
      expect(next.json().items).toHaveLength(1);
      expect(next.json().items[0].id).not.toBe(page.items[0].id);
    }
    await repository.revokeActivity(first.id, alice, { accessToken: alice });
    await repository.revokeActivity(second.id, alice, { accessToken: alice });
    expect((await read(bob, alice)).json().items).toEqual([]);
  });
  it("rejects replay under another viewer, another author, or a different feed scope before querying", async () => {
    const { app, repository, read, publish } = await setup();
    await publish(alice, 1);
    await publish(alice, 2);
    const edge = await repository.sendFollowRequest(bob, alice);
    await repository.updateRelationshipStatus(edge.id, alice, "approved");
    const authorCursor = (await read(alice, alice, "?limit=1")).json()
      .nextCursor;
    const bobAuthorCursor = (await read(bob, alice, "?limit=1")).json()
      .nextCursor;
    const feedCursor = (
      await app.inject({
        method: "GET",
        url: "/v1/community/feed?limit=1",
        headers: { authorization: `Bearer ${alice}` },
      })
    ).json().nextCursor;
    const getFeed = vi.spyOn(repository, "getFeed");
    expect((await read(bob, alice, `?cursor=${authorCursor}`)).statusCode).toBe(
      422,
    );
    expect(
      (await read(bob, bob, `?cursor=${bobAuthorCursor}`)).statusCode,
    ).toBe(422);
    expect((await read(alice, alice, `?cursor=${feedCursor}`)).statusCode).toBe(
      422,
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/community/feed?cursor=${authorCursor}`,
          headers: { authorization: `Bearer ${alice}` },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/community/feed?cursor=${feedCursor}`,
          headers: { authorization: `Bearer ${bob}` },
        })
      ).statusCode,
    ).toBe(422);
    expect(getFeed).not.toHaveBeenCalled();
  });

  it("rejects malformed cursors instead of falling back to a first page", async () => {
    const { read } = await setup();
    expect((await read(alice, alice, "?cursor=bad")).statusCode).toBe(422);
  });
});
