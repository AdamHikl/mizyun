import type { FastifyPluginAsync } from "fastify";
import {
  applyFoodEntryPatch,
  summariseFoodEntries,
  validateFoodEntryCreate,
  validateFoodEntryPatch,
  type DailyFoodSummary,
  type FoodEntryPatch,
  type FoodEntryRepository,
  type FoodEntryValidationError,
  type FoodSource,
  type StoredFoodEntry,
} from "@mizyun/core";
import {
  dailyFoodSummaryListResponseSchema,
  dailyFoodSummaryResponseSchema,
  foodEntryCreateSchema,
  foodEntryListQuerySchema,
  foodEntryListResponseSchema,
  foodEntryPatchSchema,
  foodEntryResponseSchema,
  foodEntrySummaryQuerySchema,
  type DailyFoodSummaryListResponse,
  type DailyFoodSummaryResponse,
  type FoodEntryListResponse,
  type FoodEntryResponse,
} from "@mizyun/contracts";

import { sendApiError } from "../../errors.js";

interface FoodEntriesRoutesOptions {
  readonly foodEntryRepository: FoodEntryRepository;
}

const GENERIC_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Translate a local ISO date and UTC offset into the inclusive instants the
 * repository expects. Offsets are positive east of UTC.
 */
const isoDateToStartOfDay = (iso: string, utcOffsetMinutes = 0): Date => {
  const parts = iso.split("-").map((part) => Number.parseInt(part, 10));
  // The Zod `isoDateSchema` only accepts `YYYY-MM-DD`, so all three
  // parts are guaranteed to be present and finite. The `as number`
  // strips `| undefined` from `noUncheckedIndexedAccess`.
  const [year, month, day] = parts as [number, number, number];
  return new Date(
    Date.UTC(year, month - 1, day, 0, 0, 0, 0) - utcOffsetMinutes * 60_000,
  );
};

const isoDateToEndOfDay = (iso: string, utcOffsetMinutes = 0): Date =>
  new Date(
    isoDateToStartOfDay(iso, utcOffsetMinutes).getTime() + 86_400_000 - 1,
  );

/**
 * Map a domain validation failure to the wire contract. Each
 * `FoodEntryValidationError` variant becomes a stable `code` and a
 * human-readable message. The route is the only place this mapping
 * lives; new error variants must be added here.
 */
const validationErrorToApi = (
  error: FoodEntryValidationError,
  requestId: string,
): {
  status: number;
  code: "VALIDATION_ERROR";
  message: string;
  requestId: string;
} => {
  switch (error.kind) {
    case "empty_patch":
      return {
        status: 400,
        code: "VALIDATION_ERROR",
        message: "At least one food entry field must be present.",
        requestId,
      };
    case "name_empty":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: "name cannot be blank.",
        requestId,
      };
    case "name_too_long":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `name must be at most ${error.max} characters.`,
        requestId,
      };
    case "calories_out_of_range":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `caloriesKcal must be between ${error.min} and ${error.max}.`,
        requestId,
      };
    case "macro_out_of_range":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `${error.field} must be between ${error.min} and ${error.max}.`,
        requestId,
      };
    case "details_must_be_object":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: "details must be a JSON object.",
        requestId,
      };
  }
};

/**
 * Convert a `StoredFoodEntry` (`Date` timestamps, branded UserId,
 * default-empty `details`) into the wire shape. The shape is parsed
 * through the Zod contract at the producer side so any future drift
 * is caught at the boundary.
 */
const toWire = (entry: StoredFoodEntry): FoodEntryResponse =>
  foodEntryResponseSchema.parse({
    foodEntry: {
      id: entry.id,
      userId: entry.userId,
      name: entry.name,
      consumedAt: entry.consumedAt.toISOString(),
      caloriesKcal: entry.caloriesKcal,
      proteinG: entry.proteinG,
      carbohydrateG: entry.carbohydrateG,
      fatG: entry.fatG,
      source: entry.source,
      confidence: entry.confidence,
      confirmedByUser: entry.confirmedByUser,
      clientOperationId: entry.clientOperationId ?? null,
      details: { ...entry.details },
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    },
  });

