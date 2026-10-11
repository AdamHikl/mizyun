import { z } from "zod";

const MAX_TTL_MS = 120_000;
const timestampSchema = z
  .number()
  .finite()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const revisionSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const boundedText = (max: number) => z.string().min(1).max(max);
const repetitionsSchema = z.number().int().min(0).max(1_000);
const loadKgSchema = z.number().finite().min(0).max(2_000);
export const companionSetTypeSchema = z.enum([
  "warmup",
  "working",
  "drop",
  "failure",
]);
export type CompanionSetType = z.infer<typeof companionSetTypeSchema>;

export const companionHelloSchema = z
  .object({
    protocolVersion: z.literal(1),
    kind: z.literal("hello"),
    watchNonce: z.string().uuid(),
  })
  .strict();
export type CompanionHello = z.infer<typeof companionHelloSchema>;

const companionExerciseSchema = z
  .object({
    exerciseId: boundedText(100),
    name: boundedText(120),
    completedSets: z.number().int().min(0).max(9_999),
    targetSets: z.number().int().min(0).max(9_999),
    repetitions: repetitionsSchema.nullable(),
    loadKg: loadKgSchema.nullable(),
    setType: companionSetTypeSchema,
    loadUnit: z.enum(["kg", "lb"]),
  })
  .strict();

export const companionSnapshotSchema = z
  .object({
    protocolVersion: z.literal(1),
    kind: z.literal("snapshot"),
    watchNonce: z.string().uuid(),
    bindingId: z.string().uuid(),
    workoutId: z.string().uuid(),
    revision: revisionSchema,
    issuedAtMs: timestampSchema,
    expiresAtMs: timestampSchema,
    status: z.enum(["active", "completed", "unavailable"]),
    exercise: companionExerciseSchema.nullable(),
    restEndsAtMs: timestampSchema.nullable(),
    restDurationSeconds: z.number().int().min(0).max(86_400).nullable(),
    canLogSet: z.boolean(),
    canFinish: z.boolean(),
  })
  .strict()
  .refine(
    (value) =>
      value.expiresAtMs >= value.issuedAtMs &&
      value.expiresAtMs - value.issuedAtMs <= MAX_TTL_MS,
    {
      message: "snapshot lifetime must be between zero and two minutes",
      path: ["expiresAtMs"],
    },
  );
export type CompanionSnapshot = z.infer<typeof companionSnapshotSchema>;

const commandFields = {
  protocolVersion: z.literal(1),
  watchNonce: z.string().uuid(),
  bindingId: z.string().uuid(),
  workoutId: z.string().uuid(),
  operationId: z.string().uuid(),
  baseRevision: revisionSchema,
  createdAtMs: timestampSchema,
  expiresAtMs: timestampSchema,
};
export const companionCommandSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        ...commandFields,
        kind: z.literal("log-set"),
        exerciseId: boundedText(100),
        repetitions: repetitionsSchema,
        loadKg: loadKgSchema,
        setType: companionSetTypeSchema,
      })
      .strict(),
    z.object({ ...commandFields, kind: z.literal("finish") }).strict(),
    z.object({ ...commandFields, kind: z.literal("skip-rest") }).strict(),
  ])
  .refine(
    (value) =>
      value.expiresAtMs >= value.createdAtMs &&
      value.expiresAtMs - value.createdAtMs <= MAX_TTL_MS,
    {
      message: "command lifetime must be between zero and two minutes",
      path: ["expiresAtMs"],
    },
  );
export type CompanionCommand = z.infer<typeof companionCommandSchema>;

export const companionAckSchema = z
  .object({
    protocolVersion: z.literal(1),
    kind: z.literal("ack"),
    watchNonce: z.string().uuid(),
    bindingId: z.string().uuid(),
    operationId: z.string().uuid(),
    status: z.enum(["saved", "rejected", "uncertain"]),
    reason: z.enum([
      "saved",
      "stale",
      "expired",
      "busy",
      "unbound",
      "invalid",
      "check-phone",
    ]),
    revision: revisionSchema,
  })
  .strict();
export type CompanionAck = z.infer<typeof companionAckSchema>;
export const companionClearSchema = z
  .object({
    protocolVersion: z.literal(1),
    kind: z.literal("clear"),
    watchNonce: z.string().uuid().optional(),
    reason: z.enum(["disconnected", "inactive", "completed"]),
  })
  .strict();
export type CompanionClear = z.infer<typeof companionClearSchema>;
export const companionMessageSchema = z.union([
  companionHelloSchema,
  companionSnapshotSchema,
  companionCommandSchema,
  companionAckSchema,
  companionClearSchema,
]);
export type CompanionMessage = z.infer<typeof companionMessageSchema>;
