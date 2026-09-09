import { describe, expect, it } from "vitest";
import { capsForTier } from "@mizyun/config";
import type { PlanTier, UserId, ConversationId } from "@mizyun/core";

import {
  InMemoryCoachLimitService,
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

describe("InMemoryCoachLimitService — per-tier caps", () => {
  it("honours the free-tier daily budget (5k tokens)", async () => {
    const service = new InMemoryCoachLimitService({
      clock: fixedClock("2026-07-23T10:00:00.000Z"),
    });
    // First call: budget available.
    const first = await service.acquireSlot(buildRequest({ planTier: "free" }));
    expect(first.kind).toBe("reserved");
    if (first.kind !== "reserved") return;
    expect(first.cap.dailyTokenBudget).toBe(5_000);

    // Commit 4_900 tokens. Used = 4_900. Budget remaining = 100.
    await service.commitTokens({
      userId,
      providerCallId: first.providerCallId,
      finalStatus: "succeeded",
      messageId: "msg-1",
      tokensUsed: 4_900,
    });

    // Next request with tokensEstimated=1200: used 4900 + 1200 > 5000.
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
    it("acquires draft slot and commits tokens, updating daily usage", async () => {
      const service = new InMemoryCoachLimitService({
        clock: fixedClock("2026-07-23T10:00:00.000Z"),
      });

      // Free tier budget is 5,000 tokens
      const slot = await service.acquireDraftSlot(userId, "free", "photo");
      expect(slot.allowed).toBe(true);

      // Commit 1500 tokens
      await service.commitDraftTokens(userId, 1500);

      // Subsequent draft slots succeed while under budget
      const nextSlot = await service.acquireDraftSlot(userId, "free", "photo");
      expect(nextSlot.allowed).toBe(true);
      await service.commitDraftTokens(userId, 3000); // 1500 + 3000 = 4500 used

      // Next photo needs 1500 -> 4500 + 1500 = 6000 > 5000 -> blocked
      const blocked = await service.acquireDraftSlot(userId, "free", "photo");
      expect(blocked.allowed).toBe(false);
      if (!blocked.allowed) {
        expect(blocked.reason).toBe("tokens");
        expect(blocked.retryAfter).toBeGreaterThan(0);
      }
    });

    it("enforces max concurrent in-flight requests for draft slots", async () => {
      const service = new InMemoryCoachLimitService({
        clock: fixedClock("2026-07-23T10:00:00.000Z"),
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

      // Releasing slot1 allows subsequent acquisition
      await service.releaseDraftSlot(userId);
      const slot3 = await service.acquireDraftSlot(userId, "free", "text");
      expect(slot3.allowed).toBe(true);
      await service.releaseDraftSlot(userId);
    });

    it("releaseDraftSlot frees in-flight slot without burning daily token budget", async () => {
      const service = new InMemoryCoachLimitService({
        clock: fixedClock("2026-07-23T10:00:00.000Z"),
      });

      const slot = await service.acquireDraftSlot(userId, "free", "photo");
      expect(slot.allowed).toBe(true);

      // Provider failed; release without commit
      await service.releaseDraftSlot(userId);

      // User still has full 5000 token budget available
      const retrySlot = await service.acquireDraftSlot(userId, "free", "photo");
      expect(retrySlot.allowed).toBe(true);
      await service.releaseDraftSlot(userId);
    });
  });
});
