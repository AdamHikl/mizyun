import { z } from "zod";

export const aiUsageResponseSchema = z.object({
  planTier: z.enum(["free", "paid"]),
  resetsAt: z.string().datetime(),
  coach: z.object({
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
