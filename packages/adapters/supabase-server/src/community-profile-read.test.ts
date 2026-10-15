import { describe, expect, it, vi } from "vitest";
import { CommunityMutationError, type UserId } from "@mizyun/core";
import type { RepositorySupabaseClient } from "./index.js";
import { SupabaseCommunityRepository } from "./community-repository.js";
const viewer = "00000000-0000-4000-8000-000000000001" as UserId;
const author = "00000000-0000-4000-8000-000000000002" as UserId;
describe("author-constrained Community publication read", () => {
  it("uses the authorized target RPC with caller token and stable timestamp/id cursor", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const from = vi.fn();
    const clientFor = vi.fn(
      () => ({ rpc, from }) as unknown as RepositorySupabaseClient,
    );
    const repository = new SupabaseCommunityRepository({ clientFor });
    const cursor =
      "2026-10-07T12:00:00.000Z|10000000-0000-4000-8000-000000000001";
    expect(
      await repository.getFeed(viewer, {
        accessToken: "caller-token",
        authorUserId: author,
        limit: 999,
        beforeCursor: cursor,
      }),
    ).toEqual({ items: [] });
    expect(clientFor).toHaveBeenCalledWith("caller-token");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("community_author_activities", {
      p_author_user_id: author,
      p_limit: 51,
      p_before_time: "2026-10-07T12:00:00.000Z",
      p_before_id: "10000000-0000-4000-8000-000000000001",
    });
    expect(from).not.toHaveBeenCalled();
  });
  it("preserves the existing feed RPC without an author constraint", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const repository = new SupabaseCommunityRepository({
      clientFor: () => ({ rpc }) as unknown as RepositorySupabaseClient,
    });
    await repository.getFeed(viewer, { accessToken: "token" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("community_feed", {
      p_limit: 20,
      p_before_time: null,
      p_before_id: null,
    });
  });
  it("does not silently fall back to the global feed when the author RPC is unavailable", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "function unavailable" },
    });
    const repository = new SupabaseCommunityRepository({
      clientFor: () => ({ rpc }) as unknown as RepositorySupabaseClient,
    });
    await expect(
      repository.getFeed(viewer, {
        accessToken: "token",
        authorUserId: author,
      }),
    ).rejects.toThrow();
    expect(rpc).toHaveBeenCalledOnce();
  });
  it("returns a continuation at public max50 only when the authorized lookahead exists", async () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(51 - index).padStart(12, "0")}`,
      user_id: author,
      source_workout_id: "00000000-0000-0000-0000-000000000000",
      category: "strength",
      shared_day: "2026-10-07",
      duration_seconds: null,
      version: 1,
      published_at: "2026-10-07T12:00:00.000Z",
      revoked_at: null,
    }));
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: rows, error: null })
      .mockResolvedValueOnce({ data: rows.slice(0, 50), error: null });
    const repository = new SupabaseCommunityRepository({
      clientFor: () => ({ rpc }) as unknown as RepositorySupabaseClient,
    });
    const first = await repository.getFeed(viewer, {
      authorUserId: author,
      accessToken: "token",
      limit: 50,
    });
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBe(`2026-10-07T12:00:00.000Z|${rows[49]!.id}`);
    const final = await repository.getFeed(viewer, {
      authorUserId: author,
      accessToken: "token",
      limit: 50,
    });
    expect(final.items).toHaveLength(50);
    expect(final.nextCursor).toBeUndefined();
  });
});

describe("relationship list pages skip inactive peers without ending early", () => {
  it("keeps reading past an inactive peer so a full page still signals more", async () => {
    const rows = ["r1", "r2", "r3", "r4", "r5"].map((id, index) => ({
      id,
      follower_user_id: `peer-${index + 1}`,
      target_user_id: viewer,
      status: "approved",
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
    }));
    const reads: { afterId?: string; limit: number }[] = [];
    const from = vi.fn(() => {
      const read: { afterId?: string; limit: number } = { limit: 0 };
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: (limit: number) => {
          read.limit = limit;
          return chain;
        },
        gt: (_column: string, afterId: string) => {
          read.afterId = afterId;
          return chain;
        },
        then: (resolve: (value: unknown) => void) => {
          reads.push(read);
          const start = read.afterId
            ? rows.findIndex((row) => row.id === read.afterId) + 1
            : 0;
          resolve({ data: rows.slice(start, start + read.limit), error: null });
        },
      };
      return chain;
    });
    const repository = new SupabaseCommunityRepository({
      clientFor: () => ({ from }) as unknown as RepositorySupabaseClient,
    });
    vi.spyOn(repository, "getProfile").mockImplementation(
      async (userId) =>
        ({
          userId,
          status: userId === "peer-2" ? "suspended" : "active",
        }) as never,
    );
    // The route asks for limit + 1 to detect another page.
    const page = await repository.getFollowers(viewer, {
      accessToken: "token",
      limit: 3,
    });
    expect(page.map((item) => item.relationship.id)).toEqual([
      "r1",
      "r3",
      "r4",
    ]);
    expect(reads).toEqual([{ limit: 3 }, { limit: 3, afterId: "r3" }]);
  });
});

describe("batched card reactions", () => {
  const counts = {
    clap: 1,
    fire: 0,
    high_five: 0,
    fist_bump: 0,
    thumbs_up: 0,
  };
  function repositoryWith(failure: Error) {
    const repository = new SupabaseCommunityRepository({
      clientFor: () => ({}) as unknown as RepositorySupabaseClient,
    });
    vi.spyOn(repository, "getReactionsForActivity").mockImplementation(
      async (id) => {
        if (id === "revoked") throw failure;
        return { reactionCounts: counts, viewerReaction: null } as never;
      },
    );
    return repository;
  }
  it("omits a card revoked after the page read instead of failing the page", async () => {
    const map = await repositoryWith(
      new CommunityMutationError("unavailable"),
    ).getReactionsForActivities(["kept", "revoked"], viewer, {
      accessToken: "token",
    });
    expect([...map.keys()]).toEqual(["kept"]);
  });
  it("still rejects the page for other failures", async () => {
    await expect(
      repositoryWith(new Error("database down")).getReactionsForActivities(
        ["kept", "revoked"],
        viewer,
        { accessToken: "token" },
      ),
    ).rejects.toThrow("database down");
  });
});
