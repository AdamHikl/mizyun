import type { FastifyReply, FastifyRequest } from "fastify";

import { sendApiError } from "../../errors.js";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export interface MediaUploadRateLimits {
  readonly perMinute: number;
  readonly perDay: number;
}

/**
 * SEC-02 — per-user limit on `/v1/media/upload-url` tickets. Photo backup
 * uploads at most 20 photos per run every 10 minutes (ADR-0079), so 30 a
 * minute and 600 per UTC day leave real use untouched while bounding how fast
 * one account can mint signed URLs and `media_assets` rows. In memory per API
 * process; the database storage quota is the durable bound.
 */
export const DEFAULT_MEDIA_UPLOAD_RATE_LIMITS: MediaUploadRateLimits = {
  perMinute: 30,
  perDay: 600,
};

export class MediaUploadRateLimiter {
  readonly #attempts = new Map<string, number[]>();
  readonly #limits: MediaUploadRateLimits;
  readonly #now: () => number;

  constructor(
    limits: MediaUploadRateLimits = DEFAULT_MEDIA_UPLOAD_RATE_LIMITS,
    now: () => number = Date.now,
  ) {
    this.#limits = limits;
    this.#now = now;
  }

  /** Fastify preHandler; runs after `app.authenticate`. */
  readonly check = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const principal = request.principal;
    if (!principal) return;
    const now = this.#now();
    const utcDayStart = Math.floor(now / DAY_MS) * DAY_MS;
    const cutoff = Math.min(utcDayStart, now - MINUTE_MS);
    for (const [key, values] of this.#attempts) {
      const recent = values.filter((time) => time >= cutoff);
      if (recent.length) this.#attempts.set(key, recent);
      else this.#attempts.delete(key);
    }
    const attempts = this.#attempts.get(principal.userId) ?? [];
    const today = attempts.filter((time) => time >= utcDayStart);
    const lastMinute = attempts.filter((time) => time > now - MINUTE_MS);
    if (today.length >= this.#limits.perDay) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((utcDayStart + DAY_MS - now) / 1_000),
      );
      reply.header("retry-after", String(retryAfterSeconds));
      await sendApiError(
        reply,
        request,
        429,
        "RATE_LIMITED",
        "You've uploaded a lot of photos today. Please try again tomorrow.",
        { reason: "daily_budget_exhausted", retryAfterSeconds },
      );
      return;
    }
    if (lastMinute.length >= this.#limits.perMinute) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(((lastMinute[0] as number) + MINUTE_MS - now) / 1_000),
      );
      reply.header("retry-after", String(retryAfterSeconds));
      await sendApiError(
        reply,
        request,
        429,
        "RATE_LIMITED",
        "Too many photo uploads at once. Please wait a moment and try again.",
        { reason: "minute_rate_limit", retryAfterSeconds },
      );
      return;
    }
    this.#attempts.set(principal.userId, [...attempts, now]);
  };
}
