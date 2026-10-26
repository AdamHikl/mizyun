import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import { InMemoryMemoryStore } from "@mizyun/memory";
import type { StoreEntitlementSnapshot, UserId } from "@mizyun/core";
import { signRevenueCatWebhook } from "@mizyun/adapter-revenuecat-server";
import type { BillingConfigResult, BillingServerConfig } from "@mizyun/config";
import { billingEntitlementResponseSchema } from "@mizyun/contracts";

import { buildApp } from "../../app.js";
import { InMemorySubscriptionEntitlementRepository } from "./in-memory-repository.js";
import type { EntitlementReader } from "./service.js";

const A = "a1b2c3d4-0000-4000-8000-000000000001" as UserId;
const B = "a1b2c3d4-0000-4000-8000-000000000002" as UserId;
const DELETED = "a1b2c3d4-0000-4000-8000-0000000000dd" as UserId;
const asA = { authorization: "Bearer A" };
const asB = { authorization: "Bearer B" };
const SECRET = "whsec_test_secret";
const NOW = new Date("2026-10-26T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

const baseConfig: BillingServerConfig = {
  secretApiKey: "sk_test",
  webhookSigningSecret: SECRET,
  webhookAuthorization: null,
  entitlementId: "pro",
  offeringId: null,
  iosPublicKey: "appl_public",
  androidPublicKey: "goog_public",
  allowSandbox: false,
};

const activeSnapshot = (
  overrides: Partial<StoreEntitlementSnapshot> = {},
): StoreEntitlementSnapshot => ({
  entitlementId: "pro",
  productId: "mizyun_pro_yearly",
  store: "app_store",
  environment: "production",
  periodType: "trial",
  purchasedAt: new Date(NOW.getTime() - DAY),
  expiresAt: new Date(NOW.getTime() + 13 * DAY),
  gracePeriodExpiresAt: null,
  refundedAt: null,
  unsubscribeDetectedAt: null,
  billingIssueDetectedAt: null,
  ...overrides,
});

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

const setup = (
  options: {
    billing?: BillingConfigResult;
    betaProFor?: UserId;
    manualPaidFor?: UserId;
    syncBudgetPerMinute?: number;
  } = {},
) => {
  let now = NOW;
  const repository = new InMemorySubscriptionEntitlementRepository({
    now: () => now,
  });
  repository.addUser(A, {
    betaPro: options.betaProFor === A,
    manualPaid: options.manualPaidFor === A,
  });
  repository.addUser(B, {
    betaPro: options.betaProFor === B,
    manualPaid: options.manualPaidFor === B,
  });
  const store = new Map<string, StoreEntitlementSnapshot | null>();
  let observedAt = NOW;
  let failing = false;
  const reads: string[] = [];
  const reader: EntitlementReader = {
    readEntitlement: vi.fn(async (appUserId: string) => {
      reads.push(appUserId);
      if (failing) throw new Error("revenuecat down");
      return { snapshot: store.get(appUserId) ?? null, observedAt };
    }),
  };
  const app = buildApp({
    subscriptionEntitlementRepository: repository,
    billingConfig: options.billing ?? { enabled: true, config: baseConfig },
    billingEntitlementReader: reader,
    billingNow: () => now,
    ...(options.syncBudgetPerMinute !== undefined
      ? { billingSyncBudgetPerMinute: options.syncBudgetPerMinute }
      : {}),
    tokenVerifier: {
      verify: async (token) =>
        token === "A" || token === "B"
          ? {
              userId: token === "A" ? A : B,
              accessToken: token,
              role: "authenticated",
            }
          : null,
    },
    agent: new AgentOrchestrator({
      provider: new DisabledAgentProvider(),
      memories: new InMemoryMemoryStore(),
    }),
  });
  apps.push(app);
  return {
    app,
    repository,
    store,
    reads,
    setNow: (value: Date) => {
      now = value;
    },
    setObservedAt: (value: Date) => {
      observedAt = value;
    },
    setFailing: (value: boolean) => {
      failing = value;
    },
  };
};

const webhookBody = (
  id: string,
  type: string,
  appUserId: string,
  extra: Record<string, unknown> = {},
): string =>
  JSON.stringify({
    api_version: "1.0",
    event: {
      id,
      type,
      app_user_id: appUserId,
      original_app_user_id: appUserId,
      aliases: [appUserId],
      environment: "PRODUCTION",
      entitlement_ids: ["pro"],
      // Event data is ignored; state is always re-read.
      expiration_at_ms: NOW.getTime() + 365 * DAY,
      ...extra,
    },
  });

const postWebhook = (
  app: ReturnType<typeof buildApp>,
  body: string,
  options: {
    secret?: string;
    timestamp?: number;
    signature?: string | null;
    authorization?: string;
  } = {},
) => {
  const timestamp = options.timestamp ?? Math.floor(NOW.getTime() / 1000);
  const signature =
    options.signature === undefined
      ? signRevenueCatWebhook(
          Buffer.from(body, "utf8"),
          options.secret ?? SECRET,
          timestamp,
        )
      : options.signature;
  return app.inject({
    method: "POST",
    url: "/v1/billing/revenuecat/webhook",
    headers: {
      "content-type": "application/json",
      ...(signature !== null
        ? { "x-revenuecat-webhook-signature": signature }
        : {}),
      ...(options.authorization
        ? { authorization: options.authorization }
        : {}),
    },
    payload: body,
  });
};

const getPlan = async (
  app: ReturnType<typeof buildApp>,
  headers: Record<string, string>,
) => {
  const response = await app.inject({
    method: "GET",
    url: "/v1/billing/entitlement",
    headers,
  });
  expect(response.statusCode).toBe(200);
  return billingEntitlementResponseSchema.parse(response.json());
};

describe("billing entitlement routes", () => {
  it("requires authentication", async () => {
    const { app } = setup();
    const get = await app.inject({
      method: "GET",
      url: "/v1/billing/entitlement",
    });
    expect(get.statusCode).toBe(401);
    const sync = await app.inject({
      method: "POST",
      url: "/v1/billing/entitlement/sync",
    });
    expect(sync.statusCode).toBe(401);
  });

  it("reports the free plan and no Store SDK when billing is off, and has no webhook", async () => {
    const { app, reads } = setup({
      billing: { enabled: false, reason: "flag_off" },
    });
    const plan = await getPlan(app, asA);
    expect(plan).toEqual({
      planTier: "free",
      paidSource: "none",
      purchasesEnabled: false,
      entitlement: null,
      storeSdk: null,
    });
    const sync = await app.inject({
      method: "POST",
      url: "/v1/billing/entitlement/sync",
      headers: asA,
    });
    expect(sync.statusCode).toBe(200);
    const webhook = await postWebhook(
      app,
      webhookBody("evt-off", "INITIAL_PURCHASE", A),
    );
    expect(webhook.statusCode).toBe(404);
    expect(reads).toEqual([]);
  });

  it("publishes only public SDK keys", async () => {
    const { app } = setup();
    const plan = await getPlan(app, asA);
    expect(plan.purchasesEnabled).toBe(true);
    expect(plan.storeSdk).toEqual({
      provider: "revenuecat",
      iosPublicKey: "appl_public",
      androidPublicKey: "goog_public",
      entitlementId: "pro",
      offeringId: null,
    });
    expect(JSON.stringify(plan)).not.toContain("sk_test");
    expect(JSON.stringify(plan)).not.toContain(SECRET);
  });
});

describe("RevenueCat webhook verification", () => {
  it.each([
    ["a wrong secret", { secret: "other" }],
    ["no signature", { signature: null }],
    ["a malformed signature", { signature: "t=abc,v1=zz" }],
    [
      "a timestamp outside the tolerance",
      { timestamp: Math.floor(NOW.getTime() / 1000) - 301 },
    ],
  ])("rejects %s without touching state", async (_label, options) => {
    const { app, repository, reads } = setup();
    const response = await postWebhook(
      app,
      webhookBody("evt-bad", "INITIAL_PURCHASE", A),
      options,
    );
    expect(response.statusCode).toBe(401);
    expect(reads).toEqual([]);
    expect(repository.applyCalls).toBe(0);
    expect(repository.planTier(A)).toBe("free");
  });

  it("rejects a body changed after signing", async () => {
    const { app, reads } = setup();
    const signed = webhookBody("evt-1", "INITIAL_PURCHASE", A);
    const signature = signRevenueCatWebhook(
      Buffer.from(signed),
      SECRET,
      Math.floor(NOW.getTime() / 1000),
    );
    const response = await postWebhook(
      app,
      webhookBody("evt-1", "INITIAL_PURCHASE", B),
      { signature },
    );
    expect(response.statusCode).toBe(401);
    expect(reads).toEqual([]);
  });

  it("checks the configured Authorization header as well", async () => {
    const { app, reads } = setup({
      billing: {
        enabled: true,
        config: { ...baseConfig, webhookAuthorization: "Bearer rc-hook" },
      },
    });
    const body = webhookBody("evt-auth", "TEST", A);
    expect((await postWebhook(app, body)).statusCode).toBe(401);
    expect(
      (await postWebhook(app, body, { authorization: "Bearer wrong" }))
        .statusCode,
    ).toBe(401);
    expect(
      (await postWebhook(app, body, { authorization: "Bearer rc-hook" }))
        .statusCode,
    ).toBe(200);
    expect(reads).toEqual([A]);
  });

  it("rejects a signed but unreadable payload", async () => {
    const { app } = setup();
    const response = await postWebhook(app, JSON.stringify({ hello: 1 }));
    expect(response.statusCode).toBe(400);
  });
});

describe("RevenueCat webhook processing", () => {
  it("grants Pro from the re-read entitlement and keeps users isolated", async () => {
    const { app, repository, store, reads } = setup();
    store.set(A, activeSnapshot());
    const response = await postWebhook(
      app,
      webhookBody("evt-buy", "INITIAL_PURCHASE", A),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true, duplicate: false });
    expect(reads).toEqual([A]);
    expect(repository.planTier(A)).toBe("paid");
    expect(repository.planTier(B)).toBe("free");

    const planA = await getPlan(app, asA);
    expect(planA).toMatchObject({
      planTier: "paid",
      paidSource: "subscription",
      entitlement: {
        status: "active",
        productId: "mizyun_pro_yearly",
        store: "app_store",
        inTrial: true,
        willRenew: true,
      },
    });
    const planB = await getPlan(app, asB);
    expect(planB).toMatchObject({
      planTier: "free",
      paidSource: "none",
      entitlement: null,
    });
  });

  it("never double-applies a replayed event", async () => {
    const { app, repository, store, reads } = setup();
    store.set(A, activeSnapshot());
    const body = webhookBody("evt-replay", "INITIAL_PURCHASE", A);
    expect((await postWebhook(app, body)).statusCode).toBe(200);
    const replay = await postWebhook(app, body);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ received: true, duplicate: true });
    expect(reads).toEqual([A]);
    expect(repository.applyCalls).toBe(1);
  });

  it("does not trust event data: an expiry is read back from the Store", async () => {
    const { app, repository, store } = setup();
    store.set(A, activeSnapshot());
    await postWebhook(app, webhookBody("evt-1", "INITIAL_PURCHASE", A));
    expect(repository.planTier(A)).toBe("paid");
    // A forged-looking EXPIRATION while the Store still says active changes nothing.
    await postWebhook(app, webhookBody("evt-2", "EXPIRATION", A));
    expect(repository.planTier(A)).toBe("paid");
    // The real expiry.
    store.set(
      A,
      activeSnapshot({
        periodType: "normal",
        expiresAt: new Date(NOW.getTime() - 1000),
        unsubscribeDetectedAt: new Date(NOW.getTime() - 5 * DAY),
      }),
    );
    await postWebhook(app, webhookBody("evt-3", "EXPIRATION", A));
    expect(repository.planTier(A)).toBe("free");
    const plan = await getPlan(app, asA);
    expect(plan).toMatchObject({
      planTier: "free",
      paidSource: "none",
      entitlement: { status: "expired", willRenew: false, inTrial: false },
    });
  });

  it("downgrades on refund", async () => {
    const { app, repository, store } = setup();
    store.set(A, activeSnapshot({ periodType: "normal" }));
    await postWebhook(app, webhookBody("evt-1", "INITIAL_PURCHASE", A));
    store.set(
      A,
      activeSnapshot({
        periodType: "normal",
        refundedAt: new Date(NOW.getTime() - 60_000),
      }),
    );
    await postWebhook(
      app,
      webhookBody("evt-refund", "CANCELLATION", A, {
        cancel_reason: "CUSTOMER_SUPPORT",
      }),
    );
    expect(repository.planTier(A)).toBe("free");
  });

  it("keeps a Beta Pro pass when the subscription ends", async () => {
    const { app, repository, store } = setup({ betaProFor: A });
    store.set(A, activeSnapshot());
    await postWebhook(app, webhookBody("evt-1", "INITIAL_PURCHASE", A));
    store.set(A, null);
    await postWebhook(app, webhookBody("evt-2", "EXPIRATION", A));
    expect(repository.planTier(A)).toBe("paid");
    expect((await getPlan(app, asA)).paidSource).toBe("beta_pro");
  });

  it("moves Pro with a transfer", async () => {
    const { app, repository, store, reads } = setup();
    store.set(A, activeSnapshot());
    await postWebhook(app, webhookBody("evt-1", "INITIAL_PURCHASE", A));
    store.set(A, null);
    store.set(B, activeSnapshot());
    await postWebhook(
      app,
      webhookBody("evt-transfer", "TRANSFER", B, {
        transferred_from: [A],
        transferred_to: [B],
      }),
    );
    expect(new Set(reads.slice(1))).toEqual(new Set([A, B]));
    expect(repository.planTier(A)).toBe("free");
    expect(repository.planTier(B)).toBe("paid");
  });

  it("ignores an older snapshot that arrives after a newer one", async () => {
    const { app, repository, store, setObservedAt } = setup();
    store.set(A, activeSnapshot());
    await postWebhook(app, webhookBody("evt-new", "RENEWAL", A));
    setObservedAt(new Date(NOW.getTime() - 60_000));
    store.set(A, null);
    await postWebhook(app, webhookBody("evt-old", "EXPIRATION", A));
    expect(repository.planTier(A)).toBe("paid");
  });

  it("does not grant Pro for sandbox purchases unless allowed", async () => {
    const blocked = setup();
    blocked.store.set(A, activeSnapshot({ environment: "sandbox" }));
    await postWebhook(
      blocked.app,
      webhookBody("evt-sb", "INITIAL_PURCHASE", A),
    );
    expect(blocked.repository.planTier(A)).toBe("free");

    const allowed = setup({
      billing: { enabled: true, config: { ...baseConfig, allowSandbox: true } },
    });
    allowed.store.set(A, activeSnapshot({ environment: "sandbox" }));
    await postWebhook(
      allowed.app,
      webhookBody("evt-sb", "INITIAL_PURCHASE", A),
    );
    expect(allowed.repository.planTier(A)).toBe("paid");
  });

  it("skips anonymous and deleted accounts without asking the Store", async () => {
    const { app, reads, repository } = setup();
    const anonymous = await postWebhook(
      app,
      webhookBody("evt-anon", "INITIAL_PURCHASE", "$RCAnonymousID:abc123"),
    );
    expect(anonymous.statusCode).toBe(200);
    repository.deleteUser(B);
    const deleted = await postWebhook(
      app,
      webhookBody("evt-gone", "RENEWAL", DELETED, { aliases: [DELETED, B] }),
    );
    expect(deleted.statusCode).toBe(200);
    expect(reads).toEqual([]);
  });

  it("asks for a retry when the Store cannot be read, then completes", async () => {
    const { app, repository, store, setFailing } = setup();
    store.set(A, activeSnapshot());
    setFailing(true);
    const body = webhookBody("evt-retry", "INITIAL_PURCHASE", A);
    const first = await postWebhook(app, body);
    expect(first.statusCode).toBe(503);
    expect(repository.planTier(A)).toBe("free");
    setFailing(false);
    const retry = await postWebhook(app, body);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual({ received: true, duplicate: false });
    expect(repository.planTier(A)).toBe("paid");
  });
});

