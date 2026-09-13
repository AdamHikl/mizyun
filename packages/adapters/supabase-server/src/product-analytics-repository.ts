import type {
  ProductAnalyticsRepository,
  StoredProductAnalyticsConsent,
  StoredProductAnalyticsEvent,
  UserId,
} from "@mizyun/core";

import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

export interface ProductAnalyticsConsentRow extends Record<string, unknown> {
  readonly user_id: string;
  readonly version: string;
  readonly granted: boolean;
  readonly revision: number;
  readonly epoch: string;
  readonly consented_at: string | null;
  readonly revoked_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ProductAnalyticsEventRow extends Record<string, unknown> {
  readonly id: string;
  readonly user_id: string;
  readonly epoch: string;
  readonly version: string;
  readonly event_name: string;
  readonly session_id: string;
  readonly sequence: number;
  readonly flow_id: string | null;
  readonly platform: "ios" | "android";
  readonly app_version: string;
  readonly build: string | null;
  readonly properties: Record<string, unknown>;
  readonly recorded_at: string;
  readonly received_at: string;
}

export const productAnalyticsConsentFromRow = (
  row: ProductAnalyticsConsentRow,
): StoredProductAnalyticsConsent => ({
  userId: row.user_id as UserId,
  version: row.version,
  granted: row.granted,
  revision: row.revision,
  epoch: row.epoch,
  consentedAt: row.consented_at ? new Date(row.consented_at) : null,
  revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

export const productAnalyticsEventFromRow = (
  row: ProductAnalyticsEventRow,
): StoredProductAnalyticsEvent => ({
  id: row.id,
  userId: row.user_id as UserId,
  epoch: row.epoch,
  version: row.version,
  name: row.event_name,
  sessionId: row.session_id,
  sequence: row.sequence,
  flowId: row.flow_id,
  platform: row.platform,
  appVersion: row.app_version,
  build: row.build,
  properties: (row.properties as Record<string, unknown>) ?? {},
  recordedAt: new Date(row.recorded_at),
  receivedAt: new Date(row.received_at),
});

export interface SupabaseProductAnalyticsRepositoryOptions {
  readonly client?: RepositorySupabaseClient;
  readonly clientFor?: (accessToken: string) => RepositorySupabaseClient;
}

export class SupabaseProductAnalyticsRepository implements ProductAnalyticsRepository {
  readonly #client: RepositorySupabaseClient | null;
  readonly #clientFor:
    ((accessToken: string) => RepositorySupabaseClient) | null;

  constructor(options: SupabaseProductAnalyticsRepositoryOptions) {
    this.#client = options.client ?? null;
    this.#clientFor = options.clientFor ?? null;
    if (!this.#client && !this.#clientFor) {
      throw new RepositoryError(
        "SupabaseProductAnalyticsRepository requires client or clientFor",
      );
    }
  }

  async #resolveClient(
    accessToken?: string,
  ): Promise<RepositorySupabaseClient> {
    if (this.#clientFor && accessToken) {
      return this.#clientFor(accessToken);
    }
    if (this.#client) {
      if (accessToken) {
        await this.#client.auth.setSession({
          access_token: accessToken,
        });
      }
      return this.#client;
    }
    return this.#clientFor!("");
  }

  async getConsent(
    userId: UserId,
    options?: { readonly accessToken?: string },
  ): Promise<StoredProductAnalyticsConsent | null> {
    const client = await this.#resolveClient(options?.accessToken);
    const { data, error } = await client
      .from<ProductAnalyticsConsentRow>("product_analytics_consents")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new RepositoryError(
        `Failed to get product analytics consent for user ${userId}: ${error.message}`,
      );
    }

