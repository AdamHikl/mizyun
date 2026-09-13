import type { RepositorySupabaseClient } from "@mizyun/adapter-supabase-server";
import type { UserId } from "@mizyun/core";
import type { BetaProStatus } from "@mizyun/contracts";
import type {
  BetaProRecord,
  BetaProRepository,
} from "./beta-pro-repository.js";

interface BetaProRequestRow extends Record<string, unknown> {
  readonly id: string;
  readonly user_id: string;
  readonly email: string;
  readonly push_token: string | null;
  readonly status: string;
  readonly notes: string | null;
  readonly created_at: string;
  readonly reviewed_at: string | null;
}

const toRecord = (row: BetaProRequestRow): BetaProRecord => ({
  id: row.id,
  userId: row.user_id as UserId,
  email: row.email,
  pushToken: row.push_token,
  status: row.status as BetaProStatus,
  notes: row.notes,
  createdAt: new Date(row.created_at),
  reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
});

export interface SupabaseBetaProRepositoryOptions {
  readonly client?: RepositorySupabaseClient;
  readonly clientFor?: (accessToken: string) => RepositorySupabaseClient;
  readonly serviceClient?: RepositorySupabaseClient;
}

export class SupabaseBetaProRepository implements BetaProRepository {
  readonly #client: RepositorySupabaseClient | null;
  readonly #clientFor:
    ((accessToken: string) => RepositorySupabaseClient) | null;
  readonly #serviceClient: RepositorySupabaseClient | null;

  constructor(options: SupabaseBetaProRepositoryOptions) {
    this.#client = options.client ?? null;
    this.#clientFor = options.clientFor ?? null;
    this.#serviceClient = options.serviceClient ?? null;
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
    if (this.#serviceClient) {
      return this.#serviceClient;
    }
    if (this.#clientFor) {
      return this.#clientFor("");
    }
    throw new Error("No client configured for SupabaseBetaProRepository");
  }

  async getRequest(
    userId: UserId,
    options?: { readonly accessToken?: string },
  ): Promise<BetaProRecord | null> {
    const client = await this.#resolveClient(options?.accessToken);
    const { data, error } = await client
      .from<BetaProRequestRow>("beta_pro_requests")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new Error(`beta_pro_requests select failed: ${error.message}`);
    }
    if (!data) return null;
    return toRecord(data);
  }

  async saveRequest(
    data: {
      readonly userId: UserId;
      readonly email: string;
      readonly pushToken?: string | null;
      readonly notes?: string | null;
    },
    options?: { readonly accessToken?: string; readonly now?: Date },
  ): Promise<BetaProRecord> {
    const client = await this.#resolveClient(options?.accessToken);
    const existing = await this.getRequest(data.userId, options);

    if (existing) {
      const updatePayload: Record<string, unknown> = {};
      if (data.pushToken !== undefined) {
        updatePayload.push_token = data.pushToken ?? null;
      }
      if (existing.status === "pending" && data.notes !== undefined) {
        updatePayload.notes = data.notes ?? null;
      }
      if (Object.keys(updatePayload).length > 0) {
        const writeClient = this.#serviceClient ?? client;
        const { error } = await writeClient
          .from("beta_pro_requests")
          .update(updatePayload)
          .eq("user_id", data.userId);
        if (error) {
          throw new Error(`beta_pro_requests update failed: ${error.message}`);
        }
      }
      return (await this.getRequest(data.userId, options)) ?? existing;
    }

    const { data: inserted, error } = await client
      .from<BetaProRequestRow>("beta_pro_requests")
      .insert({
        user_id: data.userId,
        email: data.email,
        push_token: data.pushToken ?? null,
        notes: data.notes ?? null,
        status: "pending",
      })
      .select("*")
      .single();

    if (error || !inserted) {
      throw new Error(
        `beta_pro_requests insert failed: ${error?.message ?? "empty response"}`,
      );
    }
    return toRecord(inserted);
  }
}
