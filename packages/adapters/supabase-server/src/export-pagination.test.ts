import { describe, expect, it, vi } from "vitest";
import type { RepositorySupabaseClient } from "./index.js";
import { fetchAllExportPages } from "./export-pagination.js";

const clientWithPages = (
  read: (from: number, to: number) => Promise<unknown>,
): RepositorySupabaseClient => {
  const q = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: read,
  };
  return { from: () => q } as unknown as RepositorySupabaseClient;
};

describe("account export exhaustion", () => {
  it("fails on a later page instead of returning the collected prefix", async () => {
    const read = vi.fn(async (from: number) =>
      from === 0
        ? { data: [{ id: "first" }], error: null }
        : { data: null, error: { message: "private backend details" } },
    );
    await expect(
      fetchAllExportPages(
        clientWithPages(read),
        "memory_items",
        "user_id",
        "owner",
        "id",
      ),
    ).rejects.toThrow("Unable to read account export category: memory_items");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("rejects a non-exhausted read at the resource guard instead of claiming completeness", async () => {
    const read = vi.fn(async (from: number) => ({
      data: [{ id: String(from) }],
      error: null,
    }));
    await expect(
      fetchAllExportPages(
        clientWithPages(read),
        "memory_items",
        "user_id",
        "owner",
        "id",
      ),
    ).rejects.toThrow("page limit exceeded");
    expect(read).toHaveBeenCalledTimes(1000);
  });

  it("rejects a missing result rather than treating it as an empty category", async () => {
    await expect(
      fetchAllExportPages(
        clientWithPages(async () => ({ data: null, error: null })),
        "memory_items",
        "user_id",
        "owner",
        "id",
      ),
    ).rejects.toThrow("Unable to read");
  });
});
