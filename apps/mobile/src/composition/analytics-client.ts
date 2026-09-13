import { apiClient } from "@/composition/api-client";
import {
  NetworkAnalyticsClient,
  type NetworkAnalyticsApiTransport,
} from "@/features/analytics/network-analytics-client";
import {
  analyticsConsentResponseSchema,
  analyticsBatchIngestResponseSchema,
  analyticsClearResponseSchema,
  analyticsEventsListResponseSchema,
  CURRENT_ANALYTICS_CONSENT_VERSION,
  type AnalyticsBatchIngestResponse,
  type AnalyticsClearResponse,
  type AnalyticsConsentResponse,
  type AnalyticsEventV2,
} from "@mizyun/contracts";

export const createApiTransport = (): NetworkAnalyticsApiTransport => ({
  async getConsent(): Promise<{
    ok: boolean;
    data?: AnalyticsConsentResponse;
  }> {
    const res = await apiClient.request<AnalyticsConsentResponse>({
      method: "GET",
      path: "/v1/analytics/consent",
      schema: analyticsConsentResponseSchema,
    });
    if (res.ok) {
      return { ok: true, data: res.value };
    }
    return { ok: false };
  },

  async updateConsent(input: {
    readonly version: typeof CURRENT_ANALYTICS_CONSENT_VERSION;
    readonly granted: boolean;
    readonly expectedRevision: number;
    readonly operationId: string;
  }): Promise<{
    ok: boolean;
    data?: AnalyticsConsentResponse;
    conflict?: boolean;
  }> {
    const res = await apiClient.request<AnalyticsConsentResponse>({
      method: "PUT",
      path: "/v1/analytics/consent",
      body: input,
      schema: analyticsConsentResponseSchema,
    });
    if (res.ok) {
      return { ok: true, data: res.value };
    }
    if (res.error.kind === "http_error" && res.error.status === 409) {
      return { ok: false, conflict: true };
    }
    return { ok: false };
  },

  async ingestBatch(input: {
    readonly consentVersion: typeof CURRENT_ANALYTICS_CONSENT_VERSION;
    readonly epoch: string;
    readonly events: readonly AnalyticsEventV2[];
  }): Promise<{
    ok: boolean;
    data?: AnalyticsBatchIngestResponse;
    conflict?: boolean;
  }> {
    const res = await apiClient.request<AnalyticsBatchIngestResponse>({
      method: "POST",
      path: "/v1/analytics/events",
      body: input,
      schema: analyticsBatchIngestResponseSchema,
    });
    if (res.ok) {
      return { ok: true, data: res.value };
    }
    if (res.error.kind === "http_error" && res.error.status === 409) {
      return { ok: false, conflict: true };
    }
    return { ok: false };
  },

  async clearEvents(input: {
    readonly expectedRevision: number;
    readonly operationId: string;
  }): Promise<{
    ok: boolean;
    data?: AnalyticsClearResponse;
    conflict?: boolean;
  }> {
    const res = await apiClient.request<AnalyticsClearResponse>({
      method: "DELETE",
      path: "/v1/analytics/events",
      body: input,
      schema: analyticsClearResponseSchema,
    });
    if (res.ok) {
      return { ok: true, data: res.value };
    }
    if (res.error.kind === "http_error" && res.error.status === 409) {
      return { ok: false, conflict: true };
    }
    return { ok: false };
  },

  async listEvents(): Promise<{
    ok: boolean;
    data?: { readonly events: readonly AnalyticsEventV2[] };
  }> {
    const res = await apiClient.request<{
      readonly events: readonly AnalyticsEventV2[];
    }>({
      method: "GET",
      path: "/v1/analytics/events",
      schema: analyticsEventsListResponseSchema,
    });
    if (res.ok) {
      return { ok: true, data: res.value };
    }
    return { ok: false };
  },
});

/**
 * Product analytics composition root (OBS-002).
 * Wires the NetworkAnalyticsClient to the ApiClient with offline queuing
 * and server synchronization.
 */
export const analyticsClient = new NetworkAnalyticsClient(createApiTransport());
