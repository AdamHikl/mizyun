import type { FastifyRequest } from "fastify";

/**
 * Installed builds reject a whole feed page on an unknown `activityKind`, so
 * newer kinds are sent only to clients that declare them (ADR-0067).
 */
export const ACTIVITY_KINDS_HEADER = "x-mizyun-activity-kinds";

export const acceptedOptionalKinds = (
  request: FastifyRequest,
): ReadonlySet<string> => {
  const raw = request.headers[ACTIVITY_KINDS_HEADER];
  const value = Array.isArray(raw) ? raw.join(",") : (raw ?? "");
  return new Set(
    value
      .split(",")
      .map((kind) => kind.trim().toLowerCase())
      .filter((kind) => kind.length > 0 && kind.length <= 32),
  );
};

/** Workout and meal cards predate kind negotiation; later kinds are opt-in. */
export const clientRendersKind = (
  accepted: ReadonlySet<string>,
  kind: string | null | undefined,
): boolean =>
  kind === undefined ||
  kind === null ||
  kind === "workout" ||
  kind === "meal" ||
  accepted.has(kind);
