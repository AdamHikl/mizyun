import { describe, expect, it, vi } from "vitest";
import type { UserFeedback, UserId } from "@mizyun/core";

import { SupabaseFeedbackRepository } from "./feedback-repository.js";
import type {
  RepositoryListResult,
  RepositorySingleResult,
  RepositorySupabaseClient,
} from "./index.js";

const feedbackRow = {
  id: "00000000-0000-4000-8000-00000000f001",
  user_id: "00000000-0000-4000-8000-000000000001",
  category: "like",
  rating: 5,
  message: "I love the clean interface!",
  context: { platform: "ios" },
  media_asset_ids: ["00000000-0000-4000-8000-00000000m001"],
  created_at: "2026-08-24T10:00:00.000Z",
};

const fakeClient = (opts: {
  selectMaybeSingle?: RepositorySingleResult<unknown>;
  insertSingle?: RepositorySingleResult<unknown>;
  selectList?: RepositoryListResult<unknown>;
}): RepositorySupabaseClient => ({
  from: (_t?: string) => {
    const builder = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue(opts.insertSingle ?? null),
      maybeSingle: vi.fn().mockResolvedValue(opts.selectMaybeSingle ?? null),
      then: (resolve: (v: RepositoryListResult<unknown>) => void) => {
        resolve(opts.selectList ?? { data: [], error: null });
      },
    };
    return builder as unknown as never;
  },
  rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  auth: {
    setSession: vi.fn().mockResolvedValue({
      data: { user: { id: "00000000-0000-4000-8000-000000000001" } },
      error: null,
    }),
  },
});

describe("SupabaseFeedbackRepository.create", () => {
  it("returns the parsed stored feedback", async () => {
    const repo = new SupabaseFeedbackRepository({
      clientFor: () =>
        fakeClient({ insertSingle: { data: feedbackRow, error: null } }),
    });
    const item: UserFeedback = {
      id: feedbackRow.id,
      userId: "00000000-0000-4000-8000-000000000001" as UserId,
      category: "like",
      rating: 5,
      message: "I love the clean interface!",
      context: { platform: "ios" },
      mediaAssetIds: ["00000000-0000-4000-8000-00000000m001"],
      createdAt: new Date("2026-08-24T10:00:00.000Z"),
    };
    const result = await repo.create(
      "00000000-0000-4000-8000-000000000001" as UserId,
      item,
      { accessToken: "token" },
    );
    expect(result.id).toBe(feedbackRow.id);
    expect(result.category).toBe("like");
    expect(result.rating).toBe(5);
    expect(result.message).toBe("I love the clean interface!");
    expect(result.context).toEqual({ platform: "ios" });
    expect(result.mediaAssetIds).toEqual([
      "00000000-0000-4000-8000-00000000m001",
    ]);
  });
});

describe("SupabaseFeedbackRepository.listForUser", () => {
  it("returns the parsed feedback list for the user", async () => {
    const repo = new SupabaseFeedbackRepository({
      clientFor: () =>
        fakeClient({ selectList: { data: [feedbackRow], error: null } }),
    });
    const list = await repo.listForUser(
      "00000000-0000-4000-8000-000000000001" as UserId,
      { accessToken: "token", limit: 10 },
    );
    expect(list).toHaveLength(1);
    expect(list[0]?.category).toBe("like");
  });
});

describe("SupabaseFeedbackRepository.deleteAllForUser", () => {
  it("returns count of deleted items", async () => {
    const repo = new SupabaseFeedbackRepository({
      clientFor: () =>
        fakeClient({
          selectList: {
            data: [{ id: feedbackRow.id }],
            error: null,
          },
        }),
    });
    const count = await repo.deleteAllForUser(
      "00000000-0000-4000-8000-000000000001" as UserId,
      { accessToken: "token" },
    );
    expect(count).toBe(1);
  });
});
