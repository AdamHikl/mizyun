import type { FastifyPluginAsync } from "fastify";
import {
  validateFeedback,
  type FeedbackRepository,
  type FeedbackValidationError,
  type UserFeedback,
} from "@mizyun/core";
import {
  createFeedbackResponseSchema,
  createFeedbackSchema,
  listFeedbackResponseSchema,
  type CreateFeedbackResponse,
  type ListFeedbackResponse,
} from "@mizyun/contracts";

import { sendApiError } from "../../errors.js";

interface FeedbackRoutesOptions {
  readonly feedbackRepository: FeedbackRepository;
}

const validationErrorToApi = (
  error: FeedbackValidationError,
  requestId: string,
): {
  status: number;
  code: "VALIDATION_ERROR";
  message: string;
  requestId: string;
} => {
  switch (error.kind) {
    case "invalid_category":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `Invalid feedback category: ${error.received}. Must be one of like, dislike, change, bug, general.`,
        requestId,
      };
    case "rating_out_of_range":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `Rating must be an integer between 1 and 5. Received ${error.received}.`,
        requestId,
      };
    case "empty_message":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: "Feedback message cannot be empty.",
        requestId,
      };
    case "message_too_long":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `Feedback message length (${error.length}) exceeds 4000 characters maximum.`,
        requestId,
      };
    case "too_many_attachments":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `Too many attachments (${error.count}). Maximum 3 allowed.`,
        requestId,
      };
  }
};

const toWire = (item: UserFeedback): CreateFeedbackResponse =>
  createFeedbackResponseSchema.parse({
    feedback: {
      id: item.id,
      userId: item.userId,
      category: item.category,
      rating: item.rating,
      message: item.message,
      context: { ...item.context },
      mediaAssetIds: [...item.mediaAssetIds],
      createdAt: item.createdAt.toISOString(),
    },
  });

const listToWire = (items: ReadonlyArray<UserFeedback>): ListFeedbackResponse =>
  listFeedbackResponseSchema.parse({
    feedback: items.map((item) => toWire(item).feedback),
  });

export const feedbackRoutes: FastifyPluginAsync<FeedbackRoutesOptions> = async (
  app,
  options,
) => {
  // POST /v1/feedback — submit user review/feedback
  app.post(
    "/",
    { preHandler: app.authenticate },
    async (request, reply): Promise<CreateFeedbackResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const body = request.body as unknown;
      const parsed = createFeedbackSchema.safeParse(body);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid feedback submission: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      const validation = validateFeedback(parsed.data);
      if (validation !== null) {
        const apiError = validationErrorToApi(validation, request.id);
        await sendApiError(
          reply,
          request,
          apiError.status,
          apiError.code,
          apiError.message,
        );
        return;
      }
      const now = new Date();
      const id = crypto.randomUUID();
      const stored: UserFeedback = {
        id,
        userId: principal.userId,
        category: parsed.data.category,
        rating: parsed.data.rating ?? null,
        message: parsed.data.message,
        context: parsed.data.context ? { ...parsed.data.context } : {},
        mediaAssetIds: parsed.data.mediaAssetIds ?? [],
        createdAt: now,
      };
      const saved = await options.feedbackRepository.create(
        principal.userId,
        stored,
        { accessToken: principal.accessToken },
      );
      void reply.status(201);
      return toWire(saved);
    },
  );

  // GET /v1/feedback — list previous feedback submitted by the authenticated user
  app.get(
    "/",
    { preHandler: app.authenticate },
    async (request, reply): Promise<ListFeedbackResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const items = await options.feedbackRepository.listForUser(
        principal.userId,
        { accessToken: principal.accessToken },
      );
      return listToWire(items);
    },
  );
};
