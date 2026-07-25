import { describe, expect, it, vi } from "vitest";

import type { StoredBodyMeasurement, UserId } from "@mizyun/core";

import { SupabaseBodyMeasurementRepository } from "./body-measurement-repository.js";
import type {
  RepositorySupabaseClient,
  RepositorySingleResult,
  RepositoryListResult,
} from "./index.js";

const measurementRow = {
  id: "00000000-0000-4000-8000-00000000a001",
  user_id: "00000000-0000-4000-8000-000000000001",
  measured_at: "2026-07-15T08:00:00.000Z",
  weight_kg: 70,
  measurements: { body_fat_percent: 18.5 },
  source: "manual",
  created_at: "2026-07-15T08:00:00.000Z",
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

describe("SupabaseBodyMeasurementRepository.create", () => {
  it("returns the parsed stored measurement", async () => {
    const repo = new SupabaseBodyMeasurementRepository({
      clientFor: () =>
        fakeClient({ insertSingle: { data: measurementRow, error: null } }),
    });
    const stored: StoredBodyMeasurement = {
      id: measurementRow.id,
      userId: "00000000-0000-4000-8000-000000000001" as UserId,
      measuredAt: new Date("2026-07-15T08:00:00Z"),
      weightKg: 70,
      measurements: { body_fat_percent: 18.5 },
      source: "manual",
      createdAt: new Date("2026-07-15T08:00:00Z"),
    };
    const result = await repo.create(
      "00000000-0000-4000-8000-000000000001" as UserId,
      stored,
      { accessToken: "token" },
    );
    expect(result.weightKg).toBe(70);
    expect(result.measurements).toEqual({ body_fat_percent: 18.5 });
  });
});

describe("SupabaseBodyMeasurementRepository.list", () => {
  it("returns the parsed list bounded by the date range", async () => {
    const repo = new SupabaseBodyMeasurementRepository({
      clientFor: () =>
        fakeClient({ selectList: { data: [measurementRow], error: null } }),
    });
    const list = await repo.list(
      "00000000-0000-4000-8000-000000000001" as UserId,
      {
        from: new Date("2026-07-01T00:00:00Z"),
        to: new Date("2026-07-31T23:59:59Z"),
        limit: 50,
        accessToken: "token",
      },
    );
    expect(list).toHaveLength(1);
  });
});

describe("SupabaseBodyMeasurementRepository.delete", () => {
  it("returns true when a row was removed", async () => {
    const repo = new SupabaseBodyMeasurementRepository({
      clientFor: () =>
        fakeClient({
          selectList: {
            data: [{ id: measurementRow.id }],
            error: null,
          },
        }),
    });
    const removed = await repo.delete(measurementRow.id, {
      accessToken: "token",
    });
    expect(removed).toBe(true);
  });
});
