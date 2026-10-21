import type { FastifyRequest } from "fastify";

import { isLegacyClient } from "../../client-compat.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Copy of a Coach payload with `additionalCandidates` removed from every
 * meal-log proposal. Installed builds (<= 9) parse
 * `coachNutritionProposalSchema` with `.strict()` and predate that field, so
 * one multi-photo proposal would stop the whole thread from opening.
 */
export const withoutAdditionalCandidates = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutAdditionalCandidates);
  if (!isRecord(value)) return value;
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (
      key === "additionalCandidates" &&
      value.kind === "meal_log" &&
      "candidate" in value
    ) {
      continue;
    }
    copy[key] = withoutAdditionalCandidates(child);
  }
  return copy;
};

/** `preSerialization` helper: strip newer proposal fields for legacy clients. */
export const stripCoachPayloadForLegacyClient = (
  request: Pick<FastifyRequest, "headers">,
  payload: unknown,
): unknown =>
  isLegacyClient(request) ? withoutAdditionalCandidates(payload) : payload;
