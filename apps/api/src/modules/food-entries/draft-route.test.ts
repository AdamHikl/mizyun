import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  DisabledVisionProvider,
  StubVisionProvider,
  VisionProviderError,
  type VisionDraftCandidate,
  type VisionDraftProvider,
} from "@mizyun/agent-runtime";
import type { AccessTokenVerifier } from "@mizyun/identity";

import { buildApp } from "../../app.js";
import { FoodDraftRateLimiter } from "./draft-rate-limit.js";

const userId = "00000000-0000-4000-8000-000000000001";
const tokenVerifier: AccessTokenVerifier = {
  verify: async (token) =>
    token === "valid"
      ? { userId: userId as never, accessToken: "test-access-token" }
      : null,
};
const auth = { authorization: "Bearer valid" };
const apps: ReturnType<typeof buildApp>[] = [];

const makeApps = (options: {
  readonly visionProvider: VisionDraftProvider;
  readonly rateLimiter?: FoodDraftRateLimiter;
  readonly resolvePlanTier?: () => "free" | "paid";
}) => {
  const rateLimiter = options.rateLimiter ?? new FoodDraftRateLimiter();
  const app = buildApp({
    tokenVerifier,
    coachControls: {
      visionProvider: options.visionProvider,
      draftRateLimiter: rateLimiter,
      resolvePlanTier: options.resolvePlanTier ?? (() => "free"),
    },
  });
  apps.push(app);
  return { app, rateLimiter };
};

const ONE_PIXEL_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

