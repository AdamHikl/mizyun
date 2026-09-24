/**
 * AI-OPS-001 — durable, replica-safe limiter for the Coach route.
 *
 * Replaces the single-process `Map`-based limiter used during
 * AI-MOB-001 with a service-role Supabase client that calls the
 * SECURITY DEFINER RPCs introduced in
 * `supabase/migrations/20260724120000_ai_ops_001_limits.sql`.
 *
 * The route layer never speaks SQL directly; it calls
 * `acquireSlot`, `commitTokens`, and `releaseSlot` on the
 * service-injected `CoachLimitService`. Two implementations live
 * here:
 *
 *   - `SupabaseCoachLimitService`: production. Calls the RPCs.
 *   - `InMemoryCoachLimitService`: tests + local dev. Mirrors the
 *     same shape so the route contract is identical.
 *
 * Plan tier resolution:
 *
 *   The cap comes from `resolveCap(planTier)`. The default reads
 *   `capsForTier(planTier)`; tests pass overrides so the existing
 *   `coachControls` (dailyUserTokenBudget / userRequestsPerMinute /
 *   userMaxConcurrentRequests) still drive the in-memory service.
 *   Env overrides only apply on the `paid` tier — the `free` tier
 *   is locked to 5k tokens/day / 3 req/min / 1 concurrent.
 */

import type { AiTierCaps } from "@mizyun/config";
import { capsForTier } from "@mizyun/config";
import type { RepositorySupabaseClient } from "@mizyun/adapter-supabase-server";
import type { ConversationId, PlanTier, UserId } from "@mizyun/core";

/**
 * Reason a slot acquisition was denied. The route maps each to a
 * stable user-facing copy (`docs/LOGGING_POLICY.md`); machine-checkable
 * code first, copy second.
 */
export type LimitReason =
  "tokens" | "drafts" | "minute" | "inflight" | "lock_busy";

export type ProviderCallStatus =
  "attempting" | "succeeded" | "failed" | "replayed";

export interface ReserveSlotRequest {
  readonly userId: UserId;
  readonly conversationId: ConversationId;
  readonly idempotencyKey: string;
  readonly planTier: PlanTier;
  /**
   * Upper-bound estimate of tokens this request will consume.
   * Used by `ai_reserve_tokens` to gate against the daily budget
   * before the provider call. Default is the model's
   * `maxOutputTokens` upper bound.
   */
  readonly tokensEstimated: number;
}

export type ReserveSlotResult =
  | {
      readonly kind: "reserved";
      readonly cap: AiTierCaps;
      readonly day: string;
      readonly providerCallId: string;
    }
  | {
      readonly kind: "replayed";
      readonly providerCallId: string;
      /**
       * `null` when the prior caller is still `attempting`; the route
       * surfaces this as a 409. Populated when the prior call
       * completed; the route returns the previously-stored message.
       */
      readonly existingMessageId: string | null;
      readonly existingMessageStatus: ProviderCallStatus;
    }
  | { readonly kind: "conflict"; readonly retryAfter: number }
  | {
      readonly kind: "limited";
      readonly reason: LimitReason;
      readonly retryAfter: number;
    };

export interface FinalizeRequest {
  readonly userId: UserId;
  readonly providerCallId: string;
  readonly finalStatus: Exclude<ProviderCallStatus, "attempting">;
  readonly messageId: string | null;
  readonly tokensUsed: number;
  readonly tokensEstimated?: number;
}

export type DraftKind = "text" | "photo" | "refine";

export const DRAFT_ESTIMATED_TOKENS: Record<DraftKind, number> = {
  text: 500,
  photo: 1500,
  refine: 800,
};

export interface ReserveDraftResult {
  readonly allowed: boolean;
  readonly reason?: LimitReason;
  readonly retryAfter?: number;
}

