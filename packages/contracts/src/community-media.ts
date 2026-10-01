import { z } from "zod";
export const communityMediaUploadSchema = z
  .object({
    operationId: z.string().uuid(),
    mimeType: z.enum(["image/jpeg", "image/png"]),
    base64: z
      .string()
      .min(4)
      .max(4_194_304)
      .regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
      ),
    altText: z.string().trim().min(1).max(240),
    rightsConfirmed: z.literal(true),
  })
  .strict();
export const communityMediaItemSchema = z
  .object({
    id: z.string().uuid(),
    authorHandle: z.string(),
    altText: z.string().min(1).max(240),
    state: z.enum(["uploading", "pending", "approved", "rejected", "revoked"]),
    width: z.number().int().min(1).max(1600).nullable(),
    height: z.number().int().min(1).max(1600).nullable(),
    isOwner: z.boolean(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
export const communityMediaListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(20).default(10),
    cursor: z.string().uuid().optional(),
    mine: z.enum(["true", "false"]).optional(),
  })
  .strict();
export const communityMediaListSchema = z
  .object({
    items: z.array(communityMediaItemSchema).max(20),
    nextCursor: z.string().uuid().nullable(),
  })
  .strict();
export const communityMediaIdSchema = z
  .object({ id: z.string().uuid() })
  .strict();
export const communityMediaContentQuerySchema = z
  .object({ variant: z.enum(["image", "thumbnail"]).default("thumbnail") })
  .strict();
export const communityMediaContentSchema = z
  .object({
    mimeType: z.literal("image/jpeg"),
    base64: z.string().max(4_194_304),
  })
  .strict();
export const communityMediaReviewSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export const communityMediaDeletedSchema = z
  .object({ deleted: z.literal(true) })
  .strict();
export type CommunityMediaItem = z.infer<typeof communityMediaItemSchema>;
export type CommunityMediaList = z.infer<typeof communityMediaListSchema>;
export type CommunityMediaContent = z.infer<typeof communityMediaContentSchema>;
