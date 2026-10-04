import { z } from "./zod-runtime.mjs";
export const exerciseSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  instructions: z.string().trim().max(4_000).nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const exerciseResponseSchema = z.object({
  exercise: exerciseSchema,
});
export const exerciseListResponseSchema = z.object({
  exercises: z.array(exerciseSchema),
});
/**
 * Body for `POST /v1/exercises`. The route server-generates `id`,
 * `userId`, and audit timestamps. `metadata` defaults to `{}` when
 * omitted; `instructions` defaults to `null` when omitted.
 */
export const exerciseCreateSchema = z
  .object({
    name: exerciseSchema.shape.name,
    instructions: exerciseSchema.shape.instructions.optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();
export const exerciseCatalogItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  movementPattern: z.enum([
    "knee_dominant",
    "hip_hinge",
    "horizontal_push",
    "horizontal_pull",
    "vertical_push",
    "vertical_pull",
    "core",
    "aerobic",
    "mobility",
  ]),
  equipment: z.array(z.string()),
  blockedBy: z.array(z.string()),
  focusFit: z.array(z.string()),
  primaryMuscles: z.array(z.string()),
  secondaryMuscles: z.array(z.string()),
  instructions: z.array(z.string()),
  category: z.string(),
  level: z.enum(["beginner", "intermediate", "expert"]),
  mechanic: z.enum(["compound", "isolation"]).nullable(),
});
export const exerciseCatalogResponseSchema = z.object({
  exercises: z.array(exerciseCatalogItemSchema),
});
