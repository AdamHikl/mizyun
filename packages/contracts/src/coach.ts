import { z } from "zod";

export const coachProviderStatusSchema = z.discriminatedUnion("ready", [
  z.object({
    ready: z.literal(true),
    provider: z.string(),
    model: z.string().optional(),
    externalAccess: z.literal(true),
  }),
  z.object({
    ready: z.literal(false),
    provider: z.string(),
    model: z.string().optional(),
    externalAccess: z.literal(false),
    reason: z.string(),
  }),
]);

export const coachConversationStatusSchema = z.enum(["active", "archived"]);

export const coachConversationSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(120).nullable(),
  status: coachConversationStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const coachMessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  text: z.string().trim().min(1).max(20_000),
  status: z.enum(["complete", "failed"]),
  provider: z.string().nullable(),
  evidenceKinds: z.array(
    z.enum(["profile", "goal", "nutrition", "training", "body", "energy"]),
  ),
  createdAt: z.string().datetime(),
});

export const coachConversationCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const coachConversationPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(120).nullable().optional(),
    status: coachConversationStatusSchema.optional(),
  })
  .strict()
  .refine(
    (patch) => patch.title !== undefined || patch.status !== undefined,
    "at least one field must be present",
  );

export const coachMessageCreateSchema = z
  .object({
    text: z.string().trim().min(1).max(4_000),
  })
  .strict();

export const coachConversationResponseSchema = z.object({
  conversation: coachConversationSchema,
});

export const coachConversationListResponseSchema = z.object({
  conversations: z.array(coachConversationSchema),
});

export const coachThreadResponseSchema = z.object({
  conversation: coachConversationSchema,
  messages: z.array(coachMessageSchema),
});

export const coachMessageResponseSchema = z.object({
  conversation: coachConversationSchema,
  userMessage: coachMessageSchema,
  assistantMessage: coachMessageSchema,
});

export type CoachProviderStatus = z.infer<typeof coachProviderStatusSchema>;
export type CoachConversation = z.infer<typeof coachConversationSchema>;
export type CoachMessage = z.infer<typeof coachMessageSchema>;
export type CoachConversationCreate = z.infer<
  typeof coachConversationCreateSchema
>;
export type CoachConversationPatch = z.infer<
  typeof coachConversationPatchSchema
>;
export type CoachMessageCreate = z.infer<typeof coachMessageCreateSchema>;
export type CoachConversationResponse = z.infer<
  typeof coachConversationResponseSchema
>;
export type CoachConversationListResponse = z.infer<
  typeof coachConversationListResponseSchema
>;
export type CoachThreadResponse = z.infer<typeof coachThreadResponseSchema>;
export type CoachMessageResponse = z.infer<typeof coachMessageResponseSchema>;
