import type { ApiClient, ApiError } from "@mizyun/api-client";
import {
  billingEntitlementResponseSchema,
  type BillingEntitlementResponse,
} from "@mizyun/contracts";
import type { Result } from "@mizyun/core";

/** Reads the server-verified plan. The server is the only authority (ADR-0029). */
export async function fetchBillingEntitlement(
  client: ApiClient,
): Promise<Result<BillingEntitlementResponse, ApiError>> {
  return client.request<BillingEntitlementResponse>({
    method: "GET",
    path: "/v1/billing/entitlement",
    schema: billingEntitlementResponseSchema,
  });
}

/**
 * Asks the server to re-read the Store billing service for the signed-in user.
 * No body: the client never sends an entitlement, receipt or tier.
 */
export async function syncBillingEntitlement(
  client: ApiClient,
): Promise<Result<BillingEntitlementResponse, ApiError>> {
  return client.request<BillingEntitlementResponse>({
    method: "POST",
    path: "/v1/billing/entitlement/sync",
    schema: billingEntitlementResponseSchema,
  });
}
