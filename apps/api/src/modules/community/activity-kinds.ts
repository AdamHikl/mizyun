import type { FastifyRequest } from "fastify";

import { isLegacyClient } from "../../client-compat.js";

/**
 * Installed builds reject a whole feed page on an unknown `activityKind`, so
 * newer kinds are sent only to clients that declare them (ADR-0067).
 */
export const ACTIVITY_KINDS_HEADER = "x-mizyun-activity-kinds";

/**
 * Meal cards shipped after installed Store build 1.0.9 (9) but before kind
 * negotiation. Build 9 sends neither the kinds header nor the compatibility
 * header and would show a meal as a workout card, so meals are rendered only
 * for clients that send either header (or name `meal` explicitly).
 */
const clientRendersMealCards = (request: FastifyRequest): boolean =>
  !isLegacyClient(request) ||
  request.headers[ACTIVITY_KINDS_HEADER] !== undefined;

export const acceptedOptionalKinds = (
  request: FastifyRequest,
): ReadonlySet<string> => {
  const raw = request.headers[ACTIVITY_KINDS_HEADER];
  const value = Array.isArray(raw) ? raw.join(",") : (raw ?? "");
  const kinds = new Set(
    value
      .split(",")
      .map((kind) => kind.trim().toLowerCase())
      .filter((kind) => kind.length > 0 && kind.length <= 32),
  );
  if (clientRendersMealCards(request)) kinds.add("meal");
  return kinds;
};

/** Workout cards predate kind negotiation; every other kind is opt-in. */
export const clientRendersKind = (
  accepted: ReadonlySet<string>,
  kind: string | null | undefined,
): boolean =>
  kind === undefined ||
  kind === null ||
  kind === "workout" ||
  accepted.has(kind);

/**
 * Whether a single activity card (recipient view or owner context) may be
 * sent. Build 9 parses any card as a workout card, and its owner schema
 * requires `sourceWorkoutId`, so legacy clients receive only kinds they
 * render. Current clients keep receiving every kind.
 */
export const clientRendersActivity = (
  request: FastifyRequest,
  kind: string | null | undefined,
): boolean =>
  !isLegacyClient(request) ||
  clientRendersKind(acceptedOptionalKinds(request), kind);
