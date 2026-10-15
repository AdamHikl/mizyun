import {
  bodyMeasurementCreateSchema,
  bodyMeasurementListResponseSchema,
  bodyMeasurementResponseSchema,
  type BodyMeasurementCreate,
  type BodyMeasurementListResponse,
  type BodyMeasurementResponse,
} from "@mizyun/contracts";

import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";
import { apiClient } from "@/composition/api-client";
import type { Result } from "@mizyun/core";
import {
  displayWeightToKilograms,
  kilogramsToDisplayWeight,
  weightUnitLabel,
} from "@/lib/weight-units";
import {
  centimetersToDisplayLength,
  displayLengthToCentimeters,
} from "@/lib/length-units";

/**
 * Pure submit reducer for the log-weight form. The screen wires
 * this to a "Save weight" button; on success we navigate back.
 */

export type LogWeightResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly message: string };

export interface LogWeightForm {
  readonly weight: string;
  readonly waist: string;
  readonly chest: string;
  readonly unitSystem: "metric" | "imperial";
}

export type WeightSubmission = BodyMeasurementCreate & {
  readonly clientOperationId: string;
  readonly measuredAt: string;
};

export const isWeightSubmission = (
  value: unknown,
): value is WeightSubmission => {
  const parsed = bodyMeasurementCreateSchema.safeParse(value);
  return (
    parsed.success &&
    parsed.data.clientOperationId !== undefined &&
    parsed.data.measuredAt !== undefined
  );
};

const humanize = (result: Result<unknown, ApiError>): string => {
  if (!result.ok) {
    switch (result.error.kind) {
      case "session_expired":
        return "Your session expired. Sign in again.";
      case "network_error":
        return "Network unavailable. Try again when you're online.";
      case "http_error":
        if (result.error.status === 409) {
          return "This measurement was already saved with different values. Recover the original entry before making changes.";
        }
        if (result.error.status === 422) {
          return "Please double-check the values and try again.";
        }
        return "The server rejected the entry.";
      case "validation_error":
        return "Please double-check the values and try again.";
      case "not_configured":
        return "The API isn't configured yet.";
      case "no_session":
        return "You're signed out. Sign in and try again.";
      default:
        return "Could not save the weight.";
    }
  }
  return "Could not save the weight.";
};

export const submitLogWeight = async (
  payload: WeightSubmission,
  binding?: Pick<RequestOptions, "expectedUserId" | "isCurrent">,
): Promise<LogWeightResult> => submitLogWeightWith(payload, apiClient, binding);

export const prepareWeightSubmission = (
  form: LogWeightForm,
  clientOperationId: string,
  measuredAt: string,
):
  | { readonly ok: true; readonly payload: WeightSubmission }
  | { readonly ok: false; readonly message: string } => {
  const weight = parseOptionalPositive(form.weight);
  const waist = parseOptionalPositive(form.waist);
  const chest = parseOptionalPositive(form.chest);
  if ([weight, waist, chest].some((value) => value === "invalid")) {
    return { ok: false, message: "Measurements must be positive numbers." };
  }
  const values = [weight, waist, chest];
  if (values.every((value) => value === null)) {
    return { ok: false, message: "Enter a weight or body measurement first." };
  }
  const weightKg =
    typeof weight !== "number"
      ? null
      : displayWeightToKilograms(weight, form.unitSystem);
  const payload: BodyMeasurementCreate = {
    clientOperationId,
    ...(weightKg !== null ? { weightKg } : {}),
    ...(typeof waist === "number" || typeof chest === "number"
      ? {
          measurements: {
            ...(typeof waist === "number"
              ? {
                  waist_cm: displayLengthToCentimeters(waist, form.unitSystem),
                }
              : {}),
            ...(typeof chest === "number"
              ? {
                  chest_cm: displayLengthToCentimeters(chest, form.unitSystem),
                }
              : {}),
          },
        }
      : {}),
    measuredAt,
  };
  const parsed = bodyMeasurementCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Please double-check the values and try again.",
    };
  }
  return {
    ok: true,
    payload: { ...parsed.data, clientOperationId, measuredAt },
  };
};

export const submitLogWeightWith = async (
  payload: WeightSubmission,
  client: ApiClient,
  binding?: Pick<RequestOptions, "expectedUserId" | "isCurrent">,
): Promise<LogWeightResult> => {
  if (!isWeightSubmission(payload)) {
    return {
      ok: false,
      message: "Recover the saved measurement draft before trying again.",
    };
  }
  const result = await client.request<BodyMeasurementResponse>({
    method: "POST",
    path: "/v1/body-measurements",
    body: bodyMeasurementCreateSchema.parse(payload),
    headers: { "Idempotency-Key": payload.clientOperationId },
    schema: bodyMeasurementResponseSchema,
    ...binding,
  });
  if (!result.ok) {
    return { ok: false, message: humanize(result) };
  }
  return { ok: true, id: result.value.bodyMeasurement.id };
};

