import type { UserId } from "./index";

/**
 * Food entry domain types and validation rules (NUT-001).
 *
 * Pure: no database, no transport, no SDK. The wire schema lives in
 * `@mizyun/contracts`; this module owns the bounded numeric rules,
 * the source enum, and the repository port that adapters implement.
 *
 * The shape mirrors `public.food_entries`:
 *   - `consumedAt` is a `Date` representing the moment of
 *     consumption. Stored UTC. The route layer maps the wire ISO
 *     string onto `Date` on entry and back on exit.
 *   - Macros and calories are nullable: users routinely record "I ate
 *     a sandwich" without knowing the macros. The validator accepts
 *     `null` (= omitted) but never a negative number.
 *   - `source` is closed; only `"manual"` exists today. The route
 *     hard-codes it on create and the patch ignores it (a user can't
 *     change the provenance of their own entry).
 *   - `details` is an open `Record<string, unknown>` reserved for the
 *     future AI path. The validator does not inspect its contents.
 */

export type FoodSource = "manual";

/** Bounded macro range. Mirrors `numeric(8, 2)` and rejects negatives. */
export const MACRO_MIN = 0;
export const MACRO_MAX = 10_000;

/** Bounded calories range. Mirrors `numeric(8, 2)` and rejects negatives. */
export const CALORIES_MIN = 0;
export const CALORIES_MAX = 20_000;

/** Bounded name length. Long enough for "2 scrambled eggs on rye toast". */
export const FOOD_NAME_MAX = 200;

/**
 * Editable domain shape. The wire schema in `@mizyun/contracts` adds
 * `id`, `userId`, audit timestamps, and `confirmedByUser`. This
 * type is the editable subset the route accepts and returns.
 */
export interface FoodEntryCore {
  readonly name: string;
  readonly consumedAt: Date;
  readonly caloriesKcal: number | null;
  readonly proteinG: number | null;
  readonly carbohydrateG: number | null;
  readonly fatG: number | null;
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * Full stored food entry, including the user id, the source (always
 * `"manual"` in v1), the AI confidence (nullable for manual), the
 * user-confirmation flag, and the audit timestamps. The API layer
 * maps `FoodEntryCore` to this when reading from the repository.
 */
export interface StoredFoodEntry extends FoodEntryCore {
  readonly id: string;
  readonly userId: UserId;
  readonly clientOperationId?: string | null | undefined;
  readonly source: FoodSource;
  readonly confidence: number | null;
  readonly confirmedByUser: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Patch shape for `PUT /v1/food-entries/:id`. Every field is
 * optional. Setting a macro field to `null` clears it. `details`
 * accepts a fresh open shape, replacing (not merging) the stored
 * record — merging detail maps is a future concern.
 *
 * The `| undefined` per-field is required because the wire schema
 * (`foodEntryPatchSchema` in `@mizyun/contracts`) uses Zod's
 * `.optional()`, which produces `T | undefined` under
 * `exactOptionalPropertyTypes: true`.
 */
export type FoodEntryPatch = {
  readonly name?: string | undefined;
  readonly consumedAt?: Date | undefined;
  readonly caloriesKcal?: number | null | undefined;
  readonly proteinG?: number | null | undefined;
  readonly carbohydrateG?: number | null | undefined;
  readonly fatG?: number | null | undefined;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
};

/**
 * Why-not-valid reasons for a food entry create or patch. The
 * discriminated union keeps the rejection reason machine-checkable
 * at the route layer (which translates it into the `apiErrorSchema`
 * `code`).
 */
export type FoodEntryValidationError =
  | { readonly kind: "empty_patch" }
  | {
      readonly kind: "name_empty";
    }
  | {
      readonly kind: "name_too_long";
      readonly max: number;
    }
  | {
      readonly kind: "calories_out_of_range";
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly kind: "macro_out_of_range";
      readonly field: "proteinG" | "carbohydrateG" | "fatG";
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly kind: "details_must_be_object";
    };

const isBlank = (value: string): boolean => value.trim().length === 0;

/**
 * Validate a single macro field. Returns the failure reason or
 * `null` when the value passes.
 */
const validateMacro = (
  field: "proteinG" | "carbohydrateG" | "fatG",
  value: number | null | undefined,
): FoodEntryValidationError | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return {
      kind: "macro_out_of_range",
      field,
      min: MACRO_MIN,
      max: MACRO_MAX,
    };
  }
  if (value < MACRO_MIN || value > MACRO_MAX) {
    return {
      kind: "macro_out_of_range",
      field,
      min: MACRO_MIN,
      max: MACRO_MAX,
    };
  }
  return null;
};

