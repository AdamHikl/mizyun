/**
 * Exercise wire schemas (EX-001).
 *
 * The shape mirrors `public.exercises`:
 *   - `name` is the user-visible label, mandatory and bounded to a
 *     sane length so it renders cleanly in a picker.
 *   - `instructions` is a free-form text field the user can use for
 *     cues ("keep your back flat, lower the bar to mid-shin"). It is
 *     nullable: most exercises have no text.
 *   - `metadata` is an open `Record<string, unknown>` for forward
 *     compatibility (the future AI path may attach muscle-group or
 *     equipment hints here). The schema rejects nothing inside it
 *     but the route layer never reads from it.
 *
 * Producers and consumers parse against the same Zod schema so a
 * future shape change fails closed at the boundary.
 */
import { z } from "zod";

export const exerciseSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  instructions: z.string().trim().max(4_000).nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Exercise = z.infer<typeof exerciseSchema>;

export const exerciseResponseSchema = z.object({
  exercise: exerciseSchema,
});

export type ExerciseResponse = z.infer<typeof exerciseResponseSchema>;

export const exerciseListResponseSchema = z.object({
  exercises: z.array(exerciseSchema),
});

export type ExerciseListResponse = z.infer<typeof exerciseListResponseSchema>;

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

export type ExerciseCreate = z.infer<typeof exerciseCreateSchema>;

/**
 * Body for `PUT /v1/exercises/:id`. Every field is optional; the
 * route merges the patch into the stored exercise. Setting
 * `instructions` to `null` clears it. Setting `metadata` replaces
 * the stored object wholesale (merging maps is a future concern).
 */
export const exercisePatchSchema = z
  .object({
    name: exerciseSchema.shape.name.optional(),
    instructions: exerciseSchema.shape.instructions.nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict()
  .refine(
    (patch) =>
      patch.name !== undefined ||
      patch.instructions !== undefined ||
      patch.metadata !== undefined,
    { message: "at least one field must be present" },
  );

export type ExercisePatch = z.infer<typeof exercisePatchSchema>;

/**
 * Query params for `GET /v1/exercises`. `limit` caps the page size
 * to protect the API from a runaway request. The route clamps to
 * `[1, 200]`; the default is `50`.
 */
export const exerciseListQuerySchema = z
  .object({
    limit: z.coerce.number().int().gte(1).lte(200).optional(),
  })
  .strict();

export type ExerciseListQuery = z.infer<typeof exerciseListQuerySchema>;

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

export type ExerciseCatalogItem = z.infer<typeof exerciseCatalogItemSchema>;

export const exerciseCatalogResponseSchema = z.object({
  exercises: z.array(exerciseCatalogItemSchema),
});

export type ExerciseCatalogResponse = z.infer<
  typeof exerciseCatalogResponseSchema
>;

export const exerciseCatalogQuerySchema = z
  .object({
    query: z.string().optional(),
    movementPattern: z
      .enum([
        "knee_dominant",
        "hip_hinge",
        "horizontal_push",
        "horizontal_pull",
        "vertical_push",
        "vertical_pull",
        "core",
        "aerobic",
        "mobility",
      ])
      .optional(),
    category: z.string().optional(),
    limit: z.coerce.number().int().gte(1).lte(200).optional(),
  })
  .strict();

export type ExerciseCatalogQuery = z.infer<typeof exerciseCatalogQuerySchema>;
