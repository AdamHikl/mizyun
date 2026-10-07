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
const userId = "00000000-0000-4000-8000-000000000001" as UserId;
const mealId = "00000000-0000-4000-8000-000000000003";
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});
const build = (enabled = true) => {
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
  });
  apps.push(app);
  return { app, service };
};
const payload = {
  clientOperationId: mealId,
  imageBase64: "/9j/2Q==",
  mimeType: "image/jpeg",
  width: 1,
  height: 1,
};
describe("Dev private meal photos", () => {
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
