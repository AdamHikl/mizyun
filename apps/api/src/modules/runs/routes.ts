import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  createRunSummary,
  readRunSummary,
  runningDate,
  runTimestampEnvelope,
  RunRepositoryError,
  type RunRepository,
  type RunMutationInput,
  type StoredWorkout,
} from "@mizyun/core";
import {
  runCreateSchema,
  runUpdateSchema,
  runListQuerySchema,
  runRecordSchema,
  type RunCreate,
} from "@mizyun/contracts";
import { sendApiError } from "../../errors.js";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const wire = (row: StoredWorkout) => {
  const parsed = runRecordSchema.safeParse({
    id: row.id,
    userId: row.userId,
    clientOperationId: row.clientOperationId,
    name: row.name,
    notes: row.notes,
    summary: readRunSummary(row.details),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
  if (!parsed.success) throw new RunRepositoryError("unavailable");
  return parsed.data;
};
const input = (body: RunCreate, revision: number): RunMutationInput => {
  const summary = createRunSummary(
    {
      activityDate: body.activityDate,
      recordingTimezone: body.recordingTimezone,
      startedAt: body.startedAt,
      durationSeconds: body.durationSeconds,
      distanceMeters: body.distanceMeters,
      environment: body.environment,
      perceivedExertion: body.perceivedExertion,
    },
    revision,
  );
  const now = new Date();
  if (
    summary.activityDate > runningDate(now, summary.recordingTimezone) ||
    (summary.startedAt !== null &&
      runTimestampEnvelope(summary).completedAt.getTime() > now.getTime())
  )
    throw new RunRepositoryError("invalid");
  return {
    clientOperationId: body.clientOperationId,
    name: body.name,
    notes: body.notes,
    summary,
  };
};
const handle = async <T>(
  request: FastifyRequest,
  reply: FastifyReply,
  action: () => Promise<T>,
): Promise<T | void> => {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof RunRepositoryError)) throw error;
    const status =
      error.kind === "unavailable"
        ? 503
        : error.kind === "not_found"
          ? 404
          : error.kind === "invalid"
            ? 422
            : 409;
    const code =
      status === 503
        ? "SERVICE_UNAVAILABLE"
        : status === 404
          ? "NOT_FOUND"
          : status === 422
            ? "VALIDATION_ERROR"
            : "CONFLICT";
    await sendApiError(
      reply,
      request,
      status,
      code,
      error.kind === "unavailable"
        ? "This run record is unavailable. Retry or export your records for recovery."
        : error.kind === "removed"
          ? "This run was removed. Discard this pending operation."
          : error.kind === "conflict"
            ? "This run changed or the operation was already used. Refresh before editing."
            : error.kind === "invalid"
              ? "Enter a valid completed run and date."
              : "Run was not found.",
    );
  }
};
export const runsRoutes: FastifyPluginAsync<{
  runRepository: RunRepository;
}> = async (app, { runRepository: repo }) => {
  const auth = { preHandler: app.authenticate };
  app.get("/", auth, async (request, reply) =>
    handle(request, reply, async () => {
      const parsed = runListQuerySchema.safeParse(request.query);
      if (!parsed.success) throw new RunRepositoryError("invalid");
      const q = parsed.data;
      if (q.cursor && !/^\d{4}-\d{2}-\d{2}:[0-9a-f-]{36}$/i.test(q.cursor))
        throw new RunRepositoryError("invalid");
      const rows = await repo.list(request.principal!.userId, {
        ...q,
        limit: q.limit + 1,
        accessToken: request.principal!.accessToken,
      });
      const page = rows.slice(0, q.limit).map(wire);
      const last = page.at(-1);
      return {
        runs: page,
        nextCursor:
          rows.length > q.limit && last
            ? `${last.summary.activityDate}:${last.id}`
            : null,
      };
    }),
  );
  app.post("/", auth, async (request, reply) =>
    handle(request, reply, async () => {
      const parsed = runCreateSchema.safeParse(request.body);
      if (!parsed.success) throw new RunRepositoryError("invalid");
      let mutation: RunMutationInput;
      try {
        mutation = input(parsed.data, 1);
      } catch {
        throw new RunRepositoryError("invalid");
      }
      return {
        run: wire(
          await repo.create(request.principal!.userId, mutation, {
            accessToken: request.principal!.accessToken,
          }),
        ),
      };
    }),
  );
  app.get("/:id", auth, async (request, reply) =>
    handle(request, reply, async () => {
      const { id } = request.params as { id: string };
      if (!UUID.test(id)) throw new RunRepositoryError("not_found");
      const row = await repo.get(request.principal!.userId, id, {
        accessToken: request.principal!.accessToken,
      });
      if (!row) throw new RunRepositoryError("not_found");
      return { run: wire(row) };
    }),
  );
  app.put("/:id", auth, async (request, reply) =>
    handle(request, reply, async () => {
      const { id } = request.params as { id: string };
      if (!UUID.test(id)) throw new RunRepositoryError("not_found");
      const parsed = runUpdateSchema.safeParse(request.body);
      if (!parsed.success) throw new RunRepositoryError("invalid");
      let mutation: RunMutationInput;
      try {
        mutation = input(parsed.data, parsed.data.expectedRevision + 1);
      } catch {
        throw new RunRepositoryError("invalid");
      }
      return {
        run: wire(
          await repo.update(
            request.principal!.userId,
            id,
            mutation,
            parsed.data.expectedRevision,
            { accessToken: request.principal!.accessToken },
          ),
        ),
      };
    }),
  );
  app.delete("/operations/:operationId", auth, async (request, reply) =>
    handle(request, reply, async () => {
      const { operationId } = request.params as { operationId: string };
      if (!UUID.test(operationId)) throw new RunRepositoryError("invalid");
      await repo.cancel(request.principal!.userId, operationId, {
        accessToken: request.principal!.accessToken,
      });
      return { removed: true };
    }),
  );
  app.delete("/:id", auth, async (request, reply) =>
    handle(request, reply, async () => {
      const { id } = request.params as { id: string };
      if (!UUID.test(id)) throw new RunRepositoryError("not_found");
      const op = request.headers["idempotency-key"];
      if (op !== undefined && (typeof op !== "string" || !UUID.test(op)))
        throw new RunRepositoryError("invalid");
      await repo.remove(request.principal!.userId, id, {
        accessToken: request.principal!.accessToken,
      });
      return { removed: true };
    }),
  );
};