    if (!data) return null;
    return productAnalyticsConsentFromRow(data);
  }

  async updateConsent(
    userId: UserId,
    mutation: {
      readonly version: string;
      readonly granted: boolean;
      readonly expectedRevision: number;
    },
    options?: { readonly accessToken?: string },
  ): Promise<
    | {
        readonly success: true;
        readonly consent: StoredProductAnalyticsConsent;
      }
    | {
        readonly success: false;
        readonly error: "revision_mismatch";
        readonly current: StoredProductAnalyticsConsent | null;
      }
  > {
    const client = await this.#resolveClient(options?.accessToken);
    const { data, error } = await client.rpc(
      "update_product_analytics_consent",
      {
        p_user_id: userId,
        p_version: mutation.version,
        p_granted: mutation.granted,
        p_expected_revision: mutation.expectedRevision,
      },
    );

    if (error) {
      throw new RepositoryError(
        `Failed to update product analytics consent for user ${userId}: ${error.message}`,
      );
    }

    const res = data as unknown as {
      success: boolean;
      error?: string;
      consent?: ProductAnalyticsConsentRow;
      current?: ProductAnalyticsConsentRow | null;
    };

    if (!res.success) {
      return {
        success: false,
        error: "revision_mismatch",
        current: res.current
          ? productAnalyticsConsentFromRow(res.current)
          : null,
      };
    }

    return {
      success: true,
      consent: productAnalyticsConsentFromRow(res.consent!),
    };
  }

  async recordBatch(
    userId: UserId,
    batch: {
      readonly consentVersion: string;
      readonly epoch: string;
      readonly events: ReadonlyArray<
        Omit<StoredProductAnalyticsEvent, "userId" | "receivedAt">
      >;
    },
    options?: { readonly accessToken?: string },
  ): Promise<
    | {
        readonly success: true;
        readonly acceptedIds: readonly string[];
        readonly rejectedCount: number;
      }
    | { readonly success: false; readonly error: "consent_or_epoch_mismatch" }
  > {
    const client = await this.#resolveClient(options?.accessToken);
    const formattedEvents = batch.events.map((e) => ({
      id: e.id,
      name: e.name,
      sessionId: e.sessionId,
      sequence: e.sequence,
      flowId: e.flowId ?? null,
      platform: e.platform,
      appVersion: e.appVersion,
      build: e.build ?? null,
      properties: e.properties,
      recordedAt: e.recordedAt.toISOString(),
    }));

    const { data, error } = await client.rpc(
      "record_product_analytics_events",
      {
        p_user_id: userId,
        p_epoch: batch.epoch,
        p_version: batch.consentVersion,
        p_events: formattedEvents,
      },
    );

    if (error) {
      throw new RepositoryError(
        `Failed to record product analytics events for user ${userId}: ${error.message}`,
      );
    }

    const res = data as unknown as {
      success: boolean;
      error?: string;
      accepted_ids?: string[];
      rejected_count?: number;
    };

    if (!res.success) {
      return {
        success: false,
        error: "consent_or_epoch_mismatch",
      };
    }

    return {
      success: true,
      acceptedIds: res.accepted_ids ?? [],
      rejectedCount: res.rejected_count ?? 0,
    };
  }

  async clearEvents(
    userId: UserId,
    options: { readonly expectedRevision: number },
    extra?: { readonly accessToken?: string },
  ): Promise<
    | {
        readonly success: true;
        readonly cleared: true;
        readonly newEpoch: string;
        readonly revision: number;
      }
    | { readonly success: false; readonly error: "revision_mismatch" }
  > {
    const client = await this.#resolveClient(extra?.accessToken);
    const { data, error } = await client.rpc("clear_product_analytics_events", {
      p_user_id: userId,
      p_expected_revision: options.expectedRevision,
    });

    if (error) {
      throw new RepositoryError(
        `Failed to clear product analytics events for user ${userId}: ${error.message}`,
      );
    }

    const res = data as unknown as {
      success: boolean;
      error?: string;
      cleared?: boolean;
      new_epoch?: string;
      revision?: number;
    };

    if (!res.success) {
      return {
        success: false,
        error: "revision_mismatch",
      };
    }

    return {
      success: true,
      cleared: true,
      newEpoch: res.new_epoch!,
      revision: res.revision!,
    };
  }

  async listRetainedEvents(
    userId: UserId,
    options?: { readonly limit?: number; readonly accessToken?: string },
  ): Promise<ReadonlyArray<StoredProductAnalyticsEvent>> {
    const client = await this.#resolveClient(options?.accessToken);
    const limit = options?.limit ?? 500;
    const cutoff = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data, error } = await client
      .from<ProductAnalyticsEventRow>("product_analytics_events")
      .select("*")
      .eq("user_id", userId)
      .gte("recorded_at", cutoff)
      .order("recorded_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new RepositoryError(
        `Failed to list retained product analytics events for user ${userId}: ${error.message}`,
      );
    }

    return (data ?? []).map(productAnalyticsEventFromRow);
  }

  async cleanupExpired(retentionDays = 30): Promise<number> {
    const client = await this.#resolveClient();
    const { data, error } = await client.rpc(
      "cleanup_expired_product_analytics",
      {
        p_retention_days: retentionDays,
      },
    );

    if (error) {
      throw new RepositoryError(
        `Failed to cleanup expired product analytics events: ${error.message}`,
      );
    }

    return (data as unknown as number) ?? 0;
  }
}
