import {
  bodyMeasurementCreateSchema,
  bodyMeasurementResponseSchema,
  type BodyMeasurementCreate,
  type BodyMeasurementResponse,
} from "@mizyun/contracts";

import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";
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