export interface AiUsageSnapshot {
  readonly planTier: PlanTier;
  readonly resetsAt: string;
  readonly coach: {
    readonly dailyTokenBudget: number;
    readonly tokensUsed: number;
    readonly tokensRemaining: number;
    readonly requestsPerMinute: number;
  };
  readonly photos: {
    readonly dailyLimit: number;
    readonly draftsUsed: number;
    readonly draftsRemaining: number;
    readonly requestsPerMinute: number;
  };
}

/**
 * Stateful limiter service. Every implementation owns its own
 * state (Maps for the in-memory implementation, RPC calls into
 * the `ai_*` functions for the durable one). The route layer
 * holds a single instance per process and calls into it on every
 * Coach message.
 */
export interface CoachLimitService {
  readonly clock: () => Date;
  resolveCap(planTier: PlanTier): AiTierCaps;
  acquireSlot(request: ReserveSlotRequest): Promise<ReserveSlotResult>;
  commitTokens(request: FinalizeRequest): Promise<void>;
  releaseSlot(request: FinalizeRequest): Promise<void>;
  acquireDraftSlot(
    userId: UserId,
    planTier: PlanTier,
    draftKind: DraftKind,
  ): Promise<ReserveDraftResult>;
  commitDraftTokens(userId: UserId, tokensUsed: number): Promise<void>;
  releaseDraftSlot(userId: UserId, draftKind?: DraftKind): Promise<void>;
  getAiUsage(userId: UserId, planTier: PlanTier): Promise<AiUsageSnapshot>;
}

export class LimitsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimitsError";
  }
}

const sqlDay = (now: Date): string => now.toISOString().slice(0, 10);

// --------------------------------------------------------------------------
// Supabase implementation (production)
// --------------------------------------------------------------------------

export interface SupabaseCoachLimitServiceOptions {
  readonly serviceClient: RepositorySupabaseClient;
  readonly clock: () => Date;
  /**
   * Optional cap resolver. Defaults to `capsForTier`. Tests pass
   * overrides so the `coachControls` knobs still drive the cap
   * surface; production keeps the default.
   */
  readonly resolveCap?: (planTier: PlanTier) => AiTierCaps;
}

/**
 * Production limiter. Calls the SECURITY DEFINER RPCs the migration
 * installs. All writes happen via the service-role client so RLS
 * stays a no-op for the limiter tables.
 */
export class SupabaseCoachLimitService implements CoachLimitService {
  readonly #client: RepositorySupabaseClient;
  readonly #clock: () => Date;
  readonly #resolveCap: (planTier: PlanTier) => AiTierCaps;

  constructor(options: SupabaseCoachLimitServiceOptions) {
    this.#client = options.serviceClient;
    this.#clock = options.clock;
    this.#resolveCap = options.resolveCap ?? capsForTier;
  }

  clock(): Date {
    return this.#clock();
  }

  resolveCap(planTier: PlanTier): AiTierCaps {
    return this.#resolveCap(planTier);
  }

