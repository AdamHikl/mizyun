import type { UserId } from "./index";

/** Content-free identity and accounting for one explicit, non-conversation AI attempt. */
export type RecipeRequestOperation = "suggest" | "recognize";
export type RecipeRequestDenial =
  "consent" | "deletion" | "tokens" | "drafts" | "minute" | "inflight";

export interface RecipeRequestLimits {
  readonly dailyTokenBudget: number;
  readonly dailyDraftLimit: number;
  readonly requestsPerMinute: number;
  readonly maxConcurrentRequests: number;
}

export interface ReserveRecipeRequest {
  readonly userId: UserId;
  readonly requestId: string;
  readonly operation: RecipeRequestOperation;
  /** SHA-256 of canonical validated client input and image digests; server context is separate. */
  readonly fingerprint: string;
  readonly consentVersion: string;
  /** Input + image upper bound + configured maximum output; never output alone. */
  readonly tokensEstimated: number;
  readonly limits: RecipeRequestLimits;
  /** Provider timeout must finish before this lease; maximum 90 seconds. */
  readonly leaseMs: number;
}

export type ReserveRecipeRequestResult =
  | {
      readonly kind: "reserved";
      readonly attemptId: string;
      readonly day: string;
      readonly leaseExpiresAt: string;
    }
  | { readonly kind: "busy"; readonly retryAfter: number }
  | { readonly kind: "conflict" }
  | { readonly kind: "outcome_unavailable" }
  | {
      readonly kind: "denied";
      readonly reason: RecipeRequestDenial;
      readonly retryAfter: number;
    };

export interface FinalizeRecipeRequest {
  readonly userId: UserId;
  readonly attemptId: string;
  readonly status: "succeeded" | "failed";
  /** Only trustworthy final successful provider usage can reduce the reservation. */
  readonly tokensUsed?: number;
}

export interface RecipeRequestUsage {
  readonly requestId: string;
  readonly operation: RecipeRequestOperation;
  readonly status: "attempting" | "succeeded" | "failed" | "expired";
  readonly createdAt: string;
  readonly budgetDay: string;
  readonly tokensCharged: number;
}

export interface RecipeRequestLedger {
  /** Fail closed when durable schema or an explicit synthetic gate is unavailable. */
  isAvailable(): Promise<boolean>;
  /** Account lifecycle only: exact allowlist with no fingerprints, consent, attempt IDs or content. */
  exportUsageForUser(userId: UserId): Promise<readonly RecipeRequestUsage[]>;
  /** Accepted account deletion cleanup; late finalization becomes inert. */
  deleteForUser(userId: UserId): Promise<void>;
  reserve(request: ReserveRecipeRequest): Promise<ReserveRecipeRequestResult>;
  /** Atomic terminal settlement and current consent/deletion fence. No output is stored. */
  finalize(
    request: FinalizeRecipeRequest,
  ): Promise<{ readonly publishAllowed: boolean }>;
}

export function assertRecipeRequestReservation(
  request: ReserveRecipeRequest,
): void {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    !uuid.test(request.requestId) ||
    !uuid.test(request.userId) ||
    !/^[0-9a-f]{64}$/.test(request.fingerprint) ||
    !["suggest", "recognize"].includes(request.operation) ||
    request.consentVersion.length < 1 ||
    request.consentVersion.length > 100 ||
    !Number.isSafeInteger(request.tokensEstimated) ||
    request.tokensEstimated < 1 ||
    request.tokensEstimated > 2_000_000 ||
    !Number.isSafeInteger(request.leaseMs) ||
    request.leaseMs < 1 ||
    request.leaseMs > 90_000 ||
    Object.values(request.limits).some(
      (value) => !Number.isSafeInteger(value) || value < 1 || value > 2_000_000,
    )
  ) {
    throw new Error("Invalid recipe request reservation");
  }
}
