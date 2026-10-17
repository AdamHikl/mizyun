import { describe, expect, it, vi } from "vitest";

vi.mock("../log-meal/meal-lifecycle-data", () => ({
  fetchFoodHistory: vi.fn(),
  isoLocalDate: (now: Date) =>
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
  entryLocalDate: (entry: { consumedAt: string }) => {
    const d = new Date(entry.consumedAt);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  },
}));

import { loadLoggingHistory } from "./logging-consistency-data";

const entry = (consumedAt: string, confirmedByUser = true) => ({
  consumedAt,
  confirmedByUser,
});
const page = (
  entries: ReturnType<typeof entry>[],
  nextCursor: string | null = null,
  message: string | null = null,
) => ({
  groups: [],
  entries,
  nextCursor,
  cutoffDateIsPartial: false,
  message,
});
const now = new Date(2026, 9, 17, 12, 0, 0);

describe("loadLoggingHistory", () => {
  it("returns distinct local dates for confirmed entries only", async () => {
    const fetchHistory = vi
      .fn()
      .mockResolvedValue(
        page([
          entry(new Date(2026, 9, 16, 8).toISOString()),
          entry(new Date(2026, 9, 16, 19).toISOString()),
          entry(new Date(2026, 9, 14, 23, 30).toISOString()),
          entry(new Date(2026, 9, 13, 9).toISOString(), false),
        ]),
      );
    const result = await loadLoggingHistory(now, fetchHistory as never);
    expect(result).toEqual({
      today: "2026-10-17",
      loggedDates: ["2026-10-14", "2026-10-16"],
    });
    expect(fetchHistory).toHaveBeenCalledWith(
      expect.objectContaining({ from: "2026-09-20", to: "2026-10-17" }),
    );
  });

  it("follows cursors across pages", async () => {
    const fetchHistory = vi
      .fn()
      .mockResolvedValueOnce(
        page([entry(new Date(2026, 9, 16, 8).toISOString())], "c1"),
      )
      .mockResolvedValueOnce(
        page([entry(new Date(2026, 9, 10, 8).toISOString())]),
      );
    const result = await loadLoggingHistory(now, fetchHistory as never);
    expect(result?.loggedDates).toEqual(["2026-10-10", "2026-10-16"]);
  });

  it("treats a failed read as unknown, not zero", async () => {
    const failed = vi.fn().mockResolvedValue(page([], null, "offline"));
    expect(await loadLoggingHistory(now, failed as never)).toBeNull();
    const thrown = vi.fn().mockRejectedValue(new Error("boom"));
    expect(await loadLoggingHistory(now, thrown as never)).toBeNull();
  });

  it("treats a failure after a good first page as unknown", async () => {
    const fetchHistory = vi
      .fn()
      .mockResolvedValueOnce(
        page([entry(new Date(2026, 9, 16, 8).toISOString())], "c1"),
      )
      .mockResolvedValueOnce(page([], null, "offline"));
    expect(await loadLoggingHistory(now, fetchHistory as never)).toBeNull();
  });

  it("treats an incomplete (too many pages) read as unknown", async () => {
    const fetchHistory = vi
      .fn()
      .mockImplementation(async () => page([], "more"));
    expect(await loadLoggingHistory(now, fetchHistory as never)).toBeNull();
  });
});
