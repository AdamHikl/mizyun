import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  StubVisionProvider,
  VisionProviderError,
  type VisionDraftProvider,
} from "@mizyun/agent-runtime";
import type { UserId } from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";

import { buildApp } from "../../app.js";
import { InMemoryProfileRepository } from "../../profile-repository.js";

const userId = "00000000-0000-4000-8000-000000000001" as UserId;
const otherUserId = "00000000-0000-4000-8000-000000000099" as UserId;
const auth = { authorization: "Bearer valid" };
const tokenVerifier: AccessTokenVerifier = {
  verify: async (token) =>
    token === "valid"
      ? { userId, accessToken: "test-access-token" }
      : token === "other"
        ? { userId: otherUserId, accessToken: "other-access-token" }
        : null,
};
const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const makeApp = (visionProvider: VisionDraftProvider) => {
  const app = buildApp({
    tokenVerifier,
    coachControls: { visionProvider },
  });
  apps.push(app);
  return app;
};

const createConversation = async (app: ReturnType<typeof buildApp>) => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/coach/conversations",
    headers: auth,
    payload: { title: "Meal photo" },
  });
  expect(response.statusCode).toBe(201);
  return response.json().conversation.id as string;
};

const postPhoto = (
  app: ReturnType<typeof buildApp>,
  conversationId: string,
  idempotencyKey: string,
  authorization = "Bearer valid",
) => {
  const boundary = `----MizyunCoach${randomUUID()}`;
  const photo = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="image"; filename="meal.jpg"\r\n` +
        `Content-Type: image/jpeg\r\n\r\n`,
    ),
    photo,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({
    method: "POST",
    url: `/v1/coach/conversations/${conversationId}/nutrition-photo`,
    headers: {
      authorization,
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(body.length),
      "idempotency-key": idempotencyKey,
    },
    payload: body,
  });
};

describe("Coach nutrition photo proposals", () => {
  it.each(["free", "paid"] as const)(
    "%s photo proposals preserve only server-authorized extra estimates",
    async (tier) => {
      const stub = new StubVisionProvider();
      let enabled: boolean | undefined;
      const extras = {
        fibreG: 3,
        saturatedFatG: 0,
        totalSugarsG: null,
        sodiumMg: 410,
        cholesterolMg: 50,
      };
      const provider: VisionDraftProvider = {
        status: () => stub.status(),
        generateDraft: async (request) => {
          enabled = request.includeAdvancedNutrition;
          return { ...(await stub.generateDraft(request)), ...extras };
        },
      };
      const app = buildApp({
        tokenVerifier,
        profileRepository: new InMemoryProfileRepository({
          defaultTimezone: "UTC",
          defaultUnitSystem: "metric",
          defaultBirthYear: 1990,
          defaultPlanTier: tier,
        }),
        coachControls: { visionProvider: provider, planTierOverride: "paid" },
      });
      apps.push(app);
      const id = await createConversation(app);
      const response = await postPhoto(app, id, "extra-nutrients-photo-0001");
      expect(response.statusCode).toBe(200);
      expect(enabled).toBe(tier === "paid");
      const candidate =
        response.json().assistantMessage.actionProposal.candidate;
      if (tier === "paid") expect(candidate).toMatchObject(extras);
      else
        for (const key of Object.keys(extras))
          expect(candidate).not.toHaveProperty(key);
      const thread = await app.inject({
        method: "GET",
        url: `/v1/coach/conversations/${id}`,
        headers: auth,
      });
      expect(thread.json().messages[1].actionProposal.candidate).toEqual(
        candidate,
      );
    },
  );

  it("persists one editable proposal and replays it idempotently", async () => {
    const app = makeApp(new StubVisionProvider());
    const conversationId = await createConversation(app);

    const first = await postPhoto(app, conversationId, "coach-photo-key-0001");
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      userMessage: {
        text: "Shared a meal photo for a nutrition draft.",
        actionProposal: null,
      },
      assistantMessage: {
        provider: "vision-dev-stub",
        actionProposal: {
          kind: "meal_log",
          candidate: {
            provenance: { inputKind: "photo" },
            caloriesKcal: 350,
          },
        },
      },
    });

    const replay = await postPhoto(app, conversationId, "coach-photo-key-0001");
    expect(replay.statusCode).toBe(200);
    expect(replay.json().assistantMessage.id).toBe(
      first.json().assistantMessage.id,
    );

    const thread = await app.inject({
      method: "GET",
      url: `/v1/coach/conversations/${conversationId}`,
      headers: auth,
    });
    expect(thread.json().messages).toHaveLength(2);
    expect(thread.json().messages[1].actionProposal).toEqual(
      first.json().assistantMessage.actionProposal,
    );
  });

  it("keeps the user message when transient provider analysis fails", async () => {
    const provider: VisionDraftProvider = {
      status: async () => ({ ready: true, provider: "failing" }),
      generateDraft: async () => {
        throw new VisionProviderError(
          "timeout",
          "Photo analysis timed out.",
          true,
        );
      },
    };
    const app = makeApp(provider);
    const conversationId = await createConversation(app);

    const response = await postPhoto(
      app,
      conversationId,
      "coach-photo-key-0002",
    );
    expect(response.statusCode).toBe(502);

    const thread = await app.inject({
      method: "GET",
      url: `/v1/coach/conversations/${conversationId}`,
      headers: auth,
    });
    expect(thread.json().messages).toEqual([
      expect.objectContaining({
        role: "user",
        text: "Shared a meal photo for a nutrition draft.",
      }),
    ]);
  });

  it("does not expose or append proposals to another user's conversation", async () => {
    const app = makeApp(new StubVisionProvider());
    const conversationId = await createConversation(app);
    const response = await postPhoto(
      app,
      conversationId,
      "coach-photo-key-0003",
      "Bearer other",
    );
    expect(response.statusCode).toBe(404);

    const ownerThread = await app.inject({
      method: "GET",
      url: `/v1/coach/conversations/${conversationId}`,
      headers: auth,
    });
    expect(ownerThread.json().messages).toEqual([]);
  });
});
