import { z } from "./zod-runtime.mjs";
/**
 * Goal domain shape (GOAL-001).
 *
 * Mizyun uses three closed goal kinds: cut (lose body mass), recomp
 * (re-distribute mass with no net change), maintain (hold the
 * current body mass within a tolerance band). The pace preference
 * shapes the rate of weekly change the energy engine targets.
 *
 * `target` is a small open shape keyed by kind:
 *   - cut / maintain: `weightKg` (mandatory, in canonical kg)
 *   - recomp: `weightKg` (mandatory) plus `bodyFatPercent`
 *     (optional, canonical 0..100, the trend target)
 *
 * The schema parses the wire shape and is the source of truth for
 * `/v1/goals` endpoints. The SQL `public.goals` table currently
 * stores `kind text` and `target jsonb`; the route layer maps the
 * closed union onto the open column. A follow-up migration tightens
 * the SQL constraint.
 */
export const goalKindSchema = z.enum(["cut", "bulk", "recomp", "maintain"]);
export const goalPaceSchema = z.enum(["steady", "gradual", "aggressive"]);
export const goalStatusSchema = z.enum([
  "draft",
  "active",
  "completed",
  "archived",
]);
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be in YYYY-MM-DD form");
/**
 * Weight target stored in canonical kilograms. Range is the plausible
 * adult band (mirrors `height_cm`); values outside the band are
 * rejected so a typo cannot derail the energy engine.
 */
export const targetWeightKgSchema = z.number().gte(30).lte(250).multipleOf(0.1);
export const goalTargetSchema = z.object({
  weightKg: targetWeightKgSchema,
  bodyFatPercent: z.number().gte(3).lte(60).multipleOf(0.1).optional(),
});
/**
 * Full stored goal. `startsOn` and `targetDate` are dates in the user's
 * local timezone semantically, but stored as ISO `YYYY-MM-DD` UTC
 * dates; the energy engine derives a calendar from them. `reviewDate`
 * is optional and triggers a UI prompt at the start of that day.
 */
export const goalSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    kind: goalKindSchema,
    status: goalStatusSchema,
    pace: goalPaceSchema,
    target: goalTargetSchema,
    startsOn: isoDateSchema,
    targetDate: isoDateSchema,
    reviewDate: isoDateSchema.optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .refine((goal) => goal.targetDate >= goal.startsOn, {
    message: "targetDate must be on or after startsOn",
    path: ["targetDate"],
  })
  .refine(
    (goal) => goal.reviewDate === undefined || goal.reviewDate >= goal.startsOn,
    {
      message: "reviewDate must be on or after startsOn",
      path: ["reviewDate"],
    },
  );
export const goalResponseSchema = z.object({
  goal: goalSchema,
});
export const goalHistoryResponseSchema = z.object({
  goals: z.array(goalSchema),
});
/**
 * Body for `POST /v1/goals`. The route server-generates `id`,
 * `userId`, `createdAt`, `updatedAt`, and `status` (always `active`
 * for newly created goals). The first goal ever created for a user
 * is also their primary active goal by definition.
 */
export const goalCreateSchema = z
  .object({
    kind: goalKindSchema,
    pace: goalPaceSchema,
    target: goalTargetSchema,
    startsOn: isoDateSchema,
    targetDate: isoDateSchema,
    reviewDate: isoDateSchema.optional(),
  })
  .strict()
  .refine((create) => create.targetDate >= create.startsOn, {
    message: "targetDate must be on or after startsOn",
    path: ["targetDate"],
  })
  .refine(
    (create) =>
      create.reviewDate === undefined || create.reviewDate >= create.startsOn,
    {
      message: "reviewDate must be on or after startsOn",
      path: ["reviewDate"],
    },
  );
/**
 * Body for `PUT /v1/goals/:id`. Status transitions are restricted:
 *   - active → completed (the goal is met)
 *   - active → archived (the user changed their mind)
 *   - draft → active (the user accepts the goal)
 *   - draft → archived
 * Any other transition is rejected at the route layer.
 */
export const goalPatchSchema = z
  .object({
    status: goalStatusSchema.optional(),
    pace: goalPaceSchema.optional(),
    target: goalTargetSchema.optional(),
    targetDate: isoDateSchema.optional(),
    reviewDate: isoDateSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (patch) =>
      patch.status !== undefined ||
      patch.pace !== undefined ||
      patch.target !== undefined ||
      patch.targetDate !== undefined ||
      patch.reviewDate !== undefined,
    { message: "at least one field must be present" },
  );
