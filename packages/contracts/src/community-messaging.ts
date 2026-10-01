import { z } from "zod";
export const communityMessagingCommandSchema = z.discriminatedUnion(
  "operation",
  [
    z
      .object({
        operation: z.literal("preferences"),
        enabled: z.boolean().optional(),
        muted: z.boolean().optional(),
      })
      .strict(),
    z.object({ operation: z.literal("contacts") }).strict(),
    z
      .object({
        operation: z.literal("listMine"),
        after: z.string().uuid().optional(),
      })
      .strict(),
    z
      .object({
        operation: z.literal("list"),
        peerId: z.string().uuid(),
        after: z.string().uuid().optional(),
      })
      .strict(),
    z
      .object({
        operation: z.literal("send"),
        peerId: z.string().uuid(),
        id: z.string().uuid(),
        text: z.string().trim().min(1).max(1000),
      })
      .strict(),
    z
      .object({
        operation: z.literal("edit"),
        id: z.string().uuid(),
        version: z.number().int().min(1),
        text: z.string().trim().min(1).max(1000),
      })
      .strict(),
    z
      .object({ operation: z.literal("delete"), id: z.string().uuid() })
      .strict(),
  ],
);
export type CommunityMessagingCommand = z.infer<
  typeof communityMessagingCommandSchema
>;
export const communityMessageSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    recipientId: z.string().uuid(),
    text: z.string().max(1000).nullable(),
    version: z.number().int(),
    createdAt: z.string().datetime({ offset: true }),
    editedAt: z.string().datetime({ offset: true }).nullable(),
    deleted: z.boolean(),
  })
  .strict();
export const communityMessagingResponseSchema = z
  .object({
    enabled: z.boolean().optional(),
    muted: z.boolean().optional(),
    contacts: z
      .array(z.object({ userId: z.string().uuid(), displayName: z.string() }))
      .optional(),
    messages: z.array(communityMessageSchema).optional(),
    message: communityMessageSchema.optional(),
    nextCursor: z.string().uuid().nullable().optional(),
    deleted: z.boolean().optional(),
  })
  .strict();
export type CommunityMessagingResponse = z.infer<
  typeof communityMessagingResponseSchema
>;
