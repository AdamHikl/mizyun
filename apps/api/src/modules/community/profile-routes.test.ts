import { afterEach, describe, expect, it, vi } from "vitest";
import { CommunityMutationError, type UserId } from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";

import { buildApp } from "../../app.js";
import { InMemoryProfileRepository } from "../../profile-repository.js";
import { InMemoryCommunityRepository } from "../../community-repository.js";

const userAdult: UserId = "00000000-0000-4000-8000-000000000001" as UserId;
const userMinor: UserId = "00000000-0000-4000-8000-000000000002" as UserId;
const userOther: UserId = "00000000-0000-4000-8000-000000000003" as UserId;

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const tokenVerifierFor = (
  principal: { readonly userId: UserId } | null,
): AccessTokenVerifier => ({
  verify: async (token) => {
    if (token === "token-adult") {
      return {
        userId: userAdult,
        role: "authenticated",
        accessToken: "token-adult",
      };
    }
    if (token === "token-minor") {
      return {
        userId: userMinor,
        role: "authenticated",
        accessToken: "token-minor",
      };
    }
    if (token === "token-other") {
      return {
        userId: userOther,
        role: "authenticated",
        accessToken: "token-other",
      };
    }
    if (principal && token === "valid") {
      return {
        userId: principal.userId,
        role: "authenticated",
        accessToken: "valid",
      };
    }
    return null;
  },
});

const setupTestApp = async () => {
  const profileRepository = new InMemoryProfileRepository({
    defaultTimezone: "UTC",
    defaultUnitSystem: "metric",
    defaultBirthYear: 1990, // Adult by default
  });

  // Seed base profiles
  const now = new Date();
  const adultProfile = await profileRepository.getOrCreate(userAdult, {
    now,
    accessToken: "token-adult",
  });
  await profileRepository.update(
    userAdult,
    { ...adultProfile, birthYear: 1995 },
    { accessToken: "token-adult" },
  );

  const minorProfile = await profileRepository.getOrCreate(userMinor, {
    now,
    accessToken: "token-minor",
  });
  await profileRepository.update(
    userMinor,
    { ...minorProfile, birthYear: 2012 },
    { accessToken: "token-minor" },
  );

  const otherProfile = await profileRepository.getOrCreate(userOther, {
    now,
    accessToken: "token-other",
  });
  await profileRepository.update(
    userOther,
    { ...otherProfile, birthYear: 1992 },
    { accessToken: "token-other" },
  );

  const communityRepository = new InMemoryCommunityRepository();

  const app = buildApp({
    tokenVerifier: tokenVerifierFor({ userId: userAdult }),
    profileRepository,
    communityRepository,
  });

  apps.push(app);
  return { app, profileRepository, communityRepository };
};