const validateCalories = (
  value: number | null | undefined,
): FoodEntryValidationError | null => {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < CALORIES_MIN ||
    value > CALORIES_MAX
  ) {
    return {
      kind: "calories_out_of_range",
      min: CALORIES_MIN,
      max: CALORIES_MAX,
    };
  }
  return null;
};

const validateName = (value: string): FoodEntryValidationError | null => {
  if (isBlank(value)) return { kind: "name_empty" };
  if (value.length > FOOD_NAME_MAX) {
    return { kind: "name_too_long", max: FOOD_NAME_MAX };
  }
  return null;
};

const validateDetails = (
  value: Readonly<Record<string, unknown>> | undefined,
): FoodEntryValidationError | null => {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { kind: "details_must_be_object" };
  }
  return null;
};

/**
 * Validate a create body. `consumedAt` is required; everything else
 * is optional. The route supplies `consumedAt = new Date()` when the
 * client omitted it.
 */
export const validateFoodEntryCreate = (create: {
  readonly name: string;
  readonly consumedAt: Date;
  readonly caloriesKcal?: number | null;
  readonly proteinG?: number | null;
  readonly carbohydrateG?: number | null;
  readonly fatG?: number | null;
  readonly details?: Readonly<Record<string, unknown>>;
}): FoodEntryValidationError | null => {
  const e0 = validateName(create.name);
  if (e0 !== null) return e0;
  if (
    !(create.consumedAt instanceof Date) ||
    Number.isNaN(create.consumedAt.getTime())
  ) {
    // The wire Zod schema already enforces ISO 8601, so this branch
    // should be unreachable. We defend against it because the route
    // passes a `Date` constructed from the wire value.
    return { kind: "name_empty" }; // surfaced as a generic 422
  }
  const e1 = validateCalories(create.caloriesKcal);
  if (e1 !== null) return e1;
  const e2 = validateMacro("proteinG", create.proteinG);
  if (e2 !== null) return e2;
  const e3 = validateMacro("carbohydrateG", create.carbohydrateG);
  if (e3 !== null) return e3;
  const e4 = validateMacro("fatG", create.fatG);
  if (e4 !== null) return e4;
  const e5 = validateDetails(create.details);
  if (e5 !== null) return e5;
  return null;
};

/**
 * Validate a patch body. Empty patches are rejected because they
 * have no effect.
 */
export const validateFoodEntryPatch = (
  patch: FoodEntryPatch,
): FoodEntryValidationError | null => {
  const touched =
    patch.name !== undefined ||
    patch.consumedAt !== undefined ||
    patch.caloriesKcal !== undefined ||
    patch.proteinG !== undefined ||
    patch.carbohydrateG !== undefined ||
    patch.fatG !== undefined ||
    patch.details !== undefined;
  if (!touched) return { kind: "empty_patch" };

  if (patch.name !== undefined) {
    const e = validateName(patch.name);
    if (e !== null) return e;
  }
  if (patch.consumedAt !== undefined) {
    if (
      !(patch.consumedAt instanceof Date) ||
      Number.isNaN(patch.consumedAt.getTime())
    ) {
      return { kind: "name_empty" };
    }
  }
  const e1 = validateCalories(patch.caloriesKcal);
  if (e1 !== null) return e1;
  const e2 = validateMacro("proteinG", patch.proteinG);
  if (e2 !== null) return e2;
  const e3 = validateMacro("carbohydrateG", patch.carbohydrateG);
  if (e3 !== null) return e3;
  const e4 = validateMacro("fatG", patch.fatG);
  if (e4 !== null) return e4;
  const e5 = validateDetails(patch.details);
  if (e5 !== null) return e5;
  return null;
};

