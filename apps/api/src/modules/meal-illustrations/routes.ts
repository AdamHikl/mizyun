import { createHash } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { mealIllustrationResponseSchema } from "@mizyun/contracts";
import {
  MEAL_ILLUSTRATION_STYLE,
  normalizeMealIllustrationName,
  type AiConsentRepository,
  type FoodEntryRepository,
  type MealIllustrationRepository,
  type ProfileRepository,
  type UserId,
} from "@mizyun/core";
import {
  screenCoachInput,
  type MealIllustrationProvider,
} from "@mizyun/agent-runtime";
import { authorizedAiConsentVersion } from "../../ai-eligibility.js";
import { capsForTier, ILLUSTRATION_MICROS } from "@mizyun/config";
import { sendApiError } from "../../errors.js";
import type { AiCostLedger } from "../coach/limits.js";
import type { BetaProRepository } from "../../beta-pro-repository.js";
import { hasMealVisuals } from "../../meal-visual-access.js";

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Illustration cancelled"));
    if (signal.aborted) {
      promise.catch(() => undefined);
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export interface MealIllustrationRoutesOptions {
  readonly foodEntryRepository: FoodEntryRepository;
  readonly profileRepository: ProfileRepository;
  readonly aiConsentRepository: AiConsentRepository;
  readonly betaProRepository: BetaProRepository;
  readonly repository: MealIllustrationRepository | null;
  readonly provider: MealIllustrationProvider | null;
  readonly enabled: () => boolean;
  readonly processImage: (bytes: Uint8Array) => Promise<string>;
  readonly timeoutMs?: number;
  /** AI cost allowance shared with the other AI routes (ADR-0081). */
  readonly costLedger?: AiCostLedger;
}
export const mealIllustrationRoutes: FastifyPluginAsync<
  MealIllustrationRoutesOptions
> = async (app, options) => {
  const jobs = new Map<AbortController, Promise<void>>();
  let closing = false;
  /**
   * The user's stored, accepted consent version when an illustration is
   * allowed, otherwise null. The SQL claim/complete functions compare the
   * stored row to this exact version.
   */
  const authorizedVersion = async (
    userId: UserId,
    accessToken: string,
    signal: AbortSignal = AbortSignal.timeout(10_000),
  ): Promise<string | null> => {
    if (
      closing ||
      !options.enabled() ||
      !options.provider ||
      !options.repository
    )
      return null;
    try {
      const [profile, consent] = await withAbort(
        Promise.all([
          options.profileRepository.getOrCreate(userId, {
            accessToken,
            now: new Date(),
          }),
          options.aiConsentRepository.getConsent(userId, { accessToken }),
        ]),
        signal,
      );
      const pro = await withAbort(
        hasMealVisuals(options, userId, accessToken, profile.planTier),
        signal,
      );
      return pro && !signal.aborted && options.enabled()
        ? authorizedAiConsentVersion({ profile, consent })
        : null;
    } catch {
      return null;
    }
  };
  const authorized = async (
    userId: UserId,
    accessToken: string,
    signal?: AbortSignal,
  ): Promise<boolean> =>
    (await authorizedVersion(userId, accessToken, signal)) !== null;
  app.addHook("onClose", async () => {
    closing = true;
    for (const controller of jobs.keys()) controller.abort();
    await withAbort(
      Promise.allSettled([...jobs.values()]),
      AbortSignal.timeout(2_000),
    ).catch(() => undefined);
  });
  app.get(
    "/illustrations/capability",
    { preHandler: app.authenticate },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const principal = request.principal!;
      return {
        available: await authorized(
          principal.userId as UserId,
          principal.accessToken,
        ),
      };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/:id/illustration",
    { preHandler: app.authenticate },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      if (
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          request.params.id,
        ) ||
        request.body !== undefined
      )
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Use a saved meal ID to request an illustration.",
        );
      const principal = request.principal!;
      const userId = principal.userId as UserId;
      let entry;
      try {
        entry = await withAbort(
          options.foodEntryRepository.getById(request.params.id, {
            accessToken: principal.accessToken,
          }),
          AbortSignal.timeout(10_000),
        );
      } catch {
        return { status: "unavailable" };
      }
      if (!entry || entry.userId !== userId)
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Meal not found.",
        );
      const dishName = normalizeMealIllustrationName(entry.name);
      const consentVersion =
        entry.photoAssetId || !dishName || !screenCoachInput(dishName).allowed
          ? null
          : await authorizedVersion(userId, principal.accessToken);
      if (consentVersion === null || !dishName)
        return { status: "unavailable" };
      const key = createHash("sha256")
        .update(`${MEAL_ILLUSTRATION_STYLE}:${dishName}`)
        .digest("hex");
      // Illustrations are Pro-only (a paid plan or an approved pass, as
      // meal_visuals_pro decides), so the paid allowance applies.
      let cost;
      try {
        cost = await options.costLedger?.reserve(
          userId,
          capsForTier("paid"),
          "illustration",
        );
      } catch {
        return { status: "unavailable" };
      }
      if (cost !== undefined && !cost.allowed) return { status: "unavailable" };
      const costReservation = cost?.allowed ? cost.reservation : undefined;
      let claim;
      try {
        claim = await withAbort(
          options.repository!.claim(userId, key, consentVersion, entry.id),
          AbortSignal.timeout(10_000),
        );
      } catch {
        claim = null;
      }
      if (costReservation !== undefined) {
        // A new claim is a charged attempt (never refunded); a cached,
        // limited or failed claim costs nothing.
        await options
          .costLedger!.settle(
            costReservation,
            claim?.kind === "claimed" ? ILLUSTRATION_MICROS : 0,
          )
          .catch(() => undefined);
      }
      if (claim === null) return { status: "unavailable" };
      if (claim.kind === "limited") return { status: "unavailable" };
      if (claim.kind === "existing") {
        // Recheck after any cache/authorization IO so a revocation does not expose ready bytes.
        if (!(await authorized(userId, principal.accessToken)))
          return { status: "unavailable" };
        if (claim.record.state === "ready" && claim.record.image)
          return mealIllustrationResponseSchema.parse({
            status: "ready",
            image: claim.record.image,
          });
        return {
          status:
            claim.record.state === "generating" ? "pending" : "unavailable",
        };
      }
      const id = claim.record.id;
      const controller = new AbortController();
      const work = new Promise<void>((resolve) => {
        // Starts after the 202 response; meal saving has no dependency on this feature.
        setImmediate(() => {
          void (async () => {
            const timer = setTimeout(
              () => controller.abort(),
              options.timeoutMs ?? 40_000,
            );
            try {
              if (
                !(await authorized(
                  userId,
                  principal.accessToken,
                  controller.signal,
                )) ||
                controller.signal.aborted
              )
                throw new Error("Illustration disabled");
              const bytes = await withAbort(
                options.provider!.generate(dishName, controller.signal),
                controller.signal,
              );
              const base64 = await withAbort(
                options.processImage(bytes),
                controller.signal,
              );
              const currentEntry = await withAbort(
                options.foodEntryRepository.getById(entry.id, {
                  accessToken: principal.accessToken,
                }),
                controller.signal,
              );
              if (
                !currentEntry ||
                currentEntry.userId !== userId ||
                currentEntry.photoAssetId ||
                normalizeMealIllustrationName(currentEntry.name) !== dishName ||
                controller.signal.aborted
              )
                throw new Error("Illustration disabled");
              const completeVersion = await authorizedVersion(
                userId,
                principal.accessToken,
                controller.signal,
              );
              if (completeVersion === null)
                throw new Error("Illustration disabled");
              await withAbort(
                options.repository!.complete(
                  userId,
                  id,
                  { base64, key, mimeType: "image/jpeg" },
                  completeVersion,
                ),
                controller.signal,
              );
            } catch {
              // Retain charged attempt for failed/ambiguous calls; never silently retry it.
              await withAbort(
                options.repository!.fail(userId, id),
                AbortSignal.timeout(1_000),
              ).catch(() => undefined);
            } finally {
              clearTimeout(timer);
              jobs.delete(controller);
              resolve();
            }
          })();
        });
      });
      jobs.set(controller, work);
      return reply.code(202).send({ status: "pending" });
    },
  );
};
