import { z } from "zod";

/**
 * Store billing (#332, ADR-0080). The server owns `plan_tier`; these shapes
 * only report what the server verified with the Store billing service. A
 * client never sends an entitlement, a receipt or a tier.
 */
export const billingStoreSchema = z.enum(["app_store", "play_store", "other"]);
export type BillingStore = z.infer<typeof billingStoreSchema>;

export const billingEnvironmentSchema = z.enum(["sandbox", "production"]);
export type BillingEnvironment = z.infer<typeof billingEnvironmentSchema>;

export const billingEntitlementStatusSchema = z.enum(["active", "expired"]);
export type BillingEntitlementStatus = z.infer<
  typeof billingEntitlementStatusSchema
>;

/** Why the account currently has `plan_tier = 'paid'`, if it does. */
export const billingPaidSourceSchema = z.enum([
  "subscription",
  "beta_pro",
  "manual",
  "none",
]);
export type BillingPaidSource = z.infer<typeof billingPaidSourceSchema>;

export const billingEntitlementSchema = z
  .object({
    status: billingEntitlementStatusSchema,
    productId: z.string().min(1).max(200).nullable(),
    store: billingStoreSchema.nullable(),
    environment: billingEnvironmentSchema.nullable(),
    inTrial: z.boolean(),
    willRenew: z.boolean(),
    billingIssue: z.boolean(),
    expiresAt: z.string().datetime().nullable(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type BillingEntitlement = z.infer<typeof billingEntitlementSchema>;

/**
 * Public Store SDK configuration. These are the billing service's public
 * (client) keys, which are designed to ship in apps; secret keys never leave
 * the server. Null when purchases are disabled on this server.
 */
export const billingStoreSdkSchema = z
  .object({
    provider: z.literal("revenuecat"),
    iosPublicKey: z.string().min(1).max(200).nullable(),
    androidPublicKey: z.string().min(1).max(200).nullable(),
    entitlementId: z.string().min(1).max(100),
    offeringId: z.string().min(1).max(100).nullable(),
  })
  .strict();
export type BillingStoreSdk = z.infer<typeof billingStoreSdkSchema>;

/** `GET /v1/billing/entitlement` and `POST /v1/billing/entitlement/sync`. */
export const billingEntitlementResponseSchema = z.object({
  planTier: z.enum(["free", "paid"]),
  paidSource: billingPaidSourceSchema,
  purchasesEnabled: z.boolean(),
  entitlement: billingEntitlementSchema.nullable(),
  storeSdk: billingStoreSdkSchema.nullable(),
});
export type BillingEntitlementResponse = z.infer<
  typeof billingEntitlementResponseSchema
>;
