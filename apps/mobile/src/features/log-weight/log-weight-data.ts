import {
  bodyMeasurementCreateSchema,
  bodyMeasurementResponseSchema,
  type BodyMeasurementCreate,
  type BodyMeasurementResponse,
} from "@mizyun/contracts";

import type { ApiClient, ApiError } from "@mizyun/api-client";
import { apiClient } from "@/composition/api-client";
import type { Result } from "@mizyun/core";

/**
 * Pure submit reducer for the log-weight form. The screen wires
 * this to a "Save weight" button; on success we navigate back.
 */

export type LogWeightResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly message: string };

export interface LogWeightForm {
  readonly weight: number | null;
  readonly unitSystem: "metric" | "imperial";
}

const POUNDS_PER_KILOGRAM = 2.204_622_621_8;

const humanize = (result: Result<unknown, ApiError>): string => {
  if (!result.ok) {
    switch (result.error.kind) {
      case "session_expired":
        return "Your session expired. Sign in again.";
      case "network_error":
        return "Network unavailable. Try again when you're online.";
      case "http_error":
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
  form: LogWeightForm,
): Promise<LogWeightResult> =>
  submitLogWeightWith(form, apiClient, () => new Date());

export const submitLogWeightWith = async (
  form: LogWeightForm,
  client: ApiClient,
  now: () => Date = () => new Date(),
): Promise<LogWeightResult> => {
  if (form.weight === null || form.weight <= 0) {
    return { ok: false, message: "Enter a positive weight first." };
  }
  const unroundedWeightKg =
    form.unitSystem === "imperial"
      ? form.weight / POUNDS_PER_KILOGRAM
      : form.weight;
  // The wire contract mirrors numeric(6, 3), so display-unit
  // conversion rounds only at the canonical storage boundary.
  const weightKg = Math.round(unroundedWeightKg * 1_000) / 1_000;
  const measuredAt = now().toISOString();
  const payload: BodyMeasurementCreate = {
    weightKg,
    measuredAt,
  };
  const parsed = bodyMeasurementCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Please double-check the values and try again.",
    };
  }
  const result = await client.request<BodyMeasurementResponse>({
    method: "POST",
    path: "/v1/body-measurements",
    body: parsed.data,
    schema: bodyMeasurementResponseSchema,
  });
  if (!result.ok) {
    return { ok: false, message: humanize(result) };
  }
  return { ok: true, id: result.value.bodyMeasurement.id };
};
