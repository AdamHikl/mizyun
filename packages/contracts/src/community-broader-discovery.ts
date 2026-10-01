import { z } from "zod";
export const communityBroaderDiscoveryCommandSchema = z.discriminatedUnion(
  "operation",
  [
    z
      .object({
        operation: z.literal("preferences"),
        enabled: z.boolean().optional(),
      })
      .strict(),
    z
      .object({
        operation: z.literal("search"),
        prefix: z
          .string()
          .trim()
          .toLowerCase()
          .min(3)
          .max(24)
          .regex(/^[a-z0-9_]+$/),
      })
      .strict(),
  ],
);
export const communityBroaderDiscoveryResponseSchema = z
  .object({
    enabled: z.boolean().optional(),
    profiles: z
      .array(
        z.object({
          userId: z.string().uuid(),
          handle: z.string(),
          displayName: z.string(),
          avatarSymbol: z.string(),
        }),
      )
      .max(10)
      .optional(),
  })
  .strict();
