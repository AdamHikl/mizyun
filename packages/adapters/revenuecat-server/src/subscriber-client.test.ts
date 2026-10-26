import { describe, expect, it, vi } from "vitest";

import {
  RevenueCatRequestError,
  RevenueCatSubscriberClient,
} from "./subscriber-client.js";

const SECRET = "sk_super_secret_key_123";
const REQUEST_MS = Date.parse("2026-10-26T12:00:00.000Z");

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const customer = (
  entitlements: Record<string, unknown> = {},
  subscriptions: Record<string, unknown> = {},
) => ({
  request_date_ms: REQUEST_MS,
  subscriber: { entitlements, subscriptions },
});

const clientWith = (
  impl: (url: string, init: RequestInit) => Promise<Response>,
) => {
  const fetchMock = vi.fn(impl);
  const client = new RevenueCatSubscriberClient({
    secretApiKey: SECRET,
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { client, fetchMock };
};

const caught = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected rejection");
};

describe("RevenueCatSubscriberClient.readEntitlement", () => {
  it("sends a GET with a bearer secret and an encoded app user id", async () => {
    const { client, fetchMock } = clientWith(async () => json(customer()));
    await client.readEntitlement("user/with space?x=1", "pro");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://api.revenuecat.com/v1/subscribers/user%2Fwith%20space%3Fx%3D1",
    );
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({
      Authorization: `Bearer ${SECRET}`,
      Accept: "application/json",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("honours a custom base url and trims trailing slashes", async () => {
    const fetchMock = vi.fn(async () => json(customer()));
    const client = new RevenueCatSubscriberClient({
      secretApiKey: SECRET,
      baseUrl: "https://rc.example.test//",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.readEntitlement("u", "pro");
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://rc.example.test/v1/subscribers/u",
    );
  });

  it.each([200, 201])("accepts HTTP %i", async (status) => {
    const { client } = clientWith(async () => json(customer(), status));
    await expect(client.readEntitlement("u", "pro")).resolves.toBeDefined();
  });

  it("returns a null snapshot with RevenueCat's request time when absent", async () => {
    const { client } = clientWith(async () =>
      json(customer({ other: { expires_date: null } })),
    );
    const reading = await client.readEntitlement("u", "pro");
    expect(reading.snapshot).toBeNull();
    expect(reading.observedAt).toEqual(new Date(REQUEST_MS));
  });

  it("tolerates missing entitlements and subscriptions maps", async () => {
    const { client } = clientWith(async () =>
      json({ request_date_ms: REQUEST_MS, subscriber: {} }),
    );
    expect((await client.readEntitlement("u", "pro")).snapshot).toBeNull();
  });

  it("maps a full app store entitlement", async () => {
    const { client } = clientWith(async () =>
      json(
        customer(
          {
            pro: {
              expires_date: "2026-11-26T12:00:00Z",
              grace_period_expires_date: "2026-11-29T12:00:00Z",
              product_identifier: "mizyun_pro_yearly",
              purchase_date: "2026-10-26T11:00:00Z",
            },
          },
          {
            mizyun_pro_yearly: {
              store: "app_store",
              is_sandbox: false,
              period_type: "trial",
              unsubscribe_detected_at: "2026-10-27T00:00:00Z",
              billing_issues_detected_at: "2026-10-28T00:00:00Z",
              refunded_at: "2026-10-29T00:00:00Z",
            },
          },
        ),
      ),
    );
    const { snapshot } = await client.readEntitlement("u", "pro");
    expect(snapshot).toEqual({
      entitlementId: "pro",
      productId: "mizyun_pro_yearly",
      store: "app_store",
      environment: "production",
      periodType: "trial",
      purchasedAt: new Date("2026-10-26T11:00:00Z"),
      expiresAt: new Date("2026-11-26T12:00:00Z"),
      gracePeriodExpiresAt: new Date("2026-11-29T12:00:00Z"),
      refundedAt: new Date("2026-10-29T00:00:00Z"),
      unsubscribeDetectedAt: new Date("2026-10-27T00:00:00Z"),
      billingIssueDetectedAt: new Date("2026-10-28T00:00:00Z"),
    });
  });

  it("maps null dates to null and a lifetime entitlement to a null expiry", async () => {
    const { client } = clientWith(async () =>
      json(
        customer(
          { pro: { expires_date: null, product_identifier: "life" } },
          { life: { store: "app_store", is_sandbox: false } },
        ),
      ),
    );
    const { snapshot } = await client.readEntitlement("u", "pro");
    expect(snapshot?.expiresAt).toBeNull();
    expect(snapshot?.purchasedAt).toBeNull();
    expect(snapshot?.refundedAt).toBeNull();
    expect(snapshot?.periodType).toBeNull();
  });

  it.each([
    ["app_store", "app_store"],
    ["mac_app_store", "app_store"],
    ["play_store", "play_store"],
    ["stripe", "other"],
    ["promotional", "other"],
  ])("maps store %s to %s", async (store, expected) => {
    const { client } = clientWith(async () =>
      json(customer({ pro: { product_identifier: "p" } }, { p: { store } })),
    );
    expect((await client.readEntitlement("u", "pro")).snapshot?.store).toBe(
      expected,
    );
  });

  it("leaves store and environment null when the subscription is absent", async () => {
    const { client } = clientWith(async () =>
      json(customer({ pro: { product_identifier: "p" } })),
    );
    const { snapshot } = await client.readEntitlement("u", "pro");
    expect(snapshot?.store).toBeNull();
    expect(snapshot?.environment).toBeNull();
  });

  it.each([
    [true, "sandbox"],
    [false, "production"],
    [undefined, null],
    [null, null],
  ])("maps is_sandbox %s to %s", async (isSandbox, expected) => {
    const sub: Record<string, unknown> = { store: "app_store" };
    if (isSandbox !== undefined) sub.is_sandbox = isSandbox;
    const { client } = clientWith(async () =>
      json(customer({ pro: { product_identifier: "p" } }, { p: sub })),
    );
    expect(
      (await client.readEntitlement("u", "pro")).snapshot?.environment,
    ).toBe(expected);
  });

  it("maps unknown period types to null", async () => {
    const { client } = clientWith(async () =>
      json(
        customer(
          { pro: { product_identifier: "p" } },
          { p: { period_type: "weird" } },
        ),
      ),
    );
    expect(
      (await client.readEntitlement("u", "pro")).snapshot?.periodType,
    ).toBeNull();
  });

  it("matches a Play entitlement to a subscription keyed by the same sub:plan id", async () => {
    const { client } = clientWith(async () =>
      json(
        customer(
          { pro: { product_identifier: "mizyun_pro:yearly" } },
          {
            "mizyun_pro:yearly": {
              store: "play_store",
              is_sandbox: true,
              period_type: "intro",
            },
            "other:monthly": { store: "app_store", is_sandbox: false },
          },
        ),
      ),
    );
    const { snapshot } = await client.readEntitlement("u", "pro");
    expect(snapshot).toMatchObject({
      productId: "mizyun_pro:yearly",
      store: "play_store",
      environment: "sandbox",
      periodType: "intro",
    });
  });

  it("resolves a Play key mismatch by base subscription id", async () => {
    const { client } = clientWith(async () =>
      json(
        customer(
          { pro: { product_identifier: "mizyun_pro:yearly" } },
          { mizyun_pro: { store: "play_store", is_sandbox: false } },
        ),
      ),
    );
    expect((await client.readEntitlement("u", "pro")).snapshot).toMatchObject({
      store: "play_store",
      environment: "production",
    });
    const second = clientWith(async () =>
      json(
        customer(
          { pro: { product_identifier: "mizyun_pro" } },
          { "mizyun_pro:monthly": { store: "play_store", is_sandbox: false } },
        ),
      ),
    );
    expect(
      (await second.client.readEntitlement("u", "pro")).snapshot?.store,
    ).toBe("play_store");
  });

  it("does not borrow an unrelated subscription for a different product", async () => {
    const { client } = clientWith(async () =>
      json(
        customer(
          { pro: { product_identifier: "mizyun_pro" } },
          { other_product: { store: "app_store", is_sandbox: true } },
        ),
      ),
    );
    const { snapshot } = await client.readEntitlement("u", "pro");
    expect(snapshot?.store).toBeNull();
    expect(snapshot?.environment).toBeNull();
  });

  it.each([
    [429, true],
    [500, true],
    [503, true],
    [401, false],
    [403, false],
    [404, false],
  ])(
    "HTTP %i is a RevenueCatRequestError with retryable=%s",
    async (status, retryable) => {
      const { client } = clientWith(async () => json({ message: "x" }, status));
      const error = await caught(client.readEntitlement("u", "pro"));
      expect(error).toBeInstanceOf(RevenueCatRequestError);
      expect((error as RevenueCatRequestError).retryable).toBe(retryable);
      expect((error as Error).message).toContain(String(status));
    },
  );

  it("treats a network failure as retryable and hides the cause", async () => {
    const { client } = clientWith(async () => {
      throw new Error(`connect ECONNREFUSED with Bearer ${SECRET}`);
    });
    const error = await caught(client.readEntitlement("u", "pro"));
    expect(error).toBeInstanceOf(RevenueCatRequestError);
    expect((error as RevenueCatRequestError).retryable).toBe(true);
    expect((error as Error).message).not.toContain(SECRET);
  });

  it("treats malformed JSON and unexpected shapes as non-retryable", async () => {
    const bodies: Response[] = [
      new Response("<html>", { status: 200 }),
      json({ subscriber: {} }),
      json({ request_date_ms: "soon", subscriber: {} }),
      json({ request_date_ms: REQUEST_MS }),
      json(customer({ pro: { expires_date: "yesterday-ish" } })),
    ];
    for (const body of bodies) {
      const { client } = clientWith(async () => body);
      const error = await caught(client.readEntitlement("u", "pro"));
      expect(error).toBeInstanceOf(RevenueCatRequestError);
      expect((error as RevenueCatRequestError).retryable).toBe(false);
      expect((error as Error).message).not.toContain(SECRET);
    }
  });

  it("never includes the secret key in any thrown message", async () => {
    for (const status of [401, 404, 429, 500]) {
      const { client } = clientWith(async () =>
        json({ message: `bad key ${SECRET}` }, status),
      );
      const error = await caught(client.readEntitlement(SECRET, "pro"));
      expect((error as Error).message).not.toContain(SECRET);
    }
  });

  it("leaves the environment unknown when several base-plan records match", async () => {
    const { client } = clientWith(async () =>
      json(
        customer(
          { pro: { product_identifier: "mizyun_pro:yearly" } },
          {
            "mizyun_pro:monthly": { store: "play_store", is_sandbox: false },
            "mizyun_pro:founding": { store: "play_store", is_sandbox: true },
          },
        ),
      ),
    );
    const reading = await client.readEntitlement("u", "pro");
    expect(reading.snapshot).toMatchObject({ environment: null, store: null });
  });
});