  async acquireSlot(request: ReserveSlotRequest): Promise<ReserveSlotResult> {
    const cap = this.#resolveCap(request.planTier);
    const now = this.#clock();
    const day = sqlDay(now);

    // Step 1: per-minute window.
    const minute = await rpcSingle<{ allowed: boolean; retry_after: number }>(
      this.#client,
      "ai_register_request",
      {
        p_user_id: request.userId,
        p_now: now.toISOString(),
        p_per_minute: cap.requestsPerMinute,
      },
    );
    if (minute.allowed !== true) {
      return {
        kind: "limited",
        reason: "minute",
        retryAfter: minute.retry_after,
      };
    }

    // Step 2: in-flight slot.
    const inflight = await rpcSingle<{ allowed: boolean }>(
      this.#client,
      "ai_acquire_in_flight",
      {
        p_user_id: request.userId,
        p_max: cap.maxConcurrentRequests,
      },
    );
    if (inflight.allowed !== true) {
      await runQuiet(() =>
        this.#client.rpc("ai_release_in_flight", {
          p_user_id: request.userId,
        }),
      );
      return { kind: "limited", reason: "inflight", retryAfter: 1 };
    }

    // Step 3: daily token gate.
    const tokens = await rpcSingle<{
      allowed: boolean;
      retry_after: number;
    }>(this.#client, "ai_reserve_tokens", {
      p_user_id: request.userId,
      p_day: day,
      p_budget: cap.dailyTokenBudget,
      p_needed: request.tokensEstimated,
    });
    if (tokens.allowed !== true) {
      await runQuiet(() =>
        this.#client.rpc("ai_release_in_flight", {
          p_user_id: request.userId,
        }),
      );
      return {
        kind: "limited",
        reason: "tokens",
        retryAfter: tokens.retry_after,
      };
    }

    // Step 4: idempotency ledger.
    const reserve = await rpcSingle<{ outcome: string; call_id: string }>(
      this.#client,
      "ai_reserve_provider_call",
      {
        p_user_id: request.userId,
        p_conversation_id: request.conversationId,
        p_idempotency_key: request.idempotencyKey,
      },
    );
    if (reserve.outcome === "conflict") {
      await runQuiet(() =>
        this.#client.rpc("ai_release_in_flight", {
          p_user_id: request.userId,
        }),
      );
      await runQuiet(() =>
        this.#client.rpc("ai_release_token_reservation", {
          p_user_id: request.userId,
          p_day: day,
          p_tokens: request.tokensEstimated,
        }),
      );
      return { kind: "conflict", retryAfter: 1 };
    }
    if (reserve.outcome === "replayed") {
      await runQuiet(() =>
        this.#client.rpc("ai_release_in_flight", {
          p_user_id: request.userId,
        }),
      );
      await runQuiet(() =>
        this.#client.rpc("ai_release_token_reservation", {
          p_user_id: request.userId,
          p_day: day,
          p_tokens: request.tokensEstimated,
        }),
      );
      return {
        kind: "replayed",
        providerCallId: reserve.call_id,
        existingMessageId: null,
        existingMessageStatus: "attempting",
      };
    }

    return {
      kind: "reserved",
      cap,
      day,
      providerCallId: reserve.call_id,
    };
  }

  async commitTokens(request: FinalizeRequest): Promise<void> {
    const day = sqlDay(this.#clock());
    const tokensReserved = request.tokensEstimated ?? request.tokensUsed;
    const commitResult = await this.#client.rpc("ai_commit_tokens", {
      p_user_id: request.userId,
      p_day: day,
      p_tokens_used: request.tokensUsed,
      p_tokens_reserved: tokensReserved,
    });
    if (commitResult.error) {
      throw new LimitsError(
        `rpc ai_commit_tokens failed: ${commitResult.error.message}`,
      );
    }
    const completeResult = await this.#client.rpc("ai_complete_provider_call", {
      p_provider_call_id: request.providerCallId,
      p_status: request.finalStatus,
      p_message_id: request.messageId,
      p_tokens: request.tokensUsed,
    });
    if (completeResult.error) {
      throw new LimitsError(
        `rpc ai_complete_provider_call failed: ${completeResult.error.message}`,
      );
    }
    const releaseResult = await this.#client.rpc("ai_release_in_flight", {
      p_user_id: request.userId,
    });
    if (releaseResult.error) {
      throw new LimitsError(
        `rpc ai_release_in_flight failed: ${releaseResult.error.message}`,
      );
    }
  }

  async releaseSlot(request: FinalizeRequest): Promise<void> {
    const day = sqlDay(this.#clock());
    const tokensReserved = request.tokensEstimated ?? 1_200;
    await runQuiet(() =>
      this.#client.rpc("ai_release_token_reservation", {
        p_user_id: request.userId,
        p_day: day,
        p_tokens: tokensReserved,
      }),
    );
    const completeResult = await this.#client.rpc("ai_complete_provider_call", {
      p_provider_call_id: request.providerCallId,
      p_status: request.finalStatus,
      p_message_id: request.messageId,
      p_tokens: request.tokensUsed,
    });
    if (completeResult.error) {
      throw new LimitsError(
        `rpc ai_complete_provider_call failed: ${completeResult.error.message}`,
      );
    }
    const releaseResult = await this.#client.rpc("ai_release_in_flight", {
      p_user_id: request.userId,
    });
    if (releaseResult.error) {
      throw new LimitsError(
        `rpc ai_release_in_flight failed: ${releaseResult.error.message}`,
      );
    }
  }

  async acquireDraftSlot(
    userId: UserId,
    planTier: PlanTier,
    draftKind: DraftKind,
  ): Promise<ReserveDraftResult> {
    void draftKind;
    const cap = this.#resolveCap(planTier);
    const now = this.#clock();
    const day = sqlDay(now);

    // Step 1: in-flight slot
    const inflight = await rpcSingle<{ allowed: boolean }>(
      this.#client,
      "ai_acquire_in_flight",
      {
        p_user_id: userId,
        p_max: cap.maxConcurrentRequests,
      },
    );
    if (inflight.allowed !== true) {
      await runQuiet(() =>
        this.#client.rpc("ai_release_in_flight", { p_user_id: userId }),
      );
      return { allowed: false, reason: "inflight", retryAfter: 1 };
    }

    // Step 2: per-minute window
    const minuteLimit =
      cap.draftRequestsPerMinute ?? (planTier === "paid" ? 3 : 1);
    const minute = await rpcSingle<{ allowed: boolean; retry_after: number }>(
      this.#client,
      "ai_register_request",
      {
        p_user_id: userId,
        p_now: now.toISOString(),
        p_per_minute: minuteLimit,
      },
    );
    if (minute.allowed !== true) {
      await runQuiet(() =>
        this.#client.rpc("ai_release_in_flight", { p_user_id: userId }),
      );
      return {
        allowed: false,
        reason: "minute",
        retryAfter: minute.retry_after,
      };
    }

    // Step 3: daily draft count gate (exempt for refine)
    if (draftKind !== "refine") {
      const draftBudget =
        cap.photoDraftDailyLimit ?? (planTier === "paid" ? 100 : 5);
      const drafts = await rpcSingle<{ allowed: boolean; retry_after: number }>(
        this.#client,
        "ai_reserve_draft",
        {
          p_user_id: userId,
          p_day: day,
          p_budget: draftBudget,
          p_needed: 1,
        },
      );
      if (drafts.allowed !== true) {
        await runQuiet(() =>
          this.#client.rpc("ai_release_in_flight", { p_user_id: userId }),
        );
        return {
          allowed: false,
          reason: "drafts",
          retryAfter: drafts.retry_after,
        };
      }
    }

    return { allowed: true };
  }

  async commitDraftTokens(userId: UserId, tokensUsed: number): Promise<void> {
    void tokensUsed;
    const day = sqlDay(this.#clock());
    const commitResult = await this.#client.rpc("ai_commit_draft", {
      p_user_id: userId,
      p_day: day,
      p_count: 1,
    });
    if (commitResult.error) {
      throw new LimitsError(
        `rpc ai_commit_draft failed: ${commitResult.error.message}`,
      );
    }
    const releaseResult = await this.#client.rpc("ai_release_in_flight", {
      p_user_id: userId,
    });
    if (releaseResult.error) {
      throw new LimitsError(
        `rpc ai_release_in_flight failed: ${releaseResult.error.message}`,
      );
    }
  }

  async releaseDraftSlot(userId: UserId, draftKind?: DraftKind): Promise<void> {
    if (draftKind !== "refine") {
      const day = sqlDay(this.#clock());
      await runQuiet(() =>
        this.#client.rpc("ai_release_draft_reservation", {
          p_user_id: userId,
          p_day: day,
          p_count: 1,
        }),
      );
    }
    const releaseResult = await this.#client.rpc("ai_release_in_flight", {
      p_user_id: userId,
    });
    if (releaseResult.error) {
      throw new LimitsError(
        `rpc ai_release_in_flight failed: ${releaseResult.error.message}`,
      );
    }
  }

  async getAiUsage(
    userId: UserId,
    planTier: PlanTier,
  ): Promise<AiUsageSnapshot> {
    const cap = this.#resolveCap(planTier);
    const now = this.#clock();
    const day = sqlDay(now);
    const resetsAt = new Date(
      Date.parse(`${day}T00:00:00.000Z`) + 86_400_000,
    ).toISOString();

    let tokensUsed = 0;
    try {
      const tokenRow = await this.#client
        .from<{
          readonly user_id?: string;
          readonly day?: string;
          readonly tokens_used?: number;
          readonly reserved_tokens?: number;
        }>("ai_daily_token_ledger")
        .select("tokens_used, reserved_tokens")
        .eq("user_id", userId)
        .eq("day", day)
        .maybeSingle();
      if (tokenRow.data) {
        tokensUsed =
          (tokenRow.data.tokens_used ?? 0) +
          (tokenRow.data.reserved_tokens ?? 0);
      }
    } catch {
      // Fall back to 0 on missing/new row
    }

    let draftsUsed = 0;
    try {
      const draftRow = await this.#client
        .from<{
          readonly user_id?: string;
          readonly day?: string;
          readonly drafts_used?: number;
          readonly reserved_drafts?: number;
        }>("ai_daily_draft_ledger")
        .select("drafts_used, reserved_drafts")
        .eq("user_id", userId)
        .eq("day", day)
        .maybeSingle();
      if (draftRow.data) {
        draftsUsed =
          (draftRow.data.drafts_used ?? 0) +
          (draftRow.data.reserved_drafts ?? 0);
      }
    } catch {
      // Fall back to 0 on missing/new row
    }

    const tokenBudget = cap.coachDailyTokenBudget ?? cap.dailyTokenBudget;
    const draftBudget =
      cap.photoDraftDailyLimit ?? (planTier === "paid" ? 100 : 5);

    return {
      planTier,
      resetsAt,
      coach: {
        dailyTokenBudget: tokenBudget,
        tokensUsed,
        tokensRemaining: Math.max(0, tokenBudget - tokensUsed),
        requestsPerMinute: cap.requestsPerMinute,
      },
      photos: {
        dailyLimit: draftBudget,
        draftsUsed,
        draftsRemaining: Math.max(0, draftBudget - draftsUsed),
        requestsPerMinute:
          cap.draftRequestsPerMinute ?? (planTier === "paid" ? 3 : 1),
      },
    };
  }
}

