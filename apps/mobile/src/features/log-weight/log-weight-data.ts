import {
  bodyMeasurementCreateSchema,
  bodyMeasurementResponseSchema,
  type BodyMeasurementCreate,
  type BodyMeasurementResponse,
} from "@mizyun/contracts";

import type { ApiClient, ApiError } from "@mizyun/api-client";
import { apiClient } from "@/composition/api-client";
import type { Result } from "@mizyun/core";
import { displayWeightToKilograms } from "@/lib/weight-units";
import { displayLengthToCentimeters } from "@/lib/length-units";

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
  const measuredAt = now().toISOString();
  const payload: BodyMeasurementCreate = {
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

const parseOptionalPositive = (raw: string): number | null | "invalid" => {
  if (raw.trim().length === 0) return null;
  const value = Number(raw.trim());
  return Number.isFinite(value) && value > 0 ? value : "invalid";
};
