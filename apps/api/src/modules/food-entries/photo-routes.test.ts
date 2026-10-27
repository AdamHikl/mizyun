import { afterEach, describe, it, expect, vi } from "vitest";
import { buildApp } from "../../app.js";
import {
  MealPhotoError,
  type UserId,
  type MealPhotoService,
} from "@mizyun/core";
import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import { InMemoryMemoryStore } from "@mizyun/memory";
import { InMemoryProfileRepository } from "../../profile-repository.js";
import { InMemoryBetaProRepository } from "../../beta-pro-repository.js";
import type { MediaQuota } from "../../media-quota.js";
const userId = "00000000-0000-4000-8000-000000000001" as UserId;
const mealId = "00000000-0000-4000-8000-000000000003";
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});
const build = (
  enabled = true,
  planTier: "paid" | "free" = "paid",
  betaStatus?: "pending" | "approved" | "rejected",
  mediaQuota?: MediaQuota,
) => {
  const profile = new InMemoryProfileRepository({
    defaultTimezone: "UTC",
    defaultUnitSystem: "metric",
    defaultPlanTier: planTier,
  });
  const beta = new InMemoryBetaProRepository();
  if (betaStatus)
    beta.__seedForTest({
      id: crypto.randomUUID(),
      userId,
      email: "synthetic@example.test",
      status: betaStatus,
      notes: null,
      pushToken: null,
      createdAt: new Date(),
      reviewedAt: null,
    });
  const service: MealPhotoService = {
    save: vi.fn().mockResolvedValue({ assetId: mealId, width: 1, height: 1 }),
    get: vi.fn().mockResolvedValue(null),
    remove: vi.fn(),
    cleanup: vi.fn(),
  };
  const app = buildApp({
    tokenVerifier: {
      verify: async (token) =>
        token === "owner"
          ? { userId, role: "authenticated", accessToken: token }
          : null,
    },
    agent: new AgentOrchestrator({
      provider: new DisabledAgentProvider(),
      memories: new InMemoryMemoryStore(),
    }),
    mealPhotosEnabled: enabled,
    mealPhotoService: service,
    profileRepository: profile,
    betaProRepository: beta,
    ...(mediaQuota ? { mediaQuota } : {}),
  });
  apps.push(app);
  return { app, service, profile, beta };
};
const payload = {
  clientOperationId: mealId,
  imageBase64: "/9j/2Q==",
  mimeType: "image/jpeg",
  width: 1,
  height: 1,
};
describe("Dev private meal photos", () => {
  it("blocks Free image reads and retention without touching media, while allowing erase", async () => {
    const { app, service } = build(true, "free");
    for (const method of ["GET", "POST"] as const) {
      const response = await app.inject({
        method,
        url: `/v1/food-entries/${mealId}/photo`,
        headers: { authorization: "Bearer owner" },
        ...(method === "POST" ? { payload } : {}),
      });
      expect(response.statusCode).toBe(403);
    }
    expect(service.get).not.toHaveBeenCalled();
    expect(service.save).not.toHaveBeenCalled();
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/v1/food-entries/${mealId}/photo`,
          headers: { authorization: "Bearer owner" },
        })
      ).statusCode,
    ).toBe(204);
    expect(service.remove).toHaveBeenCalled();
  });
  it("visual capability follows paid or approved pass independently of provider/photo enablement", async () => {
    for (const [tier, pass, allowed] of [
      ["free", undefined, false],
      ["paid", undefined, true],
      ["free", "approved", true],
      ["free", "rejected", false],
      ["free", "pending", false],
    ] as const) {
      const { app } = build(false, tier, pass);
      const response = await app.inject({
        method: "GET",
        url: "/v1/food-entries/visuals/capability",
        headers: { authorization: "Bearer owner" },
      });
      expect(response.json()).toEqual({ mealVisuals: allowed });
      expect(response.headers["cache-control"]).toBe("no-store");
    }
    expect(
      (
        await build().app.inject({
          method: "GET",
          url: "/v1/food-entries/visuals/capability",
        })
      ).statusCode,
    ).toBe(401);
  });
  it("hides a photo if downgrade occurs while the signed read is in flight", async () => {
    const { app, service, profile } = build();
    vi.mocked(service.get).mockImplementation(async () => {
      const current = await profile.getOrCreate(userId, {
        accessToken: "owner",
        now: new Date(),
      });
      await profile.update(
        userId,
        { ...current, planTier: "free" },
        { accessToken: "owner" },
      );
      return {
        assetId: mealId,
        width: 1,
        height: 1,
        signedUrl: "https://synthetic.test/image",
        expiresAt: new Date().toISOString(),
      };
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/food-entries/${mealId}/photo`,
          headers: { authorization: "Bearer owner" },
        })
      ).statusCode,
    ).toBe(403);
  });
  it("denies disabled feature without touching storage", async () => {
    const { app, service } = build(false);
    const response = await app.inject({
      method: "POST",
      url: `/v1/food-entries/${mealId}/photo`,
      headers: { authorization: "Bearer owner" },
      payload,
    });
    expect(response.statusCode).toBe(404);
    expect(service.save).not.toHaveBeenCalled();
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/v1/food-entries/${mealId}/photo`,
          headers: { authorization: "Bearer owner" },
        })
      ).statusCode,
    ).toBe(204);
    expect(service.remove).toHaveBeenCalledOnce();
  });
  it("requires authentication and passes captured ownership", async () => {
    const { app, service } = build();
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/food-entries/${mealId}/photo`,
          payload,
        })
      ).statusCode,
    ).toBe(401);
    const response = await app.inject({
      method: "POST",
      url: `/v1/food-entries/${mealId}/photo`,
      headers: { authorization: "Bearer owner" },
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(service.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        accessToken: "owner",
        mealId,
        clientOperationId: mealId,
      }),
    );
  });
  it("refuses a full storage quota before the server upload (SEC-02)", async () => {
    const allows = vi.fn<MediaQuota["allows"]>().mockResolvedValue(false);
    const { app, service } = build(true, "paid", undefined, { allows });
    const response = await app.inject({
      method: "POST",
      url: `/v1/food-entries/${mealId}/photo`,
      headers: { authorization: "Bearer owner" },
      payload,
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().error).toMatchObject({
      code: "STORAGE_QUOTA_EXCEEDED",
      message:
        "Your photo storage is full. Remove some photos or backups, then try again.",
    });
    expect(allows).toHaveBeenCalledWith(
      userId,
      Buffer.from(payload.imageBase64, "base64").length,
      { accessToken: "owner" },
    );
    expect(service.save).not.toHaveBeenCalled();
  });
  it("maps cross-account/missing meal identically", async () => {
    const { app, service } = build();
    vi.mocked(service.get).mockRejectedValue(new MealPhotoError("not_found"));
    const result = await app.inject({
      method: "GET",
      url: `/v1/food-entries/${mealId}/photo`,
      headers: { authorization: "Bearer owner" },
    });
    expect(result.statusCode).toBe(404);
  });
  it("rejects noncanonical and over-limit image bytes before service", async () => {
    const { app, service } = build();
    for (const imageBase64 of ["/9j/2R==", "a".repeat(349_529)]) {
      const response = await app.inject({
        method: "POST",
        url: `/v1/food-entries/${mealId}/photo`,
        headers: { authorization: "Bearer owner" },
        payload: { ...payload, imageBase64 },
      });
      expect(response.statusCode).toBe(422);
    }
    expect(service.save).not.toHaveBeenCalled();
  });
});
