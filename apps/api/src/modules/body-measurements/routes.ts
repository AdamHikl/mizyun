import type { FastifyPluginAsync } from "fastify";
import {
  validateBodyMeasurementCreate,
  type BodyMeasurementRepository,
  type BodyMeasurementSource,
  type BodyMeasurementValidationError,
  type StoredBodyMeasurement,
} from "@mizyun/core";
import {
  bodyMeasurementCreateSchema,
  bodyMeasurementListQuerySchema,
  bodyMeasurementListResponseSchema,
  bodyMeasurementResponseSchema,
  type BodyMeasurementListResponse,
  type BodyMeasurementResponse,
} from "@mizyun/contracts";

import { sendApiError } from "../../errors.js";

interface BodyMeasurementsRoutesOptions {
  readonly bodyMeasurementRepository: BodyMeasurementRepository;
}

const GENERIC_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const isoDateToStartOfDay = (iso: string): Date => {
  const parts = iso.split("-").map((part) => Number.parseInt(part, 10));
  const [year, month, day] = parts as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
};

const isoDateToEndOfDay = (iso: string): Date => {
  const parts = iso.split("-").map((part) => Number.parseInt(part, 10));
  const [year, month, day] = parts as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
};

/**
 * Map a domain validation failure to the wire contract. Each
 * `BodyMeasurementValidationError` variant becomes a stable `code`
 * and a human-readable message. The route is the only place this
 * mapping lives.
 */
const validationErrorToApi = (
  error: BodyMeasurementValidationError,
  requestId: string,
): {
  status: number;
  code: "VALIDATION_ERROR";
  message: string;
  requestId: string;
} => {
  switch (error.kind) {
    case "weight_out_of_range":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `weightKg must be between ${error.min} and ${error.max}.`,
        requestId,
      };
    case "measurements_must_be_object":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: "measurements must be a JSON object.",
        requestId,
      };
    case "empty_observation":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: "At least one of weightKg or measurements must be present.",
        requestId,
      };
  }
};

/**
 * Convert a `StoredBodyMeasurement` (`Date` timestamps, branded
 * UserId, default-empty `measurements`) into the wire shape. The
 * shape is parsed through the Zod contract at the producer side
 * so any future drift is caught at the boundary.
 */
const toWire = (m: StoredBodyMeasurement): BodyMeasurementResponse =>
  bodyMeasurementResponseSchema.parse({
    bodyMeasurement: {
      id: m.id,
      userId: m.userId,
      measuredAt: m.measuredAt.toISOString(),
      weightKg: m.weightKg,
      measurements: { ...m.measurements },
      source: m.source,
      createdAt: m.createdAt.toISOString(),
    },
  });

const listToWire = (
  measurements: ReadonlyArray<StoredBodyMeasurement>,
): BodyMeasurementListResponse =>
  bodyMeasurementListResponseSchema.parse({
    bodyMeasurements: measurements.map((m) => toWire(m).bodyMeasurement),
  });

export const bodyMeasurementsRoutes: FastifyPluginAsync<
  BodyMeasurementsRoutesOptions
> = async (app, options) => {
  // GET /v1/body-measurements — return the verified user's
  // measurements, newest-first. `from` and `to` are optional
  // inclusive date filters in `YYYY-MM-DD` (UTC); `limit` caps the
  // page size.
  app.get(
    "/",
    { preHandler: app.authenticate },
    async (request, reply): Promise<BodyMeasurementListResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const parsed = bodyMeasurementListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid body-measurement query: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      const from = parsed.data.from
        ? isoDateToStartOfDay(parsed.data.from)
        : null;
      const to = parsed.data.to ? isoDateToEndOfDay(parsed.data.to) : null;
      const limit = parsed.data.limit ?? DEFAULT_LIMIT;
      const cappedLimit = Math.min(MAX_LIMIT, Math.max(1, limit));
      const measurements = await options.bodyMeasurementRepository.list(
        principal.userId,
        {
          from,
          to,
          limit: cappedLimit,
          accessToken: principal.accessToken,
        },
      );
      return listToWire(measurements);
    },
  );

  // POST /v1/body-measurements — append a new measurement. The
  // route server-generates `id`, `userId`, `source` (always
  // "manual" in v1), and `createdAt`. `measuredAt` defaults to
  // now when omitted.
  app.post(
    "/",
    { preHandler: app.authenticate },
    async (request, reply): Promise<BodyMeasurementResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const body = request.body as unknown;
      const parsed = bodyMeasurementCreateSchema.safeParse(body);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid body-measurement create: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      const measuredAt = parsed.data.measuredAt
        ? new Date(parsed.data.measuredAt)
        : new Date();
      const validation = validateBodyMeasurementCreate({
        ...(parsed.data.weightKg !== undefined
          ? { weightKg: parsed.data.weightKg }
          : {}),
        ...(parsed.data.measurements !== undefined
          ? { measurements: parsed.data.measurements }
          : {}),
      });
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
      const stored: StoredBodyMeasurement = {
        id,
        userId: principal.userId,
        source: "manual" as BodyMeasurementSource,
        measuredAt,
        weightKg: parsed.data.weightKg ?? null,
        measurements: parsed.data.measurements
          ? { ...parsed.data.measurements }
          : {},
        createdAt: now,
      };
      const saved = await options.bodyMeasurementRepository.create(
        principal.userId,
        stored,
        { accessToken: principal.accessToken },
      );
      return toWire(saved);
    },
  );

  // GET /v1/body-measurements/:id — fetch a single measurement
  // by id. The route enforces the ownership check after the
  // repository returns so a missing id is indistinguishable from
  // a wrong owner (no enumeration).
  app.get(
    "/:id",
    { preHandler: app.authenticate },
    async (request, reply): Promise<BodyMeasurementResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const { id } = request.params as { id?: string };
      if (typeof id !== "string" || !GENERIC_UUID.test(id)) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Body measurement id must be a UUID.",
        );
        return;
      }
      const stored = await options.bodyMeasurementRepository.getById(id, {
        accessToken: principal.accessToken,
      });
      if (stored === null || stored.userId !== principal.userId) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "No body measurement with that id exists for this user.",
        );
        return;
      }
      return toWire(stored);
    },
  );

  // DELETE /v1/body-measurements/:id — remove the measurement.
  // Measurements are append-only in normal flow; this is for the
  // data-correctness case where the user records a measurement
  // on the wrong day.
  app.delete(
    "/:id",
    { preHandler: app.authenticate },
    async (request, reply): Promise<void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const { id } = request.params as { id?: string };
      if (typeof id !== "string" || !GENERIC_UUID.test(id)) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Body measurement id must be a UUID.",
        );
        return;
      }
      const stored = await options.bodyMeasurementRepository.getById(id, {
        accessToken: principal.accessToken,
      });
      if (stored === null || stored.userId !== principal.userId) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "No body measurement with that id exists for this user.",
        );
        return;
      }
      await options.bodyMeasurementRepository.delete(id, {
        accessToken: principal.accessToken,
      });
      void reply.status(204).send();
    },
  );
};
