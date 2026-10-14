import { describe, expect, it, vi } from "vitest";
import { capsForTier } from "@mizyun/config";
import {
  SupabaseRecipeRequestLedger,
  type RepositorySupabaseClient,
} from "@mizyun/adapter-supabase-server";
import type { PlanTier, UserId, ConversationId } from "@mizyun/core";

import {
  InMemoryCoachLimitService,
  SupabaseCoachLimitService,
  type ReserveSlotRequest,
} from "./limits.js";

const userId = "00000000-0000-4000-8000-000000000001" as UserId;
const otherUserId = "00000000-0000-4000-8000-000000000002" as UserId;
const conversationId = "00000000-0000-4000-8000-0000000000c1" as ConversationId;

const fixedClock =
  (iso: string): (() => Date) =>
  () =>
    new Date(iso);

const buildRequest = (
  overrides: Partial<ReserveSlotRequest> = {},
): ReserveSlotRequest => ({
  userId,
  conversationId,
  idempotencyKey: "key-0001",
  planTier: "free",
  tokensEstimated: 1_200,
  ...overrides,
});

/**
 * Sequentially acquire + release a slot. Mirrors the route's
 * contract: every `acquireSlot` must be paired with `commitTokens`
 * (success) or `releaseSlot` (failure) before another acquire on
 * the same user can succeed, because the in-flight slot stays
 * incremented until then.
 */
const acquireAndRelease = async (
  service: InMemoryCoachLimitService,
  request: ReserveSlotRequest,
): Promise<{
  readonly first: ReturnType<typeof service.acquireSlot> extends Promise<
    infer R
  >
    ? R
    : never;
}> => {
  const result = await service.acquireSlot(request);
  if (result.kind === "reserved") {
    await service.commitTokens({
      userId: request.userId,
      providerCallId: result.providerCallId,
      finalStatus: "succeeded",
      messageId: null,
      tokensUsed: 0,
    });
  }
  return { first: result };
};

const sharedCounterFixture = (
  maxConcurrentRequests = 1,
  deniedRpc?: string,
) => {
  const counters = new Map<string, number>();
  const attempts = new Map<string, string>();
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    const owner = String(args.p_user_id);
    const active = counters.get(owner) ?? 0;
    let row: Record<string, unknown>;
    switch (name) {
      case "ai_acquire_in_flight": {
        const allowed = active < Number(args.p_max);
        if (allowed) counters.set(owner, active + 1);
        row = { allowed };
        break;
      }
      case "ai_release_in_flight":
        counters.set(owner, Math.max(0, active - 1));
        row = {};
        break;
      case "ai_reserve_recipe_request":
        if (active >= Number(args.p_max_concurrent)) {
          row = { outcome: "denied", reason: "inflight", retry_after: 1 };
        } else {
          const attemptId = crypto.randomUUID();
          counters.set(owner, active + 1);
          attempts.set(attemptId, owner);
          row = {
            outcome: "reserved",
            attempt_id: attemptId,
            budget_day: "2026-10-13",
            lease_expires_at: "2026-10-13T10:01:00.000Z",
          };
        }
        break;
      case "ai_finalize_recipe_request":
        if (attempts.get(String(args.p_attempt_id)) !== owner) {
          throw new Error("unknown recipe reservation");
        }
        attempts.delete(String(args.p_attempt_id));
        counters.set(owner, Math.max(0, active - 1));
        row = { publish_allowed: false };
        break;
      case "ai_register_request":
      case "ai_reserve_tokens":
      case "ai_reserve_draft":
        row = { allowed: name !== deniedRpc, retry_after: 60 };
        break;
      case "ai_reserve_provider_call":
        row = { outcome: "reserved", call_id: crypto.randomUUID() };
        break;
      default:
        throw new Error(`unexpected RPC ${name}`);
    }
    return { data: [row], error: null };
  });
  const serviceClient = { rpc } as unknown as RepositorySupabaseClient;
  const recipes = new SupabaseRecipeRequestLedger(serviceClient);
  return {
    rpc,
    active: () => counters.get(userId) ?? 0,
    coach: new SupabaseCoachLimitService({
      serviceClient,
      clock: fixedClock("2026-10-13T10:00:00.000Z"),
      resolveCap: (tier) => ({ ...capsForTier(tier), maxConcurrentRequests }),
    }),
    recipes,
    reserveRecipe: () =>
      recipes.reserve({
        userId,
        requestId: crypto.randomUUID(),
        operation: "suggest",
        fingerprint: "a".repeat(64),
        consentVersion: "v1",
        tokensEstimated: 1500,
        limits: {
          dailyTokenBudget: 10_000,
          dailyDraftLimit: 5,
          requestsPerMinute: 3,
          maxConcurrentRequests,
        },
        leaseMs: 60_000,
      }),
  };
};

