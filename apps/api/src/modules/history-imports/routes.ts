import { createHash } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  HistoryImportFileError,
  HistoryImportRepositoryError,
  buildHistoryImportPlan,
  chunkHistoryImportPlan,
  historyImportCheckItems,
  parseHistoryFile,
  summarizeHistoryExercises,
  type HistoryImportFileErrorCode,
  type HistoryImportPlanError,
  type HistoryImportRepository,
  type ParsedHistory,
  type StoredHistoryImportBatch,
} from "@mizyun/core";
import {
  HISTORY_IMPORT_BODY_LIMIT,
  historyImportBatchSchema,
  historyImportConfirmRequestSchema,
  historyImportPreviewRequestSchema,
  historyImportPreviewSchema,
  type HistoryImportBatch,
  type HistoryImportPreview,
  type HistoryImportPreviewRequest,
} from "@mizyun/contracts";
import { sendApiError } from "../../errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Issues listed in the preview; `issueCount` carries the total. */
const PREVIEW_ISSUES = 50;

/** A request the route rejects before any repository call. */
class ImportRequestError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const FILE_MESSAGES: Record<HistoryImportFileErrorCode, string> = {
  empty: "This file has no workouts or activities to import.",
  too_large: "This file is too large to import. Export a shorter date range.",
  unknown_format:
    "This file is not a Hevy, Strong or generic workout CSV, or a Strava activities.csv.",
  missing_columns:
    "This file is missing columns the import needs. Export it again from the app.",
  too_many_rows: "This file has too many rows. Export a shorter date range.",
  too_many_records:
    "This file has more than 5,000 workouts or runs. Export a shorter date range.",
  invalid_timezone: "Your phone's time zone could not be used.",
};

const planMessage = (error: HistoryImportPlanError): string => {
  switch (error.kind) {
    case "missing_mapping":
      return `Choose what to do with "${error.sourceName}".`;
    case "unknown_exercise":
      return `"${error.sourceName}" is not in this file. Preview the file again.`;
    case "unknown_catalog":
      return `Pick another exercise for "${error.sourceName}".`;
    case "invalid_custom_name":
      return `Enter a name of up to 120 characters for "${error.sourceName}".`;
    case "custom_name_is_catalog":
      return `"${error.sourceName}" has the name of a library exercise. Pick that exercise instead.`;
  }
};

const parse = (body: HistoryImportPreviewRequest): ParsedHistory => {
  try {
    return parseHistoryFile(
      body.content,
      {
        timezone: body.timezone,
        weightUnit: body.weightUnit,
        distanceUnit: body.distanceUnit,
        now: new Date(),
      },
      body.format,
    );
  } catch (error) {
    if (error instanceof HistoryImportFileError)
      throw new ImportRequestError(FILE_MESSAGES[error.code]);
    throw error;
  }
};

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
};

const wire = (batch: StoredHistoryImportBatch): HistoryImportBatch =>
  historyImportBatchSchema.parse({
    id: batch.id,
    format: batch.format,
    fileName: batch.fileName,
    status: batch.status,
    workoutCount: batch.workoutCount,
    setCount: batch.setCount,
    runCount: batch.runCount,
    duplicateCount: batch.duplicateCount,
    overlapCount: batch.overlapCount,
    firstStartedAt: batch.firstStartedAt?.toISOString() ?? null,
    lastStartedAt: batch.lastStartedAt?.toISOString() ?? null,
    createdAt: batch.createdAt.toISOString(),
    completedAt: batch.completedAt?.toISOString() ?? null,
  });

const handle = async <T>(
  request: FastifyRequest,
  reply: FastifyReply,
  action: () => Promise<T>,
): Promise<T | void> => {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ImportRequestError)
      return sendApiError(
        reply,
        request,
        422,
        "VALIDATION_ERROR",
        error.message,
      );
    if (!(error instanceof HistoryImportRepositoryError)) throw error;
    const status =
      error.kind === "not_found"
        ? 404
        : error.kind === "conflict"
          ? 409
          : error.kind === "invalid"
            ? 422
            : 503;
    await sendApiError(
      reply,
      request,
      status,
      status === 404
        ? "NOT_FOUND"
        : status === 409
          ? "CONFLICT"
          : status === 422
            ? "VALIDATION_ERROR"
            : "SERVICE_UNAVAILABLE",
      error.kind === "not_found"
        ? "This import was not found."
        : error.kind === "conflict"
          ? "This import changed or is already in progress. Preview the file again."
          : error.kind === "invalid"
            ? "Some records in this file could not be saved. Nothing else was changed in this step."
            : "Imports are unavailable. Try again later.",
    );
  }
};

/**
 * History import routes (ADR-0083). Preview and confirm are registered only
 * while imports are enabled; listing and undoing batches stay available.
 */
