import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  createImportedRunSummary,
  createRunSummary,
  isImportedRunSummary,
  readRunSummary,
  reviseImportedRunSummary,
  runningDate,
  runTimestampEnvelope,
  RunRepositoryError,
  type RunRepository,
  type RunMutationInput,
  type StoredWorkout,
} from "@mizyun/core";
import {
  runCreateSchema,
  runImportSchema,
  runUpdateSchema,
  runListQuerySchema,
  runRecordSchema,
  type RunCreate,
  type RunUpdate,
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
/**
 * Imported runs keep provider facts from the stored row. A client may resend
 * them unchanged (instants compare by time), but any different value is invalid.
 */
const importedEdit = (
  stored: StoredWorkout,
  body: RunUpdate,
): RunMutationInput | null => {
  const summary = readRunSummary(stored.details);
  if (!summary || !isImportedRunSummary(summary)) return null;
  if (
    body.activityDate !== summary.activityDate ||
    body.recordingTimezone !== summary.recordingTimezone ||
    body.startedAt === null ||
    summary.startedAt === null ||
    Date.parse(body.startedAt) !== Date.parse(summary.startedAt) ||
    body.durationSeconds !== summary.durationSeconds ||
    body.distanceMeters !== summary.distanceMeters
  )
    throw new RunRepositoryError("invalid");
  return {
    clientOperationId: body.clientOperationId,
    name: body.name,
    notes: body.notes,
    summary: reviseImportedRunSummary(
      summary,
      {
        environment: body.environment,
        perceivedExertion: body.perceivedExertion,
      },
      body.expectedRevision + 1,
    ),
  };
};
export const runsRoutes: FastifyPluginAsync<{
  runRepository: RunRepository;
  /** Saving new Health imports is Dev-only; existing imported runs stay readable/editable. */
  healthImportsEnabled?: boolean;
}> = async (app, { runRepository: repo, healthImportsEnabled = false }) => {
  const auth = { preHandler: app.authenticate };
  app.get("/", auth, async (request, reply) =>
    handle(request, reply, async () => {
      const parsed = runListQuerySchema.safeParse(request.query);
      if (!parsed.success) throw new RunRepositoryError("invalid");
      const q = parsed.data;
      if (q.cursor && !/^\d{4}-\d{2}-\d{2}:[0-9a-f-]{36}$/i.test(q.cursor))
        throw new RunRepositoryError("invalid");
      const rows = await repo.list(request.principal!.userId, {
        from: q.from,
        to: q.to,
        cursor: q.cursor,
        limit: q.limit + 1,
        accessToken: request.principal!.accessToken,
        includeImports: q.include === "imports",
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
  // One-time copy of a user-selected Health workout; not registered outside Dev.
  if (healthImportsEnabled)
    app.post("/imports", auth, async (request, reply) =>
      handle(request, reply, async () => {
        const parsed = runImportSchema.safeParse(request.body);
        if (!parsed.success) throw new RunRepositoryError("invalid");
        const body = parsed.data;
        let mutation: RunMutationInput;
        try {
          const summary = createImportedRunSummary({
            provider: body.provider,
            sourceAppId: body.sourceAppId,
            sourceAppName: body.sourceAppName,
            externalId: body.externalId,
            startedAt: body.startedAt,
            recordingTimezone: body.recordingTimezone,
            durationSeconds: body.durationSeconds,
            durationBasis: body.durationBasis,
            distanceMeters: body.distanceMeters,
            environment: body.environment,
          });
          if (runTimestampEnvelope(summary).completedAt.getTime() > Date.now())
            throw new RunRepositoryError("invalid");
          mutation = {
            clientOperationId: body.clientOperationId,
            name: "Run",
            notes: null,
            summary,
          };
        } catch {
          throw new RunRepositoryError("invalid");
        }
        const result = await repo.importRun(
          request.principal!.userId,
          mutation,
          { accessToken: request.principal!.accessToken },
        );
        const run = wire(result.workout);
        void reply.code(result.created ? 201 : 200);
        return { run, created: result.created };
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
      const stored = await repo.get(request.principal!.userId, id, {
        accessToken: request.principal!.accessToken,
      });
      let mutation: RunMutationInput;
      try {
        mutation =
          (stored && importedEdit(stored, parsed.data)) ??
          input(parsed.data, parsed.data.expectedRevision + 1);
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
