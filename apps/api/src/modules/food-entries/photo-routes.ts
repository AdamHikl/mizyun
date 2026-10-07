import type { FastifyPluginAsync } from "fastify";
import { MealPhotoError, type MealPhotoService } from "@mizyun/core";
import {
  mealPhotoUploadSchema,
  mealPhotoResponseSchema,
  mealPhotoReadResponseSchema,
} from "@mizyun/contracts";
import { sendApiError } from "../../errors.js";
export const mealPhotoRoutes: FastifyPluginAsync<{
  enabled: boolean;
  service: MealPhotoService | null;
}> = async (app, options) => {
  const reject = async (
    error: unknown,
    request: Parameters<typeof sendApiError>[1],
    reply: Parameters<typeof sendApiError>[0],
  ) => {
    if (!(error instanceof MealPhotoError)) throw error;
    const status =
      error.kind === "invalid_input"
        ? 422
        : error.kind === "not_found"
          ? 404
          : error.kind === "conflict"
            ? 409
            : 503;
    await sendApiError(
      reply,
      request,
      status,
      status === 422
        ? "VALIDATION_ERROR"
        : status === 409
          ? "CONFLICT"
          : status === 404
            ? "NOT_FOUND"
            : "SERVICE_UNAVAILABLE",
      `Meal photo ${error.kind.replace("_", " ")}.`,
    );
  };
  app.addHook("preHandler", async (request, reply) => {
    if (!options.enabled || !options.service)
      await sendApiError(
        reply,
        request,
        404,
        "NOT_FOUND",
        "Meal photos are unavailable.",
      );
  });
  app.post(
    "/:id/photo",
    { preHandler: app.authenticate, bodyLimit: 360_000 },
    async (request, reply) => {
      const principal = request.principal!;
      const { id } = request.params as { id: string };
      const parsed = mealPhotoUploadSchema.safeParse(request.body);
      if (
        !parsed.success ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          id,
        )
      ) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid meal photo request.",
        );
        return;
      }
      const bytes = Buffer.from(parsed.data.imageBase64, "base64");
      if (
        bytes.length > 256 * 1024 ||
        bytes.toString("base64") !== parsed.data.imageBase64
      ) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid meal photo bytes.",
        );
        return;
      }
      try {
        const photo = await options.service!.save({
          mealId: id,
          userId: principal.userId,
          accessToken: principal.accessToken,
          clientOperationId: parsed.data.clientOperationId,
          bytes,
          width: parsed.data.width,
          height: parsed.data.height,
        });
        return mealPhotoResponseSchema.parse({ photo });
      } catch (error) {
        await reject(error, request, reply);
      }
    },
  );
  app.get(
    "/:id/photo",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal!;
      const { id } = request.params as { id: string };
      if (
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          id,
        )
      ) {
        await sendApiError(reply, request, 404, "NOT_FOUND", "Meal not found.");
        return;
      }
      try {
        const photo = await options.service!.get(id, {
          userId: principal.userId,
          accessToken: principal.accessToken,
        });
        return mealPhotoReadResponseSchema.parse({ photo });
      } catch (error) {
        await reject(error, request, reply);
      }
    },
  );
  app.delete(
    "/:id/photo",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal!;
      const { id } = request.params as { id: string };
      if (
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          id,
        )
      ) {
        await sendApiError(reply, request, 404, "NOT_FOUND", "Meal not found.");
        return;
      }
      try {
        await options.service!.remove(id, {
          userId: principal.userId,
          accessToken: principal.accessToken,
        });
        void reply.status(204).send();
      } catch (error) {
        await reject(error, request, reply);
      }
    },
  );
};
