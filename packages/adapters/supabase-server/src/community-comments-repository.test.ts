import { describe, expect, it, vi } from "vitest";
import { CommunityMutationError } from "@mizyun/core";
import type { RepositorySupabaseClient } from "./index.js";
import { SupabaseCommunityCommentsRepository } from "./community-comments-repository";
describe("comment adapter transactional authority", () => {
  it("binds the captured user JWT and sends operation IDs intact", async () => {
    const rpc = vi.fn(async () => ({
      data: { id: "comment", version: 1 },
      error: null,
    }));
    const clientFor = vi.fn(
      () => ({ rpc }) as unknown as RepositorySupabaseClient,
    );
    const repository = new SupabaseCommunityCommentsRepository(clientFor);
    await repository.execute(
      "upsert",
      { operationId: "retry", id: "comment", body: "Own text" },
      "captured-jwt",
    );
    expect(clientFor).toHaveBeenCalledWith("captured-jwt");
    expect(rpc).toHaveBeenCalledWith("community_comments", {
      p_operation: "upsert",
      p_args: { operationId: "retry", id: "comment", body: "Own text" },
    });
  });
  it("converts revoked audience denial without exposing database text", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: "P0001", message: "community_unavailable" },
    }));
    const repository = new SupabaseCommunityCommentsRepository(
      () => ({ rpc }) as unknown as RepositorySupabaseClient,
    );
    await expect(repository.execute("list", {}, "jwt")).rejects.toEqual(
      new CommunityMutationError("unavailable"),
    );
  });
});
