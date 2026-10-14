import {
  assertRecipeRequestReservation,
  type FinalizeRecipeRequest,
  type RecipeRequestDenial,
  type RecipeRequestLedger,
  type RecipeRequestUsage,
  type ReserveRecipeRequest,
  type ReserveRecipeRequestResult,
  type UserId,
} from "@mizyun/core";

/** Explicit synthetic injection only. The gate must share counters with every AI operation. */
export interface SyntheticRecipeBudgetGate {
  isAvailable(): Promise<boolean>;
  /** Atomically charge the full token estimate, one draft and shared minute/in-flight slots. */
  reserve(
    request: ReserveRecipeRequest & {
      readonly attemptId: string;
      readonly day: string;
    },
  ): Promise<
    | { readonly allowed: true }
    | {
        readonly allowed: false;
        readonly reason: RecipeRequestDenial;
        readonly retryAfter: number;
      }
  >;
  /** Release only this attempt's slot; absent actual usage retains the full charge. */
  settle(request: {
    readonly userId: UserId;
    readonly attemptId: string;
    readonly day: string;
    readonly tokensEstimated: number;
    readonly tokensUsed?: number;
  }): Promise<void>;
}

interface SyntheticAttempt {
  readonly attemptId: string;
  readonly userId: UserId;
  readonly requestId: string;
  readonly operation: RecipeRequestUsage["operation"];
  readonly createdAt: string;
  tokensCharged: number;
  readonly fingerprint: string;
  readonly consentVersion: string;
  readonly day: string;
  readonly tokensEstimated: number;
  readonly leaseExpiresAt: number;
  status: "attempting" | "succeeded" | "failed" | "expired";
}

/** Fixtures may retain this state and their shared gate to simulate an API restart. */
export interface InMemoryRecipeRequestState {
  readonly attempts: Map<string, SyntheticAttempt>;
  queue: Promise<void>;
}
export const createInMemoryRecipeRequestState =
  (): InMemoryRecipeRequestState => ({
    attempts: new Map(),
    queue: Promise.resolve(),
  });

export interface InMemoryRecipeRequestLedgerOptions {
  readonly clock: () => Date;
  readonly authorize: (
    userId: UserId,
    consentVersion: string,
  ) => Promise<"allowed" | "consent" | "deletion">;
  readonly budgetGate: SyntheticRecipeBudgetGate;
  readonly state?: InMemoryRecipeRequestState;
  readonly newAttemptId?: () => string;
}

/** Not a production fallback: availability requires an explicitly injected shared gate. */
export class InMemoryRecipeRequestLedger implements RecipeRequestLedger {
  private readonly state: InMemoryRecipeRequestState;
  constructor(private readonly options: InMemoryRecipeRequestLedgerOptions) {
    this.state = options.state ?? createInMemoryRecipeRequestState();
  }
  isAvailable(): Promise<boolean> {
    return this.options.budgetGate.isAvailable();
  }

  exportUsageForUser(userId: UserId): Promise<readonly RecipeRequestUsage[]> {
    return this.exclusive(async () =>
      [...this.state.attempts.values()]
        .filter((attempt) => attempt.userId === userId)
        .map((attempt) => ({
          requestId: attempt.requestId,
          operation: attempt.operation,
          status: attempt.status,
          createdAt: attempt.createdAt,
          budgetDay: attempt.day,
          tokensCharged: attempt.tokensCharged,
        })),
    );
  }

  deleteForUser(userId: UserId): Promise<void> {
    return this.exclusive(async () => {
      for (const [key, attempt] of this.state.attempts) {
        if (attempt.userId !== userId) continue;
        if (attempt.status === "attempting") await this.expire(attempt);
        this.state.attempts.delete(key);
      }
    });
  }