// Uploads authenticate in `onRequest`, before Fastify reads a body of up to
// 26 MiB, so unauthenticated clients cannot make the API buffer one.
export const historyImportRoutes: FastifyPluginAsync<{
  repository: HistoryImportRepository;
  enabled: boolean;
}> = async (app, { repository: repo, enabled }) => {
  const auth = { preHandler: app.authenticate };
  const owner = (request: FastifyRequest) => request.principal!.userId;
  const token = (request: FastifyRequest) => ({
    accessToken: request.principal!.accessToken,
  });

  if (enabled) {
    app.post(
      "/preview",
      { onRequest: app.authenticate, bodyLimit: HISTORY_IMPORT_BODY_LIMIT },
      async (request, reply) =>
        handle(request, reply, async () => {
          const body = historyImportPreviewRequestSchema.safeParse(
            request.body,
          );
          if (!body.success)
            throw new ImportRequestError("Pick a workout export file.");
          const parsed = parse(body.data);
          const counts = await repo.check(
            owner(request),
            parsed.format,
            historyImportCheckItems(parsed, body.data.timezone),
            token(request),
          );
          const starts = [...parsed.workouts, ...parsed.runs]
            .map((record) => record.startedAt)
            .sort();
          const preview: HistoryImportPreview = {
            format: parsed.format,
            workouts: parsed.workouts.length,
            sets: parsed.workouts.reduce(
              (total, workout) =>
                total +
                workout.exercises.reduce((n, e) => n + e.sets.length, 0),
              0,
            ),
            runs: parsed.runs.length,
            firstStartedAt: starts[0] ?? null,
            lastStartedAt: starts.at(-1) ?? null,
            alreadyImported: counts.existing,
            overlapping: counts.overlapping,
            unitsFromFile: parsed.unitsFromFile,
            exercises: summarizeHistoryExercises(parsed).map((summary) => ({
              sourceName: summary.sourceName,
              setCount: summary.setCount,
              workoutCount: summary.workoutCount,
              trackingMode: summary.trackingMode,
              match: summary.match,
            })),
            issues: parsed.issues.slice(0, PREVIEW_ISSUES).map((issue) => ({
              line: issue.line,
              code: issue.code,
            })),
            issueCount: parsed.issues.length,
            skippedActivities: Object.entries(parsed.skippedActivities)
              .map(([type, count]) => ({ type, count }))
              .sort(
                (a, b) => b.count - a.count || a.type.localeCompare(b.type),
              ),
          };
          return { preview: historyImportPreviewSchema.parse(preview) };
        }),
    );

    app.post(
      "/",
      { onRequest: app.authenticate, bodyLimit: HISTORY_IMPORT_BODY_LIMIT },
      async (request, reply) =>
        handle(request, reply, async () => {
          const body = historyImportConfirmRequestSchema.safeParse(
            request.body,
          );
          if (!body.success)
            throw new ImportRequestError(
              "Preview the file again before importing.",
            );
          const input = body.data;
          const parsed = parse(input);
          const planned = buildHistoryImportPlan(parsed, input.mappings);
          if (!planned.ok)
            throw new ImportRequestError(planMessage(planned.error));
          const { plan } = planned;
          if (plan.workouts.length === 0 && plan.runs.length === 0)
            throw new ImportRequestError(
              "Nothing to import: every exercise was skipped or the file has no records.",
            );
          const digest = createHash("sha256")
            .update(
              canonical({
                content: input.content,
                format: parsed.format,
                timezone: input.timezone,
                weightUnit: input.weightUnit,
                distanceUnit: input.distanceUnit,
                skipOverlaps: input.skipOverlaps,
                mappings: [...input.mappings]
                  .map((m) => ({
                    ...m,
                    sourceName: m.sourceName.toLowerCase(),
                  }))
                  .sort((a, b) => a.sourceName.localeCompare(b.sourceName)),
              }),
            )
            .digest("hex");
          const userId = owner(request);
          let batch = await repo.begin(
            userId,
            {
              batchId: input.batchId,
              format: parsed.format,
              fileName: input.fileName ?? null,
              digest,
            },
            token(request),
          );
          if (batch.status === "complete") return { batch: wire(batch) };
          const ids = await repo.resolveExercises(
            userId,
            batch.id,
            plan.exercises,
            token(request),
          );
          const chunks = chunkHistoryImportPlan(plan);
          // A replay resumes after the chunks a lost response already wrote.
          for (let index = batch.chunksDone; index < chunks.length; index++) {
            const chunk = chunks[index]!;
            await repo.writeChunk(
              userId,
              batch.id,
              {
                index,
                timezone: input.timezone,
                skipOverlaps: input.skipOverlaps,
                workouts: chunk.workouts.map((workout) => ({
                  key: workout.key,
                  name: workout.name,
                  startedAt: workout.startedAt,
                  completedAt: workout.completedAt,
                  notes: workout.notes,
                  sets: workout.sets.map(({ exerciseKey, ...set }) => {
                    const exerciseId = ids.get(exerciseKey);
                    if (!exerciseId)
                      throw new HistoryImportRepositoryError("unavailable");
                    return { ...set, exerciseId };
                  }),
                })),
                runs: chunk.runs,
              },
              token(request),
            );
          }
          batch = await repo.finish(
            userId,
            batch.id,
            chunks.length,
            token(request),
          );
          return { batch: wire(batch) };
        }),
    );
  }

  app.get("/", auth, async (request, reply) =>
    handle(request, reply, async () => ({
      batches: (await repo.list(owner(request), token(request))).map(wire),
    })),
  );

  app.delete<{ Params: { id: string } }>("/:id", auth, async (request, reply) =>
    handle(request, reply, async () => {
      if (!UUID.test(request.params.id))
        throw new HistoryImportRepositoryError("not_found");
      const removed = await repo.remove(
        owner(request),
        request.params.id,
        token(request),
      );
      return { removed: true as const, ...removed };
    }),
  );
};
