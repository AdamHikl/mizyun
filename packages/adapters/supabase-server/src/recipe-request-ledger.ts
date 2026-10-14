import {
  assertRecipeRequestReservation,
  type FinalizeRecipeRequest,
  type RecipeRequestDenial,
  type RecipeRequestLedger,
  type RecipeRequestUsage,
  type UserId,
  type ReserveRecipeRequest,
  type ReserveRecipeRequestResult,
} from "@mizyun/core";
import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

interface ReservationRow extends Record<string, unknown> {
  outcome: string;
  attempt_id: string | null;
  budget_day: string | null;
  lease_expires_at: string | null;
  reason: string | null;
  retry_after: number;
}
interface UsageRow extends Record<string, unknown> {
  user_id: string;
  request_id: string;
  operation: string;
  status: string;
  created_at: string;
  budget_day: string;
  tokens_charged: number;
}
const denialReasons = new Set<RecipeRequestDenial>([
  "consent",
  "deletion",
  "tokens",
  "drafts",
  "minute",
  "inflight",
]);

/** Service-role-only operational RPCs; no prompts, photos, recipes or health context. */
export class SupabaseRecipeRequestLedger implements RecipeRequestLedger {
  constructor(private readonly serviceClient: RepositorySupabaseClient) {}

  async isAvailable(): Promise<boolean> {
    try {
      const { data, error } = await this.serviceClient.rpc<{
        available: boolean;
      }>("ai_recipe_requests_available", {});
      return !error && data[0]?.available === true;
    } catch {
      return false;
    }
  }

  async exportUsageForUser(
    userId: UserId,
  ): Promise<readonly RecipeRequestUsage[]> {
    const records: RecipeRequestUsage[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await this.serviceClient
        .from<UsageRow>("ai_recipe_requests")
        .select(
          "user_id,request_id,operation,status,created_at,budget_day,tokens_charged",
        )
        .eq("user_id", userId)
        .order("request_id", { ascending: true })
        .order("operation", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error?.code === "42P01" && records.length === 0) return [];
      if (error || !data)
        throw new RepositoryError("Recipe usage export unavailable");
      for (const row of data) {
        const date =
          typeof row.created_at === "string" ? Date.parse(row.created_at) : NaN;
        const budgetDate =
          typeof row.budget_day === "string"
            ? Date.parse(`${row.budget_day}T00:00:00.000Z`)
            : NaN;
        if (
          row.user_id !== userId ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            row.request_id,
          ) ||
          !["suggest", "recognize"].includes(row.operation) ||
          !["attempting", "succeeded", "failed", "expired"].includes(
            row.status,
          ) ||
          !Number.isFinite(date) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(row.budget_day) ||
          !Number.isFinite(budgetDate) ||
          new Date(budgetDate).toISOString().slice(0, 10) !== row.budget_day ||
          !Number.isSafeInteger(row.tokens_charged) ||
          row.tokens_charged < 0 ||
          row.tokens_charged > 2_000_000
        ) {
          throw new RepositoryError("Recipe usage export unavailable");
        }
        records.push({
          requestId: row.request_id,
          operation: row.operation as RecipeRequestUsage["operation"],
          status: row.status as RecipeRequestUsage["status"],
          createdAt: new Date(date).toISOString(),
          budgetDay: row.budget_day,
          tokensCharged: row.tokens_charged,
        });
      }
      if (data.length < pageSize) return records;
    }
  }

  async deleteForUser(userId: UserId): Promise<void> {
    const { error } = await this.serviceClient
      .from<UsageRow>("ai_recipe_requests")
      .delete()
      .eq("user_id", userId);
    if (error && error.code !== "42P01")
      throw new RepositoryError("Recipe usage cleanup unavailable");
  }

  async reserve(
    request: ReserveRecipeRequest,
  ): Promise<ReserveRecipeRequestResult> {
    assertRecipeRequestReservation(request);
    const { data, error } = await this.serviceClient.rpc<ReservationRow>(
      "ai_reserve_recipe_request",
      {
        p_user_id: request.userId,
        p_request_id: request.requestId,
        p_operation: request.operation,
        p_fingerprint: request.fingerprint,
        p_consent_version: request.consentVersion,
        p_tokens_estimated: request.tokensEstimated,
        p_token_budget: request.limits.dailyTokenBudget,
        p_draft_budget: request.limits.dailyDraftLimit,
        p_per_minute: request.limits.requestsPerMinute,
        p_max_concurrent: request.limits.maxConcurrentRequests,
        p_lease_ms: request.leaseMs,
      },
    );
    if (error || !data[0])
      throw new RepositoryError("Recipe reservation unavailable");
    const row = data[0];
    switch (row.outcome) {
      case "reserved":
        if (!row.attempt_id || !row.budget_day || !row.lease_expires_at) break;
        return {
          kind: "reserved",
          attemptId: row.attempt_id,
          day: row.budget_day,
          leaseExpiresAt: row.lease_expires_at,
        };
      case "busy":
        if (!Number.isSafeInteger(row.retry_after) || row.retry_after < 1)
          break;
        return { kind: "busy", retryAfter: row.retry_after };
      case "conflict":
        return { kind: "conflict" };
      case "outcome_unavailable":
        return { kind: "outcome_unavailable" };
      case "denied":
        if (
          !denialReasons.has(row.reason as RecipeRequestDenial) ||
          !Number.isSafeInteger(row.retry_after) ||
          row.retry_after < 0
        )
          break;
        return {
          kind: "denied",
          reason: row.reason as RecipeRequestDenial,
          retryAfter: row.retry_after,
        };
    }
    throw new RepositoryError("Recipe reservation unavailable");
  }

  async finalize(
    request: FinalizeRecipeRequest,
  ): Promise<{ readonly publishAllowed: boolean }> {
    if (
      !["succeeded", "failed"].includes(request.status) ||
      (request.tokensUsed !== undefined &&
        (!Number.isSafeInteger(request.tokensUsed) ||
          request.tokensUsed < 0 ||
          request.tokensUsed > 2_000_000))
    ) {
      throw new RepositoryError("Invalid recipe request settlement");
    }
    const { data, error } = await this.serviceClient.rpc<{
      publish_allowed: boolean;
    }>("ai_finalize_recipe_request", {
      p_user_id: request.userId,
      p_attempt_id: request.attemptId,
      p_status: request.status,
      p_tokens_used: request.tokensUsed ?? null,
    });
    if (error || typeof data[0]?.publish_allowed !== "boolean") {
      throw new RepositoryError("Recipe settlement unavailable");
    }
    return { publishAllowed: data[0].publish_allowed };
  }
}
