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

export interface DraftRateLimitOptions {
  readonly clock?: () => number;
  readonly freePerMinute?: number;
  readonly paidPerMinute?: number;
}

export interface DraftRateLimitResult {
  readonly allowed: boolean;
  readonly retryAfter: number;
  readonly remaining: number;
}

export class FoodDraftRateLimiter {
  readonly #clock: () => number;
  readonly #freePerMinute: number;
  readonly #paidPerMinute: number;
  readonly #byUser = new Map<string, number[]>();

  constructor(options: DraftRateLimitOptions = {}) {
    this.#clock = options.clock ?? Date.now;
    this.#freePerMinute = options.freePerMinute ?? 1;
    this.#paidPerMinute = options.paidPerMinute ?? 3;
  }

  acquire(userId: string, tier: PlanTier): DraftRateLimitResult {
    const limit = tier === "paid" ? this.#paidPerMinute : this.#freePerMinute;
    const now = this.#clock();
    const cutoff = now - WINDOW_MS;
    const existing = (this.#byUser.get(userId) ?? []).filter(
      (timestamp) => timestamp > cutoff,
    );
    if (existing.length >= limit) {
      const oldest = existing[0] as number;
      const retryAfter = Math.max(
        1,
        Math.ceil((oldest + WINDOW_MS - now) / 1_000),
      );
      this.#byUser.set(userId, existing);
      return { allowed: false, retryAfter, remaining: 0 };
    }
    existing.push(now);
    this.#byUser.set(userId, existing);
    return {
      allowed: true,
      retryAfter: 0,
      remaining: limit - existing.length,
    };
  }

  /**
   * Test-only helper. Drops all sliding windows so a test
   * starts clean.
   */
  __resetForTest(): void {
    this.#byUser.clear();
  }
}
