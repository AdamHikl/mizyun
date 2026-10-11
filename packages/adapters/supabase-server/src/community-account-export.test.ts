import { describe, expect, it, vi } from "vitest";
import {
  exportCommunityAccount,
  SOCIAL_EXPORT_CATEGORIES,
} from "./community-account-export.js";
import type { RepositorySupabaseClient } from "./index.js";

const clientWithRpc = (rpc: ReturnType<typeof vi.fn>) =>
  ({ rpc }) as unknown as RepositorySupabaseClient;

describe("community account export", () => {
  it("uses caller-scoped RPC for every declared category including empty categories", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    const result = await exportCommunityAccount(clientWithRpc(rpc));
    expect(Object.keys(result.categories)).toEqual([
      ...SOCIAL_EXPORT_CATEGORIES,
    ]);
    expect(Object.values(result.counts)).toEqual(
      SOCIAL_EXPORT_CATEGORIES.map(() => 0),
    );
    expect(result.consistency).toBe("live_keyset");
    expect(result.schemaVersion).toBe("2026-10-11");
    expect(result.categories).toHaveProperty("challengeMemberships");
    expect(result.categories).toHaveProperty("commentSettings");
    expect(rpc).toHaveBeenCalledTimes(SOCIAL_EXPORT_CATEGORIES.length);
    expect(
      rpc.mock.calls.every(
        ([...args]) => !JSON.stringify(args).includes("p_user_id"),
      ),
    ).toBe(true);
  });
  it("advances keyset cursor over multiple full pages before declaring completion", async () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({
      item_key: String(i).padStart(6, "0"),
      item: { id: i },
    }));
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: rows, error: null })
      .mockResolvedValue({ data: [], error: null });
    const result = await exportCommunityAccount(clientWithRpc(rpc));
    expect(result.counts.identity).toBe(500);
    expect(rpc).toHaveBeenNthCalledWith(2, "community_export_page", {
      p_category: "identity",
      p_after: "000499",
      p_limit: 500,
    });
  });
  it("fails closed instead of silently returning complete after a denied category", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValue({ data: null, error: { message: "denied" } });
    await expect(exportCommunityAccount(clientWithRpc(rpc))).rejects.toThrow(
      "Community export failed",
    );
  });
  it.each(
    [
      null,
      {},
      [null],
      [{ item_key: 1, item: {} }],
      [{ item_key: "a", item: null }],
      [{ item_key: "a", item: [] }],
      Array.from({ length: 501 }, (_, i) => ({
        item_key: String(i),
        item: {},
      })),
    ].map((data) => ({ data })),
  )("fails closed for malformed successful page $data", async ({ data }) => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    await expect(exportCommunityAccount(clientWithRpc(rpc))).rejects.toThrow(
      "invalid",
    );
  });
  it("rejects replayed page cursors rather than accumulating duplicates", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { item_key: "a", item: {} },
        { item_key: "a", item: {} },
      ],
      error: null,
    });
    await expect(exportCommunityAccount(clientWithRpc(rpc))).rejects.toThrow(
      "cursor did not advance",
    );
  });
});
