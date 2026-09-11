/**
 * VISION-001 — Per-user rate limiter for the food-draft endpoint.
 *
 * Sliding window over the last 60 seconds. Default caps per
 * `capsForDraftTier`:
 *   - free: 1 request / minute
 *   - paid: 3 requests / minute
 *
 * The durable Coach limiter (AI-OPS-001) is the canonical
 * per-day + per-minute + in-flight cap on the Coach flow; this
 * is a separate, lighter sliding window that protects the
 * vision provider (which costs more per call) without displacing
 * Coach budget. In-memory only — a single-replica alpha. A
 * future segment can back this with the same `ai_*` RPCs.
 *
 * The route calls `acquire` before running the vision provider.
 * On reject it returns 429 with `Retry-After: <seconds-until-1
 * oldest falls out of the window>`.
 */

import type { PlanTier } from "@mizyun/core";

const WINDOW_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DraftRateLimitOptions {
  readonly clock?: () => number;
  readonly freePerMinute?: number;
  readonly paidPerMinute?: number;
  readonly freePerDay?: number;
  readonly paidPerDay?: number;
}

export interface DraftRateLimitResult {
  readonly allowed: boolean;
  readonly retryAfter: number;
  readonly remaining: number;
  readonly reason?: "minute_limit_exceeded" | "daily_limit_exceeded";
}

export class FoodDraftRateLimiter {
  readonly #clock: () => number;
  readonly #freePerMinute: number;
  readonly #paidPerMinute: number;
  readonly #freePerDay: number;
  readonly #paidPerDay: number;
  readonly #dailyByUser = new Map<string, number[]>();
  readonly #minuteByUser = new Map<string, number[]>();

  constructor(options: DraftRateLimitOptions = {}) {
    this.#clock = options.clock ?? Date.now;
    this.#freePerMinute = options.freePerMinute ?? 1;
    this.#paidPerMinute = options.paidPerMinute ?? 3;
    this.#freePerDay = options.freePerDay ?? 5;
    this.#paidPerDay = options.paidPerDay ?? 100;
  }

  acquire(
    userId: string,
    tier: PlanTier,
    draftKind?: "photo" | "text" | "refine",
  ): DraftRateLimitResult {
    const minuteLimit =
      tier === "paid" ? this.#paidPerMinute : this.#freePerMinute;
    const dailyLimit = tier === "paid" ? this.#paidPerDay : this.#freePerDay;
    const now = this.#clock();
    const isRefine = draftKind === "refine";

    const dailyCutoff = now - DAY_MS;
    const minuteCutoff = now - WINDOW_MS;

    // 1. Check daily budget cap (exempt for refine)
    const existingDaily = (this.#dailyByUser.get(userId) ?? []).filter(
      (timestamp) => timestamp > dailyCutoff,
    );
    if (!isRefine && existingDaily.length >= dailyLimit) {
      const oldestDaily = existingDaily[0] as number;
      const retryAfter = Math.max(
        1,
        Math.ceil((oldestDaily + DAY_MS - now) / 1_000),
      );
      this.#dailyByUser.set(userId, existingDaily);
      return {
        allowed: false,
        retryAfter,
        remaining: 0,
        reason: "daily_limit_exceeded",
      };
    }

    // 2. Check minute sliding window (applies to all drafts to prevent spam)
    const recentMinute = (this.#minuteByUser.get(userId) ?? []).filter(
      (timestamp) => timestamp > minuteCutoff,
    );
    if (recentMinute.length >= minuteLimit) {
      const oldestMinute = recentMinute[0] as number;
      const retryAfter = Math.max(
        1,
        Math.ceil((oldestMinute + WINDOW_MS - now) / 1_000),
      );
      this.#minuteByUser.set(userId, recentMinute);
      return {
        allowed: false,
        retryAfter,
        remaining: 0,
        reason: "minute_limit_exceeded",
      };
    }

    recentMinute.push(now);
    this.#minuteByUser.set(userId, recentMinute);

    if (!isRefine) {
      existingDaily.push(now);
      this.#dailyByUser.set(userId, existingDaily);
    }

    return {
      allowed: true,
      retryAfter: 0,
      remaining: minuteLimit - recentMinute.length,
    };
  }

  /**
   * Test-only helper. Drops all sliding windows so a test
   * starts clean.
   */
  __resetForTest(): void {
    this.#dailyByUser.clear();
    this.#minuteByUser.clear();
  }
}