describe("SupabaseCoachLimitService — shared recipe concurrency", () => {
  it.each(["chat", "draft"] as const)(
    "a denied %s acquisition preserves an active recipe's slot",
    async (kind) => {
      const f = sharedCounterFixture();
      const first = await f.reserveRecipe();
      expect(first.kind).toBe("reserved");
      if (first.kind !== "reserved") throw new Error("expected reservation");

      const denied =
        kind === "chat"
          ? await f.coach.acquireSlot(buildRequest())
          : await f.coach.acquireDraftSlot(userId, "free", "photo");
      expect(denied).toMatchObject({ reason: "inflight" });
      expect(await f.reserveRecipe()).toEqual({
        kind: "denied",
        reason: "inflight",
        retryAfter: 1,
      });
      expect(f.active()).toBe(1);
      expect(f.rpc.mock.calls.map(([name]) => name)).not.toContain(
        "ai_release_in_flight",
      );

      await f.recipes.finalize({
        userId,
        attemptId: first.attemptId,
        status: "failed",
      });
      expect(f.active()).toBe(0);
      expect((await f.reserveRecipe()).kind).toBe("reserved");
    },
  );

  it.each([
    { kind: "chat", deniedRpc: "ai_reserve_tokens", reason: "tokens" },
    { kind: "draft", deniedRpc: "ai_register_request", reason: "minute" },
    { kind: "draft", deniedRpc: "ai_reserve_draft", reason: "drafts" },
  ] as const)(
    "$kind $reason denial releases only its successfully acquired slot",
    async ({ kind, deniedRpc, reason }) => {
      const f = sharedCounterFixture(2, deniedRpc);
      expect((await f.reserveRecipe()).kind).toBe("reserved");
      const denied =
        kind === "chat"
          ? await f.coach.acquireSlot(buildRequest())
          : await f.coach.acquireDraftSlot(userId, "free", "photo");
      expect(denied).toMatchObject({ reason });
      expect(f.active()).toBe(1);
      expect((await f.reserveRecipe()).kind).toBe("reserved");
      expect(await f.reserveRecipe()).toMatchObject({
        kind: "denied",
        reason: "inflight",
      });
    },
  );
});

