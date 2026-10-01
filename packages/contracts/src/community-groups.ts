import { z } from "zod";

const id = z.string().uuid();
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), "Use plain text");
const targetVersion = { targetMembershipVersion: z.number().int().positive() };
const base = {
  groupId: id,
  membershipVersion: z.number().int().positive().optional(),
};
export const communityGroupRequestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("list") }).strict(),
  z.object({ operation: z.literal("inbox") }).strict(),
  z
    .object({
      operation: z.literal("staffAppeals"),
      reason: text(500),
      after: id.optional(),
      limit: z.number().int().min(1).max(20).default(20),
    })
    .strict(),
  z
    .object({
      operation: z.literal("staffResolveAppeal"),
      appealId: id,
      appealMembershipVersion: z.number().int().positive(),
      decision: z.enum(["approved", "rejected"]),
      reason: text(500),
    })
    .strict(),
  z
    .object({
      operation: z.literal("create"),
      operationId: id,
      name: text(60),
      rules: text(1000),
    })
    .strict(),
  z.object({ operation: z.literal("read"), ...base }).strict(),
  z
    .object({ operation: z.literal("invite"), ...base, targetUserId: id })
    .strict(),
  z.object({ operation: z.literal("code"), ...base }).strict(),
  z
    .object({
      operation: z.literal("request"),
      token: z.string().regex(/^[a-f0-9]{32}$/),
    })
    .strict(),
  z.object({ operation: z.literal("join"), ...base }).strict(),
  z.object({ operation: z.literal("leave"), ...base }).strict(),
  z.object({ operation: z.literal("disband"), ...base }).strict(),
  z
    .object({ operation: z.literal("rules"), ...base, rules: text(1000) })
    .strict(),
  z
    .object({
      operation: z.literal("approve"),
      ...base,
      ...targetVersion,
      targetUserId: id,
    })
    .strict(),
  z
    .object({
      operation: z.literal("remove"),
      ...base,
      ...targetVersion,
      targetUserId: id,
    })
    .strict(),
  z
    .object({
      operation: z.literal("ban"),
      ...base,
      ...targetVersion,
      targetUserId: id,
      reason: text(500),
    })
    .strict(),
  z
    .object({
      operation: z.literal("unban"),
      ...base,
      ...targetVersion,
      targetUserId: id,
    })
    .strict(),
  z
    .object({
      operation: z.literal("role"),
      ...base,
      ...targetVersion,
      targetUserId: id,
      role: z.enum(["moderator", "member"]),
    })
    .strict(),
  z
    .object({
      operation: z.literal("transfer"),
      ...base,
      ...targetVersion,
      targetUserId: id,
    })
    .strict(),
  z
    .object({
      operation: z.literal("post"),
      ...base,
      operationId: id,
      body: text(1000),
      acceptedAudience: z.literal(true),
    })
    .strict(),
  z
    .object({ operation: z.literal("deletePost"), ...base, postId: id })
    .strict(),
  z
    .object({ operation: z.literal("appeal"), ...base, reason: text(1000) })
    .strict(),
  z
    .object({
      operation: z.literal("resolveAppeal"),
      ...base,
      appealId: id,
      appealMembershipVersion: z.number().int().positive(),
      decision: z.enum(["approved", "rejected"]),
      reason: text(500),
    })
    .strict(),
]);
export type CommunityGroupRequest = z.infer<typeof communityGroupRequestSchema>;
export const communityGroupRoleSchema = z.enum([
  "owner",
  "moderator",
  "member",
]);
export const communityGroupSummarySchema = z.object({
  id,
  name: z.string(),
  rules: z.string(),
  role: communityGroupRoleSchema,
  state: z.enum(["member", "pending", "invited", "banned", "removed"]),
  membershipVersion: z.number().int().positive(),
});
export const communityGroupResultSchema = z.object({
  groups: z.array(communityGroupSummarySchema).default([]),
  group: communityGroupSummarySchema.nullable().default(null),
  members: z
    .array(
      z.object({
        userId: id,
        handle: z.string(),
        displayName: z.string(),
        role: communityGroupRoleSchema,
        state: z.string(),
        membershipVersion: z.number().int().positive(),
      }),
    )
    .default([]),
  posts: z
    .array(
      z.object({
        id,
        userId: id,
        displayName: z.string(),
        body: z.string(),
        createdAt: z.string(),
      }),
    )
    .default([]),
  appeals: z
    .array(
      z.object({
        id,
        groupId: id,
        userId: id,
        membershipVersion: z.number().int().positive(),
        reason: z.string(),
        status: z.enum(["pending", "approved", "rejected"]),
        response: z.string().nullable(),
      }),
    )
    .default([]),
  events: z
    .array(
      z.object({
        id,
        groupId: id.nullable(),
        kind: z.string(),
        createdAt: z.string(),
      }),
    )
    .default([]),
  inviteCode: z.string().nullable().default(null),
  complete: z.boolean().default(true),
});
export type CommunityGroupResult = z.infer<typeof communityGroupResultSchema>;
