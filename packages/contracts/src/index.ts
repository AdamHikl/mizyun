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

/**
 * Profile domain shape (PROF-001).
 *
 * The values mirror the `public.profiles` migration:
 *   - `unit_system` is the closed enum the SQL check constraint enforces.
 *   - `height_cm` is bounded to plausible adult range; the canonical
 *     storage is metric. Conversion to imperial happens at the
 *     presentation layer in a later segment.
 *   - `birth_year` is bounded to a plausible adult range so the API
 *     rejects obviously malformed input early. Age in years is derived
 *     at the presentation layer rather than stored, to avoid timezone
 *     ambiguity.
 *   - `display_name` is optional and bounded to a sane length so it
 *     can render in a list view without truncation surprises.
 *
 * The schema is the single source of truth for the `/v1/profile`
 * wire contract. Producers and consumers parse against the same
 * Zod schema so a future shape change fails closed at the boundary.
 */
export const unitSystemSchema = z.enum(["metric", "imperial"]);

export type UnitSystem = z.infer<typeof unitSystemSchema>;

export const profileSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string().trim().min(1).max(80).nullable().optional(),
  unitSystem: unitSystemSchema,
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .describe("IANA timezone string, e.g. 'UTC', 'Europe/Paris'."),
  birthYear: z
    .number()
    .int()
    .gte(1900)
    .lte(new Date().getUTCFullYear())
    .nullable()
    .optional(),
  heightCm: z.number().gte(50).lte(260).multipleOf(0.01).nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Profile = z.infer<typeof profileSchema>;

export const profileResponseSchema = z.object({
  profile: profileSchema,
});

export type ProfileResponse = z.infer<typeof profileResponseSchema>;

/**
 * Partial-update body for `PUT /v1/profile`. Every field is optional;
 * the route handler merges the patch into the stored profile and
 * validates the merged shape. Sending `null` clears a nullable
 * field; omitting a field leaves it unchanged.
 *
 * The inferred type allows `undefined` per Zod's `.optional()` so the
 * type matches the optional input shape exactly under
 * `exactOptionalPropertyTypes: true`.
 */
export const profilePatchSchema = z
  .object({
    displayName: profileSchema.shape.displayName.optional(),
    unitSystem: unitSystemSchema.optional(),
    timezone: profileSchema.shape.timezone.optional(),
    birthYear: profileSchema.shape.birthYear.optional(),
    heightCm: profileSchema.shape.heightCm.optional(),
  })
  .strict()
  .refine(
    (patch) =>
      patch.displayName !== undefined ||
      patch.unitSystem !== undefined ||
      patch.timezone !== undefined ||
      patch.birthYear !== undefined ||
      patch.heightCm !== undefined,
    { message: "at least one field must be present" },
  );

export type ProfilePatch = z.infer<typeof profilePatchSchema>;
