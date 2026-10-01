import { describe, expect, it, vi } from "vitest";
import { CommunityMutationError } from "@mizyun/core";
import { SupabaseCommunityGroupsRepository } from "./community-groups-repository";
import type { RepositorySupabaseClient } from "./index";
import { RepositoryError } from "./repository-error";
describe("group RPC authority", () => {
  it("binds caller token and does no service table reads", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { groups: [] }, error: null });
    const clientFor = vi.fn(
      () => ({ rpc }) as unknown as RepositorySupabaseClient,
    );
    const repo = new SupabaseCommunityGroupsRepository(clientFor);
    await expect(repo.execute("list", {}, "actor-token")).resolves.toEqual({
      groups: [],
    });
    expect(clientFor).toHaveBeenCalledWith("actor-token");
    expect(rpc).toHaveBeenCalledWith("community_groups_rpc", {
      p_operation: "list",
      p_args: {},
    });
  });
  it.each([
    "community_access_denied",
    "community_conflict",
    "community_unavailable",
    "community_rate_limited",
    "community_invalid_action",
  ])("maps expected transactional denial %s", async (message) => {
    const repo = new SupabaseCommunityGroupsRepository(
      () =>
        ({
          rpc: vi.fn().mockResolvedValue({
            data: null,
            error: { code: "P0001", message },
          }),
        }) as unknown as RepositorySupabaseClient,
    );
    await expect(repo.execute("read", {}, "token")).rejects.toBeInstanceOf(
      CommunityMutationError,
    );
  });
  it("scrubs database/provider failure details", async () => {
    const repo = new SupabaseCommunityGroupsRepository(
      () =>
        ({
          rpc: vi.fn().mockResolvedValue({
            data: null,
            error: { code: "XX000", message: "sensitive schema details" },
          }),
        }) as unknown as RepositorySupabaseClient,
    );
    await expect(repo.execute("list", {}, "token")).rejects.toThrow(
      new RepositoryError("Community group operation unavailable"),
    );
  });
});
