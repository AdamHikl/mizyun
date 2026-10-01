import { z } from "zod";

export const communityCommentIdSchema = z.string().uuid();
export const communityCommentQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(20).default(20),
    cursor: z
      .string()
      .max(90)
      .refine((value) => {
        const [time, id, ...extra] = value.split("|");
        return (
          extra.length === 0 &&
          !!time &&
          Number.isFinite(Date.parse(time)) &&
          z.string().uuid().safeParse(id).success
        );
      })
      .optional(),
  })
  .strict();

export const communityCommentTextSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (text) => Array.from(text).length <= 500,
    "Use at most 500 characters.",
  )
  .refine(
    (text) => !/[\u0000-\u001f\u007f@]|https?:\/\/|www\./i.test(text),
    "Use plain text without links or typed mentions.",
  );
const identity = z.object({
  userId: z.string().uuid(),
  handle: z.string(),
  displayName: z.string(),
  avatarSymbol: z.string(),
});
export const communityCommentSchema = z.object({
  id: z.string().uuid(),
  activityId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  author: identity,
  body: communityCommentTextSchema,
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  mentions: z.array(identity).max(3),
});
export type CommunityComment = z.infer<typeof communityCommentSchema>;
export const communityCommentPageSchema = z.object({
  items: z.array(communityCommentSchema).max(20),
  nextCursor: z.string().nullable(),
  enabled: z.boolean(),
  canManage: z.boolean(),
  allowMentions: z.boolean(),
});
export type CommunityCommentPage = z.infer<typeof communityCommentPageSchema>;
export const communityCommentMutationSchema = z
  .object({
    id: z.string().uuid(),
    operationId: z.string().uuid(),
    parentId: z.string().uuid().nullable().default(null),
    body: communityCommentTextSchema,
    expectedVersion: z.number().int().min(0),
    mentions: z.array(z.string().uuid()).max(3).default([]),
  })
  .strict()
  .refine(
    (value) => new Set(value.mentions).size === value.mentions.length,
    "Choose each mention once.",
  );
export const communityCommentDeleteSchema = z
  .object({ expectedVersion: z.number().int().positive() })
  .strict();
export const communityCommentSettingsSchema = z
  .object({ enabled: z.boolean() })
  .strict();
export const communityCommentPreferencesSchema = z
  .object({ allowMentions: z.boolean() })
  .strict();
export const communityCommentCandidatesSchema = z.object({
  items: z.array(identity).max(30),
});
export type CommunityCommentCandidates = z.infer<
  typeof communityCommentCandidatesSchema
>;
export const communityCommentMentionInboxSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        activityId: z.string().uuid(),
        commentId: z.string().uuid(),
        createdAt: z.string().datetime(),
      }),
    )
    .max(30),
});
export type CommunityCommentMentionInbox = z.infer<
  typeof communityCommentMentionInboxSchema
>;
export const communityCommentAckSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
});
export const communityCommentReportSchema = z
  .object({
    reason: z.enum([
      "harassment",
      "impersonation",
      "spam",
      "unsafe_or_sexual_content",
      "offensive_content",
      "other",
    ]),
    notes: z.string().max(1000).optional(),
    receiptId: z.string().uuid().optional(),
  })
  .strict();
export const communityCommentReportAckSchema = z.object({
  id: z.string().uuid(),
});
