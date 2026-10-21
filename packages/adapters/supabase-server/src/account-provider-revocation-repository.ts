import type {
  AccountProviderRevocation,
  AccountProviderRevocationRepository,
  UserId,
} from "@mizyun/core";
import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

interface ProviderRevocationRow extends Record<string, unknown> {
  readonly job_id: string;
  readonly user_id: string;
  readonly provider: string;
  readonly status: AccountProviderRevocation["status"];
  readonly subject: string | null;
  readonly client_id: string | null;
  readonly encrypted_token: string | null;
}

/** Privileged cleanup state. It is intentionally absent from export inventory. */
export class SupabaseAccountProviderRevocationRepository implements AccountProviderRevocationRepository {
  constructor(private readonly client: RepositorySupabaseClient) {}

  async load(input: {
    readonly jobId: string;
    readonly userId: UserId;
    readonly provider: string;
  }): Promise<AccountProviderRevocation | null> {
    const { data, error } = await this.client
      .from<ProviderRevocationRow>("account_provider_revocations")
      .select(
        "job_id,user_id,provider,status,subject,client_id,encrypted_token",
      )
      .eq("job_id", input.jobId)
      .eq("user_id", input.userId)
      .eq("provider", input.provider)
      .limit(1);
    if (error)
      throw new RepositoryError("Provider cleanup state is unavailable");
    const row = data?.[0];
    if (!row) return null;
    if (
      row.job_id !== input.jobId ||
      row.user_id !== input.userId ||
      row.provider !== input.provider ||
      ![
        "not_required",
        "pending",
        "revoked",
        "skipped_no_authorization_code",
      ].includes(row.status)
    ) {
      throw new RepositoryError("Provider cleanup state is invalid");
    }
    return {
      jobId: row.job_id,
      userId: row.user_id as UserId,
      provider: row.provider,
      status: row.status,
      subject: row.subject,
      clientId: row.client_id,
      encryptedToken: row.encrypted_token,
    };
  }

  async save(
    record: AccountProviderRevocation,
    options: { readonly workerId: string },
  ): Promise<void> {
    const { data, error } = await this.client.rpc<{ saved: boolean }>(
      "account_save_provider_revocation",
      {
        p_job_id: record.jobId,
        p_user_id: record.userId,
        p_provider: record.provider,
        p_worker_id: options.workerId,
        p_status: record.status,
        p_subject: record.subject,
        p_client_id: record.clientId,
        p_encrypted_token: record.encryptedToken,
      },
    );
    if (error || data?.[0]?.saved !== true) {
      throw new RepositoryError("Provider cleanup state could not be saved");
    }
  }
}