  reserve(request: ReserveRecipeRequest): Promise<ReserveRecipeRequestResult> {
    assertRecipeRequestReservation(request);
    return this.exclusive(async () => {
      if (!(await this.isAvailable()))
        throw new Error("Recipe reservation unavailable");
      const authorization = await this.options.authorize(
        request.userId,
        request.consentVersion,
      );
      if (authorization !== "allowed")
        return { kind: "denied", reason: authorization, retryAfter: 0 };
      const now = this.options.clock().getTime();
      const key = `${request.userId}:${request.requestId}:${request.operation}`;
      const prior = this.state.attempts.get(key);
      if (prior) {
        if (prior.fingerprint !== request.fingerprint)
          return { kind: "conflict" };
        if (prior.status === "attempting" && prior.leaseExpiresAt > now) {
          return {
            kind: "busy",
            retryAfter: Math.max(
              1,
              Math.ceil((prior.leaseExpiresAt - now) / 1000),
            ),
          };
        }
        if (prior.status === "attempting") await this.expire(prior);
        return { kind: "outcome_unavailable" };
      }
      for (const attempt of this.state.attempts.values()) {
        if (
          attempt.userId === request.userId &&
          attempt.status === "attempting" &&
          attempt.leaseExpiresAt <= now
        ) {
          await this.expire(attempt);
        }
      }
      const attemptId = this.options.newAttemptId?.() ?? crypto.randomUUID();
      const day = new Date(now).toISOString().slice(0, 10);
      const budget = await this.options.budgetGate.reserve({
        ...request,
        attemptId,
        day,
      });
      if (!budget.allowed)
        return {
          kind: "denied",
          reason: budget.reason,
          retryAfter: budget.retryAfter,
        };
      const leaseExpiresAt = this.options.clock().getTime() + request.leaseMs;
      this.state.attempts.set(key, {
        attemptId,
        userId: request.userId,
        requestId: request.requestId,
        operation: request.operation,
        createdAt: new Date(now).toISOString(),
        tokensCharged: request.tokensEstimated,
        fingerprint: request.fingerprint,
        consentVersion: request.consentVersion,
        day,
        tokensEstimated: request.tokensEstimated,
        leaseExpiresAt,
        status: "attempting",
      });
      return {
        kind: "reserved",
        attemptId,
        day,
        leaseExpiresAt: new Date(leaseExpiresAt).toISOString(),
      };
    });
  }

  finalize(
    request: FinalizeRecipeRequest,
  ): Promise<{ readonly publishAllowed: boolean }> {
    if (
      !["succeeded", "failed"].includes(request.status) ||
      (request.tokensUsed !== undefined &&
        (!Number.isSafeInteger(request.tokensUsed) ||
          request.tokensUsed < 0 ||
          request.tokensUsed > 2_000_000))
    ) {
      throw new Error("Invalid recipe request settlement");
    }
    return this.exclusive(async () => {
      const attempt = [...this.state.attempts.values()].find(
        (value) =>
          value.attemptId === request.attemptId &&
          value.userId === request.userId,
      );
      if (!attempt || attempt.status !== "attempting")
        return { publishAllowed: false };
      if (attempt.leaseExpiresAt <= this.options.clock().getTime()) {
        await this.expire(attempt);
        return { publishAllowed: false };
      }
      const authorized = await this.options.authorize(
        request.userId,
        attempt.consentVersion,
      );
      if (attempt.leaseExpiresAt <= this.options.clock().getTime()) {
        await this.expire(attempt);
        return { publishAllowed: false };
      }
      await this.options.budgetGate.settle({
        userId: request.userId,
        attemptId: request.attemptId,
        day: attempt.day,
        tokensEstimated: attempt.tokensEstimated,
        ...(request.status === "succeeded" && request.tokensUsed !== undefined
          ? { tokensUsed: request.tokensUsed }
          : {}),
      });
      attempt.status = request.status;
      if (request.status === "succeeded" && request.tokensUsed !== undefined)
        attempt.tokensCharged = request.tokensUsed;
      return {
        publishAllowed:
          authorized === "allowed" && request.status === "succeeded",
      };
    });
  }

  private async expire(attempt: SyntheticAttempt): Promise<void> {
    await this.options.budgetGate.settle({
      userId: attempt.userId,
      attemptId: attempt.attemptId,
      day: attempt.day,
      tokensEstimated: attempt.tokensEstimated,
    });
    attempt.status = "expired";
  }
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.state.queue.then(action);
    this.state.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }
}
