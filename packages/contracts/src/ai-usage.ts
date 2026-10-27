import { z } from "zod";

export const aiUsageResponseSchema = z.object({
  planTier: z.enum(["free", "paid"]),
  resetsAt: z.string().datetime(),
  coach: z.object({
    /** Messages per UTC day (ADR-0085); absent on older servers. */
    dailyMessageLimit: z.number().optional(),
    messagesUsed: z.number().optional(),
    messagesRemaining: z.number().optional(),
    /** Hidden Coach token ceiling; older app builds still show it. */
    dailyTokenBudget: z.number(),
    tokensUsed: z.number(),
    tokensRemaining: z.number(),
    requestsPerMinute: z.number(),
  }),
  photos: z.object({
    dailyLimit: z.number(),
    draftsUsed: z.number(),
    draftsRemaining: z.number(),
    requestsPerMinute: z.number(),
  }),
});

export type AiUsageResponse = z.infer<typeof aiUsageResponseSchema>;
