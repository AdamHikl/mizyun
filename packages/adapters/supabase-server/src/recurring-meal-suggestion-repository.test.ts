import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserId } from "@mizyun/core";
import { SupabaseRecurringMealSuggestionRepository } from "./recurring-meal-suggestion-repository.js";
import type { RepositorySupabaseClient } from "./index.js";
const uid = "10000000-0000-4000-8000-000000000001" as UserId;
const rows = [11, 12, 13].map((day, index) => ({
  id: `20000000-0000-4000-8000-00000000000${index + 1}`,
  user_id: uid,
  name: "Oats with banana",
  consumed_at: `2026-10-${day}T08:00:00+00:00`,
  created_at: `2026-10-${day}T08:00:00.123456+00:00`,
  updated_at: `2026-10-${day}T08:00:00.123456+00:00`,
  confirmed_by_user: true,
  calories_kcal: 300,
  protein_g: 10,
  carbohydrate_g: 40,
  fat_g: 10,
  details: { grams: 100 },
}));
function setup(
  pages: Record<string, unknown>[][] = [rows],
  context: Record<string, unknown> = {
    userId: uid,
    enabled: true,
    states: [],
    schedules: [],
    generatedEntryIds: [],
  },
) {
  let page = 0;
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    then: (resolve: (v: unknown) => void) =>
      Promise.resolve({ data: pages[page++] ?? [], error: null }).then(resolve),
  };
  const rpc = vi.fn().mockResolvedValue({ data: [{ context }], error: null });
  const clientFor = vi.fn().mockReturnValue({
    from: () => query,
    rpc,
  } as unknown as RepositorySupabaseClient);
  return {
    repo: new SupabaseRecurringMealSuggestionRepository(clientFor),
    query,
    rpc,
    clientFor,
  };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());
