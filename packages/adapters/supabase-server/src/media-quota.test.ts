import { describe, expect, it, vi } from "vitest";

import type { RepositorySupabaseClient } from "./index.js";
import { SupabaseMediaQuota } from "./media-quota.js";
import { RepositoryError } from "./repository-error.js";

const clientReturning = (result: {
  readonly data: ReadonlyArray<Record<string, unknown>>;
  readonly error: { readonly message: string } | null;
}) => {
  const rpc = vi.fn(async () => result);
  const clientFor = vi.fn(
    () => ({ rpc }) as unknown as RepositorySupabaseClient,
  );
  return { rpc, clientFor };
};

describe("SupabaseMediaQuota", () => {
  it("checks the caller's own quota under their access token", async () => {
    const { rpc, clientFor } = clientReturning({
      data: [{ allowed: false }],
      error: null,
    });
    const quota = new SupabaseMediaQuota({ clientFor });
    await expect(
      quota.allows("user-a", 2048, { accessToken: "token-a" }),
    ).resolves.toBe(false);
    expect(clientFor).toHaveBeenCalledWith("token-a");
    expect(rpc).toHaveBeenCalledWith("private_media_quota_check", {
      p_byte_size: 2048,
    });
  });

  it("fails closed on an error or malformed result", async () => {
    for (const result of [
      { data: [], error: { message: "storage_quota_access_denied" } },
      { data: [], error: null },
      { data: [{ allowed: "yes" }], error: null },
    ]) {
      const quota = new SupabaseMediaQuota(clientReturning(result));
      await expect(
        quota.allows("user-a", 1, { accessToken: "t" }),
      ).rejects.toBeInstanceOf(RepositoryError);
    }
  });
});
