import { z } from "zod";

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("mizyun-api"),
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const chatRoleSchema = z.enum(["user", "assistant"]);

export const chatMessageSchema = z.object({
  role: chatRoleSchema,
  text: z.string().trim().min(1).max(20_000),
});

export const coachRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: chatMessageSchema.refine((message) => message.role === "user", {
    message: "A new coach message must use the user role.",
  }),
});

export type CoachRequest = z.infer<typeof coachRequestSchema>;

export const coachResponseSchema = z.object({
  conversationId: z.string().uuid(),
  message: chatMessageSchema.refine((message) => message.role === "assistant", {
    message: "A coach response must use the assistant role.",
  }),
  provider: z.string(),
});

export type CoachResponse = z.infer<typeof coachResponseSchema>;

/**
 * Wire schema for the verified principal returned by `/v1/me`. Decoupled
 * from `@mizyun/identity`'s runtime `AuthPrincipal` interface so a future
 * change to either side does not silently break the other.
 */
export const authPrincipalSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email().optional(),
  role: z.string().optional(),
});

export type AuthPrincipalWire = z.infer<typeof authPrincipalSchema>;

export const meResponseSchema = z.object({
  user: authPrincipalSchema,
});

export type MeResponse = z.infer<typeof meResponseSchema>;