const postDraft = (
  app: ReturnType<typeof buildApp>,
  payload:
    | {
        file: { name: string; content: Buffer; type: string };
        hint?: string;
      }
    | string,
  headers: Record<string, string> = {},
) => {
  if (typeof payload === "string") {
    return app.inject({
      method: "POST",
      url: "/v1/food-entries/draft",
      headers: { ...auth, "content-type": "application/json", ...headers },
      payload,
    });
  }
  const boundary = `----MizyunTest${randomUUID()}`;
  const parts: Buffer[] = [];
  if (payload.hint !== undefined) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="textHint"\r\n\r\n` +
          `${payload.hint}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="image"; filename="${payload.file.name}"\r\n` +
        `Content-Type: ${payload.file.type}\r\n\r\n`,
    ),
  );
  parts.push(payload.file.content);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return app.inject({
    method: "POST",
    url: "/v1/food-entries/draft",
    headers: {
      ...auth,
      "content-type": `multipart/form-data; boundary=${boundary}`,
      ...headers,
    },
    payload: Buffer.concat(parts),
  });
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const buildForm = (
  file: { name: string; content: Buffer; type: string },
  hint?: string,
): {
  file: { name: string; content: Buffer; type: string };
  hint?: string;
} => ({
  file,
  ...(hint !== undefined ? { hint } : {}),
});

describe("Food draft route — happy path", () => {
  it("returns the StubVisionProvider candidate for a valid multipart image", async () => {
    const provider = new StubVisionProvider();
    const { app } = makeApps({ visionProvider: provider });
    const response = await postDraft(
      app,
      buildForm(
        { name: "meal.png", content: ONE_PIXEL_PNG, type: "image/png" },
        "Lunch",
      ),
    );
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.draft).toMatchObject({
      name: "Lunch",
      caloriesKcal: 350,
      confidence: 0.45,
    });
    expect(body.requestId).toBeTruthy();
  });

  it("falls back to a generic name when no textHint is supplied", async () => {
    const provider = new StubVisionProvider();
    const { app } = makeApps({ visionProvider: provider });
    const response = await postDraft(
      app,
      buildForm({
        name: "meal.png",
        content: ONE_PIXEL_PNG,
        type: "image/png",
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().draft.name).toMatch(/could not identify/i);
  });

  it("forwards the photo bytes to the vision provider", async () => {
    let receivedBytes: Uint8Array | null = null;
    let receivedMime: string | null = null;
    let receivedHint: string | undefined;
    const capture: VisionDraftProvider = {
      status: async () => ({ ready: true, provider: "capture" }),
      generateDraft: async (req) => {
        receivedBytes = req.photo;
        receivedMime = req.mimeType;
        receivedHint = req.textHint;
        const result: VisionDraftCandidate = {
          name: "captured",
          caloriesKcal: 100,
          proteinG: 5,
          carbohydrateG: 10,
          fatG: 1,
          confidence: 0.7,
          warnings: [],
        };
        return result;
      },
    };
    const { app } = makeApps({ visionProvider: capture });
    const form = buildForm(
      { name: "meal.jpg", content: ONE_PIXEL_PNG, type: "image/jpeg" },
      "Dinner",
    );
    const response = await postDraft(app, form);
    expect(response.statusCode).toBe(200);
    expect(receivedBytes).not.toBeNull();
    expect(receivedBytes!.length).toBe(ONE_PIXEL_PNG.length);
    expect(receivedMime).toBe("image/jpeg");
    expect(receivedHint).toBe("Dinner");
  });
});

describe("Food draft route — defence in depth", () => {
  it("returns 401 when the bearer token is missing", async () => {
    const { app } = makeApps({ visionProvider: new StubVisionProvider() });
    const boundary = `----MizyunTest${randomUUID()}`;
    const body = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="image"; filename="meal.png"\r\n` +
        `Content-Type: image/png\r\n\r\n` +
        `dummy\r\n` +
        `--${boundary}--\r\n`,
    );
    const response = await app.inject({
      method: "POST",
      url: "/v1/food-entries/draft",
      // No `authorization` header — the route must reject with
      // 401 AUTHENTICATION_REQUIRED before touching multipart.
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(response.statusCode).toBe(401);
  });

  it("returns 422 when the request is not multipart", async () => {
    const { app } = makeApps({ visionProvider: new StubVisionProvider() });
    const response = await postDraft(app, JSON.stringify({ hint: "x" }));
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("returns 422 when the image field is missing", async () => {
    const { app } = makeApps({ visionProvider: new StubVisionProvider() });
    const boundary = `----MizyunTest${randomUUID()}`;
    const body = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="textHint"\r\n\r\nlunch\r\n` +
        `--${boundary}--\r\n`,
    );
    const response = await app.inject({
      method: "POST",
      url: "/v1/food-entries/draft",
      headers: {
        ...auth,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(response.statusCode).toBe(422);
  });

  it("returns 422 when the mime type is not allowed", async () => {
    const { app } = makeApps({ visionProvider: new StubVisionProvider() });
    const response = await postDraft(
      app,
      buildForm({
        name: "meal.pdf",
        content: ONE_PIXEL_PNG,
        type: "application/pdf",
      }),
    );
    expect(response.statusCode).toBe(422);
  });

  it("returns 503 when the vision provider is not configured", async () => {
    const { app } = makeApps({ visionProvider: new DisabledVisionProvider() });
    const response = await postDraft(
      app,
      buildForm({
        name: "meal.png",
        content: ONE_PIXEL_PNG,
        type: "image/png",
      }),
    );
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: { code: "AI_CONFIGURATION_ERROR" },
    });
  });

  it("maps a 429 VisionProviderError to RATE_LIMITED", async () => {
    const provider: VisionDraftProvider = {
      status: async () => ({ ready: true, provider: "fake" }),
      generateDraft: async () => {
        throw new VisionProviderError("rate_limited", "rate limited", true);
      },
    };
    const { app } = makeApps({ visionProvider: provider });
    const response = await postDraft(
      app,
      buildForm({
        name: "meal.png",
        content: ONE_PIXEL_PNG,
        type: "image/png",
      }),
    );
    expect(response.statusCode).toBe(429);
  });

  it("maps an unavailable VisionProviderError to 502 AI_UNAVAILABLE", async () => {
    const provider: VisionDraftProvider = {
      status: async () => ({ ready: true, provider: "fake" }),
      generateDraft: async () => {
        throw new VisionProviderError("unavailable", "downstream down", true);
      },
    };
    const { app } = makeApps({ visionProvider: provider });
    const response = await postDraft(
      app,
      buildForm({
        name: "meal.png",
        content: ONE_PIXEL_PNG,
        type: "image/png",
      }),
    );
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      error: { code: "AI_UNAVAILABLE" },
    });
  });
});

describe("Food draft route — rate limit", () => {
  it("enforces the free-tier 1/min cap", async () => {
    const provider = new StubVisionProvider();
    const { app, rateLimiter } = makeApps({ visionProvider: provider });
    const form = buildForm({
      name: "meal.png",
      content: ONE_PIXEL_PNG,
      type: "image/png",
    });
    const first = await postDraft(app, form);
    expect(first.statusCode).toBe(200);
    const second = await postDraft(app, form);
    expect(second.statusCode).toBe(429);
    expect(second.headers["retry-after"]).toBeDefined();
    rateLimiter.__resetForTest();
  });

  it("allows 3 requests/min for the paid tier", async () => {
    const rateLimiter = new FoodDraftRateLimiter();
    const { app } = makeApps({
      visionProvider: new StubVisionProvider(),
      rateLimiter,
      resolvePlanTier: () => "paid",
    });
    const form = buildForm({
      name: "meal.png",
      content: ONE_PIXEL_PNG,
      type: "image/png",
    });
    for (let i = 0; i < 3; i += 1) {
      const response = await postDraft(app, form);
      expect(response.statusCode).toBe(200);
    }
    const fourth = await postDraft(app, form);
    expect(fourth.statusCode).toBe(429);
    rateLimiter.__resetForTest();
  });
});
