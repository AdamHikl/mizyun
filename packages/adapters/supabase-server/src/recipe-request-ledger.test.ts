import { describe, expect, it, vi } from "vitest";
import type { ReserveRecipeRequest, UserId } from "@mizyun/core";
import type { RepositorySupabaseClient } from "./index.js";
import { SupabaseRecipeRequestLedger } from "./recipe-request-ledger.js";
const input: ReserveRecipeRequest = {
  userId: "83000000-0000-4000-8000-000000000001" as UserId,
  requestId: "83000000-0000-4000-8000-000000000002",
  operation: "suggest",
  fingerprint: "a".repeat(64),
  consentVersion: "v1",
  tokensEstimated: 1500,
  limits: {
    dailyTokenBudget: 5000,
    dailyDraftLimit: 5,
    requestsPerMinute: 3,
    maxConcurrentRequests: 1,
  },
  leaseMs: 60000,
};
const fixture = (
  data: Record<string, unknown>[],
  error: null | { message: string } = null,
) => {
  const rpc = vi.fn(async () => ({ data, error }));
  return {
    rpc,
    ledger: new SupabaseRecipeRequestLedger({
      rpc,
    } as unknown as RepositorySupabaseClient),
  };
};
describe("durable recipe request adapter", () => {
  it("performs one atomic RPC with content-free owner/identity/budget metadata", async () => {
    const f = fixture([
      {
        outcome: "reserved",
        attempt_id: "attempt",
        budget_day: "2026-10-13",
        lease_expires_at: "2026-10-13T12:01:00Z",
        reason: null,
        retry_after: 0,
      },
    ]);
    expect(await f.ledger.reserve(input)).toEqual({
      kind: "reserved",
      attemptId: "attempt",
      day: "2026-10-13",
      leaseExpiresAt: "2026-10-13T12:01:00Z",
    });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("ai_reserve_recipe_request", {
      p_user_id: input.userId,
      p_request_id: input.requestId,
      p_operation: "suggest",
      p_fingerprint: input.fingerprint,
      p_consent_version: "v1",
      p_tokens_estimated: 1500,
      p_token_budget: 5000,
      p_draft_budget: 5,
      p_per_minute: 3,
      p_max_concurrent: 1,
      p_lease_ms: 60000,
    });
  });
  it.each(["conflict", "outcome_unavailable"])(
    "maps durable %s without issuing a fresh reservation",
    async (outcome) => {
      const f = fixture([{ outcome }]);
      expect(await f.ledger.reserve(input)).toEqual({ kind: outcome });
      expect(f.rpc).toHaveBeenCalledTimes(1);
    },
  );
  it("maps duplicate busy and budget denial", async () => {
    expect(
      await fixture([{ outcome: "busy", retry_after: 30 }]).ledger.reserve(
        input,
      ),
    ).toEqual({ kind: "busy", retryAfter: 30 });
    expect(
      await fixture([
        { outcome: "denied", reason: "tokens", retry_after: 60 },
      ]).ledger.reserve(input),
    ).toEqual({ kind: "denied", reason: "tokens", retryAfter: 60 });
  });
  it("fails closed on missing migration, transport failure, or malformed reservation", async () => {
    const f = fixture([], { message: "schema unavailable" });
    expect(await f.ledger.isAvailable()).toBe(false);
    await expect(f.ledger.reserve(input)).rejects.toThrow(
      "Recipe reservation unavailable",
    );
    await expect(
      fixture([{ outcome: "reserved" }]).ledger.reserve(input),
    ).rejects.toThrow("Recipe reservation unavailable");
    await expect(
      fixture([
        { outcome: "denied", reason: "untrusted", retry_after: 0 },
      ]).ledger.reserve(input),
    ).rejects.toThrow("Recipe reservation unavailable");
  });
  it("readiness is a read-only service RPC", async () => {
    const f = fixture([{ available: true }]);
    expect(await f.ledger.isAvailable()).toBe(true);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith(
      "ai_recipe_requests_available",
      {},
    );
  });
  it("invalid fingerprint or bounds make zero RPCs", async () => {
    const f = fixture([]);
    await expect(
      f.ledger.reserve({ ...input, fingerprint: "sensitive input" }),
    ).rejects.toThrow("Invalid recipe request reservation");
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("terminal failure requests conservative settlement and preserves owner fence", async () => {
    const f = fixture([{ publish_allowed: false }]);
    expect(
      await f.ledger.finalize({
        userId: input.userId,
        attemptId: "attempt",
        status: "failed",
      }),
    ).toEqual({ publishAllowed: false });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith(
      "ai_finalize_recipe_request",
      {
        p_user_id: input.userId,
        p_attempt_id: "attempt",
        p_status: "failed",
        p_tokens_used: null,
      },
    );
  });
  it("settlement error cannot be reported as a publishable result", async () => {
    await expect(
      fixture([], { message: "unavailable" }).ledger.finalize({
        userId: input.userId,
        attemptId: "attempt",
        status: "succeeded",
        tokensUsed: 100,
      }),
    ).rejects.toThrow("Recipe settlement unavailable");
  });
});

const usageRow = (changes: Record<string, unknown> = {}) => ({
  user_id: input.userId,
  request_id: input.requestId,
  operation: "suggest",
  status: "attempting",
  created_at: "2026-10-13T12:00:00+00:00",
  budget_day: "2026-10-13",
  tokens_charged: 1500,
  fingerprint: "private",
  consent_version: "private",
  attempt_id: "private",
  ...changes,
});
function usageFixture(initial: Record<string, unknown>[]) {
  let rows = [...initial];
  const select = vi.fn();
  const eq = vi.fn();
  const range = vi.fn();
  const remove = vi.fn();
  const from = vi.fn(() => {
    let owner: unknown;
    let deleting = false;
    let first = 0;
    let last = 999;
    const builder = {
      select: (columns: string) => {
        select(columns);
        return builder;
      },
      eq: (column: string, value: unknown) => {
        eq(column, value);
        owner = value;
        return builder;
      },
      order: () => builder,
      range: (start: number, end: number) => {
        range(start, end);
        first = start;
        last = end;
        return builder;
      },
      delete: () => {
        remove();
        deleting = true;
        return builder;
      },
      then: (resolve: (value: unknown) => unknown) => {
        if (deleting) rows = rows.filter((row) => row.user_id !== owner);
        return Promise.resolve({
          data: deleting
            ? []
            : rows
                .filter((row) => row.user_id === owner)
                .slice(first, last + 1),
          error: null,
        }).then(resolve);
      },
    };
    return builder;
  });
  const rpc = vi.fn(async () => ({
    data: [{ publish_allowed: false }],
    error: null,
  }));
  const ledger = new SupabaseRecipeRequestLedger({
    from,
    rpc,
  } as unknown as RepositorySupabaseClient);
  return { ledger, from, select, eq, range, remove, getRows: () => rows };
}
describe("recipe operational account lifecycle adapter", () => {
  it.each(["42P01", "42501", "PGRST205", "08006", undefined])(
    "only explicit undefined_table absence bypasses account export and cleanup: %s",
    async (code) => {
      const builder = {
        select: () => builder,
        delete: () => builder,
        eq: () => builder,
        order: () => builder,
        range: () => builder,
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({
            data: null,
            error: { code, message: "ai_recipe_requests unavailable" },
          }).then(resolve),
      };
      const ledger = new SupabaseRecipeRequestLedger({
        from: () => builder,
      } as unknown as RepositorySupabaseClient);
      if (code === "42P01") {
        expect(await ledger.exportUsageForUser(input.userId)).toEqual([]);
        await expect(
          ledger.deleteForUser(input.userId),
        ).resolves.toBeUndefined();
      } else {
        await expect(ledger.exportUsageForUser(input.userId)).rejects.toThrow(
          "export unavailable",
        );
        await expect(ledger.deleteForUser(input.userId)).rejects.toThrow(
          "cleanup unavailable",
        );
      }
    },
  );
  it("transport exceptions never become an empty export or successful cleanup", async () => {
    const ledger = new SupabaseRecipeRequestLedger({
      from: () => {
        throw new Error("network outage");
      },
    } as unknown as RepositorySupabaseClient);
    await expect(ledger.exportUsageForUser(input.userId)).rejects.toThrow(
      "network outage",
    );
    await expect(ledger.deleteForUser(input.userId)).rejects.toThrow(
      "network outage",
    );
  });
  it("exports only exact owner metadata allowlist and no private attempt identity", async () => {
    const f = usageFixture([
      usageRow(),
      usageRow({ user_id: "83000000-0000-4000-8000-000000000003" }),
    ]);
    expect(await f.ledger.exportUsageForUser(input.userId)).toEqual([
      {
        requestId: input.requestId,
        operation: "suggest",
        status: "attempting",
        createdAt: "2026-10-13T12:00:00.000Z",
        budgetDay: "2026-10-13",
        tokensCharged: 1500,
      },
    ]);
    expect(f.select).toHaveBeenCalledExactlyOnceWith(
      "user_id,request_id,operation,status,created_at,budget_day,tokens_charged",
    );
    expect(f.eq).toHaveBeenCalledExactlyOnceWith("user_id", input.userId);
  });
  it("empty owner export succeeds and multi-page export is complete", async () => {
    expect(
      await usageFixture([]).ledger.exportUsageForUser(input.userId),
    ).toEqual([]);
    const f = usageFixture(
      Array.from({ length: 1001 }, (_, n) =>
        usageRow({
          request_id: `83000000-0000-4000-8000-${String(n + 10).padStart(12, "0")}`,
        }),
      ),
    );
    expect(await f.ledger.exportUsageForUser(input.userId)).toHaveLength(1001);
    expect(f.range.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });
  it.each([
    { operation: "prompt" },
    { status: "provider content" },
    { request_id: "not uuid" },
    { created_at: "secret" },
    { budget_day: "2026-02-30" },
    { tokens_charged: -1 },
    { tokens_charged: 1.5 },
  ])("malformed operational metadata blocks export: %j", async (change) => {
    await expect(
      usageFixture([usageRow(change)]).ledger.exportUsageForUser(input.userId),
    ).rejects.toThrow("Recipe usage export unavailable");
  });
  it("explicit cleanup erases only the owner; late finalize cannot publish", async () => {
    const other = "83000000-0000-4000-8000-000000000003";
    const f = usageFixture([usageRow(), usageRow({ user_id: other })]);
    await f.ledger.deleteForUser(input.userId);
    expect(f.getRows().map((row) => row.user_id)).toEqual([other]);
    expect(await f.ledger.exportUsageForUser(input.userId)).toEqual([]);
    expect(
      await f.ledger.finalize({
        userId: input.userId,
        attemptId: "private",
        status: "succeeded",
        tokensUsed: 0,
      }),
    ).toEqual({ publishAllowed: false });
  });
});
