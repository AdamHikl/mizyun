import { z } from "zod";

export const betaProStatusSchema = z.enum([
  "none",
  "pending",
  "approved",
  "rejected",
]);
export type BetaProStatus = z.infer<typeof betaProStatusSchema>;

export const betaProStatusResponseSchema = z.object({
  status: betaProStatusSchema,
  requestedAt: z.string().datetime().nullable(),
  reviewedAt: z.string().datetime().nullable(),
  notes: z.string().nullable().optional(),
});
export type BetaProStatusResponse = z.infer<typeof betaProStatusResponseSchema>;

export const betaProRequestInputSchema = z.object({
  pushToken: z.string().max(255).optional(),
  notes: z.string().max(1000).optional(),
});
export type BetaProRequestInput = z.infer<typeof betaProRequestInputSchema>;

export const betaProRequestResponseSchema = z.object({
  status: z.literal("pending"),
});
export type BetaProRequestResponse = z.infer<
  typeof betaProRequestResponseSchema
>;

export const betaProPushTokenResponseSchema = z.object({
  updated: z.boolean(),
});
export type BetaProPushTokenResponse = z.infer<
  typeof betaProPushTokenResponseSchema
>;
