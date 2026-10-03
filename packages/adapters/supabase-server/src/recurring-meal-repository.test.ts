import { describe, expect, it, vi } from "vitest";
import type { UserId } from "@mizyun/core";
import { RecurringMealRepositoryError } from "@mizyun/core";
import { SupabaseRecurringMealRepository } from "./recurring-meal-repository.js";
import type { RepositorySupabaseClient } from "./index.js";
const uid = "10000000-0000-4000-8000-000000000001" as UserId;
const input = {
  id: "30000000-0000-4000-8000-000000000001",
  sourceEntryId: "20000000-0000-4000-8000-000000000001",
  localTime: "10:00",
  timeZone: "UTC",
  weekdays: [1],
};
const row = {
  id: input.id,
  user_id: uid,
  name: "Synthetic breakfast",
  local_time: "10:00",
  time_zone: "UTC",
  weekdays: [1],
  enabled: true,
  created_at: "2026-10-03T00:00:00Z",
  updated_at: "2026-10-03T00:00:00Z",
};
function setup(result: {
  data: Record<string, unknown>[];
  error: { code?: string; message: string } | null;
}) {
  const rpc = vi.fn().mockResolvedValue(result);
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  };
  const from = vi.fn().mockReturnValue(query);
  const clientFor = vi
    .fn()
    .mockReturnValue({ rpc, from } as unknown as RepositorySupabaseClient);
  return {
    repo: new SupabaseRecurringMealRepository(clientFor),
    rpc,
    query,
    clientFor,
  };
}
describe("Supabase recurring meal adapter", () => {
  it("uses verified token, owner filter and stopped filter for reads", async () => {
    const { repo, clientFor, query } = setup({ data: [row], error: null });
    const results = await repo.list(uid, { accessToken: "verified" });
    expect(clientFor).toHaveBeenCalledWith("verified");
    expect(query.eq).toHaveBeenCalledWith("user_id", uid);
    expect(query.is).toHaveBeenCalledWith("stopped_at", null);
    expect(results[0]).toMatchObject({
      userId: uid,
      localTime: "10:00",
      timeZone: "UTC",
      createdAt: new Date(row.created_at),
    });
  });
  it("RPC creates carry no caller-selected owner or nutrition and preserve retry ID", async () => {
    const { repo, rpc } = setup({ data: [row], error: null });
    await repo.create(uid, input, { accessToken: "verified" });
    await repo.create(uid, input, { accessToken: "verified" });
    expect(rpc).toHaveBeenNthCalledWith(1, "recurring_meal_create", {
      p_id: input.id,
      p_source: input.sourceEntryId,
      p_time: "10:00",
      p_zone: "UTC",
      p_days: [1],
    });
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
  });
  it("rejects an unexpected foreign create response", async () => {
    const { repo } = setup({
      data: [{ ...row, user_id: "other" }],
      error: null,
    });
    await expect(
      repo.create(uid, input, { accessToken: "verified" }),
    ).rejects.toMatchObject({ kind: "not_found" });
  });
  it.each([
    ["23505", "conflict"],
    ["P0002", "not_found"],
    ["22023", "invalid"],
    ["22P02", "invalid"],
  ])("maps SQL %s without exposing data", async (code, kind) => {
    const { repo } = setup({
      data: [],
      error: { code, message: "sensitive synthetic database detail" },
    });
    await expect(
      repo.create(uid, input, { accessToken: "verified" }),
    ).rejects.toEqual(
      new RecurringMealRepositoryError(
        kind as "conflict" | "not_found" | "invalid",
      ),
    );
  });
  it("patch, skip and stop use atomic owner-bound RPCs", async () => {
    const { repo, rpc } = setup({ data: [{ ok: true }], error: null });
    await repo.skip(uid, input.id, "2026-10-03", { accessToken: "verified" });
    await repo.stop(uid, input.id, { accessToken: "verified" });
    expect(rpc).toHaveBeenCalledWith("recurring_meal_skip", {
      p_id: input.id,
      p_date: "2026-10-03",
    });
    expect(rpc).toHaveBeenCalledWith("recurring_meal_stop", { p_id: input.id });
    const empty = setup({ data: [], error: null });
    expect(
      await empty.repo.update(
        uid,
        input.id,
        { enabled: false },
        { accessToken: "verified" },
      ),
    ).toBeNull();
  });
  it("unknown database failures are generic", async () => {
    const { repo } = setup({
      data: [],
      error: { message: "private meal snapshot" },
    });
    await expect(repo.list(uid, { accessToken: "verified" })).rejects.toThrow(
      "Recurring meal persistence unavailable",
    );
  });
});
