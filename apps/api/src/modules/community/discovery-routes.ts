import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import {
  toPublicCommunityProfile,
  type CommunityRepository,
} from "@mizyun/core";
import {
  searchProfilesResponseSchema,
  publicCommunityProfileDtoSchema,
  type SearchProfilesResponse,
  type PublicCommunityProfileDto,
} from "@mizyun/contracts";
import { sendApiError } from "../../errors.js";
import { registerCommunityErrorHandler } from "./error-handler.js";

/** One limiter per API process, shared by exact lookup and invitation resolution.
 * Database RPCs separately enforce durable actor budgets across restarts/instances.
 * Source identifiers are short-lived in memory and never enter the database ledger.
 */
export class CommunityDiscoveryRateLimiter {
  readonly #attempts = new Map<string, number[]>();
  constructor(private readonly now: () => number = Date.now) {}
  readonly check = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const principal = request.principal;
    if (!principal) return;
    const now = this.now();
    const utcDayStart = Math.floor(now / 86_400_000) * 86_400_000;
    for (const [key, values] of this.#attempts) {
      const recent = values.filter(
        (time) => time >= Math.min(utcDayStart, now - 60_000),
      );
      if (recent.length) this.#attempts.set(key, recent);
      else this.#attempts.delete(key);
    }
    const keys = [`actor:${principal.userId}`, `source:${request.ip}`];
    if (
      this.#attempts.size >= 10_000 ||
      keys.some((key) => {
        const attempts = this.#attempts.get(key) ?? [];
        const actor = key.startsWith("actor:");
        return (
          attempts.filter((time) => time >= utcDayStart).length >=
            (actor ? 120 : 1000) ||
          attempts.filter((time) => time > now - 60_000).length >=
            (actor ? 30 : 120)
        );
      })
    ) {
      sendApiError(
        reply,
        request,
        429,
        "RATE_LIMITED",
        "Please wait before making another Community request.",
      );
      return;
    }
    for (const key of keys)
      this.#attempts.set(key, [...(this.#attempts.get(key) ?? []), now]);
  };
}

export interface CommunityDiscoveryRoutesOptions {
  readonly communityRepository: CommunityRepository;
  readonly discoveryRateLimiter: CommunityDiscoveryRateLimiter;
}
export const communityDiscoveryRoutes: FastifyPluginAsync<
  CommunityDiscoveryRoutesOptions
> = async (app, options) => {
  registerCommunityErrorHandler(app);
  // GET /v1/community/search — search discoverable profiles
  app.get(
    "/search",
    { preHandler: [app.authenticate, options.discoveryRateLimiter.check] },
    async (request, reply): Promise<SearchProfilesResponse | void> => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const myProfile = await options.communityRepository.getProfile(
        principal.userId,
        { accessToken: principal.accessToken },
      );
      if (!myProfile || myProfile.status !== "active") {
        return sendApiError(
          reply,
          request,
          403,
          "COMMUNITY_NOT_ENROLLED",
          "You must be enrolled in Community to search profiles.",
        );
      }

      const query = request.query as { q?: string; limit?: string };
      const q = (query.q ?? "").trim();
      const limit = query.limit === undefined ? 20 : Number(query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50 || q.length > 25)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Enter an exact handle and a limit between 1 and 50.",
        );

      if (!q) {
        return { profiles: [] };
      }

      const found = await options.communityRepository.searchProfiles(
        q,
        principal.userId,
        { accessToken: principal.accessToken, limit },
      );

      const profilesWithRelationship: PublicCommunityProfileDto[] = [];

      for (const p of found) {
        if (!p.isSearchable || p.status !== "active") continue;
        const publicP = toPublicCommunityProfile(p);

        // Check relationship
        const outgoing = await options.communityRepository.getRelationship(
          principal.userId,
          p.userId,
          { accessToken: principal.accessToken },
        );
        const incoming = await options.communityRepository.getRelationship(
          p.userId,
          principal.userId,
          { accessToken: principal.accessToken },
        );

        let relationshipWithViewer: PublicCommunityProfileDto["relationshipWithViewer"] =
          "none";

        if (
          outgoing?.status === "approved" &&
          incoming?.status === "approved"
        ) {
          relationshipWithViewer = "mutual";
        } else if (outgoing?.status === "approved") {
          relationshipWithViewer = "following";
        } else if (incoming?.status === "approved") {
          relationshipWithViewer = "follower";
        } else if (outgoing?.status === "pending") {
          relationshipWithViewer = "pending_outgoing";
        } else if (incoming?.status === "pending") {
          relationshipWithViewer = "pending_incoming";
        }

        profilesWithRelationship.push(
          publicCommunityProfileDtoSchema.parse({
            userId: publicP.userId,
            handle: publicP.handle,
            displayName: publicP.displayName,
            avatarSymbol: publicP.avatarSymbol,
            bio: null,
            createdAt: publicP.createdAt.toISOString(),
            relationshipWithViewer,
          }),
        );
      }

      return searchProfilesResponseSchema.parse({
        profiles: profilesWithRelationship,
      });
    },
  );
};