describe("entitlement sync and lapse", () => {
  it("re-reads only the caller's own entitlement and ignores any body", async () => {
    const { app, store, reads, repository } = setup();
    store.set(A, activeSnapshot());
    store.set(B, activeSnapshot());
    const response = await app.inject({
      method: "POST",
      url: "/v1/billing/entitlement/sync",
      headers: asB,
      payload: {
        userId: A,
        planTier: "paid",
        entitlement: { status: "active" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(reads).toEqual([B]);
    expect(repository.planTier(A)).toBe("free");
    expect(
      billingEntitlementResponseSchema.parse(response.json()).planTier,
    ).toBe("paid");
  });

  it("throttles repeated syncs and reports a Store outage", async () => {
    const { app, reads, setFailing, setNow } = setup();
    const sync = () =>
      app.inject({
        method: "POST",
        url: "/v1/billing/entitlement/sync",
        headers: asA,
      });
    await sync();
    await sync();
    expect(reads).toEqual([A]);
    setNow(new Date(NOW.getTime() + 11_000));
    setFailing(true);
    expect((await sync()).statusCode).toBe(503);
  });

  it("re-reads a lapsed active row on GET so Pro ends with the period", async () => {
    const { app, repository, store, setNow } = setup();
    store.set(A, activeSnapshot());
    await postWebhook(app, webhookBody("evt-1", "INITIAL_PURCHASE", A));
    expect(repository.planTier(A)).toBe("paid");
    // The expiry webhook never arrives; the period ends.
    setNow(new Date(NOW.getTime() + 14 * DAY));
    store.set(A, null);
    const plan = await getPlan(app, asA);
    expect(plan.planTier).toBe("free");
    expect(repository.planTier(A)).toBe("free");
  });

  it("keeps an operator's paid grant when a sync finds no purchase", async () => {
    const { app, repository, store } = setup({ manualPaidFor: A });
    const sync = await app.inject({
      method: "POST",
      url: "/v1/billing/entitlement/sync",
      headers: asA,
    });
    expect(sync.statusCode).toBe(200);
    expect(repository.planTier(A)).toBe("paid");
    expect(billingEntitlementResponseSchema.parse(sync.json()).paidSource).toBe(
      "manual",
    );
    // A subscription that later ends does clear paid.
    store.set(A, activeSnapshot());
    await postWebhook(app, webhookBody("evt-m1", "INITIAL_PURCHASE", A));
    store.set(A, null);
    await postWebhook(app, webhookBody("evt-m2", "EXPIRATION", A));
    expect(repository.planTier(A)).toBe("free");
  });

  it("caps app-triggered re-reads across all users", async () => {
    const { app, reads } = setup({ syncBudgetPerMinute: 1 });
    const sync = (headers: Record<string, string>) =>
      app.inject({
        method: "POST",
        url: "/v1/billing/entitlement/sync",
        headers,
      });
    expect((await sync(asA)).statusCode).toBe(200);
    expect((await sync(asB)).statusCode).toBe(200);
    expect(reads).toEqual([A]);
  });
});

describe("fail-closed environment", () => {
  it("refuses a purchase whose environment is unknown outside Dev", async () => {
    const { app, repository, store } = setup();
    store.set(A, activeSnapshot({ environment: null }));
    await postWebhook(app, webhookBody("evt-env", "INITIAL_PURCHASE", A));
    expect(repository.planTier(A)).toBe("free");
  });

  it("keeps processing when an alias is malformed", async () => {
    const { app, repository, store } = setup();
    store.set(A, activeSnapshot());
    const response = await postWebhook(
      app,
      webhookBody("evt-alias", "INITIAL_PURCHASE", A, {
        aliases: [A, "x".repeat(500), 42, null],
        environment: "SOMETHING_VERY_LONG_AND_UNEXPECTED",
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(repository.planTier(A)).toBe("paid");
  });
});