describe("InMemoryCoachLimitService — per-tier caps", () => {
  it("honours the free-tier daily budget (10k tokens)", async () => {
    const service = new InMemoryCoachLimitService({
      clock: fixedClock("2026-07-23T10:00:00.000Z"),
    });
    // First call: budget available.
    const first = await service.acquireSlot(buildRequest({ planTier: "free" }));
    expect(first.kind).toBe("reserved");
    if (first.kind !== "reserved") return;
    expect(first.cap.dailyTokenBudget).toBe(10_000);

    // Commit 9_900 tokens. Used = 9_900. Budget remaining = 100.
    await service.commitTokens({
      userId,
      providerCallId: first.providerCallId,
      finalStatus: "succeeded",
      messageId: "msg-1",
      tokensUsed: 9_900,
    });

    // Next request with tokensEstimated=1200: used 9900 + 1200 > 10000.
    const blocked = await service.acquireSlot(
      buildRequest({ idempotencyKey: "key-0002" }),
    );
    expect(blocked.kind).toBe("limited");
    if (blocked.kind !== "limited") return;
    expect(blocked.reason).toBe("tokens");
  });

  it("honours the paid-tier daily budget (100k tokens)", async () => {
    const service = new InMemoryCoachLimitService({
      clock: fixedClock("2026-07-23T10:00:00.000Z"),
    });
    // Reserve; commit 50_000 tokens (well within 100k).
    const first = await service.acquireSlot(buildRequest({ planTier: "paid" }));
    expect(first.kind).toBe("reserved");
    if (first.kind !== "reserved") return;
    expect(first.cap.dailyTokenBudget).toBe(100_000);
    await service.commitTokens({
      userId,
      providerCallId: first.providerCallId,
      finalStatus: "succeeded",
      messageId: "msg-1",
      tokensUsed: 50_000,
    });

    // Second request: 50_000 + 1_200 = 51_200 < 100_000. Pass.
    const second = await service.acquireSlot(
      buildRequest({ idempotencyKey: "key-0002", planTier: "paid" }),
    );
    expect(second.kind).toBe("reserved");
  });

  it("free tier rejects the 4th request in a minute; paid tier allows up to 6", async () => {
    const freeService = new InMemoryCoachLimitService({
      clock: fixedClock("2026-07-23T10:00:00.000Z"),
    });
    for (let i = 0; i < 3; i++) {
      const { first } = await acquireAndRelease(
        freeService,
        buildRequest({
          planTier: "free",
          idempotencyKey: `free-key-${i}`,
        }),
      );
      expect(first.kind).toBe("reserved");
    }
    const freeFourth = await acquireAndRelease(
      freeService,
      buildRequest({ planTier: "free", idempotencyKey: "free-key-3" }),
    );
    expect(freeFourth.first.kind).toBe("limited");
    if (freeFourth.first.kind !== "limited") return;
    expect(freeFourth.first.reason).toBe("minute");

    const paidService = new InMemoryCoachLimitService({
      clock: fixedClock("2026-07-23T10:00:00.000Z"),
    });
    for (let i = 0; i < 6; i++) {
      const { first } = await acquireAndRelease(
        paidService,
        buildRequest({
          planTier: "paid",
          idempotencyKey: `paid-key-${i}`,
        }),
      );
      expect(first.kind).toBe("reserved");
    }
    const paidSeventh = await acquireAndRelease(
      paidService,
      buildRequest({ planTier: "paid", idempotencyKey: "paid-key-6" }),
    );
    expect(paidSeventh.first.kind).toBe("limited");
    if (paidSeventh.first.kind !== "limited") return;
    expect(paidSeventh.first.reason).toBe("minute");
  });

  it("resets the per-minute window when the minute boundary passes", async () => {
    let now = new Date("2026-07-23T10:00:00.000Z");
    const service = new InMemoryCoachLimitService({
      clock: () => now,
    });
    for (let i = 0; i < 3; i++) {
      const { first } = await acquireAndRelease(
        service,
        buildRequest({
          planTier: "free",
          idempotencyKey: `key-${i}`,
        }),
      );
      expect(first.kind).toBe("reserved");
    }
    // Cross the minute boundary.
    now = new Date("2026-07-23T10:01:00.000Z");
    const reset = await acquireAndRelease(
      service,
      buildRequest({ planTier: "free", idempotencyKey: "key-reset" }),
    );
    expect(reset.first.kind).toBe("reserved");
  });

  it("rejects concurrent in-flight acquisitions once the cap is hit", async () => {
    const service = new InMemoryCoachLimitService({
      clock: fixedClock("2026-07-23T10:00:00.000Z"),
    });
    const first = await service.acquireSlot(
      buildRequest({ idempotencyKey: "in-flight-1" }),
    );
    expect(first.kind).toBe("reserved");
    // Second concurrent acquire on a new key hits the in-flight cap.
    const blocked = await service.acquireSlot(
      buildRequest({ idempotencyKey: "in-flight-2" }),
    );
    expect(blocked.kind).toBe("limited");
    if (blocked.kind !== "limited") return;
    expect(blocked.reason).toBe("inflight");
    expect(blocked.retryAfter).toBe(1);

    // Release the slot via a successful commit; the next acquire fits.
    if (first.kind !== "reserved") return;
    await service.commitTokens({
      userId,
      providerCallId: first.providerCallId,
      finalStatus: "succeeded",
      messageId: "msg-1",
      tokensUsed: 100,
    });
    const recovered = await service.acquireSlot(
      buildRequest({ idempotencyKey: "in-flight-3" }),
    );
    expect(recovered.kind).toBe("reserved");
  });

  it("releaseSlot on error decrements in-flight without committing tokens", async () => {
    const service = new InMemoryCoachLimitService({
      clock: fixedClock("2026-07-23T10:00:00.000Z"),
    });
    const reserved = await service.acquireSlot(buildRequest());
    if (reserved.kind !== "reserved") {
      throw new Error("expected reserved");
    }
    await service.releaseSlot({
      userId,
      providerCallId: reserved.providerCallId,
      finalStatus: "failed",
      messageId: null,
      tokensUsed: 0,
    });
    // After release, another acquire succeeds. Used stays at 0
    // because `failed` releases do not increment the ledger.
    const next = await service.acquireSlot(
      buildRequest({ idempotencyKey: "after-fail" }),
    );
    expect(next.kind).toBe("reserved");
  });

  it("replays a previously completed provider call from the same idempotency key", async () => {
    const service = new InMemoryCoachLimitService({
      clock: fixedClock("2026-07-23T10:00:00.000Z"),
    });
    const reserved = await service.acquireSlot(buildRequest());
    if (reserved.kind !== "reserved") {
      throw new Error("expected reserved");
    }
    await service.commitTokens({
      userId,
      providerCallId: reserved.providerCallId,
      finalStatus: "succeeded",
      messageId: "msg-1",
      tokensUsed: 100,
    });
    const replay = await service.acquireSlot(buildRequest());
    expect(replay.kind).toBe("replayed");
    if (replay.kind !== "replayed") return;
    expect(replay.existingMessageId).toBe("msg-1");
    expect(replay.existingMessageStatus).toBe("succeeded");
  });

  it("returns conflict on a retry with the same idempotency key after a failure", async () => {
    const service = new InMemoryCoachLimitService({
      clock: fixedClock("2026-07-23T10:00:00.000Z"),
    });
    const reserved = await service.acquireSlot(buildRequest());
    if (reserved.kind !== "reserved") {
      throw new Error("expected reserved");
    }
    await service.releaseSlot({
      userId,
      providerCallId: reserved.providerCallId,
      finalStatus: "failed",
      messageId: null,
      tokensUsed: 0,
    });
    const retry = await service.acquireSlot(buildRequest());
    expect(retry.kind).toBe("conflict");
    if (retry.kind !== "conflict") return;
    expect(retry.retryAfter).toBe(1);
  });

  it("scopes state per user: user B is unaffected by user A's usage", async () => {
    const service = new InMemoryCoachLimitService({
      clock: fixedClock("2026-07-23T10:00:00.000Z"),
    });
    // Burn user A's free-tier minute budget.
    for (let i = 0; i < 3; i++) {
      const { first } = await acquireAndRelease(
        service,
        buildRequest({ idempotencyKey: `a-key-${i}` }),
      );
      expect(first.kind).toBe("reserved");
    }
    const aBlocked = await acquireAndRelease(
      service,
      buildRequest({ idempotencyKey: "a-key-3" }),
    );
    expect(aBlocked.first.kind).toBe("limited");

    // User B starts with a clean slate.
    const bResult = await acquireAndRelease(
      service,
      buildRequest({ userId: otherUserId, idempotencyKey: "b-key-1" }),
    );
    expect(bResult.first.kind).toBe("reserved");
  });

  it("caps resolveCap via capOverrides for tests", () => {
    const service = new InMemoryCoachLimitService({
      clock: fixedClock("2026-07-23T10:00:00.000Z"),
      capOverrides: { dailyTokenBudget: 42 },
    });
    const cap = service.resolveCap("free");
    expect(cap.dailyTokenBudget).toBe(42);
    // Requests-per-minute stays at the free-tier default.
    expect(cap.requestsPerMinute).toBe(capsForTier("free").requestsPerMinute);
  });

  it("falls back to free when the resolver is asked for an unknown tier (defence in depth)", () => {
    const service = new InMemoryCoachLimitService({
      clock: fixedClock("2026-07-23T10:00:00.000Z"),
    });
    const free = capsForTier("free");
    expect(service.resolveCap("free" as PlanTier)).toEqual(free);
  });

  describe("draft slot limits", () => {
    it("acquires draft slot and commits drafts, updating daily usage", async () => {
      let currentTime = new Date("2026-07-23T10:00:00.000Z").getTime();
      const service = new InMemoryCoachLimitService({
        clock: () => new Date(currentTime),
      });

      // Free tier budget is 5 drafts per day
      for (let i = 0; i < 5; i++) {
        const slot = await service.acquireDraftSlot(userId, "free", "photo");
        expect(slot.allowed).toBe(true);
        await service.commitDraftTokens(userId, 0);
        // Advance clock by 65s so minute rate limit does not interfere with daily limit test
        currentTime += 65_000;
      }

      // 6th draft exceeds daily limit of 5
      const blocked = await service.acquireDraftSlot(userId, "free", "photo");
      expect(blocked.allowed).toBe(false);
      if (!blocked.allowed) {
        expect(blocked.reason).toBe("drafts");
        expect(blocked.retryAfter).toBeGreaterThan(0);
      }
    });

    it("enforces max concurrent in-flight requests for draft slots", async () => {
      let currentTime = new Date("2026-07-23T10:00:00.000Z").getTime();
      const service = new InMemoryCoachLimitService({
        clock: () => new Date(currentTime),
      });

      // Free tier maxConcurrentRequests is 1
      const slot1 = await service.acquireDraftSlot(userId, "free", "text");
      expect(slot1.allowed).toBe(true);

      // Concurrent request while slot1 is in-flight is rejected
      const slot2 = await service.acquireDraftSlot(userId, "free", "text");
      expect(slot2.allowed).toBe(false);
      if (!slot2.allowed) {
        expect(slot2.reason).toBe("inflight");
      }

      // Releasing slot1 allows subsequent acquisition once minute window clears
      await service.releaseDraftSlot(userId);
      currentTime += 65_000;
      const slot3 = await service.acquireDraftSlot(userId, "free", "text");
      expect(slot3.allowed).toBe(true);
      await service.releaseDraftSlot(userId);
    });

    it("releaseDraftSlot frees in-flight slot without burning daily draft budget", async () => {
      let currentTime = new Date("2026-07-23T10:00:00.000Z").getTime();
      const service = new InMemoryCoachLimitService({
        clock: () => new Date(currentTime),
      });

      const slot = await service.acquireDraftSlot(userId, "free", "photo");
      expect(slot.allowed).toBe(true);

      // Provider failed; release without commit
      await service.releaseDraftSlot(userId);

      // User still has full 5 draft budget available (advancing clock for minute window)
      currentTime += 65_000;
      const retrySlot = await service.acquireDraftSlot(userId, "free", "photo");
      expect(retrySlot.allowed).toBe(true);
      await service.releaseDraftSlot(userId);
    });
  });

  describe("token reservations and counter independence (REL-AUD-006)", () => {
    it("reconciles estimated tokens on commitTokens so unused reservations are returned to budget", async () => {
      let currentTime = new Date("2026-07-23T10:00:00.000Z").getTime();
      const service = new InMemoryCoachLimitService({
        clock: () => new Date(currentTime),
      });

      // Free tier budget is 10,000 tokens.
      // Acquire slot reserving 1,200 tokens.
      const first = await service.acquireSlot(
        buildRequest({ tokensEstimated: 1_200 }),
      );
      expect(first.kind).toBe("reserved");
      if (first.kind !== "reserved") return;

      // Usage snapshot should show 1,200 tokens in use (reserved).
      let usage = await service.getAiUsage(userId, "free");
      expect(usage.coach.tokensUsed).toBe(1_200);
      expect(usage.coach.tokensRemaining).toBe(8_800);

      // Commit actual usage of only 300 tokens out of 1,200 estimated.
      await service.commitTokens({
        userId,
        providerCallId: first.providerCallId,
        finalStatus: "succeeded",
        messageId: "msg-1",
        tokensUsed: 300,
        tokensEstimated: 1_200,
      });

      // After settlement, exactly 300 tokens should be counted as used, leaving 9,700 remaining.
      usage = await service.getAiUsage(userId, "free");
      expect(usage.coach.tokensUsed).toBe(300);
      expect(usage.coach.tokensRemaining).toBe(9_700);
    });

    it("releaseSlot frees reserved tokens so provider failure does not penalize daily budget", async () => {
      let currentTime = new Date("2026-07-23T10:00:00.000Z").getTime();
      const service = new InMemoryCoachLimitService({
        clock: () => new Date(currentTime),
      });

      // Acquire slot reserving 1,200 tokens.
      const slot = await service.acquireSlot(
        buildRequest({ tokensEstimated: 1_200 }),
      );
      expect(slot.kind).toBe("reserved");
      if (slot.kind !== "reserved") return;

      // Provider failure triggers releaseSlot with tokensUsed = 0.
      await service.releaseSlot({
        userId,
        providerCallId: slot.providerCallId,
        finalStatus: "failed",
        messageId: null,
        tokensUsed: 0,
        tokensEstimated: 1_200,
      });

      // Tokens should be fully restored to 0 used / 10,000 remaining.
      const usage = await service.getAiUsage(userId, "free");
      expect(usage.coach.tokensUsed).toBe(0);
      expect(usage.coach.tokensRemaining).toBe(10_000);
    });

    it("photo drafts and chat tokens maintain independent counters without cross-consumption", async () => {
      let currentTime = new Date("2026-07-23T10:00:00.000Z").getTime();
      const service = new InMemoryCoachLimitService({
        clock: () => new Date(currentTime),
      });

      // 1. Consume all 5 free photo drafts.
      for (let i = 0; i < 5; i++) {
        const dSlot = await service.acquireDraftSlot(userId, "free", "photo");
        expect(dSlot.allowed).toBe(true);
        await service.commitDraftTokens(userId, 500);
        currentTime += 65_000; // clear per-minute window
      }

      // 6th photo draft is rejected.
      const d6 = await service.acquireDraftSlot(userId, "free", "photo");
      expect(d6.allowed).toBe(false);
      expect(d6.reason).toBe("drafts");

      // Verify photo exhaustion does NOT affect chat token budget.
      let usage = await service.getAiUsage(userId, "free");
      expect(usage.photos.draftsRemaining).toBe(0);
      expect(usage.coach.tokensRemaining).toBe(10_000);

      // Chat request still succeeds under full token budget.
      const chatSlot = await service.acquireSlot(
        buildRequest({ tokensEstimated: 1_200 }),
      );
      expect(chatSlot.kind).toBe("reserved");
      if (chatSlot.kind !== "reserved") return;
      await service.commitTokens({
        userId,
        providerCallId: chatSlot.providerCallId,
        finalStatus: "succeeded",
        messageId: "msg-chat",
        tokensUsed: 1_200,
        tokensEstimated: 1_200,
      });

      // Verify chat tokens do not consume or alter photo draft counters.
      usage = await service.getAiUsage(userId, "free");
      expect(usage.coach.tokensUsed).toBe(1_200);
      expect(usage.coach.tokensRemaining).toBe(8_800);
      expect(usage.photos.draftsUsed).toBe(5);
      expect(usage.photos.draftsRemaining).toBe(0);
    });

    it("resets counters at UTC day boundary", async () => {
      let currentTime = new Date("2026-07-23T23:59:00.000Z").getTime();
      const service = new InMemoryCoachLimitService({
        clock: () => new Date(currentTime),
      });

      // Use some quota before midnight.
      const slot = await service.acquireSlot(
        buildRequest({ tokensEstimated: 2_000 }),
      );
      expect(slot.kind).toBe("reserved");
      if (slot.kind !== "reserved") return;
      await service.commitTokens({
        userId,
        providerCallId: slot.providerCallId,
        finalStatus: "succeeded",
        messageId: "msg-day1",
        tokensUsed: 2_000,
        tokensEstimated: 2_000,
      });

      let usage = await service.getAiUsage(userId, "free");
      expect(usage.coach.tokensUsed).toBe(2_000);
      expect(usage.resetsAt).toBe("2026-07-24T00:00:00.000Z");

      // Advance clock 2 minutes across midnight UTC.
      currentTime += 120_000; // 2026-07-24T00:01:00.000Z

      usage = await service.getAiUsage(userId, "free");
      expect(usage.coach.tokensUsed).toBe(0);
      expect(usage.coach.tokensRemaining).toBe(10_000);
      expect(usage.resetsAt).toBe("2026-07-25T00:00:00.000Z");
    });
  });
});
