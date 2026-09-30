import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserId } from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";

import { buildApp } from "../../app.js";
import { InMemoryProfileRepository } from "../../profile-repository.js";
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

  const app = buildApp({
    tokenVerifier: tokenVerifierFor(),
    profileRepository,
    communityRepository,
  });
  apps.push(app);
  await app.ready();
  return { app, communityRepository };
};

describe("Community Invitation Routes", () => {
  it("retains issuance quota through social cleanup and resets only on the UTC day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T23:50:00Z"));
    try {
      const repository = new InMemoryCommunityRepository();
      await repository.saveProfile(userAlice, {
        handle: "alice_safe",
        displayName: "Alice",
      });
      for (let index = 0; index < 20; index++) {
        const invitation = await repository.createInvitation(userAlice);
        await repository.revokeInvitation(invitation.id, userAlice);
      }
      await repository.deleteAllForUser(userAlice);
      await repository.saveProfile(userAlice, {
        handle: "alice_safe",
        displayName: "Alice",
      });
      await expect(
        repository.createInvitation(userAlice),
      ).rejects.toMatchObject({ code: "rate_limited" });
      vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
      await expect(
        repository.createInvitation(userAlice),
      ).resolves.toMatchObject({ inviterUserId: userAlice });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns no bio through invitations even for an approved follower", async () => {
    const { app, communityRepository } = await setupTestApp();
    await communityRepository.saveProfile(userAlice, {
      handle: "alice_private",
      displayName: "Alice",
      bio: "Hidden bio",
      isSearchable: true,
    });
    await communityRepository.saveProfile(userBob, {
      handle: "bob_private",
      displayName: "Bob",
    });
    const edge = await communityRepository.sendFollowRequest(
      userBob,
      userAlice,
    );
    await communityRepository.updateRelationshipStatus(
      edge.id,
      userAlice,
      "approved",
    );
    await communityRepository.saveProfile(userAlice, {
      handle: "alice_private",
      displayName: "Alice",
      bio: "Hidden bio",
      isSearchable: false,
    });
    const invitation = await communityRepository.createInvitation(userAlice);
    const res = await app.inject({
      method: "GET",
      url: `/v1/community/invitations/${invitation.token}`,
      headers: { authorization: "Bearer token-bob" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().inviter.bio).toBeNull();
    expect(res.json().inviter.relationshipWithViewer).toBe("following");
    const search = await app.inject({
      method: "GET",
      url: "/v1/community/search?q=alice_private",
      headers: { authorization: "Bearer token-bob" },
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().profiles).toEqual([]);
  });

  it("does not send bearer tokens to an arbitrary PUBLIC_APP_URL", async () => {
    const previous = process.env.PUBLIC_APP_URL;
    process.env.PUBLIC_APP_URL = "https://untrusted.example";
    try {
      const { app, communityRepository } = await setupTestApp();
      await communityRepository.saveProfile(userAlice, {
        handle: "alice_safe",
        displayName: "Alice",
      });
      const res = await app.inject({
        method: "POST",
        url: "/v1/community/invitations",
        headers: { authorization: "Bearer token-alice" },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().inviteUrl).toMatch(
        /^mizyun(?:-dev)?:\/\/invite\/[A-Za-z0-9_-]{22}$/,
      );
    } finally {
      if (previous === undefined) delete process.env.PUBLIC_APP_URL;
      else process.env.PUBLIC_APP_URL = previous;
    }
  });

  it("shares actor quota across exact lookup and invalid invitation probes", async () => {
    const { app, communityRepository } = await setupTestApp();
    await communityRepository.saveProfile(userAlice, {
      handle: "alice_safe",
      displayName: "Alice",
    });
    for (let index = 0; index < 30; index++) {
      const res = await app.inject({
        method: "GET",
        url:
          index % 2
            ? "/v1/community/search?q=unknown_handle"
            : "/v1/community/invitations/ABCDEFGHIJKLMNOPQRSTUV",
        headers: { authorization: "Bearer token-alice" },
      });
      expect(res.statusCode).toBe(index % 2 ? 200 : 404);
    }
    const res = await app.inject({
      method: "GET",
      url: "/v1/community/search?q=unknown_handle",
      headers: { authorization: "Bearer token-alice" },
    });
    expect(res.statusCode).toBe(429);
  });

  it("denies unauthenticated creation", async () => {
    const { app } = await setupTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/community/invitations",
    });
    expect(res.statusCode).toBe(401);
  });

  it("denies creation if caller is not enrolled in Community", async () => {
    const { app } = await setupTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/community/invitations",
      headers: { authorization: "Bearer token-alice" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("COMMUNITY_NOT_ENROLLED");
  });

  it("creates an invitation token and returns invite URL", async () => {
    const { app, communityRepository } = await setupTestApp();

    // Enroll Alice
    await communityRepository.saveProfile(
      userAlice,
      {
        handle: "alice_runner",
        displayName: "Alice Runner",
        isSearchable: false, // Non-searchable profile!
      },
      { accessToken: "token-alice" },
    );

    const res = await app.inject({
      method: "POST",
      url: "/v1/community/invitations",
      headers: { authorization: "Bearer token-alice" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.invitation.inviterUserId).toBe(userAlice);
    expect(body.invitation.token).toBeTruthy();
    expect(body.invitation.revokedAt).toBeNull();
    expect(body.inviteUrl).toContain(`/invite/${body.invitation.token}`);
  });

  it("lists active invitations for the author", async () => {
    const { app, communityRepository } = await setupTestApp();

    await communityRepository.saveProfile(
      userAlice,
      {
        handle: "alice_runner",
        displayName: "Alice Runner",
        isSearchable: true,
      },
      { accessToken: "token-alice" },
    );

    await app.inject({
      method: "POST",
      url: "/v1/community/invitations",
      headers: { authorization: "Bearer token-alice" },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/community/invitations",
      headers: { authorization: "Bearer token-alice" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBe(1);
    expect(body.items[0].inviterUserId).toBe(userAlice);
  });

  it("resolves valid invitation link revealing minimal inviter profile", async () => {
    const { app, communityRepository } = await setupTestApp();

    // Alice is enrolled but non-searchable
    await communityRepository.saveProfile(
      userAlice,
      {
        handle: "alice_runner",
        displayName: "Alice Runner",
        avatarSymbol: "AR",
        bio: "Private runner",
        isSearchable: false,
      },
      { accessToken: "token-alice" },
    );

    // Bob is enrolled
    await communityRepository.saveProfile(
      userBob,
      {
        handle: "bob_fit",
        displayName: "Bob Fit",
        isSearchable: true,
      },
      { accessToken: "token-bob" },
    );

    // Alice creates invitation
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/community/invitations",
      headers: { authorization: "Bearer token-alice" },
    });
    const { invitation } = createRes.json();

    // Bob resolves Alice's invitation token
    const resolveRes = await app.inject({
      method: "GET",
      url: `/v1/community/invitations/${invitation.token}`,
      headers: { authorization: "Bearer token-bob" },
    });

    expect(resolveRes.statusCode).toBe(200);
    const body = resolveRes.json();
    expect(body.id).toBe(invitation.id);
    expect(body.inviter.handle).toBe("alice_runner");
    expect(body.inviter.displayName).toBe("Alice Runner");
    expect(body.inviter.avatarSymbol).toBe("AR");
    expect(body.inviter.relationshipWithViewer).toBe("none");
    expect(body.isExpired).toBe(false);
    expect(body.isRevoked).toBe(false);
    // Crucial check: private account fields never present
    expect(body.inviter.email).toBeUndefined();
    expect(body.inviter.birthYear).toBeUndefined();
  });

  it("returns 404 NOT_FOUND when a bilateral block exists between caller and inviter", async () => {
    const { app, communityRepository } = await setupTestApp();

    await communityRepository.saveProfile(
      userAlice,
      {
        handle: "alice_runner",
        displayName: "Alice",
        isSearchable: true,
      },
      { accessToken: "token-alice" },
    );
    await communityRepository.saveProfile(
      userBob,
      {
        handle: "bob_fit",
        displayName: "Bob",
        isSearchable: true,
      },
      { accessToken: "token-bob" },
    );

    const createRes = await app.inject({
      method: "POST",
      url: "/v1/community/invitations",
      headers: { authorization: "Bearer token-alice" },
    });
    const { invitation } = createRes.json();

    // Alice blocks Bob
    await communityRepository.blockUser(userAlice, userBob, {
      accessToken: "token-alice",
    });

    // Bob attempts to resolve Alice's invitation token
    const resolveRes = await app.inject({
      method: "GET",
      url: `/v1/community/invitations/${invitation.token}`,
      headers: { authorization: "Bearer token-bob" },
    });

    // Must fail closed with neutral 404
    expect(resolveRes.statusCode).toBe(404);
  });

  it("revokes invitation and returns neutral 404 on subsequent resolution", async () => {
    const { app, communityRepository } = await setupTestApp();

    await communityRepository.saveProfile(
      userAlice,
      {
        handle: "alice_runner",
        displayName: "Alice",
        isSearchable: true,
      },
      { accessToken: "token-alice" },
    );
    await communityRepository.saveProfile(
      userBob,
      {
        handle: "bob_fit",
        displayName: "Bob",
        isSearchable: true,
      },
      { accessToken: "token-bob" },
    );

    const createRes = await app.inject({
      method: "POST",
      url: "/v1/community/invitations",
      headers: { authorization: "Bearer token-alice" },
    });
    const { invitation } = createRes.json();

    // Alice revokes invitation
    const revokeRes = await app.inject({
      method: "DELETE",
      url: `/v1/community/invitations/${invitation.id}`,
      headers: { authorization: "Bearer token-alice" },
    });
    expect(revokeRes.statusCode).toBe(200);
    expect(revokeRes.json().revoked).toBe(true);

    // Bob attempts to resolve revoked invitation
    const resolveRes = await app.inject({
      method: "GET",
      url: `/v1/community/invitations/${invitation.token}`,
      headers: { authorization: "Bearer token-bob" },
    });
    expect(resolveRes.statusCode).toBe(404);
    expect(resolveRes.json().error.code).toBe("NOT_FOUND");
  });

  it("prevents Bob from revoking Alice's invitation", async () => {
    const { app, communityRepository } = await setupTestApp();

    await communityRepository.saveProfile(
      userAlice,
      {
        handle: "alice_runner",
        displayName: "Alice",
        isSearchable: true,
      },
      { accessToken: "token-alice" },
    );
    await communityRepository.saveProfile(
      userBob,
      {
        handle: "bob_fit",
        displayName: "Bob",
        isSearchable: true,
      },
      { accessToken: "token-bob" },
    );

    const createRes = await app.inject({
      method: "POST",
      url: "/v1/community/invitations",
      headers: { authorization: "Bearer token-alice" },
    });
    const { invitation } = createRes.json();

    // Bob tries to revoke Alice's invitation
    const revokeRes = await app.inject({
      method: "DELETE",
      url: `/v1/community/invitations/${invitation.id}`,
      headers: { authorization: "Bearer token-bob" },
    });
    expect(revokeRes.statusCode).toBe(404);
  });
});
