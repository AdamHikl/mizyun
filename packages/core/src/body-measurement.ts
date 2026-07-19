import type { UserId } from "./index";

/**
 * Body measurement domain types and validation rules (BODY-001).
 *
 * Pure: no database, no transport, no SDK. The wire schema lives in
 * `@mizyun/contracts`; this module owns the bounded weight rule,
 * the closed `source` enum, and the repository port that adapters
 * implement.
 *
 * Body measurements are append-only — there is no `update` path
 * because a measurement is an immutable observation of the body
 * at a moment in time. Re-measuring produces a new row.
 *
 * The shape mirrors `public.body_measurements`:
 *   - `measuredAt` is the moment the measurement was taken.
 *   - `weightKg` is the canonical body weight in kilograms.
 *     Nullable: a user may record waist/chest measurements without
 *     a weight.
 *   - `measurements` is an open `Record<string, unknown>` for
 *     arbitrary body measurements.
 *   - `source` is closed; only `"manual"` exists today.
 */

export type BodyMeasurementSource = "manual";

/**
 * Bounded weight range, in kilograms. Mirrors `numeric(6, 3)` in
 * the SQL column and matches `WEIGHT_KG_MIN/MAX` from the goal
 * surface so the trend view and the goal target agree on what
 * "plausible" means.
 */
export const BODY_WEIGHT_KG_MIN = 30;
export const BODY_WEIGHT_KG_MAX = 250;

/**
 * Editable domain shape. The wire schema in `@mizyun/contracts`
 * adds `id`, `userId`, `source`, and `createdAt`. This type is the
 * editable subset the route accepts and returns.
 */
export interface BodyMeasurementCore {
  readonly measuredAt: Date;
  readonly weightKg: number | null;
  readonly measurements: Readonly<Record<string, unknown>>;
}

/**
 * Full stored body measurement. Includes the user id, the source
 * (always `"manual"` in v1), and the audit `createdAt` timestamp
 * (no `updatedAt` because the row is immutable).
 */
export interface StoredBodyMeasurement extends BodyMeasurementCore {
  readonly id: string;
  readonly userId: UserId;
  readonly source: BodyMeasurementSource;
  readonly createdAt: Date;
}

export interface WeightTrendSummary {
  readonly status: "insufficient" | "ready";
  readonly latestWeightKg: number | null;
  readonly smoothedWeightKg: number | null;
  readonly weeklyChangeKg: number | null;
  readonly observationCount: number;
  readonly spanDays: number;
  readonly windowDays: 28;
  readonly smoothingHalfLifeDays: 7;
}

const roundTo3 = (value: number): number => Math.round(value * 1_000) / 1_000;

/**
 * Summarize confirmed weights without hiding the raw observations.
 *
 * The displayed smooth value is an elapsed-time exponential moving average
 * with a seven-day half-life. Weekly rate is the least-squares slope over the
 * newest 28 days and is withheld until at least three observations span seven
 * days. Irregular measurement spacing therefore affects the math by elapsed
 * time rather than pretending every row represents one day.
 */
export const summariseWeightTrend = (
  observations: ReadonlyArray<{
    readonly measuredAt: Date;
    readonly weightKg: number | null;
  }>,
): WeightTrendSummary => {
  const weighted = observations
    .filter(
      (observation): observation is { measuredAt: Date; weightKg: number } =>
        observation.weightKg !== null &&
        Number.isFinite(observation.weightKg) &&
        Number.isFinite(observation.measuredAt.getTime()),
    )
    .sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime());
  if (weighted.length === 0) {
    return {
      status: "insufficient",
      latestWeightKg: null,
      smoothedWeightKg: null,
      weeklyChangeKg: null,
      observationCount: 0,
      spanDays: 0,
      windowDays: 28,
      smoothingHalfLifeDays: 7,
    };
  }

  const first = weighted[0] as { measuredAt: Date; weightKg: number };
  const latest = weighted[weighted.length - 1] as {
    measuredAt: Date;
    weightKg: number;
  };
  let smoothed = first.weightKg;
  let previousAt = first.measuredAt.getTime();
  for (const observation of weighted.slice(1)) {
    const elapsedDays = Math.max(
      (observation.measuredAt.getTime() - previousAt) / 86_400_000,
      1 / 1_440,
    );
    const alpha = 1 - 2 ** (-elapsedDays / 7);
    smoothed += alpha * (observation.weightKg - smoothed);
    previousAt = observation.measuredAt.getTime();
  }

  const spanDays =
    (latest.measuredAt.getTime() - first.measuredAt.getTime()) / 86_400_000;
  const windowStart = latest.measuredAt.getTime() - 28 * 86_400_000;
  const window = weighted.filter(
    (observation) => observation.measuredAt.getTime() >= windowStart,
  );
  const windowSpanDays =
    window.length < 2
      ? 0
      : ((
          window[window.length - 1] as { measuredAt: Date }
        ).measuredAt.getTime() -
          (window[0] as { measuredAt: Date }).measuredAt.getTime()) /
        86_400_000;
  let weeklyChangeKg: number | null = null;
  if (window.length >= 3 && windowSpanDays >= 7) {
    const origin = (window[0] as { measuredAt: Date }).measuredAt.getTime();
    const points = window.map((observation) => ({
      x: (observation.measuredAt.getTime() - origin) / 86_400_000,
      y: observation.weightKg,
    }));
    const meanX =
      points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const meanY =
      points.reduce((sum, point) => sum + point.y, 0) / points.length;
    const denominator = points.reduce(
      (sum, point) => sum + (point.x - meanX) ** 2,
      0,
    );
    if (denominator > 0) {
      const numerator = points.reduce(
        (sum, point) => sum + (point.x - meanX) * (point.y - meanY),
        0,
      );
      weeklyChangeKg = roundTo3((numerator / denominator) * 7);
    }
  }

  return {
    status: weeklyChangeKg === null ? "insufficient" : "ready",
    latestWeightKg: latest.weightKg,
    smoothedWeightKg: roundTo3(smoothed),
    weeklyChangeKg,
    observationCount: weighted.length,
    spanDays: roundTo3(spanDays),
    windowDays: 28,
    smoothingHalfLifeDays: 7,
  };
};

