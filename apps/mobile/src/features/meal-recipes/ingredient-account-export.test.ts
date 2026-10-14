import { beforeEach, expect, it, vi } from "vitest";
vi.mock("expo-notifications", () => ({ setNotificationChannelAsync: vi.fn() }));
vi.mock("../log-meal/public-data", () => ({
  clearAllMealPhotoRetries: vi.fn().mockResolvedValue(true),
  loadMealCompletionReceipt: vi.fn().mockResolvedValue(null),
}));
vi.mock("../dashboard/public-data", () => ({
  clearQuickMealRepeat: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../analytics/public-data", () => ({
  clearAnalyticsReminder: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/features/health-exports", () => ({
  clearLocalHealthExports: vi.fn(),
}));
import {
  fetchAccountExport,
  saveExportToFile,
} from "../settings/account-data-management";
import { retireIngredientReviews } from "./ingredient-review-lifecycle";
import type { IngredientReviewStore } from "./ingredient-review-storage";
let current: boolean;
let store: IngredientReviewStore;
const owner = "00000000-0000-4000-8000-000000000001";
const recovery = {
  version: "ingredient-review-v1" as const,
  updatedAt: 1000,
  expiresAt: 2000,
  ingredients: [],
  requiresPhotoReselect: true,
  pendingRequest: {
    requestId: "00000000-0000-4000-8000-000000000002",
    startedAt: 1000,
  },
};
const envelope = {
  export: { userId: owner, generatedAt: "2026-10-13T00:00:00Z" },
};
beforeEach(() => {
  current = true;
  store = {
    load: vi.fn(),
    save: vi.fn(),
    clear: vi.fn(),
    export: vi.fn().mockResolvedValue(recovery),
  };
});
const options = () => ({
  expectedUserId: owner,
  isCurrent: () => current,
  recipeReviewStore: store,
});
it("includes only this owner's bounded local ingredient recovery in the saved export", async () => {
  const request = vi.fn().mockResolvedValue({ ok: true, value: envelope });
  const result = await fetchAccountExport({ request } as any, options());
  expect(request).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedUserId: owner,
      isCurrent: expect.any(Function),
    }),
  );
  expect(store.export).toHaveBeenCalledExactlyOnceWith(owner);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const write = vi.fn();
  await saveExportToFile(result.data, () => ({
    uri: "synthetic://export",
    write,
  }));
  expect(
    JSON.parse(write.mock.calls[0]![0]).localRecipeIngredientReview,
  ).toEqual(recovery);
});
it("rejects another server owner before reading locally retained ingredients", async () => {
  expect(
    (
      await fetchAccountExport(
        {
          request: async () => ({
            ok: true,
            value: { export: { ...envelope.export, userId: "other" } },
          }),
        } as any,
        options(),
      )
    ).ok,
  ).toBe(false);
  expect(store.export).not.toHaveBeenCalled();
});
it.each(["owner switch", "consent retirement"])(
  "fences %s during local export read",
  async (kind) => {
    store.export = async () => {
      if (kind === "owner switch") current = false;
      else await retireIngredientReviews(owner);
      return recovery;
    };
    expect(
      (
        await fetchAccountExport(
          { request: async () => ({ ok: true, value: envelope }) } as any,
          options(),
        )
      ).ok,
    ).toBe(false);
  },
);
it("fails visibly when encrypted recovery cannot be read", async () => {
  store.export = async () => {
    throw new Error("sensitive storage failure");
  };
  const result = await fetchAccountExport(
    { request: async () => ({ ok: true, value: envelope }) } as any,
    options(),
  );
  expect(result).toEqual({
    ok: false,
    message: "Could not export account data. Please try again later.",
  });
});

it("exports this owner's retained recipe session and completion receipt, and fails closed on unavailable session storage", async () => {
  const { recovery } = await import("./recipe-fixtures.test-support");
  const { loadMealCompletionReceipt } = await import("../log-meal/public-data");
  vi.mocked(loadMealCompletionReceipt).mockResolvedValue({
    operationIds: ["81000000-0000-4000-8000-000000000001"],
  });
  const sessionStore = {
    load: vi.fn(),
    save: vi.fn(),
    clear: vi.fn(),
    export: vi.fn().mockResolvedValue(recovery()),
  };
  const result = await fetchAccountExport(
    { request: async () => ({ ok: true, value: envelope }) } as any,
    { ...options(), recipeSessionStore: sessionStore },
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.data.export.localRecipeSession).toEqual(recovery());
    expect(result.data.export.localMealCompletionReceipt?.operationIds).toEqual(
      ["81000000-0000-4000-8000-000000000001"],
    );
  }
  expect(sessionStore.export).toHaveBeenCalledExactlyOnceWith(owner);
  sessionStore.export.mockRejectedValue(Error("private"));
  expect(
    (
      await fetchAccountExport(
        { request: async () => ({ ok: true, value: envelope }) } as any,
        { ...options(), recipeSessionStore: sessionStore },
      )
    ).ok,
  ).toBe(false);
});
