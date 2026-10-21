import type { FastifyRequest } from "fastify";
import { API_COMPAT_HEADER } from "@mizyun/contracts";

/**
 * True when the request lacks a non-empty `x-mizyun-api-compat` header. The
 * current `packages/api-client` sends it on every request; installed Store
 * builds up to build 9 do not, so their strict response schemas must not
 * see newer fields.
 */
export const isLegacyClient = (
  request: Pick<FastifyRequest, "headers">,
): boolean => {
  const value = request.headers[API_COMPAT_HEADER];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first !== "string" || first.trim().length === 0;
};
