import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

/**
 * SEC-02 — owner-scoped storage quota pre-check. Runs under the caller's
 * access token, so `private_media_quota_check` only ever reads the caller's
 * own usage. The Storage trigger remains the authoritative bound.
 */
export class SupabaseMediaQuota {
  readonly #clientFor: (accessToken: string) => RepositorySupabaseClient;

  constructor(options: {
    readonly clientFor: (accessToken: string) => RepositorySupabaseClient;
  }) {
    this.#clientFor = options.clientFor;
  }

  async allows(
    _userId: string,
    byteSize: number,
    options: { readonly accessToken: string },
  ): Promise<boolean> {
    const { data, error } = await this.#clientFor(options.accessToken).rpc<{
      allowed: boolean;
    }>("private_media_quota_check", { p_byte_size: byteSize });
    if (error || typeof data?.[0]?.allowed !== "boolean") {
      throw new RepositoryError("Storage quota unavailable");
    }
    return data[0].allowed;
  }
}
