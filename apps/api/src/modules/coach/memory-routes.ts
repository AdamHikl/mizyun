/**
 * MEM-001 — User-facing Coach memory controls.
 *
 * Exposes the durable `MemoryStore` (ADR-0017 §"Memory invariants")
 * to the mobile app so users can review, edit, and delete the
 * memories the runtime has remembered about them. The endpoints
 * run `screenCoachInput` on user-edited text fields to defend
 * against prompt injection via the controls API.
 *
 * Candidate creation is explicit and user-controlled. Candidates
 * never enter recall until the user promotes them to active.
 */

import type { FastifyPluginAsync } from "fastify";
import { screenCoachInput } from "@mizyun/agent-runtime";
import type { MemoryId, UserId } from "@mizyun/core";
import {
  MemoryNotFoundError,
  MemoryStore,
  MemoryValidationError,
} from "@mizyun/memory";
import {
  coachMemoryListResponseSchema,
  coachMemoryCreateSchema,
  coachMemoryPatchSchema,
  coachMemoryResponseSchema,
  type CoachMemory,
  type CoachMemorySummary,
} from "@mizyun/contracts";

import { sendApiError } from "../../errors.js";

interface MemoryRoutesOptions {
  readonly memoryStore: MemoryStore;
}

const principalOrThrow = (): never => {
  throw new Error("principal missing after authentication");
};

const toWire = (memory: {
  readonly id: MemoryId;
  readonly kind: string;
  readonly source: string;
  readonly status: string;
  readonly confidence: number;
  readonly importance: number;
  readonly content: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly expiresAt?: Date;
}): CoachMemory => ({
  id: memory.id as unknown as string,
  kind: memory.kind as never,
  source: memory.source,
  status: memory.status as never,
  confidence: memory.confidence,
  importance: memory.importance,
  content: memory.content,
  metadata: { ...memory.metadata },
  createdAt: memory.createdAt.toISOString(),
  updatedAt: memory.updatedAt.toISOString(),
  expiresAt: memory.expiresAt?.toISOString() ?? null,
});

const toSummary = (
  memory: Parameters<typeof toWire>[0],
): CoachMemorySummary => ({
  id: memory.id as unknown as string,
  kind: memory.kind as never,
  source: memory.source,
  status: memory.status as never,
  confidence: memory.confidence,
  importance: memory.importance,
  preview:
    memory.content.length > 280
      ? `${memory.content.slice(0, 277)}…`
      : memory.content,
  updatedAt: memory.updatedAt.toISOString(),
  expiresAt: memory.expiresAt?.toISOString() ?? null,
});

const parseMemoryId = (raw: string): MemoryId => {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
  ) {
    throw new MemoryNotFoundError(raw as MemoryId);
  }
  return raw as MemoryId;
};

export const coachMemoryRoutes: FastifyPluginAsync<
  MemoryRoutesOptions
