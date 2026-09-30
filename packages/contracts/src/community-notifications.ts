import { z } from "zod";
const timezone = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  });
export const communityNotificationPreferencesSchema = z
  .object({
    requests: z.boolean(),
    reactions: z.boolean(),
    moderation: z.boolean(),
    muted: z.boolean(),
    timezone,
    quietHours: z
      .object({
        startMinutes: z.number().int().min(0).max(1439),
        endMinutes: z.number().int().min(0).max(1439),
      })
      .strict()
      .refine((v) => v.startMinutes !== v.endMinutes)
      .nullable(),
  })
  .strict();
export type CommunityNotificationPreferences = z.infer<
  typeof communityNotificationPreferencesSchema
>;
export const communityNotificationEventSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(["request", "approval", "reaction", "moderation"]),
    createdAt: z.string().datetime(),
    readAt: z.string().datetime().nullable(),
    targetId: z.string().uuid().nullable(),
  })
  .strict();
export type CommunityNotificationEvent = z.infer<
  typeof communityNotificationEventSchema
>;
export const communityInboxResponseSchema = z
  .object({
    items: z.array(communityNotificationEventSchema).max(50),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type CommunityInboxResponse = z.infer<
  typeof communityInboxResponseSchema
>;
export const communityNotificationDestinationSchema = z
  .object({
    destination: z.enum(["relationships", "activity", "safety"]),
    targetId: z.string().uuid().nullable(),
  })
  .strict();
export const communityNotificationTokenSchema = z
  .object({
    installationId: z.string().uuid(),
    token: z
      .string()
      .regex(/^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/),
  })
  .strict();
