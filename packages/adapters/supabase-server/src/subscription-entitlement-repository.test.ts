import { describe, expect, it, vi } from "vitest";

import type { SubscriptionEntitlementState, UserId } from "@mizyun/core";

import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";
import { SupabaseSubscriptionEntitlementRepository } from "./subscription-entitlement-repository.js";

const USER = "00000000-0000-4000-8000-000000000001" as UserId;
const OTHER = "00000000-0000-4000-8000-000000000002";

interface Result {
  data: unknown;
  error: unknown;
}

const entitlementRow = {
  user_id: USER,
  entitlement_id: "pro",
  status: "active",
  product_id: "mizyun_pro:yearly",
  store: "app_store",
  environment: "production",
  in_trial: true,
  will_renew: false,
  billing_issue: true,
  expires_at: "2026-11-26T12:00:00.000Z",
  observed_at: "2026-10-26T12:00:00.000Z",
  updated_at: "2026-10-26T12:00:01.000Z",
};

const ok = (data: unknown): Result => ({ data, error: null });

interface FakeOptions {
  tables?: Record<string, Result>;
  rpc?: Result;
}

const fakeClient = (options: FakeOptions = {}) => {
  const filters: Array<{ table: string; args: unknown[] }> = [];
  const rpc = vi.fn(
    async (_name: string, _args: Record<string, unknown>) =>
      options.rpc ?? { data: [], error: null },
  );
  const from = vi.fn((table: string) => {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((...args: unknown[]) => {
        filters.push({ table, args });
        return builder;
      }),
      maybeSingle: vi.fn(async () => options.tables?.[table] ?? ok(null)),
    };
    return builder;
  });
  return {
    client: {
      from,
      rpc,
      auth: { setSession: vi.fn() },
    } as unknown as RepositorySupabaseClient,
    from,
    rpc,
    filters,
  };
};

const state: SubscriptionEntitlementState = {
  entitlementId: "pro",
  status: "active",
  productId: "mizyun_pro:yearly",
  store: "play_store",
  environment: "sandbox",
  inTrial: true,
  willRenew: false,
  billingIssue: true,
  expiresAt: new Date("2026-11-26T12:00:00.000Z"),
};
const observedAt = new Date("2026-10-26T12:00:00.000Z");

