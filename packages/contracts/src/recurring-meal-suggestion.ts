import { z } from "zod";
import {
  recurringMealSchema,
  recurringMealLocalDateSchema,
  recurringMealLocalTimeSchema,
  recurringMealTimeZoneSchema,
  recurringMealWeekdaysSchema,
} from "./recurring-meal";
const number = z.number().finite().nonnegative().max(20_000).nullable();
export const recurringMealSuggestionProposalSchema = z
  .object({
    candidateId: z.string().regex(/^mrs1-[0-9a-f]{8}$/),
    familyKey: z.string().min(1).max(200),
    sourceEntryId: z.string().uuid(),
    sourceUpdatedAt: z.string().datetime(),
    evidence: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            updatedAt: z.string().datetime(),
            localDate: recurringMealLocalDateSchema,
          })
          .strict(),
      )
      .length(3),
    evidenceDigest: z.string().regex(/^[0-9a-f]{8}$/),
    name: z
      .string()
      .min(1)
      .max(200)
      .refine((value) => value.trim().length > 0),
    caloriesKcal: number,
    proteinG: number,
    carbohydrateG: number,
    fatG: number,
    grams: number,
    policyVersion: z.string().min(1).max(100),
    reasonCode: z.literal("three_consecutive_days"),
    localTime: recurringMealLocalTimeSchema,
    timeZone: recurringMealTimeZoneSchema,
    weekdays: recurringMealWeekdaysSchema,
    startLocalDate: recurringMealLocalDateSchema,
    expiresAt: z.string().datetime(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (
      new Set(p.evidence.map((e) => e.id)).size !== 3 ||
      new Set(p.evidence.map((e) => e.localDate)).size !== 3
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Evidence must contain three distinct entries and dates",
      });
    if (
      !p.evidence.some(
        (e) => e.id === p.sourceEntryId && e.updatedAt === p.sourceUpdatedAt,
      )
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Source revision must occur in evidence",
      });
  });
export type RecurringMealSuggestionProposal = z.infer<
  typeof recurringMealSuggestionProposalSchema
>;
export const recurringMealSuggestionListResponseSchema = z
  .object({
    suggestion: recurringMealSuggestionProposalSchema.nullable(),
    enabled: z.boolean(),
  })
  .strict();
export type RecurringMealSuggestionListResponse = z.infer<
  typeof recurringMealSuggestionListResponseSchema
>;
export const recurringMealSuggestionAcceptSchema = z
  .object({
    operationId: z.string().uuid(),
    proposal: recurringMealSuggestionProposalSchema,
    localTime: recurringMealLocalTimeSchema,
    timeZone: recurringMealTimeZoneSchema,
    weekdays: recurringMealWeekdaysSchema,
  })
  .strict();
export type RecurringMealSuggestionAccept = z.infer<
  typeof recurringMealSuggestionAcceptSchema
>;
export const recurringMealSuggestionAcceptResponseSchema = z
  .object({
    recurringMeal: recurringMealSchema,
    created: z.boolean(),
    startLocalDate: recurringMealLocalDateSchema,
  })
  .strict();
export type RecurringMealSuggestionAcceptResponse = z.infer<
  typeof recurringMealSuggestionAcceptResponseSchema
>;
export const recurringMealSuggestionDecisionSchema = z
  .object({
    proposal: recurringMealSuggestionProposalSchema,
    decision: z.enum(["shown", "not_now", "never"]),
  })
  .strict();
export type RecurringMealSuggestionDecision = z.infer<
  typeof recurringMealSuggestionDecisionSchema
>;
export const recurringMealSuggestionPreferencesSchema = z
  .object({ enabled: z.boolean() })
  .strict();
export type RecurringMealSuggestionPreferences = z.infer<
  typeof recurringMealSuggestionPreferencesSchema
>;
