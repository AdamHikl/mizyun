import { createHash } from "node:crypto";

import plugin from "fastify-plugin";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

/**
 * Conditional GET revalidation and cache-storage policy for `/v1/` routes.
 *
 * - Every `/v1/` response whose route did not set `Cache-Control` gets
 *   `Cache-Control: no-store`, so OS HTTP caches (iOS URLCache / Cache.db,
 *   Android OkHttp `http-cache`) and intermediaries never persist personal
 *   health data (RFC 9111 §5.2.2.5).
 * - A `GET` 200 JSON response whose route did not set `Cache-Control` or
 *   `ETag` gets a strong ETag derived from SHA-256 of the exact payload
 *   bytes (RFC 9110 §8.8.3).
 * - When the request's `If-None-Match` matches that ETag (weak comparison,
 *   comma lists and `*`, RFC 9110 §13.1.2) the reply becomes
 *   `304 Not Modified` with no body, keeping `ETag` and `Cache-Control`
 *   (RFC 9110 §15.4.5).
 *
 * The decision runs in `onSend`, i.e. after authentication, authorization
 * and the route handler produced a 200. A 401/403/404 or any non-200
 * response is never converted to 304, so a validator cannot reveal anything
 * to a caller who could not read the representation.
 */

const V1_PREFIX = "/v1/";

const ENTITY_TAG = /(?:W\/)?"([^"]*)"/g;

const hasHeader = (reply: FastifyReply, name: string): boolean => {
  const value = reply.getHeader(name);
  return value !== undefined && value !== null && value !== "";
};

const isJsonContentType = (reply: FastifyReply): boolean => {
  const value = reply.getHeader("content-type");
  return (
    typeof value === "string" &&
    value.toLowerCase().startsWith("application/json")
  );
};

/** Strong ETag over the exact bytes sent: `"sha256:<32 base64url chars>"`. */
export const computeEntityTag = (payload: string | Buffer): string => {
  const digest = createHash("sha256").update(payload).digest("base64url");
  return `"sha256:${digest.slice(0, 32)}"`;
};

const opaqueTag = (entityTag: string): string | null => {
  const match = /^(?:W\/)?"([^"]*)"$/.exec(entityTag.trim());
  return match ? (match[1] ?? null) : null;
};

/**
 * RFC 9110 §13.1.2: `*` matches any current representation; otherwise the
 * field is a comma-separated list compared with the weak comparison
 * function (opaque-tags equal, W/ prefix ignored).
 */
export const ifNoneMatchMatches = (
  header: string | readonly string[] | undefined,
  currentEntityTag: string,
): boolean => {
  if (header === undefined) return false;
  const value = Array.isArray(header) ? header.join(",") : String(header);
  if (value.trim() === "*") return true;
  const current = opaqueTag(currentEntityTag);
  if (current === null) return false;
  for (const match of value.matchAll(ENTITY_TAG)) {
    if (match[1] === current) return true;
  }
  return false;
};

const isV1Request = (request: FastifyRequest): boolean =>
  request.url.startsWith(V1_PREFIX);

const conditionalGet: FastifyPluginAsync = async (app) => {
  app.addHook("onSend", async (request, reply, payload) => {
    if (!isV1Request(request)) return payload;

    // Routes that choose their own caching policy (signed media and
    // illustration routes set `no-store`) are left untouched.
    if (hasHeader(reply, "cache-control")) return payload;
    reply.header("cache-control", "no-store");

    if (
      request.method !== "GET" ||
      reply.statusCode !== 200 ||
      hasHeader(reply, "etag") ||
      !isJsonContentType(reply) ||
      !(typeof payload === "string" || Buffer.isBuffer(payload))
    ) {
      return payload;
    }

    const entityTag = computeEntityTag(payload);
    reply.header("etag", entityTag);

    if (!ifNoneMatchMatches(request.headers["if-none-match"], entityTag)) {
      return payload;
    }

    reply.code(304);
    reply.removeHeader("content-type");
    reply.removeHeader("content-length");
    return null;
  });
};

export const conditionalGetPlugin = plugin(conditionalGet, {
  name: "mizyun-conditional-get",
});
