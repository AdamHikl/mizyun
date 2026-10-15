import { describe, it, expect, vi } from "vitest";
import { buildApp } from "../../app.js";
import { InMemoryCommunityRepository } from "../../community-repository.js";
import type { UserId } from "@mizyun/core";
import {
  communityOperationGate,
  communityExpansionOperationGate,
} from "./operations.js";
import { loadCommunityOperations } from "@mizyun/config";
describe("Community operations", () => {
  it("unconfigured API denies growth and browsing but retains owner privacy reductions", async () => {
    for (const key of [
      "COMMUNITY_ENABLED",
      "COMMUNITY_ENROLLMENT_ENABLED",
      "COMMUNITY_DISCOVERY_ENABLED",
      "COMMUNITY_PUBLISH_ENABLED",
      "COMMUNITY_ENGAGEMENT_ENABLED",
      "COMMUNITY_DELIVERY_ENABLED",
    ])
      vi.stubEnv(key, undefined);
    const communityRepository = new InMemoryCommunityRepository();
    const viewer = "00000000-0000-4000-8000-000000000001" as UserId;
    const owner = "00000000-0000-4000-8000-000000000002" as UserId;
    for (const [userId, handle] of [
      [viewer, "control_viewer"],
      [owner, "control_owner"],
    ] as const)
      await communityRepository.saveProfile(userId, {
        handle,
        displayName: "Synthetic",
        isSearchable: true,
        enrollmentConsent: {
          adultDeclaration: true,
          termsVersion: "2026-09-30",
        },
      });
    const edge = await communityRepository.sendFollowRequest(viewer, owner, {
      operationId: "control-request",
    });
    await communityRepository.updateRelationshipStatus(
      edge.id,
      owner,
      "approved",
    );
    const activity = await communityRepository.publishActivity(owner, {
      enrollmentGeneration: 1,
      operationId: "control-publication",
      sourceWorkoutId: "00000000-0000-4000-8000-000000000009",
      category: "strength",
      sharedDay: new Date().toISOString().slice(0, 10),
      durationSeconds: null,
    });
    await communityRepository.setReaction(activity.id, viewer, "clap");
    expect(
      (await communityRepository.getReactionsForActivity(activity.id, viewer))
        .viewerReaction,
    ).toBe("clap");
    const removal = vi.spyOn(communityRepository, "setReaction");
    const app = buildApp({
      communityRepository,
      tokenVerifier: {
        verify: async (accessToken) => ({
          userId: "00000000-0000-4000-8000-000000000001" as UserId,
          role: "authenticated",
          accessToken,
        }),
      },
    });
    const headers = { authorization: "Bearer captured" };
    try {
      for (const [method, url] of [
        ["GET", "/v1/community/feed"],
        ["GET", "/v1/community/profiles/00000000-0000-4000-8000-000000000002"],
        ["POST", "/v1/community/profile"],
      ] as const) {
        const response = await app.inject({
          method,
          url,
          headers: { ...headers, "x-request-id": "closed-community-check" },
        });
        expect(response.statusCode).toBe(503);
        expect(response.json().error).toMatchObject({
          code: "SERVICE_UNAVAILABLE",
          requestId: "closed-community-check",
        });
      }
      expect(
        (
          await app.inject({
            method: "PUT",
            url: `/v1/community/activities/${activity.id}/reaction`,
            headers,
            payload: { reaction: null },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await communityRepository.getReactionsForActivity(activity.id, viewer))
          .viewerReaction,
      ).toBeNull();
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/community/profile/withdraw",
            headers,
          })
        ).statusCode,
      ).not.toBe(503);
      expect(removal).toHaveBeenCalledWith(activity.id, viewer, null, {
        accessToken: "captured",
      });
    } finally {
      await app.close();
      vi.unstubAllEnvs();
    }
  });
  it.each([
    ["GET", "/search", "discovery"],
    ["GET", "/handles/check?handle=x", "discovery"],
    ["GET", "/profile/handle-availability", "discovery"],
    ["POST", "/invitations", "discovery"],
    ["GET", "/invitations/token-value", "discovery"],
    ["POST", "/meal-activities", "publish"],
    ["POST", "/relationships/follow", "engagement"],
    ["POST", "/relationships/requests", "engagement"],
    ["PATCH", "/activities/id", "publish"],
    ["POST", "/activities", "publish"],
    ["POST", "/profile", "enrollment"],
    ["GET", "/feed", "browsing"],
    ["GET", "/activities/id", "browsing"],
    ["GET", "/activities/id/reactions", "browsing"],
    ["GET", "/profiles/id", "browsing"],
    ["GET", "/profiles/id/activities", "browsing"],
  ])("gates %s %s", (method, path, gate) =>
    expect(communityOperationGate(method!, `/v1/community${path}`)).toBe(gate),
  );
  it("gates viewing media bytes as browsing, not publishing", () => {
    expect(
      communityExpansionOperationGate(
        "POST",
        "/v1/community/media/id/content",
        {},
      ),
    ).toBe("browsing");
    expect(
      communityExpansionOperationGate("POST", "/v1/community/media", {}),
    ).toBe("publish");
    expect(
      communityExpansionOperationGate(
        "POST",
        "/v1/community/media/reports/id/content",
        {},
      ),
    ).toBeNull();
  });
  it.each(["threads", "latest"])(
    "gates messaging %s as browsing",
    (operation) => {
      expect(
        communityExpansionOperationGate("POST", "/v1/community/messaging", {
          operation,
        }),
      ).toBe("browsing");
    },
  );
  it.each([
    ["POST", "/profile/withdraw"],
    ["DELETE", "/profile"],
    ["POST", "/reports"],
    ["POST", "/blocks"],
    ["POST", "/activities/id/unpublish"],
    ["DELETE", "/activities/id"],
    ["GET", "/notifications/inbox"],
    ["DELETE", "/notifications/token/id"],
    ["GET", "/invitations"],
    ["DELETE", "/invitations/id"],
  ])("preserves %s %s", (method, path) =>
    expect(communityOperationGate(method!, `/v1/community${path}`)).toBeNull(),
  );
  it("defaults delivery closed, fails closed for malformed flags and freezes all growth", () => {
    expect(
      Object.values(loadCommunityOperations({})).every((enabled) => !enabled),
    ).toBe(true);
    expect(loadCommunityOperations({}).delivery).toBe(false);
    expect(
      loadCommunityOperations({ COMMUNITY_PUBLISH_ENABLED: "TRUE" }).publish,
    ).toBe(false);
    expect(
      Object.values(
        loadCommunityOperations({
          COMMUNITY_ENABLED: "false",
          COMMUNITY_DELIVERY_ENABLED: "true",
        }),
      ),
    ).toEqual([false, false, false, false, false, false]);
  });
});