describe("Community Profile Routes", () => {
  it("returns 404 COMMUNITY_NOT_ENROLLED for unenrolled user", async () => {
    const { app } = await setupTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/v1/community/profile",
      headers: { authorization: "Bearer token-adult" },
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error.code).toBe("COMMUNITY_NOT_ENROLLED");
  });

  it("blocks minors under 18 from enrolling with 403 COMMUNITY_AGE_RESTRICTED", async () => {
    const { app } = await setupTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/community/profile",
      headers: { authorization: "Bearer token-minor" },
      payload: {
        handle: "young_athlete",
        displayName: "Young Athlete",
        acceptedTerms: true,
        adultDeclaration: true,
        termsVersion: "2026-09-30",
        isSearchable: true,
      },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(body.error.code).toBe("COMMUNITY_AGE_RESTRICTED");
  });

  it("allows adult users to enroll with valid handle and terms", async () => {
    const { app } = await setupTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/community/profile",
      headers: { authorization: "Bearer token-adult" },
      payload: {
        handle: "marathon_dan",
        displayName: "Dan Runner",
        bio: "Training for a sub-3 marathon",
        isSearchable: true,
        acceptedTerms: true,
        adultDeclaration: true,
        termsVersion: "2026-09-30",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.handle).toBe("marathon_dan");
    expect(body.displayName).toBe("Dan Runner");
    expect(body.avatarSymbol).toBe("DR"); // Derived from Dan Runner
    expect(body.generation).toBe(1);
    expect(body.status).toBe("active");
  });

  it.each([false, true])(
    "enrolls without enrolled-only discovery, including withdrawn accounts: %s",
    async (reenroll) => {
      const { app, communityRepository } = await setupTestApp();
      const payload = {
        handle: "private_runner",
        displayName: "Private Runner",
        acceptedTerms: true,
        adultDeclaration: true,
        termsVersion: "2026-09-30",
        isSearchable: false,
      };
      if (reenroll) {
        await communityRepository.saveProfile(userAdult, {
          ...payload,
          enrollmentConsent: {
            adultDeclaration: true,
            termsVersion: "2026-09-30",
          },
        });
        await communityRepository.withdrawProfile(userAdult);
      }
      // Real discovery RPC requires an already active Community caller.
      const discovery = vi
        .spyOn(communityRepository, "getProfileByHandle")
        .mockRejectedValue(new CommunityMutationError("unavailable"));
      const response = await app.inject({
        method: "POST",
        url: "/v1/community/profile",
        headers: { authorization: "Bearer token-adult" },
        payload,
      });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        handle: "private_runner",
        status: "active",
        generation: reenroll ? 2 : 1,
        isSearchable: false,
      });
      expect(discovery).not.toHaveBeenCalled();
    },
  );

  it("rejects handle collisions with 409 HANDLE_TAKEN", async () => {
    const { app } = await setupTestApp();

    // User adult claims handle
    await app.inject({
      method: "POST",
      url: "/v1/community/profile",
      headers: { authorization: "Bearer token-adult" },
      payload: {
        handle: "popular_handle",
        displayName: "User One",
        acceptedTerms: true,
        adultDeclaration: true,
        termsVersion: "2026-09-30",
        isSearchable: true,
      },
    });

    // User other attempts to claim same handle
    const response = await app.inject({
      method: "POST",
      url: "/v1/community/profile",
      headers: { authorization: "Bearer token-other" },
      payload: {
        handle: "popular_handle",
        displayName: "User Two",
        acceptedTerms: true,
        adultDeclaration: true,
        termsVersion: "2026-09-30",
        isSearchable: true,
      },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.error.code).toBe("HANDLE_TAKEN");
  });

  it.each([{}, { adultDeclaration: false }, { termsVersion: "2026-09-29" }])(
    "denies missing or obsolete consent without creating identity: %j",
    async (change) => {
      const { app, communityRepository } = await setupTestApp();
      const consent = Object.keys(change).length
        ? { adultDeclaration: true, termsVersion: "2026-09-30", ...change }
        : {};
      const response = await app.inject({
        method: "POST",
        url: "/v1/community/profile",
        headers: { authorization: "Bearer token-adult" },
        payload: {
          handle: "receipt_runner",
          displayName: "Runner",
          acceptedTerms: true,
          ...consent,
        },
      });
      expect(response.statusCode).toBe(422);
      expect(await communityRepository.getProfile(userAdult)).toBeNull();
    },
  );

  it("rejects the ambiguous 18-year birth-year boundary and missing year", async () => {
    const { app, profileRepository } = await setupTestApp();
    for (const birthYear of [new Date().getUTCFullYear() - 18, null]) {
      const existing = await profileRepository.getOrCreate(userAdult, {
        now: new Date(),
        accessToken: "token-adult",
      });
      await profileRepository.update(
        userAdult,
        { ...existing, birthYear },
        { accessToken: "token-adult" },
      );
      const response = await app.inject({
        method: "POST",
        url: "/v1/community/profile",
        headers: { authorization: "Bearer token-adult" },
        payload: {
          handle: "boundary_runner",
          displayName: "Runner",
          acceptedTerms: true,
          adultDeclaration: true,
          termsVersion: "2026-09-30",
        },
      });
      expect(response.statusCode).toBe(403);
    }
  });

  it("reconciles a retried successful enrollment without incrementing its generation", async () => {
    const { app } = await setupTestApp();
    const request = {
      method: "POST" as const,
      url: "/v1/community/profile",
      headers: { authorization: "Bearer token-adult" },
      payload: {
        handle: "retry_runner",
        displayName: "Runner",
        acceptedTerms: true,
        adultDeclaration: true,
        termsVersion: "2026-09-30",
      },
    };
    const first = await app.inject(request);
    const retry = await app.inject(request);
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json().generation).toBe(first.json().generation);
    expect(retry.json().isSearchable).toBe(false);
    expect(Object.keys(retry.json()).sort()).toEqual(
      [
        "userId",
        "handle",
        "displayName",
        "avatarSymbol",
        "bio",
        "isSearchable",
        "status",
        "generation",
        "createdAt",
        "updatedAt",
      ].sort(),
    );
  });

  it("checks handle availability correctly", async () => {
    const { app } = await setupTestApp();

    // Available handle
    const res1 = await app.inject({
      method: "GET",
      url: "/v1/community/handles/check?handle=unique_runner",
      headers: { authorization: "Bearer token-adult" },
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.json().available).toBe(true);

    // Reserved handle
    const res2 = await app.inject({
      method: "GET",
      url: "/v1/community/handles/check?handle=admin",
      headers: { authorization: "Bearer token-adult" },
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().available).toBe(false);

    // Invalid format handle
    const res3 = await app.inject({
      method: "GET",
      url: "/v1/community/handles/check?handle=a",
      headers: { authorization: "Bearer token-adult" },
    });
    expect(res3.statusCode).toBe(200);
    expect(res3.json().available).toBe(false);
  });

  it("allows updating profile and withdrawing", async () => {
    const { app } = await setupTestApp();

    // Enroll
    await app.inject({
      method: "POST",
      url: "/v1/community/profile",
      headers: { authorization: "Bearer token-adult" },
      payload: {
        handle: "runner_d",
        displayName: "Dan R.",
        acceptedTerms: true,
        adultDeclaration: true,
        termsVersion: "2026-09-30",
        isSearchable: true,
      },
    });

    // Update
    const updateRes = await app.inject({
      method: "PATCH",
      url: "/v1/community/profile",
      headers: { authorization: "Bearer token-adult" },
      payload: {
        displayName: "Daniel R.",
        bio: "New updated bio",
        isSearchable: false,
      },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().displayName).toBe("Daniel R.");
    expect(updateRes.json().isSearchable).toBe(false);

    // Withdraw
    const withdrawRes = await app.inject({
      method: "DELETE",
      url: "/v1/community/profile",
      headers: { authorization: "Bearer token-adult" },
    });
    expect(withdrawRes.statusCode).toBe(200);
    expect(withdrawRes.json().withdrawn).toBe(true);

    // Owner can recover the reserved handle after withdrawal
    const getRes = await app.inject({
      method: "GET",
      url: "/v1/community/profile",
      headers: { authorization: "Bearer token-adult" },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().status).toBe("withdrawn");

    // Re-enroll increments generation
    const reEnrollRes = await app.inject({
      method: "POST",
      url: "/v1/community/profile",
      headers: { authorization: "Bearer token-adult" },
      payload: {
        handle: "runner_d",
        displayName: "Daniel R.",
        acceptedTerms: true,
        adultDeclaration: true,
        termsVersion: "2026-09-30",
        isSearchable: true,
      },
    });
    expect(reEnrollRes.statusCode).toBe(201);
    expect(reEnrollRes.json().generation).toBe(2);
  });

  it("searches discoverable profiles excluding self and blocked users", async () => {
    const { app, communityRepository } = await setupTestApp();

    // Enroll user adult
    await app.inject({
      method: "POST",
      url: "/v1/community/profile",
      headers: { authorization: "Bearer token-adult" },
      payload: {
        handle: "dan_searcher",
        displayName: "Dan S.",
        acceptedTerms: true,
        adultDeclaration: true,
        termsVersion: "2026-09-30",
        isSearchable: true,
      },
    });

    // Enroll user other
    await app.inject({
      method: "POST",
      url: "/v1/community/profile",
      headers: { authorization: "Bearer token-other" },
      payload: {
        handle: "alice_wonder",
        displayName: "Alice Runner",
        acceptedTerms: true,
        adultDeclaration: true,
        termsVersion: "2026-09-30",
        isSearchable: true,
      },
    });

    // Search for exact handle "alice_wonder"
    const searchRes = await app.inject({
      method: "GET",
      url: "/v1/community/search?q=alice_wonder",
      headers: { authorization: "Bearer token-adult" },
    });

    expect(searchRes.statusCode).toBe(200);
    const searchBody = searchRes.json();
    expect(searchBody.profiles.length).toBe(1);
    expect(searchBody.profiles[0].handle).toBe("alice_wonder");
    expect(searchBody.profiles[0].relationshipWithViewer).toBe("none");

    // Block alice -> search should no longer return alice
    await communityRepository.blockUser(userAdult, userOther);

    const searchBlocked = await app.inject({
      method: "GET",
      url: "/v1/community/search?q=alice_wonder",
      headers: { authorization: "Bearer token-adult" },
    });

    expect(searchBlocked.json().profiles.length).toBe(0);
  });

  it("fetches single public profile with enrollment and block checks", async () => {
    const { app, communityRepository } = await setupTestApp();

    // Enroll user adult
    await app.inject({
      method: "POST",
      url: "/v1/community/profile",
      headers: { authorization: "Bearer token-adult" },
      payload: {
        handle: "dan_profile",
        displayName: "Dan P.",
        acceptedTerms: true,
        adultDeclaration: true,
        termsVersion: "2026-09-30",
        isSearchable: true,
      },
    });

    // Unenrolled caller cannot view profile
    const unenrolledRes = await app.inject({
      method: "GET",
      url: `/v1/community/profiles/${userAdult}`,
      headers: { authorization: "Bearer token-other" },
    });
    expect(unenrolledRes.statusCode).toBe(403);
    expect(unenrolledRes.json().error.code).toBe("COMMUNITY_NOT_ENROLLED");

    // Enroll caller (other)
    await app.inject({
      method: "POST",
      url: "/v1/community/profile",
      headers: { authorization: "Bearer token-other" },
      payload: {
        handle: "alice_profile",
        displayName: "Alice P.",
        acceptedTerms: true,
        adultDeclaration: true,
        termsVersion: "2026-09-30",
        isSearchable: true,
      },
    });

    // Now caller can view profile
    const viewRes = await app.inject({
      method: "GET",
      url: `/v1/community/profiles/${userAdult}`,
      headers: { authorization: "Bearer token-other" },
    });
    expect(viewRes.statusCode).toBe(200);
    expect(viewRes.json().handle).toBe("dan_profile");
    expect(viewRes.json().displayName).toBe("Dan P.");
    expect(viewRes.json().avatarSymbol).toBe("DP");
    expect(viewRes.json().relationshipWithViewer).toBe("none");

    // Block caller -> target becomes unavailable (404)
    await communityRepository.blockUser(userAdult, userOther);
    const blockedRes = await app.inject({
      method: "GET",
      url: `/v1/community/profiles/${userAdult}`,
      headers: { authorization: "Bearer token-other" },
    });
    expect(blockedRes.statusCode).toBe(404);
  });
});

describe("community profile privacy regressions", () => {
  it("does not let enrollment clear moderation suspension", async () => {
    const { app, communityRepository } = await setupTestApp();
    const original = await communityRepository.saveProfile(userAdult, {
      handle: "suspended",
      displayName: "Suspended",
      isSearchable: true,
    });
    vi.spyOn(communityRepository, "getProfile").mockResolvedValue({
      ...original,
      status: "suspended",
    });
    const save = vi.spyOn(communityRepository, "saveProfile");
    const response = await app.inject({
      method: "POST",
      url: "/v1/community/profile",
      headers: { authorization: "Bearer token-adult" },
      payload: {
        handle: "suspended",
        displayName: "Suspended",
        acceptedTerms: true,
        adultDeclaration: true,
        termsVersion: "2026-09-30",
        isSearchable: true,
      },
    });
    expect(response.statusCode).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });

  it("does not expose bio through exact lookup to an unrelated viewer", async () => {
    const { app, communityRepository } = await setupTestApp();
    await communityRepository.saveProfile(userAdult, {
      handle: "viewer",
      displayName: "Viewer",
      isSearchable: true,
    });
    await communityRepository.saveProfile(userOther, {
      handle: "private_bio",
      displayName: "Other",
      bio: "Follower-only bio",
      isSearchable: true,
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/community/search?q=private_bio",
      headers: { authorization: "Bearer token-adult" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().profiles[0].bio).toBeNull();
  });

  it("does not disclose a nonsearchable profile from a guessed UUID", async () => {
    const { app, communityRepository } = await setupTestApp();
    await communityRepository.saveProfile(userAdult, {
      handle: "viewer",
      displayName: "Viewer",
      isSearchable: true,
    });
    await communityRepository.saveProfile(userOther, {
      handle: "hidden",
      displayName: "Other",
      isSearchable: false,
    });
    const response = await app.inject({
      method: "GET",
      url: `/v1/community/profiles/${userOther}`,
      headers: { authorization: "Bearer token-adult" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("allows following a hidden inviter only with their exact invitation capability", async () => {
    const { app, communityRepository } = await setupTestApp();
    await communityRepository.saveProfile(userAdult, {
      handle: "viewer",
      displayName: "Viewer",
      isSearchable: true,
    });
    await communityRepository.saveProfile(userOther, {
      handle: "hidden_inviter",
      displayName: "Hidden",
      isSearchable: false,
    });
    const request = {
      method: "POST" as const,
      url: "/v1/community/relationships/follow",
      headers: { authorization: "Bearer token-adult" },
      payload: { targetUserId: userOther, operationId: crypto.randomUUID() },
    };
    expect((await app.inject(request)).statusCode).toBe(404);
    const invitation = await communityRepository.createInvitation(userOther);
    const response = await app.inject({
      ...request,
      payload: { ...request.payload, invitationToken: invitation.token },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe("pending");
  });

  it("reports hidden and suspended handles as reserved to an unenrolled caller", async () => {
    const { app, communityRepository } = await setupTestApp();
    await communityRepository.saveProfile(userOther, {
      handle: "hidden_reserved",
      displayName: "Hidden",
      isSearchable: false,
    });
    // Production identity lookups intentionally hide this target from this caller.
    vi.spyOn(communityRepository, "getProfileByHandle").mockResolvedValue(null);
    const request = {
      method: "GET" as const,
      url: "/v1/community/handles/check?handle=hidden_reserved",
      headers: { authorization: "Bearer token-adult" },
    };
    const hidden = await app.inject(request);
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json().available).toBe(false);
    const stored = await communityRepository.getProfile(userOther);
    // Simulate an existing staff suspension; every persisted handle stays reserved.
    Object.assign(stored!, { status: "suspended" });
    expect((await communityRepository.getProfile(userOther))?.status).toBe(
      "suspended",
    );
    const suspended = await app.inject(request);
    expect(suspended.json().available).toBe(false);
    expect(suspended.json().userId).toBeUndefined();
  });
});
