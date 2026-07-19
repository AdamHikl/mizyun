import type { ApiClient, ApiError } from "@mizyun/api-client";
import {
  bodyMeasurementListResponseSchema,
  type BodyMeasurement,
  type BodyMeasurementListResponse,
} from "@mizyun/contracts";
import { summariseWeightTrend, type WeightTrendSummary } from "@mizyun/core";

import { apiClient } from "@/composition/api-client";

export interface BodyHistoryResult {
  readonly measurements: ReadonlyArray<BodyMeasurement>;
  readonly trend: WeightTrendSummary;
  readonly message: string | null;
}

export type BodyHistoryMutation =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

const humanize = (error: ApiError): string => {
  switch (error.kind) {
    case "network_error":
      return "Network unavailable. Refresh when you're online.";
    case "session_expired":
    case "no_session":
      return "Your session expired. Sign in again.";
    case "not_configured":
      return "The API isn't configured yet.";
    case "http_error":
      return error.status === 404
        ? "That measurement no longer exists."
        : "The server could not load your measurements.";
    case "validation_error":
    case "parse_error":
      return "The server returned an unexpected measurement record.";
  }
};

const emptyTrend = (): WeightTrendSummary => summariseWeightTrend([]);

export const fetchBodyHistory = async (): Promise<BodyHistoryResult> =>
  fetchBodyHistoryWith(apiClient);

export const fetchBodyHistoryWith = async (
  client: ApiClient,
): Promise<BodyHistoryResult> => {
  const result = await client.request<BodyMeasurementListResponse>({
    method: "GET",
    path: "/v1/body-measurements?limit=200",
    schema: bodyMeasurementListResponseSchema,
  });
  if (!result.ok) {
    return {
      measurements: [],
      trend: emptyTrend(),
      message: humanize(result.error),
    };
  }
  const measurements = result.value.bodyMeasurements;
  return {
    measurements,
    trend: summariseWeightTrend(
      measurements.map((measurement) => ({
        measuredAt: new Date(measurement.measuredAt),
        weightKg: measurement.weightKg,
      })),
    ),
    message: null,
  };
};

export const deleteBodyMeasurement = async (
  measurementId: string,
): Promise<BodyHistoryMutation> =>
  deleteBodyMeasurementWith(apiClient, measurementId);

export const deleteBodyMeasurementWith = async (
  client: ApiClient,
  measurementId: string,
): Promise<BodyHistoryMutation> => {
  const result = await client.request<void>({
    method: "DELETE",
    path: `/v1/body-measurements/${encodeURIComponent(measurementId)}`,
  });
  return result.ok
    ? { ok: true }
    : { ok: false, message: humanize(result.error) };
};