// --------------------------------------------------------------------------
// In-memory implementation (tests + local dev)
// --------------------------------------------------------------------------

interface InMemoryUsageRow {
  readonly day: string;
  tokens: number;
  reservedTokens: number;
}

interface InMemoryWindowRow {
  readonly startedAtMs: number;
  count: number;
}

interface InMemoryProviderCall {
  readonly providerCallId: string;
  status: ProviderCallStatus;
  messageId: string | null;
  tokensUsed: number;
}

export interface InMemoryCoachLimitServiceOptions {
  readonly clock: () => Date;
  readonly capOverrides?: Partial<AiTierCaps>;
}

/**
 * Test + local-dev limiter. Mirrors the durable implementation's
 * contract so the existing 14 coach route tests continue to pass
 * without Supabase.
 *
 * `capOverrides` threads the `coachControls` knobs
 * (`dailyUserTokenBudget`, `userRequestsPerMinute`,
 * `userMaxConcurrentRequests`) through `resolveCap`. Without
 * overrides, `resolveCap` reads `capsForTier`.
 */
export class InMemoryCoachLimitService implements CoachLimitService {
  readonly #clock: () => Date;
  readonly #usage = new Map<UserId, InMemoryUsageRow>();
  readonly #windows = new Map<UserId, InMemoryWindowRow>();
  readonly #draftUsage = new Map<
    UserId,
    { readonly day: string; drafts: number }
  >();
  readonly #draftWindows = new Map<UserId, InMemoryWindowRow>();
  readonly #inFlight = new Map<UserId, number>();
  readonly #calls = new Map<string, InMemoryProviderCall>();
  readonly #capOverrides: Partial<AiTierCaps>;

