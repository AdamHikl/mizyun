import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  photos: readonly Buffer[] = [Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
  textHint?: string,
) => {
  const boundary = `----MizyunCoach${randomUUID()}`;
  const body = Buffer.concat([
    ...(textHint === undefined
      ? []
      : [
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="textHint"\r\n\r\n${textHint}\r\n`,
          ),
        ]),
    ...photos.flatMap((photo) => [
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="meal.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
      ),
      photo,
      Buffer.from("\r\n"),
    ]),
    Buffer.from(`--${boundary}--\r\n`),
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

describe("Coach multiple photo requests", () => {
  const photo = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  it("persists separate Pro candidates in one replayable message and one inference", async () => {
    const stub = new StubVisionProvider();
    const generateDraft = vi.fn(
      async (request: Parameters<VisionDraftProvider["generateDraft"]>[0]) => {
        const candidate = await stub.generateDraft(request);
        return {
          ...candidate,
          additionalDrafts: [{ ...candidate, name: "Second meal" }],
        };
      },
    );
    const app = buildApp({
      tokenVerifier,
      profileRepository: new InMemoryProfileRepository({
        defaultPlanTier: "paid",
        defaultBirthYear: 1990,
        defaultTimezone: "UTC",
        defaultUnitSystem: "metric",
      }),
      coachControls: {
        visionProvider: { status: () => stub.status(), generateDraft },
      },
    });
    apps.push(app);
    const id = await createConversation(app);
    const first = await postPhoto(
      app,
      id,
      "multi-photo-request-001",
      "Bearer valid",
      [photo, photo, photo],
      "Two meals",
    );
    expect(first.statusCode).toBe(200);
    expect(first.json().userMessage.text).toBe(
      "Two meals\n\n[3 photos attached]",
    );
    expect(
      first.json().assistantMessage.actionProposal.additionalCandidates,
    ).toHaveLength(1);
    expect(generateDraft.mock.calls[0]?.[0]).toMatchObject({
      purpose: "coach",
      textHint: "Two meals",
      additionalPhotos: [
        { mimeType: "image/jpeg" },
        { mimeType: "image/jpeg" },
      ],
    });
    const replay = await postPhoto(
      app,
      id,
      "multi-photo-request-001",
      "Bearer valid",
      [photo],
    );
    expect(replay.json()).toEqual(first.json());
    expect(generateDraft).toHaveBeenCalledTimes(1);
  });
  it("rejects multiple photos for free accounts regardless of paid quota override", async () => {
    const stub = new StubVisionProvider();
    const generateDraft = vi.fn(stub.generateDraft.bind(stub));
    const app = buildApp({
      tokenVerifier,
      coachControls: {
        planTierOverride: "paid",
        visionProvider: { status: () => stub.status(), generateDraft },
      },
    });
    apps.push(app);
    const id = await createConversation(app);
    const response = await postPhoto(
      app,
      id,
      "free-photo-request-001",
      "Bearer valid",
      [photo, photo],
    );
    expect(response.statusCode).toBe(422);
    expect(generateDraft).not.toHaveBeenCalled();
    const retry = await postPhoto(app, id, "free-photo-request-002");
    expect(retry.statusCode).toBe(200);
  });
  it("returns nonmeal visual advice without a save proposal", async () => {
    const stub = new StubVisionProvider();
    const app = makeApp({
      status: () => stub.status(),
      generateDraft: async (request) => ({
        ...(await stub.generateDraft(request)),
        name: null,
        photoAdvice:
          "The nutrition label gives values per serving. Check the serving size.",
      }),
    });
    const id = await createConversation(app);
    const response = await postPhoto(
      app,
      id,
      "label-photo-request-001",
      "Bearer valid",
      [photo],
      "Explain this label",
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().assistantMessage.text).toContain("per serving");
    expect(response.json().assistantMessage.actionProposal).toBeNull();
  });
  it("screens unsafe photo questions without calling the model", async () => {
    const stub = new StubVisionProvider();
    const generateDraft = vi.fn(stub.generateDraft.bind(stub));
    const app = makeApp({ status: () => stub.status(), generateDraft });
    const id = await createConversation(app);
    const response = await postPhoto(
      app,
      id,
      "unsafe-photo-request-001",
      "Bearer valid",
      [photo],
      "I have chest pain, diagnose this",
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().assistantMessage.text).toContain(
      "urgent medical help",
    );
    expect(response.json().assistantMessage.actionProposal).toBeNull();
    expect(generateDraft).not.toHaveBeenCalled();
  });
  it("rejects diagnostic and medication assertions from arbitrary photo providers", async () => {
    const stub = new StubVisionProvider();
    const app = makeApp({
      status: () => stub.status(),
      generateDraft: async (request) => ({
        ...(await stub.generateDraft(request)),
        name: null,
        photoAdvice:
          "The lesion is melanoma. Take ibuprofen 800 mg twice daily.",
      }),
    });
    const id = await createConversation(app);
    const response = await postPhoto(
      app,
      id,
      "medical-output-photo-001",
      "Bearer valid",
      [photo],
      "Explain this photo",
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().assistantMessage.text).toContain(
      "qualified medical professional",
    );
    expect(response.json().assistantMessage.text).not.toContain("800 mg");
    expect(response.json().assistantMessage.actionProposal).toBeNull();
  });
  it.each(["four", "aggregate", "empty"])(
    "rejects Pro %s input and releases the in-flight reservation",
    async (kind) => {
      const stub = new StubVisionProvider();
      const generateDraft = vi.fn(stub.generateDraft.bind(stub));
      const app = buildApp({
        tokenVerifier,
        profileRepository: new InMemoryProfileRepository({
          defaultPlanTier: "paid",
          defaultBirthYear: 1990,
          defaultTimezone: "UTC",
          defaultUnitSystem: "metric",
        }),
        coachControls: {
          visionProvider: { status: () => stub.status(), generateDraft },
        },
      });
      apps.push(app);
      const id = await createConversation(app);
      const photos =
        kind === "four"
          ? [photo, photo, photo, photo]
          : kind === "aggregate"
            ? [Buffer.alloc(8 * 1024 * 1024), Buffer.alloc(8 * 1024 * 1024)]
            : [Buffer.alloc(0)];
      expect(
        (
          await postPhoto(
            app,
            id,
            `invalid-${kind}-photos-001`,
            "Bearer valid",
            photos,
          )
        ).statusCode,
      ).toBe(422);
      expect(generateDraft).not.toHaveBeenCalled();
      expect(
        (await postPhoto(app, id, `retry-${kind}-photo-001`)).statusCode,
      ).toBe(200);
    },
  );
});
