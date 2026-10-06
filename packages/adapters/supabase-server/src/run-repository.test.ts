import { describe, expect, it, vi } from "vitest";
import { createRunSummary, type UserId } from "@mizyun/core";
import { SupabaseRunRepository } from "./run-repository.js";
import type { RepositorySupabaseClient } from "./index.js";
const user = "00000000-0000-4000-8000-000000000001" as UserId;
const input = {
  clientOperationId: "00000000-0000-4000-8000-000000000002",
  name: "Run",
  notes: null,
  summary: createRunSummary({
    activityDate: "2026-10-01",
    recordingTimezone: "UTC",
    startedAt: null,
    durationSeconds: 1800,
    distanceMeters: null,
    environment: "unspecified",
    perceivedExertion: null,
  }),
};
describe("SupabaseRunRepository", () => {
  it("uses one authenticated RPC for each atomic mutation and no direct row writes", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const clientFor = vi.fn(
      () => ({ rpc }) as unknown as RepositorySupabaseClient,
    );
    const repo = new SupabaseRunRepository(clientFor);
    await repo.cancel(user, input.clientOperationId, { accessToken: "owner" });
    await repo.remove(user, input.clientOperationId, { accessToken: "owner" });
    expect(clientFor).toHaveBeenNthCalledWith(1, "owner");
    expect(rpc).toHaveBeenNthCalledWith(1, "run_cancel", {
      p_operation: input.clientOperationId,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "run_remove", {
      p_id: input.clientOperationId,
    });
  });
  it.each([
    ["P0003", "removed"],
    ["PT409", "conflict"],
    ["40001", "conflict"],
    ["42501", "not_found"],
    ["22023", "invalid"],
  ])("maps %s without exposing health payloads", async (code, kind) => {
    const repo = new SupabaseRunRepository(
      () =>
        ({
          rpc: vi.fn().mockResolvedValue({
            data: [],
            error: { code, message: "private values" },
          }),
        }) as unknown as RepositorySupabaseClient,
    );
    await expect(
      repo.create(user, input, { accessToken: "owner" }),
    ).rejects.toMatchObject({ kind });
  });
  it("refuses unexpected-owner responses", async () => {
    const repo = new SupabaseRunRepository(
      () =>
        ({
          rpc: vi
            .fn()
            .mockResolvedValue({ data: [{ user_id: "other" }], error: null }),
        }) as unknown as RepositorySupabaseClient,
    );
    await expect(
      repo.create(user, input, { accessToken: "owner" }),
    ).rejects.toMatchObject({ kind: "not_found" });
  });
});