  constructor(options: InMemoryCoachLimitServiceOptions) {
    this.#clock = options.clock;
    this.#capOverrides = options.capOverrides ?? {};
  }

  clock(): Date {
    return this.#clock();
  }

  resolveCap(planTier: PlanTier): AiTierCaps {
    const base = capsForTier(planTier);
    return {
      tier: base.tier,
      dailyTokenBudget:
        this.#capOverrides.dailyTokenBudget ?? base.dailyTokenBudget,
      coachDailyTokenBudget:
        this.#capOverrides.coachDailyTokenBudget ?? base.coachDailyTokenBudget,
      photoDraftDailyLimit:
        this.#capOverrides.photoDraftDailyLimit ?? base.photoDraftDailyLimit,
      requestsPerMinute:
        this.#capOverrides.requestsPerMinute ?? base.requestsPerMinute,
      draftRequestsPerMinute:
        this.#capOverrides.draftRequestsPerMinute ??
        base.draftRequestsPerMinute,
      maxConcurrentRequests:
        this.#capOverrides.maxConcurrentRequests ?? base.maxConcurrentRequests,
    };
  }

  async acquireSlot(request: ReserveSlotRequest): Promise<ReserveSlotResult> {
    const cap = this.resolveCap(request.planTier);
    const now = this.#clock();
    const day = sqlDay(now);

    // Step 1: per-minute window.
    const windowMs = 60_000;
    const prior = this.#windows.get(request.userId);
    if (prior === undefined || now.getTime() - prior.startedAtMs >= windowMs) {
      this.#windows.set(request.userId, {
        startedAtMs: now.getTime(),
        count: 0,
      });
    }
    const w = this.#windows.get(request.userId)!;
    if (w.count >= cap.requestsPerMinute) {
      return {
        kind: "limited",
        reason: "minute",
        retryAfter: Math.max(
          1,
          Math.ceil((w.startedAtMs + windowMs - now.getTime()) / 1_000),
        ),
      };
    }
    w.count += 1;

    // Step 2: in-flight slot.
    const active = this.#inFlight.get(request.userId) ?? 0;
    if (active >= cap.maxConcurrentRequests) {
      return { kind: "limited", reason: "inflight", retryAfter: 1 };
    }
    this.#inFlight.set(request.userId, active + 1);

    // Step 3: daily token gate.
    const usage = this.#usage.get(request.userId);
    const used = usage?.day === day ? usage.tokens : 0;
    const reserved = usage?.day === day ? usage.reservedTokens : 0;
    if (used + reserved + request.tokensEstimated > cap.dailyTokenBudget) {
      this.#inFlight.set(request.userId, Math.max(0, active));
      return {
        kind: "limited",
        reason: "tokens",
        retryAfter: Math.max(
          1,
          Math.ceil(
            (Date.parse(`${day}T00:00:00.000Z`) + 86_400_000 - now.getTime()) /
              1_000,
          ),
        ),
      };
    }
    this.#usage.set(request.userId, {
      day,
      tokens: used,
      reservedTokens: reserved + request.tokensEstimated,
    });

    // Step 4: idempotency ledger.
    const key = `${request.userId}:${request.conversationId}:${request.idempotencyKey}`;
    const priorCall = this.#calls.get(key);
    if (priorCall !== undefined) {
      this.#inFlight.set(request.userId, Math.max(0, active));
      this.#usage.set(request.userId, {
        day,
        tokens: used,
        reservedTokens: reserved,
      });
      if (priorCall.status === "failed") {
        return { kind: "conflict", retryAfter: 1 };
      }
      return {
        kind: "replayed",
        providerCallId: priorCall.providerCallId,
        existingMessageId: priorCall.messageId,
        existingMessageStatus: priorCall.status,
      };
    }
    const providerCallId = crypto.randomUUID();
    this.#calls.set(key, {
      providerCallId,
      status: "attempting",
      messageId: null,
      tokensUsed: 0,
    });

    return {
      kind: "reserved",
      cap,
      day,
      providerCallId,
    };
  }

  async commitTokens(request: FinalizeRequest): Promise<void> {
    const row = this.#findCall(request.providerCallId);
    if (row !== undefined) {
      row.status = request.finalStatus;
      row.messageId = request.messageId;
      row.tokensUsed = request.tokensUsed;
      if (request.finalStatus === "succeeded") {
        const day = sqlDay(this.#clock());
        const usage = this.#usage.get(request.userId);
        const used = usage?.day === day ? usage.tokens : 0;
        const reserved = usage?.day === day ? usage.reservedTokens : 0;
        const settleReserved = request.tokensEstimated ?? request.tokensUsed;
        this.#usage.set(request.userId, {
          day,
          tokens: used + Math.max(0, request.tokensUsed),
          reservedTokens: Math.max(0, reserved - settleReserved),
        });
      }
    }
    const active = this.#inFlight.get(request.userId) ?? 0;
    this.#inFlight.set(request.userId, Math.max(0, active - 1));
  }

  async releaseSlot(request: FinalizeRequest): Promise<void> {
    const row = this.#findCall(request.providerCallId);
    if (row !== undefined) {
      row.status = request.finalStatus;
      row.messageId = request.messageId;
      row.tokensUsed = request.tokensUsed;
      const day = sqlDay(this.#clock());
      const usage = this.#usage.get(request.userId);
      if (usage?.day === day) {
        const settleReserved = request.tokensEstimated ?? 1_200;
        this.#usage.set(request.userId, {
          day,
          tokens: usage.tokens,
          reservedTokens: Math.max(0, usage.reservedTokens - settleReserved),
        });
      }
    }
    const active = this.#inFlight.get(request.userId) ?? 0;
    this.#inFlight.set(request.userId, Math.max(0, active - 1));
  }

  async acquireDraftSlot(
    userId: UserId,
    planTier: PlanTier,
    draftKind: DraftKind,
  ): Promise<ReserveDraftResult> {
    void draftKind;
    const cap = this.resolveCap(planTier);
    const now = this.#clock();
    const day = sqlDay(now);

    // Step 1: in-flight slot (check first so concurrent requests receive 'inflight')
    const active = this.#inFlight.get(userId) ?? 0;
    if (active >= cap.maxConcurrentRequests) {
      return { allowed: false, reason: "inflight", retryAfter: 1 };
    }

    // Step 2: per-minute window
    const windowMs = 60_000;
    const minuteLimit =
      cap.draftRequestsPerMinute ?? (planTier === "paid" ? 3 : 1);
    const prior = this.#draftWindows.get(userId);
    if (prior === undefined || now.getTime() - prior.startedAtMs >= windowMs) {
      this.#draftWindows.set(userId, {
        startedAtMs: now.getTime(),
        count: 0,
      });
    }
    const w = this.#draftWindows.get(userId)!;
    if (w.count >= minuteLimit) {
      return {
        allowed: false,
        reason: "minute",
        retryAfter: Math.max(
          1,
          Math.ceil((w.startedAtMs + windowMs - now.getTime()) / 1_000),
        ),
      };
    }

    // Step 3: daily draft gate (exempt for refine)
    if (draftKind !== "refine") {
      const draftBudget =
        cap.photoDraftDailyLimit ?? (planTier === "paid" ? 100 : 5);
      const usage = this.#draftUsage.get(userId);
      const used = usage?.day === day ? usage.drafts : 0;
      if (used + 1 > draftBudget) {
        return {
          allowed: false,
          reason: "drafts",
          retryAfter: Math.max(
            1,
            Math.ceil(
              (Date.parse(`${day}T00:00:00.000Z`) +
                86_400_000 -
                now.getTime()) /
                1_000,
            ),
          ),
        };
      }
    }

    // Successfully acquired: reserve in-flight slot and register request in minute window
    this.#inFlight.set(userId, active + 1);
    w.count += 1;

    return { allowed: true };
  }

  async commitDraftTokens(userId: UserId, tokensUsed: number): Promise<void> {
    void tokensUsed;
    const day = sqlDay(this.#clock());
    const usage = this.#draftUsage.get(userId);
    const used = usage?.day === day ? usage.drafts : 0;
    this.#draftUsage.set(userId, {
      day,
      drafts: used + 1,
    });
    const active = this.#inFlight.get(userId) ?? 0;
    this.#inFlight.set(userId, Math.max(0, active - 1));
  }

  async releaseDraftSlot(userId: UserId, draftKind?: DraftKind): Promise<void> {
    void draftKind;
    const active = this.#inFlight.get(userId) ?? 0;
    this.#inFlight.set(userId, Math.max(0, active - 1));
  }

  async getAiUsage(
    userId: UserId,
    planTier: PlanTier,
  ): Promise<AiUsageSnapshot> {
    const cap = this.resolveCap(planTier);
    const now = this.#clock();
    const day = sqlDay(now);
    const resetsAt = new Date(
      Date.parse(`${day}T00:00:00.000Z`) + 86_400_000,
    ).toISOString();

    const usage = this.#usage.get(userId);
    const tokensUsed =
      usage?.day === day ? usage.tokens + (usage.reservedTokens ?? 0) : 0;

    const draftUsage = this.#draftUsage.get(userId);
    const draftsUsed = draftUsage?.day === day ? draftUsage.drafts : 0;

    const tokenBudget = cap.coachDailyTokenBudget ?? cap.dailyTokenBudget;
    const draftBudget =
      cap.photoDraftDailyLimit ?? (planTier === "paid" ? 100 : 5);

    return {
      planTier,
      resetsAt,
      coach: {
        dailyTokenBudget: tokenBudget,
        tokensUsed,
        tokensRemaining: Math.max(0, tokenBudget - tokensUsed),
        requestsPerMinute: cap.requestsPerMinute,
      },
      photos: {
        dailyLimit: draftBudget,
        draftsUsed,
        draftsRemaining: Math.max(0, draftBudget - draftsUsed),
        requestsPerMinute:
          cap.draftRequestsPerMinute ?? (planTier === "paid" ? 3 : 1),
      },
    };
  }

  #findCall(providerCallId: string): InMemoryProviderCall | undefined {
    for (const call of this.#calls.values()) {
      if (call.providerCallId === providerCallId) return call;
    }
    return undefined;
  }
}

// --------------------------------------------------------------------------
// Internal RPC helpers
// --------------------------------------------------------------------------

const rpcSingle = async <TRow extends Record<string, unknown>>(
  client: RepositorySupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<TRow> => {
  const result = await client.rpc<TRow>(name, args);
  if (result.error) {
    throw new LimitsError(`rpc ${name} failed: ${result.error.message}`);
  }
  const row = result.data[0];
  if (row === undefined) {
    throw new LimitsError(`rpc ${name} returned no row`);
  }
  return row;
};

const runQuiet = async (fn: () => Promise<unknown>): Promise<void> => {
  try {
    await fn();
  } catch {
    // Best-effort release. The next request that re-acquires the
    // slot will overwrite the row state, so a transient failure
    // here does not poison the user; we just leak one slot until
    // the next request acquires + releases.
  }
};