describe("owner meal suggestion adapter", () => {
  it("preserves microsecond evidence revisions and never writes food on GET", async () => {
    const { repo, rpc, query, clientFor } = setup();
    const result = await repo.getForUser(
      uid,
      { timeZone: "UTC" },
      { accessToken: "verified" },
    );
    expect(result.suggestion?.sourceUpdatedAt).toBe(
      "2026-10-13T08:00:00.123456Z",
    );
    expect(query.eq).toHaveBeenCalledWith("user_id", uid);
    expect(clientFor).toHaveBeenCalledWith("verified");
    expect(rpc).toHaveBeenCalledWith("recurring_suggestion_context", {
      p_entry_ids: rows.map((r) => r.id),
    });
  });
  it("follows full pages and rejects a repeated cursor instead of offering partial evidence", async () => {
    const full = Array.from({ length: 500 }, (_, index) => ({
      ...rows[index % 3]!,
      name: "Lunch",
      id: `22000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    }));
    const { repo, query } = setup([full, rows]);
    expect(
      (await repo.getForUser(uid, { timeZone: "UTC" }, { accessToken: "v" }))
        .suggestion,
    ).not.toBeNull();
    expect(query.or).toHaveBeenCalledTimes(2);
    const bad = setup([full, full]);
    expect(
      (
        await bad.repo.getForUser(
          uid,
          { timeZone: "UTC" },
          { accessToken: "v" },
        )
      ).suggestion,
    ).toBeNull();
  });
  it("exhausts capped short pages before offering and fails closed when a later page repeats", async () => {
    const capped = setup(rows.map((row) => [row]));
    expect(
      (
        await capped.repo.getForUser(
          uid,
          { timeZone: "UTC" },
          { accessToken: "v" },
        )
      ).suggestion,
    ).not.toBeNull();
    expect(capped.query.or).toHaveBeenCalledTimes(3);
    const incomplete = setup([rows, [rows[0]!]]);
    expect(
      (
        await incomplete.repo.getForUser(
          uid,
          { timeZone: "UTC" },
          { accessToken: "v" },
        )
      ).suggestion,
    ).toBeNull();
    expect(incomplete.rpc).toHaveBeenCalledWith(
      "recurring_suggestion_context",
      { p_entry_ids: [] },
    );
  });
  it("does not treat a successful first page as complete when its successor fails", async () => {
    const { repo, query, rpc } = setup();
    let reads = 0;
    query.then = (resolve: (v: unknown) => void) =>
      Promise.resolve(
        ++reads === 1
          ? { data: rows, error: null }
          : { data: [], error: { message: "Synthetic read failure" } },
      ).then(resolve);
    await expect(
      repo.getForUser(uid, { timeZone: "UTC" }, { accessToken: "v" }),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("returns no suggestion for an unrepresentable saved serving", async () => {
    const { repo } = setup([
      rows.map((row) => ({ ...row, details: { grams: 20001 } })),
    ]);
    expect(
      (await repo.getForUser(uid, { timeZone: "UTC" }, { accessToken: "v" }))
        .suggestion,
    ).toBeNull();
  });
  it("authoritative ledger excludes a generated row even when its marker was edited away", async () => {
    const { repo } = setup([rows], {
      userId: uid,
      enabled: true,
      states: [],
      schedules: [],
      generatedEntryIds: [rows[2]!.id],
    });
    expect(
      (await repo.getForUser(uid, { timeZone: "UTC" }, { accessToken: "v" }))
        .suggestion,
    ).toBeNull();
  });
  it("Not now expires after thirty days and ignored offers after seven plus thirty", async () => {
    const state = {
      user_id: uid,
      family_key: "oats with banana",
      never: false,
      accepted_schedule_id: null,
      first_shown_at: "2026-09-13T09:00:00Z",
      expires_at: "2026-09-20T09:00:00Z",
      cooldown_until: "2026-10-13T09:00:00Z",
    };
    const eligible = setup([rows], {
      userId: uid,
      enabled: true,
      states: [state],
      schedules: [],
      generatedEntryIds: [],
    });
    expect(
      (
        await eligible.repo.getForUser(
          uid,
          { timeZone: "UTC" },
          { accessToken: "v" },
        )
      ).suggestion,
    ).not.toBeNull();
    const blocked = setup([rows], {
      userId: uid,
      enabled: true,
      states: [{ ...state, cooldown_until: "2026-10-13T11:00:00Z" }],
      schedules: [],
      generatedEntryIds: [],
    });
    expect(
      (
        await blocked.repo.getForUser(
          uid,
          { timeZone: "UTC" },
          { accessToken: "v" },
        )
      ).suggestion,
    ).toBeNull();
    const ignored = setup([rows], {
      userId: uid,
      enabled: true,
      states: [
        {
          ...state,
          first_shown_at: "2026-09-06T09:00:00Z",
          expires_at: "2026-09-13T11:00:00Z",
          cooldown_until: null,
        },
      ],
      schedules: [],
      generatedEntryIds: [],
    });
    expect(
      (
        await ignored.repo.getForUser(
          uid,
          { timeZone: "UTC" },
          { accessToken: "v" },
        )
      ).suggestion,
    ).toBeNull();
  });
  it("refuses foreign row/context projections", async () => {
    const foreign = setup([[{ ...rows[0]!, user_id: "other" }]]);
    await expect(
      foreign.repo.getForUser(uid, { timeZone: "UTC" }, { accessToken: "v" }),
    ).rejects.toMatchObject({ kind: "not_found" });
    const context = setup([rows], { userId: "other" });
    await expect(
      context.repo.getForUser(uid, { timeZone: "UTC" }, { accessToken: "v" }),
    ).rejects.toMatchObject({ kind: "not_found" });
  });
  it("passes immutable owner-free request to acceptance and rejects foreign response", async () => {
    const { repo, rpc } = setup();
    const proposal = (
      await repo.getForUser(uid, { timeZone: "UTC" }, { accessToken: "v" })
    ).suggestion!;
    const input = {
      operationId: "30000000-0000-4000-8000-000000000001",
      proposal,
      localTime: "09:15",
      timeZone: "UTC",
      weekdays: [1],
    };
    rpc.mockResolvedValueOnce({
      data: [
        {
          result: {
            schedule: {
              id: input.operationId,
              user_id: uid,
              name: proposal.name,
              local_time: "09:15",
              time_zone: "UTC",
              weekdays: [1],
              enabled: false,
              created_at: "2026-10-13T08:00:00Z",
              updated_at: "2026-10-13T09:00:00Z",
            },
            created: true,
            startLocalDate: "2026-10-19",
          },
        },
      ],
      error: null,
    });
    const result = await repo.accept(uid, input, { accessToken: "v" });
    expect(result.recurringMeal.enabled).toBe(false);
    expect(rpc).toHaveBeenLastCalledWith("recurring_suggestion_accept", {
      p_request: input,
    });
    rpc.mockResolvedValueOnce({
      data: [{ result: { schedule: { user_id: "other" } } }],
      error: null,
    });
    await expect(
      repo.accept(uid, input, { accessToken: "v" }),
    ).rejects.toMatchObject({ kind: "not_found" });
  });
  it.each([
    ["23505", "conflict"],
    ["42501", "not_found"],
    ["22023", "invalid"],
    ["XX000", "unavailable"],
  ])(
    "maps %s without exposing sensitive database detail",
    async (code, kind) => {
      const { repo, rpc } = setup();
      rpc.mockResolvedValue({
        data: [],
        error: { code, message: "private meal and evidence" },
      });
      await expect(
        repo.getPreferences(uid, { accessToken: "v" }),
      ).rejects.toMatchObject({
        kind,
        message: `Recurring meal suggestion ${kind}`,
      });
    },
  );
  it("preference/reset/erase use narrow authenticated RPCs", async () => {
    const { repo, rpc } = setup();
    rpc.mockResolvedValue({
      data: [{ enabled: false, ok: true }],
      error: null,
    });
    await repo.setPreferences(uid, { enabled: false }, { accessToken: "v" });
    await repo.resetDecisions(uid, { accessToken: "v" });
    await repo.clearForUser(uid, { accessToken: "v" });
    expect(rpc.mock.calls.map((c) => c[0])).toEqual([
      "recurring_suggestion_preferences",
      "recurring_suggestion_preferences",
      "recurring_suggestion_clear",
    ]);
  });
});