/**
 * Apply a validated patch to a stored food entry. Returns the new
 * stored shape with `updatedAt` advanced. Assumes the patch has
 * already passed `validateFoodEntryPatch`; if it has not, the result
 * is undefined behaviour and the route layer is responsible for
 * rejecting it.
 */
export const applyFoodEntryPatch = (
  stored: StoredFoodEntry,
  patch: FoodEntryPatch,
  now: Date,
): StoredFoodEntry => ({
  id: stored.id,
  userId: stored.userId,
  source: stored.source,
  confidence: stored.confidence,
  confirmedByUser: stored.confirmedByUser,
  name: patch.name === undefined ? stored.name : patch.name,
  consumedAt:
    patch.consumedAt === undefined ? stored.consumedAt : patch.consumedAt,
  caloriesKcal:
    patch.caloriesKcal === undefined ? stored.caloriesKcal : patch.caloriesKcal,
  proteinG: patch.proteinG === undefined ? stored.proteinG : patch.proteinG,
  carbohydrateG:
    patch.carbohydrateG === undefined
      ? stored.carbohydrateG
      : patch.carbohydrateG,
  fatG: patch.fatG === undefined ? stored.fatG : patch.fatG,
  details: patch.details === undefined ? stored.details : { ...patch.details },
  createdAt: stored.createdAt,
  updatedAt: now,
});

/**
 * Repository port. The Supabase adapter implements this against the
 * `public.food_entries` table; tests implement it with an in-memory
 * array. Range queries take inclusive bounds on `consumedAt`. When
 * a bound is missing, the repository uses a sentinel: `from` defaults
 * to the epoch, `to` defaults to "now".
 */
export interface FoodEntryRepository {
  /**
   * `accessToken` is the verified principal's bearer token. The
   * in-memory adapter ignores it; the Supabase adapter uses it
   * to construct a per-request client bound to the user's RLS
   * session. PERSIST-001.
   */
  /**
   * Insert a new food entry. The repository assigns the audit
   * timestamps and any server-generated fields before returning the
   * stored shape. (In the in-memory implementation the route
   * constructs them; in the SQL implementation a default + trigger
   * would handle it. Both honour the contract: the route passes a
   * `StoredFoodEntry` with all fields filled in.)
   */
  create(
    userId: UserId,
    entry: StoredFoodEntry,
    options: { readonly accessToken: string },
  ): Promise<StoredFoodEntry>;
  /**
   * Return the most-recent entries for a user, optionally bounded
   * by `from`/`to`. Newest-first. `limit` caps the page size;
   * adapters that page in SQL may ignore very large limits and
   * surface them, but the in-memory implementation enforces
   * `limit` exactly. When both bounds are omitted the repository
   * returns the user's most-recent entries up to `limit`.
   */
  list(
    userId: UserId,
    options: {
      readonly from: Date | null;
      readonly to: Date | null;
      readonly limit: number;
      readonly cursor?: {
        readonly consumedAt: Date;
        readonly id: string;
      } | null;
      readonly search?: string | null;
      readonly accessToken: string;
    },
  ): Promise<ReadonlyArray<StoredFoodEntry>>;
  /**
   * Return the stored entry by id, or `null` when no entry exists
   * with that id for any user. The route is responsible for the
   * ownership check (it filters on `userId` after the call).
   */
  getById(
    id: string,
    options: { readonly accessToken: string },
  ): Promise<StoredFoodEntry | null>;
  /**
   * Apply a patch to an existing food entry. Returns the new stored
   * shape. Throws if the entry id does not exist.
   */
  update(
    entry: StoredFoodEntry,
    options: { readonly accessToken: string },
  ): Promise<StoredFoodEntry>;
  /**
   * Permanently remove a food entry. Returns `true` when the entry
   * existed and was removed, `false` otherwise. The route is the
   * owner of the 404 decision (no idempotency-200 on miss).
   */
  delete(
    id: string,
    options: { readonly accessToken: string },
  ): Promise<boolean>;
  /**
   * Return a stored entry for a user matching the given clientOperationId,
   * or `null` if none exists. Used for idempotent retry deduplication (REL-AUD-007).
   */
  findByClientOperationId?(
    userId: UserId,
    clientOperationId: string,
    options: { readonly accessToken: string },
  ): Promise<StoredFoodEntry | null>;
}

