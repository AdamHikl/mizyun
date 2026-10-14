import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  mealRecipeSuggestionRequestSchema,
  recipeRequestIdSchema,
  mealRecipeCapabilitiesSchema,
  mealRecipeRevalidationRequestSchema,
} from "@mizyun/contracts";
import type { UserId } from "@mizyun/core";
import {
  normalizeIngredientImage,
  IngredientImageError,
} from "@mizyun/adapter-image-processing";
import { sendApiError } from "../../errors.js";
import { MealRecipeSessionService } from "./session-service.js";
import {
  MealRecipeService,
  RecipeServiceError,
  type RecipeServiceOptions,
} from "./service.js";
interface Options extends RecipeServiceOptions {}
export const mealRecipeRoutes: FastifyPluginAsync<Options> = async (
  app,
  options,
) => {
  const service = new MealRecipeService(options);
  const sessionService = new MealRecipeSessionService(options);
  const failure = async (
    reply: FastifyReply,
    request: FastifyRequest,
    error: unknown,
  ) => {
    if (error instanceof RecipeServiceError)
      return sendApiError(
        reply,
        request,
        error.statusCode,
        error.code,
        error.message,
      );
    if (error instanceof IngredientImageError)
      return sendApiError(
        reply,
        request,
        400,
        "INVALID_RECIPE_IMAGE",
        "Use a valid, single-frame JPEG, PNG or WebP image within the displayed limits.",
      );
    return sendApiError(
      reply,
      request,
      503,
      "RECIPE_REQUEST_UNAVAILABLE",
      "The recipe request is unavailable. Use a new request when available.",
    );
  };
  app.get(
    "/session-context",
    { preHandler: app.authenticate },
    async (request, reply) => {
      try {
        const principal = request.principal!;
        return await sessionService.context(
          principal.userId as UserId,
          principal.accessToken,
        );
      } catch (error) {
        return failure(reply, request, error);
      }
    },
  );
  app.post(
    "/revalidate",
    { preHandler: app.authenticate, bodyLimit: 32_768 },
    async (request, reply) => {
      const parsed = mealRecipeRevalidationRequestSchema.safeParse(
        request.body,
      );
      if (!parsed.success)
        return sendApiError(
          reply,
          request,
          400,
          "INVALID_RECIPE_REQUEST",
          "Review the recipe session and confirmed ingredients.",
        );
      try {
        const principal = request.principal!;
        return await sessionService.revalidate(
          principal.userId as UserId,
          principal.accessToken,
          parsed.data,
        );
      } catch (error) {
        return failure(reply, request, error);
      }
    },
  );
  app.get(
    "/capabilities",
    { preHandler: app.authenticate },
    async (request, reply) => {
      try {
        const principal = request.principal!;
        return mealRecipeCapabilitiesSchema.parse(
          await service.readiness(
            principal.userId as UserId,
            principal.accessToken,
          ),
        );
      } catch (error) {
        return failure(reply, request, error);
      }
    },
  );
  app.post(
    "/suggest",
    { preHandler: app.authenticate, bodyLimit: 32_768 },
    async (request, reply) => {
      const parsed = mealRecipeSuggestionRequestSchema.safeParse(request.body);
      if (!parsed.success)
        return sendApiError(
          reply,
          request,
          400,
          "INVALID_RECIPE_REQUEST",
          "Review the ingredients, servings and request identifier.",
        );
      try {
        const principal = request.principal!;
        return await service.suggest(
          principal.userId as UserId,
          principal.accessToken,
          parsed.data,
        );
      } catch (error) {
        return failure(reply, request, error);
      }
    },
  );
  app.post(
    "/recognize-ingredients",
    { preHandler: app.authenticate, bodyLimit: 4_194_304 + 65_536 },
    async (request, reply) => {
      const principal = request.principal!;
      try {
        const profile = await service.requireReady(
          principal.userId as UserId,
          principal.accessToken,
          "recognize",
        );
        if (!request.isMultipart())
          throw new RecipeServiceError(400, "INVALID_RECIPE_IMAGE_REQUEST");
        const maximumImages = await service.maximumImages(
          principal.userId as UserId,
          principal.accessToken,
          profile,
        );
        const images: Awaited<ReturnType<typeof normalizeIngredientImage>>[] =
          [];
        let requestId: string | undefined,
          bytesRead = 0;
        for await (const part of request.parts({
          limits: {
            files: maximumImages,
            fields: 1,
            parts: maximumImages + 1,
            fileSize: 4_194_304,
            fieldSize: 100,
          },
        })) {
          if (part.type === "field") {
            if (
              part.fieldname !== "requestId" ||
              requestId !== undefined ||
              typeof part.value !== "string"
            )
              throw new RecipeServiceError(400, "INVALID_RECIPE_IMAGE_REQUEST");
            const parsedId = recipeRequestIdSchema.safeParse(part.value);
            if (!parsedId.success)
              throw new RecipeServiceError(400, "INVALID_RECIPE_IMAGE_REQUEST");
            requestId = parsedId.data;
          } else {
            if (part.fieldname !== "images")
              throw new RecipeServiceError(400, "INVALID_RECIPE_IMAGE_REQUEST");
            const bytes = await part.toBuffer();
            bytesRead += bytes.byteLength;
            if (bytesRead > 4_194_304 || part.file.truncated)
              throw new RecipeServiceError(413, "RECIPE_IMAGE_LIMIT");
            images.push(await normalizeIngredientImage(bytes, part.mimetype));
          }
        }
        if (!requestId || !images.length)
          throw new RecipeServiceError(400, "INVALID_RECIPE_IMAGE_REQUEST");
        return await service.recognize(
          principal.userId as UserId,
          principal.accessToken,
          requestId,
          images,
        );
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? error.code
            : null;
        if (
          [
            "FST_REQ_FILE_TOO_LARGE",
            "FST_FILES_LIMIT",
            "FST_FIELDS_LIMIT",
            "FST_PARTS_LIMIT",
          ].includes(String(code))
        )
          return failure(
            reply,
            request,
            new RecipeServiceError(413, "RECIPE_IMAGE_LIMIT"),
          );
        return failure(reply, request, error);
      }
    },
  );
};
