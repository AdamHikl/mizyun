import type {
  HealthDataConsentRepository,
  StoredHealthDataConsent,
  UserId,
} from "@mizyun/core";

import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

export interface HealthDataConsentRow extends Record<string, unknown> {
  readonly user_id: string;
  readonly granted: boolean;
  readonly consent_version: string;
  readonly consented_at: string | null;
  readonly revoked_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export const healthDataConsentFromRow = (
  row: HealthDataConsentRow,
): StoredHealthDataConsent => ({
  userId: row.user_id as UserId,
  granted: row.granted,
  consentVersion: row.consent_version,
  consentedAt: row.consented_at ? new Date(row.consented_at) : null,
  revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

export interface SupabaseHealthDataConsentRepositoryOptions {
  readonly clientFor: (accessToken: string) => RepositorySupabaseClient;
}

/**
 * Owner-scoped health-data consent (PRIV-01). Every read and write uses the
 * caller's access token, so RLS on `user_health_data_consents` applies. The
 * times sent here satisfy the row's shape; a database trigger replaces them
 * with its own clock and keeps the original time of a repeated grant.
 */
export class SupabaseHealthDataConsentRepository implements HealthDataConsentRepository {
  readonly #clientFor: (accessToken: string) => RepositorySupabaseClient;

  constructor(options: SupabaseHealthDataConsentRepositoryOptions) {
    this.#clientFor = options.clientFor;
  }

  #client(accessToken?: string): RepositorySupabaseClient {
    if (!accessToken) {
      throw new RepositoryError("Health data consent requires an access token");
    }
    return this.#clientFor(accessToken);
  }

  async getConsent(
    userId: UserId,
    options?: { readonly accessToken?: string },
  ): Promise<StoredHealthDataConsent | null> {
    const { data, error } = await this.#client(options?.accessToken)
      .from<HealthDataConsentRow>("user_health_data_consents")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      throw new RepositoryError(
        `getHealthDataConsent failed: ${error.message}`,
      );
    }
    return data ? healthDataConsentFromRow(data) : null;
  }

  async saveConsent(
    userId: UserId,
    consent: { readonly granted: boolean; readonly consentVersion: string },
    options?: { readonly accessToken?: string; readonly now?: Date },
  ): Promise<StoredHealthDataConsent> {
    const client = this.#client(options?.accessToken);
    const now = (options?.now ?? new Date()).toISOString();
    const { data, error } = await client
      .from<HealthDataConsentRow>("user_health_data_consents")
      .upsert(
        {
          user_id: userId,
          granted: consent.granted,
          consent_version: consent.consentVersion,
          consented_at: consent.granted ? now : null,
          revoked_at: consent.granted ? null : now,
          updated_at: now,
        },
        { onConflict: "user_id" },
      )
      .select("*")
      .single();
    if (error || !data) {
      throw new RepositoryError(
        `saveHealthDataConsent failed: ${error?.message ?? "no row returned"}`,
      );
    }
    return healthDataConsentFromRow(data);
  }
}