/**
 * Why-not-valid reasons for a body measurement create. The
 * discriminated union keeps the rejection reason
 * machine-checkable at the route layer.
 */
export type BodyMeasurementValidationError =
  | {
      readonly kind: "weight_out_of_range";
      readonly min: number;
      readonly max: number;
    }
  | { readonly kind: "measurements_must_be_object" }
  | { readonly kind: "empty_observation" };

const validateWeight = (
  value: number | null | undefined,
): BodyMeasurementValidationError | null => {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < BODY_WEIGHT_KG_MIN ||
    value > BODY_WEIGHT_KG_MAX
  ) {
    return {
      kind: "weight_out_of_range",
      min: BODY_WEIGHT_KG_MIN,
      max: BODY_WEIGHT_KG_MAX,
    };
  }
  return null;
};

const validateMeasurements = (
  value: Readonly<Record<string, unknown>> | undefined,
): BodyMeasurementValidationError | null => {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { kind: "measurements_must_be_object" };
  }
  return null;
};

/**
 * Validate a create body. The route enforces that at least one of
 * `weightKg` or a non-empty `measurements` map is present; the
 * wire Zod schema's refine already does that, so the domain
 * validator focuses on per-field bounds.
 */
export const validateBodyMeasurementCreate = (create: {
  readonly weightKg?: number | null;
  readonly measurements?: Readonly<Record<string, unknown>>;
}): BodyMeasurementValidationError | null => {
  const e0 = validateWeight(create.weightKg);
  if (e0 !== null) return e0;
  const e1 = validateMeasurements(create.measurements);
  if (e1 !== null) return e1;
  if (
    create.weightKg === undefined &&
    (create.measurements === undefined ||
      Object.keys(create.measurements).length === 0)
  ) {
    return { kind: "empty_observation" };
  }
  return null;
};

/**
 * Repository port. The Supabase adapter implements this against
 * the `public.body_measurements` table; tests implement it with an
 * in-memory map. The table is append-only, so the port has no
 * `update` method.
 */
export interface BodyMeasurementRepository {
  /**
   * `accessToken` is the verified principal's bearer token. The
   * in-memory adapter ignores it; the Supabase adapter uses it
   * to construct a per-request client bound to the user's RLS
   * session. PERSIST-002.
   */
  create(
    userId: UserId,
    measurement: StoredBodyMeasurement,
    options: { readonly accessToken: string },
  ): Promise<StoredBodyMeasurement>;
  /**
   * Return the user's measurements, bounded by `measuredAt`,
   * newest-first. `limit` caps the page size.
   */
  list(
    userId: UserId,
    options: {
      readonly from: Date | null;
      readonly to: Date | null;
      readonly limit: number;
      readonly accessToken: string;
    },
  ): Promise<ReadonlyArray<StoredBodyMeasurement>>;
  /**
   * Return the stored measurement by id, or `null` when no
   * measurement exists with that id for any user. The route is
   * responsible for the ownership check.
   */
  getById(
    id: string,
    options: { readonly accessToken: string },
  ): Promise<StoredBodyMeasurement | null>;
  /**
   * Permanently remove a measurement. Returns `true` when the row
   * existed and was removed, `false` otherwise. Removal is rare
   * (append-only is the model), but the route offers it for the
   * data-correctness case where the user accidentally recorded a
   * measurement on the wrong day.
   */
  delete(
    id: string,
    options: { readonly accessToken: string },
  ): Promise<boolean>;
}
