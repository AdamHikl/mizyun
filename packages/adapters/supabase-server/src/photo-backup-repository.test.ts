import { describe, expect, it, vi } from "vitest";
import type { UserId } from "@mizyun/core";
import type { RepositorySupabaseClient } from "./index.js";
import { SupabasePhotoBackupRepository } from "./photo-backup-repository.js";

const user = "00000000-0000-4000-8000-000000000001" as UserId;
const other = "00000000-0000-4000-8000-000000000009";
const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;

type Call = readonly [string, ...unknown[]];
type Result = { data: unknown; error: { message: string } | null };

/** Records each table query's chain and answers results per table, in order. */
const fakeClient = (results: Record<string, Result[]>) => {
  const queries: { table: string; calls: Call[] }[] = [];
  const tokens: string[] = [];
  const clientFor = (token: string) => {
    tokens.push(token);
    return {
      from: (table: string) => {
        const query = { table, calls: [] as Call[] };
        queries.push(query);
        const builder: Record<string, unknown> = {};
        for (const name of ["select", "eq", "in", "is", "or", "order", "limit"])
          builder[name] = vi.fn((...args: unknown[]) => {
            query.calls.push([name, ...args]);
            return builder;
          });
        builder.then = (resolve: (r: Result) => void) =>
          resolve(results[table]?.shift() ?? { data: [], error: null });
        return builder;
      },
    } as unknown as RepositorySupabaseClient;
  };
  return { clientFor, queries, tokens };
};

const asset = (assetId: string, purpose: string, userId: string = user) => ({
  id: assetId,
  user_id: userId,
  purpose,
  deleted_at: null,
});

describe("SupabasePhotoBackupRepository", () => {
  it("lists owner meal photos newest first with live food assets, using the caller token", async () => {
    const fake = fakeClient({
      food_entries: [
        {
          data: [
            {
              id: id(1),
              user_id: user,
              photo_asset_id: id(11),
              consumed_at: "2026-10-20T10:00:00Z",
            },
            {
              id: id(2),
              user_id: user,
              photo_asset_id: id(12),
              consumed_at: "2026-10-19T10:00:00Z",
            },
          ],
          error: null,
        },
      ],
      // id(12) is soft-deleted (filtered by the query, so absent here).
      media_assets: [{ data: [asset(id(11), "food")], error: null }],
    });
    const repo = new SupabasePhotoBackupRepository({
      clientFor: fake.clientFor,
    });
    const page = await repo.listMealPhotos(user, {
      accessToken: "owner",
      limit: 5,
    });
    expect(page).toEqual({
      items: [{ entryId: id(1), assetId: id(11) }],
      truncated: false,
    });
    expect(fake.tokens).toEqual(["owner"]);
    expect(fake.queries[0]).toEqual({
      table: "food_entries",
      calls: [
        ["select", "id,user_id,photo_asset_id,consumed_at"],
        ["eq", "user_id", user],
        ["or", "photo_asset_id.not.is.null"],
        ["order", "consumed_at", { ascending: false }],
        ["order", "id", { ascending: false }],
        ["limit", 6],
      ],
    });
    expect(fake.queries[1]).toEqual({
      table: "media_assets",
      calls: [
        ["select", "id,user_id,purpose,deleted_at"],
        ["eq", "user_id", user],
        ["in", "id", [id(11), id(12)]],
        ["is", "deleted_at", null],
      ],
    });
  });

  it("lists boulder photos, drops wrong-purpose assets and reports truncation", async () => {
    const rows = [1, 2, 3].map((n) => ({
      id: id(n),
      user_id: user,
      workout_id: id(100),
      photo_asset_id: id(10 + n),
      logged_at: "2026-10-20T10:00:00Z",
    }));
    const fake = fakeClient({
      boulder_ascents: [{ data: rows, error: null }],
      media_assets: [
        {
          data: [asset(id(11), "workout"), asset(id(12), "progress")],
          error: null,
        },
      ],
    });
    const page = await new SupabasePhotoBackupRepository({
      clientFor: fake.clientFor,
    }).listBoulderPhotos(user, { accessToken: "owner", limit: 2 });
    expect(page).toEqual({
      items: [{ ascentId: id(1), sessionId: id(100), assetId: id(11) }],
      truncated: true,
    });
    expect(fake.queries[0]?.calls).toContainEqual(["limit", 3]);
    expect(fake.queries[0]?.calls).toContainEqual([
      "order",
      "logged_at",
      { ascending: false },
    ]);
    // Only the returned page's assets are checked.
    expect(fake.queries[1]?.calls).toContainEqual([
      "in",
      "id",
      [id(11), id(12)],
    ]);
  });

  it("chunks asset lookups", async () => {
    const rows = Array.from({ length: 150 }, (_, n) => ({
      id: id(1000 + n),
      user_id: user,
      workout_id: id(100),
      photo_asset_id: id(5000 + n),
      logged_at: "2026-10-20T10:00:00Z",
    }));
    const fake = fakeClient({
      boulder_ascents: [{ data: rows, error: null }],
      media_assets: [
        { data: [], error: null },
        { data: [], error: null },
      ],
    });
    await new SupabasePhotoBackupRepository({
      clientFor: fake.clientFor,
    }).listBoulderPhotos(user, { accessToken: "owner", limit: 2000 });
    expect(fake.queries.filter((q) => q.table === "media_assets")).toHaveLength(
      2,
    );
  });

  it("fails closed on errors and foreign rows", async () => {
    const failing = fakeClient({
      food_entries: [{ data: null, error: { message: "boom" } }],
    });
    await expect(
      new SupabasePhotoBackupRepository({
        clientFor: failing.clientFor,
      }).listMealPhotos(user, { accessToken: "owner", limit: 5 }),
    ).rejects.toThrow("Photo backups unavailable");
    const foreign = fakeClient({
      boulder_ascents: [
        {
          data: [
            {
              id: id(1),
              user_id: other,
              workout_id: id(100),
              photo_asset_id: id(11),
              logged_at: "2026-10-20T10:00:00Z",
            },
          ],
          error: null,
        },
      ],
    });
    await expect(
      new SupabasePhotoBackupRepository({
        clientFor: foreign.clientFor,
      }).listBoulderPhotos(user, { accessToken: "owner", limit: 5 }),
    ).rejects.toThrow("Photo backups unavailable");
    const assetError = fakeClient({
      boulder_ascents: [
        {
          data: [
            {
              id: id(1),
              user_id: user,
              workout_id: id(100),
              photo_asset_id: id(11),
              logged_at: "2026-10-20T10:00:00Z",
            },
          ],
          error: null,
        },
      ],
      media_assets: [{ data: null, error: { message: "boom" } }],
    });
    await expect(
      new SupabasePhotoBackupRepository({
        clientFor: assetError.clientFor,
      }).listBoulderPhotos(user, { accessToken: "owner", limit: 5 }),
    ).rejects.toThrow("Photo backups unavailable");
  });

  it("ignores another user's asset rows", async () => {
    const fake = fakeClient({
      food_entries: [
        {
          data: [
            {
              id: id(1),
              user_id: user,
              photo_asset_id: id(11),
              consumed_at: "2026-10-20T10:00:00Z",
            },
          ],
          error: null,
        },
      ],
      media_assets: [{ data: [asset(id(11), "food", other)], error: null }],
    });
    const page = await new SupabasePhotoBackupRepository({
      clientFor: fake.clientFor,
    }).listMealPhotos(user, { accessToken: "owner", limit: 5 });
    expect(page.items).toEqual([]);
  });
});