const parseOptionalPositive = (raw: string): number | null | "invalid" => {
  if (raw.trim().length === 0) return null;
  const value = Number(raw.trim().replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : "invalid";
};

/** The user's most recent body entry, used only to hint the next entry. */
export interface LastBodyEntry {
  readonly measuredAt: string;
  readonly weightKg: number | null;
  readonly waistCm: number | null;
  readonly chestCm: number | null;
}

const finitePositive = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;

/**
 * Newest-first read of recent entries; the weight comes from the latest entry
 * that has one, waist/chest from the latest entries that have those values, so
 * a waist-only entry does not hide the last weight.
 */
export type LastBodyEntryRead =
  | { readonly ok: true; readonly entry: LastBodyEntry | null }
  | { readonly ok: false };

export const readLastBodyEntry = async (
  binding?: Pick<RequestOptions, "expectedUserId" | "isCurrent">,
): Promise<LastBodyEntryRead> => readLastBodyEntryWith(apiClient, binding);

export const fetchLastBodyEntry = async (
  binding?: Pick<RequestOptions, "expectedUserId" | "isCurrent">,
): Promise<LastBodyEntry | null> => {
  const read = await readLastBodyEntry(binding);
  return read.ok ? read.entry : null;
};

export const readLastBodyEntryWith = async (
  client: ApiClient,
  binding?: Pick<RequestOptions, "expectedUserId" | "isCurrent">,
): Promise<LastBodyEntryRead> => {
  const result = await client.request<BodyMeasurementListResponse>({
    method: "GET",
    path: "/v1/body-measurements?limit=20",
    schema: bodyMeasurementListResponseSchema,
    ...binding,
  });
  if (!result.ok) return { ok: false };
  const rows = result.value.bodyMeasurements;
  const newest = rows[0];
  if (!newest) return { ok: true, entry: null };
  const withWeight = rows.find((row) => finitePositive(row.weightKg) !== null);
  const waist = rows.find((row) => finitePositive(row.measurements.waist_cm));
  const chest = rows.find((row) => finitePositive(row.measurements.chest_cm));
  return {
    ok: true,
    entry: {
      measuredAt: (withWeight ?? newest).measuredAt,
      weightKg: finitePositive(withWeight?.weightKg),
      waistCm: finitePositive(waist?.measurements.waist_cm),
      chestCm: finitePositive(chest?.measurements.chest_cm),
    },
  };
};

const MS_PER_DAY = 86_400_000;
const localMidnight = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** "today", "yesterday", "3 days ago", "2 weeks ago", "4 months ago". */
export const describeElapsedDays = (
  measuredAt: string,
  now: Date = new Date(),
): string | null => {
  const when = new Date(measuredAt);
  if (Number.isNaN(when.getTime())) return null;
  const days = Math.round(
    (localMidnight(now) - localMidnight(when)) / MS_PER_DAY,
  );
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
};

export interface LastEntryPresentation {
  /** Numeric text for placeholder/fill, in the user's display unit. */
  readonly weight: string | null;
  readonly waist: string | null;
  readonly chest: string | null;
  /** "Last: 82.4 kg · 3 days ago", or null when there is no prior weight. */
  readonly weightHint: string | null;
}

export const presentLastBodyEntry = (
  entry: LastBodyEntry,
  unitSystem: "metric" | "imperial",
  now: Date = new Date(),
): LastEntryPresentation => {
  const weight =
    entry.weightKg === null
      ? null
      : String(kilogramsToDisplayWeight(entry.weightKg, unitSystem));
  const elapsed = describeElapsedDays(entry.measuredAt, now);
  return {
    weight,
    waist:
      entry.waistCm === null
        ? null
        : String(centimetersToDisplayLength(entry.waistCm, unitSystem)),
    chest:
      entry.chestCm === null
        ? null
        : String(centimetersToDisplayLength(entry.chestCm, unitSystem)),
    weightHint:
      weight === null
        ? null
        : `Last: ${weight} ${weightUnitLabel(unitSystem)}${elapsed ? ` · ${elapsed}` : ""}`,
  };
};

/** True when the latest weight entry is from the device-local `now` day. */
export const isWeightLoggedToday = (
  entry: LastBodyEntry | null,
  now: Date = new Date(),
): boolean =>
  entry !== null &&
  entry.weightKg !== null &&
  describeElapsedDays(entry.measuredAt, now) === "today";