describe("readForOwner", () => {
  const tables = (overrides: Record<string, Result> = {}) => ({
    profiles: ok({ plan_tier: "paid" }),
    subscription_entitlements: ok(entitlementRow),
    beta_pro_requests: ok({ status: "approved" }),
    ...overrides,
  });

  const build = (t: Record<string, Result>) => {
    const user = fakeClient({ tables: t });
    const service = fakeClient();
    const clientFor = vi.fn(() => user.client);
    const repo = new SupabaseSubscriptionEntitlementRepository({
      clientFor,
      serviceRoleClient: service.client,
    });
    return { repo, user, service, clientFor };
  };

  it("reads all three tables with the principal client only", async () => {
    const { repo, user, service, clientFor } = build(tables());
    await repo.readForOwner(USER, { accessToken: "tok" });
    expect(clientFor).toHaveBeenCalledTimes(1);
    expect(clientFor).toHaveBeenCalledWith("tok");
    expect(user.from.mock.calls.map((c) => c[0]).sort()).toEqual([
      "beta_pro_requests",
      "profiles",
      "subscription_entitlements",
    ]);
    expect(service.from).not.toHaveBeenCalled();
    expect(service.rpc).not.toHaveBeenCalled();
    expect(user.filters).toEqual([
      { table: "profiles", args: ["id", USER] },
      { table: "subscription_entitlements", args: ["user_id", USER] },
      { table: "beta_pro_requests", args: ["user_id", USER] },
    ]);
  });

  it("maps rows and dates", async () => {
    const { repo } = build(tables());
    const view = await repo.readForOwner(USER, { accessToken: "tok" });
    expect(view).toEqual({
      planTier: "paid",
      betaProApproved: true,
      entitlement: {
        userId: USER,
        entitlementId: "pro",
        status: "active",
        productId: "mizyun_pro:yearly",
        store: "app_store",
        environment: "production",
        inTrial: true,
        willRenew: false,
        billingIssue: true,
        expiresAt: new Date("2026-11-26T12:00:00.000Z"),
        observedAt: new Date("2026-10-26T12:00:00.000Z"),
        updatedAt: new Date("2026-10-26T12:00:01.000Z"),
      },
    });
  });

  it("maps a null expiry and a free account without rows", async () => {
    const { repo } = build(
      tables({
        profiles: ok({ plan_tier: "free" }),
        subscription_entitlements: ok({ ...entitlementRow, expires_at: null }),
        beta_pro_requests: ok({ status: "pending" }),
      }),
    );
    const view = await repo.readForOwner(USER, { accessToken: "tok" });
    expect(view.planTier).toBe("free");
    expect(view.betaProApproved).toBe(false);
    expect(view.entitlement?.expiresAt).toBeNull();

    const empty = build(
      tables({
        profiles: ok(null),
        subscription_entitlements: ok(null),
        beta_pro_requests: ok(null),
      }),
    );
    expect(await empty.repo.readForOwner(USER, { accessToken: "t" })).toEqual({
      planTier: "free",
      betaProApproved: false,
      entitlement: null,
    });
  });

  it("rejects an entitlement row owned by another user", async () => {
    const { repo } = build(
      tables({
        subscription_entitlements: ok({ ...entitlementRow, user_id: OTHER }),
      }),
    );
    await expect(
      repo.readForOwner(USER, { accessToken: "tok" }),
    ).rejects.toBeInstanceOf(RepositoryError);
  });

  it.each(["profiles", "subscription_entitlements", "beta_pro_requests"])(
    "throws RepositoryError when reading %s fails",
    async (table) => {
      const { repo } = build(
        tables({ [table]: { data: null, error: { message: "boom" } } }),
      );
      await expect(
        repo.readForOwner(USER, { accessToken: "tok" }),
      ).rejects.toBeInstanceOf(RepositoryError);
    },
  );
});

