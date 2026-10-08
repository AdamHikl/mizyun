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
  filters?: unknown[][];
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
      eq: vi.fn().mockImplementation(function (
        this: unknown,
        ...args: unknown[]
      ) {
        opts.filters?.push(args);
        return this;
      }),
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

  it("recovers a unique-index race using both owner and operation filters", async () => {
    const operation = "11111111-1111-4111-8111-111111111111";
    const filters: unknown[][] = [];
    const clientFor = vi.fn((_token: string) =>
      fakeClient({
        insertSingle: {
          data: null,
          error: { code: "23505", message: "unique violation" },
        },
        selectMaybeSingle: {
          data: { ...measurementRow, client_operation_id: operation },
          error: null,
        },
        filters,
      }),
    );
    const repo = new SupabaseBodyMeasurementRepository({ clientFor });
    const result = await repo.create(
      measurementRow.user_id as UserId,
      {
        id: "22222222-2222-4222-8222-222222222222",
        userId: measurementRow.user_id as UserId,
        clientOperationId: operation,
        measuredAt: new Date(measurementRow.measured_at),
        weightKg: 70,
        measurements: measurementRow.measurements,
        source: "manual",
        createdAt: new Date(measurementRow.created_at),
      },
      { accessToken: "owner-token" },
    );
    expect(result.id).toBe(measurementRow.id);
    expect(result.clientOperationId).toBe(operation);
    expect(filters).toEqual([
      ["user_id", measurementRow.user_id],
      ["client_operation_id", operation],
    ]);
    expect(
      clientFor.mock.calls.every(([token]) => token === "owner-token"),
    ).toBe(true);
  });

  it("does not disguise unrelated insert failures as a successful replay", async () => {
    const filters: unknown[][] = [];
    const repo = new SupabaseBodyMeasurementRepository({
      clientFor: () =>
        fakeClient({
          insertSingle: {
            data: null,
            error: { code: "42501", message: "permission denied" },
          },
          selectMaybeSingle: { data: measurementRow, error: null },
          filters,
        }),
    });
    await expect(
      repo.create(
        measurementRow.user_id as UserId,
        {
          id: measurementRow.id,
          userId: measurementRow.user_id as UserId,
          clientOperationId: "11111111-1111-4111-8111-111111111111",
          measuredAt: new Date(measurementRow.measured_at),
          weightKg: 70,
          measurements: measurementRow.measurements,
          source: "manual",
          createdAt: new Date(measurementRow.created_at),
        },
        { accessToken: "owner-token" },
      ),
    ).rejects.toThrow("permission denied");
    expect(filters).toHaveLength(0);
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
