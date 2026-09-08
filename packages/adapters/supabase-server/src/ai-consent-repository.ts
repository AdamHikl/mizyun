import type {
  AiConsentRepository,
  StoredAiConsent,
  UserId,
} from "@mizyun/core";

import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

export interface AiConsentRow extends Record<string, unknown> {
  readonly user_id: string;
  readonly granted: boolean;
  readonly confirmed_adult: boolean;
  readonly consent_version: string;
  readonly consented_at: string | null;
  readonly revoked_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export const aiConsentFromRow = (row: AiConsentRow): StoredAiConsent => ({
  userId: row.user_id as UserId,
  granted: row.granted,
  confirmedAdult: row.confirmed_adult,
  consentVersion: row.consent_version,
  consentedAt: row.consented_at ? new Date(row.consented_at) : null,
  revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

export interface SupabaseAiConsentRepositoryOptions {
  readonly client?: RepositorySupabaseClient;
  readonly clientFor?: (accessToken: string) => RepositorySupabaseClient;
}

export class SupabaseAiConsentRepository implements AiConsentRepository {
  readonly #client: RepositorySupabaseClient | null;
  readonly #clientFor:
    ((accessToken: string) => RepositorySupabaseClient) | null;

  constructor(options: SupabaseAiConsentRepositoryOptions) {
    this.#client = options.client ?? null;
    this.#clientFor = options.clientFor ?? null;
    if (!this.#client && !this.#clientFor) {
      throw new RepositoryError(
        "SupabaseAiConsentRepository requires client or clientFor",
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
  ): Promise<StoredAiConsent | null> {
    const client = await this.#resolveClient(options?.accessToken);
    const { data, error } = await client
      .from<AiConsentRow>("user_ai_consents")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new RepositoryError(`getConsent failed: ${error.message}`);
    }
    return data ? aiConsentFromRow(data) : null;
  }

  async saveConsent(
    userId: UserId,
    consent: {
      readonly granted: boolean;
      readonly confirmedAdult: boolean;
      readonly consentVersion: string;
    },
    options?: { readonly accessToken?: string; readonly now?: Date },
  ): Promise<StoredAiConsent> {
    const client = await this.#resolveClient(options?.accessToken);
    const now = (options?.now ?? new Date()).toISOString();
    const payload = {
      user_id: userId,
      granted: consent.granted,
      confirmed_adult: consent.confirmedAdult,
      consent_version: consent.consentVersion,
      consented_at: consent.granted ? now : null,
      revoked_at: consent.granted ? null : now,
      updated_at: now,
    };

    const existing = await client
      .from<AiConsentRow>("user_ai_consents")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (existing.error) {
      throw new RepositoryError(
        `saveConsent lookup failed: ${existing.error.message}`,
      );
    }

    if (existing.data !== null) {
      const { data, error } = await client
        .from<AiConsentRow>("user_ai_consents")
        .update({
          granted: payload.granted,
          confirmed_adult: payload.confirmed_adult,
          consent_version: payload.consent_version,
          consented_at: payload.consented_at,
          revoked_at: payload.revoked_at,
          updated_at: payload.updated_at,
        })
        .eq("user_id", userId)
        .select("*")
        .single();

      if (error || !data) {
        throw new RepositoryError(
          `saveConsent update failed: ${error?.message ?? "no row returned"}`,
        );
      }
      return aiConsentFromRow(data);
    } else {
      const { data, error } = await client
        .from<AiConsentRow>("user_ai_consents")
        .insert(payload)
        .select("*")
        .single();

      if (error || !data) {
        throw new RepositoryError(
          `saveConsent insert failed: ${error?.message ?? "no row returned"}`,
        );
      }
      return aiConsentFromRow(data);
    }
  }
}