describe("writes", () => {
  const build = (rpcResult?: Result, tables?: Record<string, Result>) => {
    const service = fakeClient({
      ...(rpcResult ? { rpc: rpcResult } : {}),
      ...(tables ? { tables } : {}),
    });
    const user = fakeClient();
    const repo = new SupabaseSubscriptionEntitlementRepository({
      clientFor: () => user.client,
      serviceRoleClient: service.client,
    });
    return { repo, service, user };
  };

  it("apply calls billing_apply_entitlement with exact arguments", async () => {
    const { repo, service, user } = build(
      ok([{ applied: true, plan_tier: "paid" }]),
    );
    const result = await repo.apply(USER, state, {
      observedAt,
      eventId: "evt-1",
    });
    expect(result).toEqual({ applied: true, planTier: "paid" });
    expect(service.rpc).toHaveBeenCalledWith("billing_apply_entitlement", {
      p_user_id: USER,
      p_entitlement_id: "pro",
      p_status: "active",
      p_product_id: "mizyun_pro:yearly",
      p_store: "play_store",
      p_environment: "sandbox",
      p_in_trial: true,
      p_will_renew: false,
      p_billing_issue: true,
      p_expires_at: "2026-11-26T12:00:00.000Z",
      p_observed_at: "2026-10-26T12:00:00.000Z",
      p_event_id: "evt-1",
    });
    expect(user.rpc).not.toHaveBeenCalled();
  });

  it("apply sends null for a missing expiry and event id", async () => {
    const { repo, service } = build(ok([{ applied: false, plan_tier: null }]));
    const result = await repo.apply(
      USER,
      { ...state, expiresAt: null },
      { observedAt, eventId: null },
    );
    expect(result).toEqual({ applied: false, planTier: null });
    expect(service.rpc.mock.calls[0]![1]).toMatchObject({
      p_expires_at: null,
      p_event_id: null,
    });
  });

  it("apply throws when the RPC errors or returns no row", async () => {
    for (const rpc of [
      { data: [], error: { message: "x" } },
      { data: [{ applied: true, plan_tier: "paid" }], error: { message: "x" } },
      { data: [], error: null },
      { data: null, error: null },
    ]) {
      const { repo } = build(rpc);
      await expect(
        repo.apply(USER, state, { observedAt, eventId: null }),
      ).rejects.toBeInstanceOf(RepositoryError);
    }
  });

  it("claimWebhookEvent calls billing_claim_webhook_event and maps the flag", async () => {
    const first = build(ok([{ already_processed: false }]));
    expect(await first.repo.claimWebhookEvent("evt", "RENEWAL")).toBe(false);
    expect(first.service.rpc).toHaveBeenCalledWith(
      "billing_claim_webhook_event",
      { p_event_id: "evt", p_event_type: "RENEWAL" },
    );
    const dup = build(ok([{ already_processed: true }]));
    expect(await dup.repo.claimWebhookEvent("evt", "RENEWAL")).toBe(true);
  });

  it("claimWebhookEvent throws on error or an empty result", async () => {
    for (const rpc of [
      { data: [], error: { message: "x" } },
      { data: [], error: null },
    ]) {
      await expect(
        build(rpc).repo.claimWebhookEvent("evt", "T"),
      ).rejects.toBeInstanceOf(RepositoryError);
    }
  });

  it("completeWebhookEvent calls billing_complete_webhook_event", async () => {
    const { repo, service } = build(ok([]));
    await repo.completeWebhookEvent("evt");
    expect(service.rpc).toHaveBeenCalledWith("billing_complete_webhook_event", {
      p_event_id: "evt",
    });
  });

  it("completeWebhookEvent throws on error", async () => {
    await expect(
      build({ data: [], error: { message: "x" } }).repo.completeWebhookEvent(
        "e",
      ),
    ).rejects.toBeInstanceOf(RepositoryError);
  });

  it("userExists queries profiles with the service client", async () => {
    const { repo, service, user } = build(undefined, {
      profiles: ok({ id: USER }),
    });
    expect(await repo.userExists(USER)).toBe(true);
    expect(service.from).toHaveBeenCalledWith("profiles");
    expect(service.filters).toEqual([
      { table: "profiles", args: ["id", USER] },
    ]);
    expect(user.from).not.toHaveBeenCalled();
  });

  it("userExists is false for no row or a different id, and throws on error", async () => {
    expect(
      await build(undefined, { profiles: ok(null) }).repo.userExists(USER),
    ).toBe(false);
    expect(
      await build(undefined, { profiles: ok({ id: OTHER }) }).repo.userExists(
        USER,
      ),
    ).toBe(false);
    await expect(
      build(undefined, {
        profiles: { data: null, error: { message: "x" } },
      }).repo.userExists(USER),
    ).rejects.toBeInstanceOf(RepositoryError);
  });
});

describe("without a service-role client", () => {
  const user = fakeClient({
    tables: { profiles: ok({ id: USER }) },
    rpc: ok([{ applied: true, plan_tier: "paid", already_processed: false }]),
  });
  const repo = new SupabaseSubscriptionEntitlementRepository({
    clientFor: () => user.client,
    serviceRoleClient: null,
  });

  it("refuses every write and never falls back to the user client", async () => {
    await expect(
      repo.apply(USER, state, { observedAt, eventId: null }),
    ).rejects.toBeInstanceOf(RepositoryError);
    await expect(repo.claimWebhookEvent("e", "T")).rejects.toBeInstanceOf(
      RepositoryError,
    );
    await expect(repo.completeWebhookEvent("e")).rejects.toBeInstanceOf(
      RepositoryError,
    );
    await expect(repo.userExists(USER)).rejects.toBeInstanceOf(RepositoryError);
    expect(user.rpc).not.toHaveBeenCalled();
    expect(user.from).not.toHaveBeenCalled();
  });

  it("still serves owner reads", async () => {
    await expect(
      repo.readForOwner(USER, { accessToken: "t" }),
    ).resolves.toMatchObject({ entitlement: null });
  });
});
