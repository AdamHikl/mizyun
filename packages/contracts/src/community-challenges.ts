import { z } from "zod";
const id = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const communityChallengeCommandSchema = z
  .discriminatedUnion("operation", [
    z
      .object({
        operation: z.literal("create"),
        id,
        groupId: id,
        title: z.string().trim().min(1).max(80),
        startDay: day,
        endDay: day,
        timezone: z.string().min(1).max(80),
        goalDays: z.number().int().min(1).max(42),
        confirmed: z.literal(true),
      })
      .strict(),
    z.object({ operation: z.literal("list"), groupId: id }).strict(),
    z.object({ operation: z.literal("get"), id }).strict(),
    z.object({ operation: z.literal("getMine"), id }).strict(),
    z
      .object({ operation: z.literal("listMine"), after: id.optional() })
      .strict(),
    z
      .object({ operation: z.literal("join"), id, confirmed: z.literal(true) })
      .strict(),
    z.object({ operation: z.literal("leave"), id }).strict(),
    z.object({ operation: z.literal("cancel"), id }).strict(),
    z
      .object({
        operation: z.literal("contribute"),
        id,
        day,
        kind: z.enum(["workout", "rest"]),
        sourceWorkoutId: id.optional(),
        confirmed: z.literal(true),
      })
      .strict(),
    z.object({ operation: z.literal("removeContribution"), id, day }).strict(),
  ])
  .refine(
    (c) =>
      c.operation !== "contribute" ||
      (c.kind === "workout" ? !!c.sourceWorkoutId : !c.sourceWorkoutId),
  );
export const communityChallengeSchema = z
  .object({
    id,
    groupId: id,
    title: z.string(),
    startDay: day,
    endDay: day,
    timezone: z.string(),
    goalDays: z.number().int(),
    joined: z.boolean(),
    isOwner: z.boolean(),
    canceled: z.boolean(),
    myProgress: z.number().int().nullable(),
    teamProgress: z.number().int().nullable(),
    participants: z.number().int(),
    days: z.array(
      z.object({ day, kind: z.enum(["workout", "rest"]), valid: z.boolean() }),
    ),
  })
  .strict();
export const communityChallengeResponseSchema = z
  .object({
    challenge: communityChallengeSchema.optional(),
    challenges: z.array(communityChallengeSchema).max(20).optional(),
    done: z.boolean().optional(),
    nextCursor: id.nullable().optional(),
  })
  .strict();
export type CommunityChallengeResponse = z.infer<
  typeof communityChallengeResponseSchema
>;
