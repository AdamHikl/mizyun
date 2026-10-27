import { AsyncLocalStorage } from "node:async_hooks";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  effectiveProfileTimeZone,
  isValidIanaTimeZone,
  type ProfileRepository,
} from "@mizyun/core";
import { DEVICE_TIME_ZONE_HEADER } from "@mizyun/contracts";

/**
 * The phone's IANA zone from `x-mizyun-time-zone`, or null when the header
 * is missing (builds before REL-01) or not a named zone.
 */
export const requestTimeZone = (
  request: Pick<FastifyRequest, "headers">,
): string | null => {
  const value = request.headers[DEVICE_TIME_ZONE_HEADER];
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = typeof first === "string" ? first.trim() : null;
  return isValidIanaTimeZone(trimmed) ? trimmed : null;
};

const scope = new AsyncLocalStorage<string | null>();

/**
 * Runs `work` with the request's device zone in scope, so profile reads made
 * anywhere beneath it (Coach grounding and tools) can use it.
 */
export const runWithRequestTimeZone = <T>(
  timeZone: string | null,
  work: () => Promise<T>,
): Promise<T> => scope.run(timeZone, work);

/** Route handler wrapper that scopes the request's device zone. */
export const withRequestTimeZoneScope =
  <T>(handler: (request: FastifyRequest, reply: FastifyReply) => Promise<T>) =>
  (request: FastifyRequest, reply: FastifyReply): Promise<T> =>
    runWithRequestTimeZone(requestTimeZone(request), () =>
      handler(request, reply),
    );

/**
 * REL-01: wraps a profile repository so reads inside `runWithRequestTimeZone`
 * report the request's zone while the stored zone is still the default.
 * Outside a scope, or without a valid zone, reads are unchanged. Writes pass
 * through; the app stores its zone with an explicit PUT /v1/profile.
 */
export const withRequestTimeZone = (
  repository: ProfileRepository,
): ProfileRepository => ({
  getOrCreate: async (userId, defaults) => {
    const profile = await repository.getOrCreate(userId, defaults);
    const effective = effectiveProfileTimeZone(
      profile.timezone,
      scope.getStore(),
    );
    return effective === profile.timezone
      ? profile
      : { ...profile, timezone: effective };
  },
  update: (userId, next, options) => repository.update(userId, next, options),
});
