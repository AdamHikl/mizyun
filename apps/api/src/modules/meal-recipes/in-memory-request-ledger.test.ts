import { describe, expect, it } from "vitest";
import type { ReserveRecipeRequest, UserId } from "@mizyun/core";
import {
  InMemoryRecipeRequestLedger,
  createInMemoryRecipeRequestState,
  type SyntheticRecipeBudgetGate,
} from "./in-memory-request-ledger.js";
const user = "81000000-0000-4000-8000-000000000001" as UserId;
const other = "81000000-0000-4000-8000-000000000002" as UserId;
const input = (n = 1): ReserveRecipeRequest => ({
  userId: user,
  requestId: `82000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  operation: "suggest",
  fingerprint: "a".repeat(64),
  consentVersion: "v1",
  tokensEstimated: 800,
  limits: {
    dailyTokenBudget: 1000,
    dailyDraftLimit: 10,
    requestsPerMinute: 10,
    maxConcurrentRequests: 10,
  },
  leaseMs: 60000,
});
function fixture() {
  let now = new Date("2026-10-13T23:59:30Z");
  let authorization: "allowed" | "consent" | "deletion" = "allowed";
  const usage = new Map<string, number>();
  const charged = new Map<string, number>();
  const gate: SyntheticRecipeBudgetGate = {
    isAvailable: async () => true,
    reserve: async (request) => {
      const key = `${request.userId}:${request.day}`;
      const used = usage.get(key) ?? 0;
      if (used + request.tokensEstimated > request.limits.dailyTokenBudget)
        return { allowed: false, reason: "tokens", retryAfter: 1 };
      usage.set(key, used + request.tokensEstimated);
      charged.set(request.attemptId, request.tokensEstimated);
      return { allowed: true };
    },
    settle: async (request) => {
      const original = charged.get(request.attemptId);
      if (original === undefined) return;
      charged.delete(request.attemptId);
      const key = `${request.userId}:${request.day}`;
      usage.set(
        key,
        (usage.get(key) ?? 0) + (request.tokensUsed ?? original) - original,
      );
    },
  };
  const state = createInMemoryRecipeRequestState();
  const create = () =>
    new InMemoryRecipeRequestLedger({
      clock: () => now,
      authorize: async () => authorization,
      budgetGate: gate,
      state,
    });
  return {
    ledger: create(),
    restart: create,
    usage,
    state,
    setNow: (value: string) => {
      now = new Date(value);
    },
    revoke: () => {
      authorization = "consent";
    },
    delete: () => {
      authorization = "deletion";
    },
  };
}
describe("explicit synthetic shared-gate recipe ledger", () => {
  it("concurrent duplicate admission has one reservation and remains busy across restart", async () => {
    const f = fixture();
    const results = await Promise.all([
      f.ledger.reserve(input()),
      f.ledger.reserve(input()),
    ]);
    expect(results.map((r) => r.kind)).toEqual(["reserved", "busy"]);
    expect(await f.restart().reserve(input())).toMatchObject({ kind: "busy" });
    expect(f.usage.get(`${user}:2026-10-13`)).toBe(800);
  });
  it("different fingerprint conflicts without a second budget charge", async () => {
    const f = fixture();
    await f.ledger.reserve(input());
    expect(
      await f.ledger.reserve({ ...input(), fingerprint: "b".repeat(64) }),
    ).toEqual({ kind: "conflict" });
    expect(f.state.attempts.size).toBe(1);
  });
  it("completed and failed identities cannot invoke another provider after lost output", async () => {
    for (const status of ["succeeded", "failed"] as const) {
      const f = fixture();
      const r = await f.ledger.reserve(input());
      if (r.kind !== "reserved") throw new Error("reservation");
      expect(
        await f.ledger.finalize({
          userId: user,
          attemptId: r.attemptId,
          status,
          tokensUsed: 100,
        }),
      ).toEqual({ publishAllowed: status === "succeeded" });
      expect(await f.restart().reserve(input())).toEqual({
        kind: "outcome_unavailable",
      });
      expect(f.usage.get(`${user}:2026-10-13`)).toBe(
        status === "succeeded" ? 100 : 800,
      );
    }
  });
  it("expired ambiguity keeps estimate, never publishes, and never reopens identity", async () => {
    const f = fixture();
    const r = await f.ledger.reserve(input());
    if (r.kind !== "reserved") throw new Error("reservation");
    f.setNow("2026-10-14T00:01:00Z");
    expect(
      await f.restart().finalize({
        userId: user,
        attemptId: r.attemptId,
        status: "succeeded",
        tokensUsed: 100,
      }),
    ).toEqual({ publishAllowed: false });
    expect(await f.restart().reserve(input())).toEqual({
      kind: "outcome_unavailable",
    });
    expect(f.usage.get(`${user}:2026-10-13`)).toBe(800);
    expect(f.usage.get(`${user}:2026-10-14`)).toBeUndefined();
  });
  it("trusted successful midnight settlement updates original budget day once", async () => {
    const f = fixture();
    const r = await f.ledger.reserve(input());
    if (r.kind !== "reserved") throw new Error("reservation");
    f.setNow("2026-10-14T00:00:00Z");
    await f.ledger.finalize({
      userId: user,
      attemptId: r.attemptId,
      status: "succeeded",
      tokensUsed: 200,
    });
    expect(
      await f.ledger.finalize({
        userId: user,
        attemptId: r.attemptId,
        status: "succeeded",
        tokensUsed: 0,
      }),
    ).toEqual({ publishAllowed: false });
    expect(f.usage.get(`${user}:2026-10-13`)).toBe(200);
  });
  it("other synthetic AI operations share the injected budget namespace", async () => {
    const f = fixture();
    // Simulated Coach usage in the same injected counter, not an independent recipe budget.
    f.usage.set(`${user}:2026-10-13`, 300);
    expect(await f.ledger.reserve(input())).toMatchObject({
      kind: "denied",
      reason: "tokens",
    });
    expect(f.state.attempts.size).toBe(0);
  });
  it.each(["revoke", "delete"] as const)(
    "fresh %s fence denies admission and suppresses late result",
    async (fence) => {
      const f = fixture();
      const r = await f.ledger.reserve(input());
      if (r.kind !== "reserved") throw new Error("reservation");
      f[fence]();
      expect(
        await f.ledger.finalize({
          userId: user,
          attemptId: r.attemptId,
          status: "succeeded",
          tokensUsed: 100,
        }),
      ).toEqual({ publishAllowed: false });
      expect(await f.ledger.reserve(input(2))).toMatchObject({
        kind: "denied",
        reason: fence === "revoke" ? "consent" : "deletion",
      });
    },
  );
  it("cross-owner finalization cannot release or refund a reservation", async () => {
    const f = fixture();
    const r = await f.ledger.reserve(input());
    if (r.kind !== "reserved") throw new Error("reservation");
    expect(
      await f.ledger.finalize({
        userId: other,
        attemptId: r.attemptId,
        status: "succeeded",
        tokensUsed: 0,
      }),
    ).toEqual({ publishAllowed: false });
    expect(f.usage.get(`${user}:2026-10-13`)).toBe(800);
  });
});

describe("synthetic recipe operational lifecycle metadata", () => {
  it("exports only content-free metadata and preserves owner isolation", async () => {
    const f = fixture();
    const r = await f.ledger.reserve(input());
    if (r.kind !== "reserved") throw new Error("reservation");
    await f.ledger.finalize({
      userId: user,
      attemptId: r.attemptId,
      status: "succeeded",
      tokensUsed: 100,
    });
    expect(await f.ledger.exportUsageForUser(user)).toEqual([
      {
        requestId: input().requestId,
        operation: "suggest",
        status: "succeeded",
        createdAt: "2026-10-13T23:59:30.000Z",
        budgetDay: "2026-10-13",
        tokensCharged: 100,
      },
    ]);
    expect(await f.ledger.exportUsageForUser(other)).toEqual([]);
  });
  it("explicit deletion removes operational identity and fences a late result", async () => {
    const f = fixture();
    const r = await f.ledger.reserve(input());
    if (r.kind !== "reserved") throw new Error("reservation");
    await f.ledger.reserve({ ...input(2), userId: other });
    f.delete();
    await f.ledger.deleteForUser(user);
    expect(await f.ledger.exportUsageForUser(user)).toEqual([]);
    expect(await f.ledger.exportUsageForUser(other)).toHaveLength(1);
    expect(
      await f.restart().finalize({
        userId: user,
        attemptId: r.attemptId,
        status: "succeeded",
        tokensUsed: 0,
      }),
    ).toEqual({ publishAllowed: false });
    expect(f.usage.get(`${user}:2026-10-13`)).toBe(800);
    expect(await f.ledger.reserve(input())).toMatchObject({
      kind: "denied",
      reason: "deletion",
    });
  });
});