/**
 * A `DailyFoodSummary` is the read-model aggregate for one calendar
 * day in UTC: the sum of calories and macros for every entry the
 * user recorded on that day, plus the entry count.
 *
 * The sums are nullable: when **any** entry on the day has `null`
 * for a numeric field, the field's daily total is also `null`. This
 * is intentional. A user who records "I ate a sandwich" without
 * macros shouldn't see their daily protein total magically read
 * `0g` — that would silently misinform. `null` propagates the
 * "unknown" state to the UI, which can then prompt the user to
 * backfill.
 *
 * All numeric values are rounded to two decimal places, mirroring
 * `numeric(8, 2)` so the wire value matches the eventual SQL column
 * precision.
 */
export interface DailyFoodSummary {
  readonly date: string;
  readonly entryCount: number;
  readonly caloriesKcal: number | null;
  readonly proteinG: number | null;
  readonly carbohydrateG: number | null;
  readonly fatG: number | null;
}

const roundTo2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Convert an entry's UTC instant to the requested local calendar day.
 * The offset is positive east of UTC; shifting the instant before reading
 * UTC fields keeps this calculation deterministic and timezone-library free.
 */
const isoDateOf = (instant: Date, utcOffsetMinutes: number): string => {
  const shifted = new Date(instant.getTime() + utcOffsetMinutes * 60_000);
  const y = shifted.getUTCFullYear();
  const m = (shifted.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = shifted.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
};

/**
 * Sum a list of nullable numeric values. Returns `null` when the
 * list is empty OR when any value is `null`; otherwise the rounded
 * sum. The "all-null means null" rule matches the documented
 * behaviour of `DailyFoodSummary`.
 */
const sumNullable = (values: ReadonlyArray<number | null>): number | null => {
  let total = 0;
  for (const v of values) {
    if (v === null) return null;
    total += v;
  }
  return roundTo2(total);
};

/**
 * Aggregate a list of stored entries into the daily summaries for
 * the inclusive `[from, to]` range. Days with zero entries are NOT
 * included — the route can synthesize them if the UI wants a dense
 * series, but for v1 the natural shape is "days the user logged on".
 *
 * The aggregator is pure: same inputs produce same outputs. It does
 * not read clocks; the route is the only place that constructs
 * `Date.now()`.
 *
 * Returns an array ordered oldest-first so the UI can render a
 * chronological bar chart without re-sorting.
 */
export const summariseFoodEntries = (
  entries: ReadonlyArray<StoredFoodEntry>,
  options: {
    readonly from: string;
    readonly to: string;
    readonly utcOffsetMinutes?: number;
  },
): ReadonlyArray<DailyFoodSummary> => {
  const buckets = new Map<
    string,
    {
      readonly date: string;
      readonly calories: Array<number | null>;
      readonly protein: Array<number | null>;
      readonly carbohydrate: Array<number | null>;
      readonly fat: Array<number | null>;
      count: number;
    }
  >();

  for (const entry of entries) {
    const date = isoDateOf(entry.consumedAt, options.utcOffsetMinutes ?? 0);
    if (date < options.from || date > options.to) continue;
    const existing = buckets.get(date);
    if (existing === undefined) {
      buckets.set(date, {
        date,
        calories: [entry.caloriesKcal],
        protein: [entry.proteinG],
        carbohydrate: [entry.carbohydrateG],
        fat: [entry.fatG],
        count: 1,
      });
    } else {
      existing.calories.push(entry.caloriesKcal);
      existing.protein.push(entry.proteinG);
      existing.carbohydrate.push(entry.carbohydrateG);
      existing.fat.push(entry.fatG);
      existing.count += 1;
    }
  }

  return [...buckets.values()]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((b): DailyFoodSummary => ({
      date: b.date,
      entryCount: b.count,
      caloriesKcal: sumNullable(b.calories),
      proteinG: sumNullable(b.protein),
      carbohydrateG: sumNullable(b.carbohydrate),
      fatG: sumNullable(b.fat),
    }));
};