const toLocalDateString = (date: Date, utcOffsetMinutes = 0): string => {
  const localMs = date.getTime() + utcOffsetMinutes * 60_000;
  const localDate = new Date(localMs);
  const year = localDate.getUTCFullYear();
  const month = String(localDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(localDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

interface DecodedCursor {
  readonly consumedAt: Date;
  readonly id: string;
}

const encodeCursor = (cursor: { consumedAt: Date; id: string }): string => {
  const payload = {
    c: cursor.consumedAt.toISOString(),
    i: cursor.id,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
};

const decodeCursor = (raw: string): DecodedCursor | null => {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf-8");
    const data = JSON.parse(json) as {
      c?: unknown;
      i?: unknown;
      consumedAt?: unknown;
      id?: unknown;
    };
    const iso =
      typeof data.c === "string"
        ? data.c
        : typeof data.consumedAt === "string"
          ? data.consumedAt
          : null;
    const id =
      typeof data.i === "string"
        ? data.i
        : typeof data.id === "string"
          ? data.id
          : null;
    if (!iso || !id || !GENERIC_UUID.test(id)) return null;
    const consumedAt = new Date(iso);
    if (Number.isNaN(consumedAt.getTime())) return null;
    return { consumedAt, id };
  } catch {
    return null;
  }
};

const listToWire = (
  entries: ReadonlyArray<StoredFoodEntry>,
  nextCursor?: string | null,
  cutoffDateIsPartial?: boolean,
): FoodEntryListResponse => {
  const wire: FoodEntryListResponse = {
    foodEntries: entries.map((e) => toWire(e).foodEntry),
  };
  if (nextCursor) {
    wire.nextCursor = nextCursor;
  }
  if (cutoffDateIsPartial) {
    wire.cutoffDateIsPartial = true;
  }
  return foodEntryListResponseSchema.parse(wire);
};

export const foodEntriesRoutes: FastifyPluginAsync<
  FoodEntriesRoutesOptions
> = async (app, options) => {
  // GET /v1/food-entries — return the verified user's food entries,
  // newest-first. `from` and `to` are optional inclusive date
  // filters in `YYYY-MM-DD` (UTC); `limit` caps the page size;
  // `cursor` allows paginating older entries; `search` matches meal names.
  app.get(
    "/",
    { preHandler: app.authenticate },
    async (request, reply): Promise<FoodEntryListResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const parsed = foodEntryListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid food entry query: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      let decodedCursor: DecodedCursor | null = null;
      if (parsed.data.cursor !== undefined) {
        decodedCursor = decodeCursor(parsed.data.cursor);
        if (decodedCursor === null) {
          await sendApiError(
            reply,
            request,
            422,
            "VALIDATION_ERROR",
            "Invalid cursor format",
          );
          return;
        }
      }
      const from = parsed.data.from
        ? isoDateToStartOfDay(parsed.data.from, parsed.data.utcOffsetMinutes)
        : null;
      const to = parsed.data.to
        ? isoDateToEndOfDay(parsed.data.to, parsed.data.utcOffsetMinutes)
        : null;
      const limit = parsed.data.limit ?? DEFAULT_LIMIT;
      // The Zod schema caps `limit` at MAX_LIMIT; default below.
      const cappedLimit = Math.min(MAX_LIMIT, Math.max(1, limit));
      // Fetch cappedLimit + 1 to check whether another page exists
      const rawEntries = await options.foodEntryRepository.list(
        principal.userId,
        {
          from,
          to,
          limit: cappedLimit + 1,
          cursor: decodedCursor,
          search: parsed.data.search ?? null,
          accessToken: principal.accessToken,
        },
      );

      const hasMore = rawEntries.length > cappedLimit;
      const entries = hasMore ? rawEntries.slice(0, cappedLimit) : rawEntries;
      let nextCursor: string | null = null;
      let cutoffDateIsPartial = false;

      if (hasMore && entries.length > 0) {
        const lastEntry = entries[entries.length - 1]!;
        nextCursor = encodeCursor({
          consumedAt: lastEntry.consumedAt,
          id: lastEntry.id,
        });
        const nextEntry = rawEntries[cappedLimit]!;
        const lastDay = toLocalDateString(
          lastEntry.consumedAt,
          parsed.data.utcOffsetMinutes,
        );
        const nextDay = toLocalDateString(
          nextEntry.consumedAt,
          parsed.data.utcOffsetMinutes,
        );
        cutoffDateIsPartial = lastDay === nextDay;
      }

      return listToWire(entries, nextCursor, cutoffDateIsPartial);
    },
  );

  // POST /v1/food-entries — create a new manual food entry. The
  // route server-generates `id`, `userId`, audit timestamps,
  // `source` (always "manual" in v1), `confirmedByUser` (always
  // true for user-created entries), and `confidence` (always null
  // for manual). `consumedAt` defaults to now when omitted.
  app.post(
    "/",
    { preHandler: app.authenticate },
    async (request, reply): Promise<FoodEntryResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const body = request.body as unknown;
      const parsed = foodEntryCreateSchema.safeParse(body);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid food entry create: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      const consumedAt = parsed.data.consumedAt
        ? new Date(parsed.data.consumedAt)
        : new Date();
      const validation = validateFoodEntryCreate({
        name: parsed.data.name,
        consumedAt,
        ...(parsed.data.caloriesKcal !== undefined
          ? { caloriesKcal: parsed.data.caloriesKcal }
          : {}),
        ...(parsed.data.proteinG !== undefined
          ? { proteinG: parsed.data.proteinG }
          : {}),
        ...(parsed.data.carbohydrateG !== undefined
          ? { carbohydrateG: parsed.data.carbohydrateG }
          : {}),
        ...(parsed.data.fatG !== undefined ? { fatG: parsed.data.fatG } : {}),
        ...(parsed.data.details !== undefined
          ? { details: parsed.data.details }
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

      const clientOpHeader = request.headers["idempotency-key"];
      const clientOperationId =
        parsed.data.clientOperationId ??
        (typeof clientOpHeader === "string" && clientOpHeader.trim().length > 0
          ? clientOpHeader.trim()
          : undefined);

      const canonicalJson = (val: unknown): string => {
        if (val === null || typeof val !== "object") {
          return JSON.stringify(val);
        }
        if (Array.isArray(val)) {
          return "[" + val.map(canonicalJson).join(",") + "]";
        }
        const record = val as Record<string, unknown>;
        const sortedKeys = Object.keys(record).sort();
        const entries: string[] = [];
        for (const key of sortedKeys) {
          if (record[key] !== undefined) {
            entries.push(
              `${JSON.stringify(key)}:${canonicalJson(record[key])}`,
            );
          }
        }
        return "{" + entries.join(",") + "}";
      };

      const matchesCanonicalPayload = (
        existing: StoredFoodEntry,
        incoming: typeof parsed.data,
      ): boolean => {
        if (existing.name.trim() !== incoming.name.trim()) return false;
        if ((existing.caloriesKcal ?? null) !== (incoming.caloriesKcal ?? null))
          return false;
        if ((existing.proteinG ?? null) !== (incoming.proteinG ?? null))
          return false;
        if (
          (existing.carbohydrateG ?? null) !== (incoming.carbohydrateG ?? null)
        )
          return false;
        if ((existing.fatG ?? null) !== (incoming.fatG ?? null)) return false;

        if (incoming.consumedAt !== undefined) {
          const incomingTime = new Date(incoming.consumedAt).getTime();
          const existingTime =
            existing.consumedAt instanceof Date
              ? existing.consumedAt.getTime()
              : new Date(existing.consumedAt).getTime();
          if (isNaN(incomingTime) || incomingTime !== existingTime) {
            return false;
          }
        }

        const existingDetails = existing.details ?? {};
        const incomingDetails = incoming.details ?? {};
        if (canonicalJson(existingDetails) !== canonicalJson(incomingDetails)) {
          return false;
        }

        return true;
      };

      if (
        clientOperationId &&
        options.foodEntryRepository.findByClientOperationId
      ) {
        const existing =
          await options.foodEntryRepository.findByClientOperationId(
            principal.userId,
            clientOperationId,
            { accessToken: principal.accessToken },
          );
        if (existing !== null) {
          if (!matchesCanonicalPayload(existing, parsed.data)) {
            await sendApiError(
              reply,
              request,
              409,
              "CONFLICT",
              "The specified operation ID was already used with a different meal payload.",
            );
            return;
          }
          return toWire(existing);
        }
      }

      const now = new Date();
      const id = crypto.randomUUID();
      const stored: StoredFoodEntry = {
        id,
        userId: principal.userId,
        clientOperationId: clientOperationId ?? null,
        source: "manual" as FoodSource,
        confidence: null,
        confirmedByUser: true,
        name: parsed.data.name,
        consumedAt,
        caloriesKcal: parsed.data.caloriesKcal ?? null,
        proteinG: parsed.data.proteinG ?? null,
        carbohydrateG: parsed.data.carbohydrateG ?? null,
        fatG: parsed.data.fatG ?? null,
        details: parsed.data.details ? { ...parsed.data.details } : {},
        createdAt: now,
        updatedAt: now,
      };
      const saved = await options.foodEntryRepository.create(
        principal.userId,
        stored,
        { accessToken: principal.accessToken },
      );
      if (
        clientOperationId &&
        saved.clientOperationId === clientOperationId &&
        !matchesCanonicalPayload(saved, parsed.data)
      ) {
        await sendApiError(
          reply,
          request,
          409,
          "CONFLICT",
          "The specified operation ID was already used with a different meal payload.",
        );
        return;
      }
      return toWire(saved);
    },
  );

  // GET /v1/food-entries/:id — fetch a single entry by id. The
  // route enforces the ownership check after the repository
  // returns so a missing id is indistinguishable from a wrong
  // owner (no enumeration).
  app.get(
    "/:id",
    { preHandler: app.authenticate },
    async (request, reply): Promise<FoodEntryResponse | void> => {
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
          "Food entry id must be a UUID.",
        );
        return;
      }
      const stored = await options.foodEntryRepository.getById(id, {
        accessToken: principal.accessToken,
      });
      if (stored === null || stored.userId !== principal.userId) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "No food entry with that id exists for this user.",
        );
        return;
      }
      return toWire(stored);
    },
  );

  // PUT /v1/food-entries/:id — partial update. Body is parsed by
  // Zod; domain validation runs after parsing so the rejection
  // reason carries the typed `FoodEntryValidationError` shape,
  // not a Zod issue list.
  app.put(
    "/:id",
    { preHandler: app.authenticate },
    async (request, reply): Promise<FoodEntryResponse | void> => {
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
          "Food entry id must be a UUID.",
        );
        return;
      }
      const body = request.body as unknown;
      const parsed = foodEntryPatchSchema.safeParse(body);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid food entry patch: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      const stored = await options.foodEntryRepository.getById(id, {
        accessToken: principal.accessToken,
      });
      if (stored === null || stored.userId !== principal.userId) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "No food entry with that id exists for this user.",
        );
        return;
      }
      const patch: FoodEntryPatch = {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.consumedAt !== undefined
          ? { consumedAt: new Date(parsed.data.consumedAt) }
          : {}),
        ...(parsed.data.caloriesKcal !== undefined
          ? {
              caloriesKcal:
                parsed.data.caloriesKcal === null
                  ? null
                  : parsed.data.caloriesKcal,
            }
          : {}),
        ...(parsed.data.proteinG !== undefined
          ? {
              proteinG:
                parsed.data.proteinG === null ? null : parsed.data.proteinG,
            }
          : {}),
        ...(parsed.data.carbohydrateG !== undefined
          ? {
              carbohydrateG:
                parsed.data.carbohydrateG === null
                  ? null
                  : parsed.data.carbohydrateG,
            }
          : {}),
        ...(parsed.data.fatG !== undefined
          ? {
              fatG: parsed.data.fatG === null ? null : parsed.data.fatG,
            }
          : {}),
        ...(parsed.data.details !== undefined
          ? { details: parsed.data.details }
          : {}),
      };
      const validation = validateFoodEntryPatch(patch);
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
      const next = applyFoodEntryPatch(stored, patch, new Date());
      const saved = await options.foodEntryRepository.update(next, {
        accessToken: principal.accessToken,
      });
      return toWire(saved);
    },
  );

  // DELETE /v1/food-entries/:id — remove the entry. The route
  // enforces the ownership check before deleting so a missing id
  // is indistinguishable from a wrong owner (no enumeration).
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
          "Food entry id must be a UUID.",
        );
        return;
      }
      const stored = await options.foodEntryRepository.getById(id, {
        accessToken: principal.accessToken,
      });
      if (stored === null || stored.userId !== principal.userId) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "No food entry with that id exists for this user.",
        );
        return;
      }
      await options.foodEntryRepository.delete(id, {
        accessToken: principal.accessToken,
      });
      void reply.status(204).send();
    },
  );

  // GET /v1/food-entries/summary — daily summary aggregation.
  // Two shapes share the route:
  //   - `?date=YYYY-MM-DD` returns a single day's summary object
  //     (`{ summary: { ... } }`). The summary is present even when
  //     the user logged nothing on that day, so the UI can render
  //     a "today" card without special-casing the empty case.
  //   - `?from=YYYY-MM-DD&to=YYYY-MM-DD` returns an array of
  //     per-day summaries (`{ summaries: [{...}, ...] }`) ordered
  //     oldest-first. Days with zero entries are omitted.
  //
  // The route uses the same `list(from, to, limit)` plumbing as the
  // list endpoint so the in-memory and SQL adapters stay aligned.
  app.get(
    "/summary",
    { preHandler: app.authenticate },
    async (
      request,
      reply,
    ): Promise<
      DailyFoodSummaryResponse | DailyFoodSummaryListResponse | void
    > => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const parsed = foodEntrySummaryQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid summary query: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      const DEFAULT_RANGE_LIMIT = 92;
      const MAX_RANGE_LIMIT = 366;
      if (parsed.data.date !== undefined) {
        // Single-day shape: always present, including zero-entry days.
        const from = isoDateToStartOfDay(
          parsed.data.date,
          parsed.data.utcOffsetMinutes,
        );
        const to = isoDateToEndOfDay(
          parsed.data.date,
          parsed.data.utcOffsetMinutes,
        );
        const entries = await options.foodEntryRepository.list(
          principal.userId,
          {
            from,
            to,
            limit: MAX_RANGE_LIMIT,
            accessToken: principal.accessToken,
          },
        );
        const summaries = summariseFoodEntries(entries, {
          from: parsed.data.date,
          to: parsed.data.date,
          ...(parsed.data.utcOffsetMinutes !== undefined
            ? { utcOffsetMinutes: parsed.data.utcOffsetMinutes }
            : {}),
        });
        const empty: DailyFoodSummary = {
          date: parsed.data.date,
          entryCount: 0,
          caloriesKcal: null,
          proteinG: null,
          carbohydrateG: null,
          fatG: null,
        };
        const summary = summaries[0] ?? empty;
        return dailyFoodSummaryResponseSchema.parse({ summary });
      }
      const from = parsed.data.from
        ? isoDateToStartOfDay(parsed.data.from, parsed.data.utcOffsetMinutes)
        : null;
      const to = parsed.data.to
        ? isoDateToEndOfDay(parsed.data.to, parsed.data.utcOffsetMinutes)
        : null;
      const limit = parsed.data.limit ?? DEFAULT_RANGE_LIMIT;
      const cappedLimit = Math.min(MAX_RANGE_LIMIT, Math.max(1, limit));
      const entries = await options.foodEntryRepository.list(principal.userId, {
        from,
        to,
        limit: cappedLimit * 50 /* headroom */,
        accessToken: principal.accessToken,
      });
      // The repo paginates by row count, not by calendar day; we
      // re-slice the resulting summaries by day count after
      // aggregation so a user who logged 50 entries on day 1 doesn't
      // push every subsequent day off the page.
      const summaries = summariseFoodEntries(entries, {
        from: parsed.data.from as string,
        to: parsed.data.to as string,
        ...(parsed.data.utcOffsetMinutes !== undefined
          ? { utcOffsetMinutes: parsed.data.utcOffsetMinutes }
          : {}),
      }).slice(0, cappedLimit);
      return dailyFoodSummaryListResponseSchema.parse({ summaries });
    },
  );
};