> = async (app, options) => {
  app.post(
    "/memories",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal ?? principalOrThrow();
      const parsed = coachMemoryCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "The memory candidate is invalid.",
        );
      }
      const safety = screenCoachInput(parsed.data.content);
      if (!safety.allowed) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "The memory content is not allowed.",
        );
      }
      const now = new Date();
      const memory = await options.memoryStore.save(
        {
          id: crypto.randomUUID() as MemoryId,
          userId: principal.userId as UserId,
          kind: parsed.data.kind,
          content: parsed.data.content,
          source: "user",
          confidence: 1,
          importance: parsed.data.importance,
          status: parsed.data.status,
          ...(parsed.data.expiresAt
            ? { expiresAt: new Date(parsed.data.expiresAt) }
            : {}),
          metadata: {
            createdBy: "user",
            createdFrom: "memory_controls",
            candidateCreatedAt: now.toISOString(),
          },
        },
        { accessToken: principal.accessToken },
      );
      return reply
        .status(201)
        .send(coachMemoryResponseSchema.parse({ memory: toWire(memory) }));
    },
  );

  app.get(
    "/memories",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal ?? principalOrThrow();
      const query = request.query as {
        readonly includeSuperseded?: string | undefined;
        readonly limit?: string | undefined;
      };
      const includeSuperseded = query.includeSuperseded === "true";
      const limit = (() => {
        if (query.limit === undefined) return undefined;
        const parsed = Number.parseInt(query.limit, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
        return parsed;
      })();
      const memories = await options.memoryStore.list(
        principal.userId as UserId,
        {
          accessToken: principal.accessToken,
          includeSuperseded,
          ...(limit === undefined ? {} : { limit }),
        },
      );
      return reply.status(200).send(
        coachMemoryListResponseSchema.parse({
          memories: memories.map(toSummary),
        }),
      );
    },
  );

  app.get(
    "/memories/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal ?? principalOrThrow();
      const id = parseMemoryId((request.params as { readonly id: string }).id);
      const memory = await options.memoryStore.get(
        principal.userId as UserId,
        id,
        { accessToken: principal.accessToken },
      );
      if (memory === null) {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Memory not found.",
        );
      }
      return reply
        .status(200)
        .send(coachMemoryResponseSchema.parse({ memory: toWire(memory) }));
    },
  );

  app.patch(
    "/memories/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal ?? principalOrThrow();
      const id = parseMemoryId((request.params as { readonly id: string }).id);
      const parsed = coachMemoryPatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "The memory patch is invalid.",
        );
      }
      const parsed_patch = parsed.data;
      const patch = {
        ...(parsed_patch.content !== undefined
          ? { content: parsed_patch.content }
          : {}),
        ...(parsed_patch.confidence !== undefined
          ? { confidence: parsed_patch.confidence }
          : {}),
        ...(parsed_patch.importance !== undefined
          ? { importance: parsed_patch.importance }
          : {}),
        ...(parsed_patch.status !== undefined
          ? { status: parsed_patch.status }
          : {}),
        ...(parsed_patch.expiresAt !== undefined
          ? {
              expiresAt:
                parsed_patch.expiresAt === null
                  ? null
                  : new Date(parsed_patch.expiresAt),
            }
          : {}),
      };
      if (parsed_patch.content !== undefined) {
        const safety = screenCoachInput(parsed_patch.content);
        if (!safety.allowed) {
          return sendApiError(
            reply,
            request,
            422,
            "VALIDATION_ERROR",
            "The memory content is not allowed.",
          );
        }
      }
      try {
        const current = await options.memoryStore.get(
          principal.userId as UserId,
          id,
          { accessToken: principal.accessToken },
        );
        if (current === null) {
          return sendApiError(
            reply,
            request,
            404,
            "NOT_FOUND",
            "Memory not found.",
          );
        }
        const correctionHistory = Array.isArray(
          current.metadata.correctionHistory,
        )
          ? current.metadata.correctionHistory.slice(-9)
          : [];
        const patchWithProvenance =
          parsed_patch.content !== undefined &&
          parsed_patch.content !== current.content
            ? {
                ...patch,
                metadata: {
                  ...current.metadata,
                  correctionHistory: [
                    ...correctionHistory,
                    {
                      content: current.content,
                      correctedAt: new Date().toISOString(),
                    },
                  ],
                  lastCorrectedBy: "user",
                },
              }
            : patch;
        const memory = await options.memoryStore.update(
          principal.userId as UserId,
          id,
          {
            accessToken: principal.accessToken,
            patch: patchWithProvenance,
          },
        );
        return reply
          .status(200)
          .send(coachMemoryResponseSchema.parse({ memory: toWire(memory) }));
      } catch (error) {
        if (error instanceof MemoryNotFoundError) {
          return sendApiError(
            reply,
            request,
            404,
            "NOT_FOUND",
            "Memory not found.",
          );
        }
        if (error instanceof MemoryValidationError) {
          return sendApiError(
            reply,
            request,
            422,
            "VALIDATION_ERROR",
            error.message,
          );
        }
        throw error;
      }
    },
  );

  app.delete(
    "/memories/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal ?? principalOrThrow();
      const id = parseMemoryId((request.params as { readonly id: string }).id);
      const removed = await options.memoryStore.delete(
        principal.userId as UserId,
        id,
        { accessToken: principal.accessToken },
      );
      if (!removed) {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Memory not found.",
        );
      }
      return reply.status(204).send();
    },
  );
};
