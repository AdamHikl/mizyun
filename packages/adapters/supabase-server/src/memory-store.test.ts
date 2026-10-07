import { describe, expect, it, vi } from "vitest";
import type { MemoryId, UserId } from "@mizyun/core";

import type {
  RepositoryListResult,
  RepositorySupabaseClient,
} from "./index.js";
import { SupabaseMemoryStore } from "./memory-store.js";

const userId = "00000000-0000-4000-8000-000000000001" as UserId;
const row = (
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> => ({
  id: "00000000-0000-4000-8000-000000000011",
  user_id: userId,
  kind: "preference",
  content: "Prefers morning workouts",
  source: "user",
  confidence: 0.9,
  importance: 5,
  status: "active",
  metadata: {},
  expires_at: null,
  created_at: "2026-07-26T10:00:00.000Z",
  updated_at: "2026-07-26T10:00:00.000Z",
  ...overrides,
});

const fakeClient = (options: {
  readonly rows?: readonly Record<string, unknown>[];
  readonly single?: Record<string, unknown>;
}): RepositorySupabaseClient => ({
  from: () => {
    const builder = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: options.single ?? null,
        error: null,
      }),
      single: vi.fn().mockResolvedValue({
        data: options.single ?? null,
        error: null,
      }),
      then: (
        resolve: (value: RepositoryListResult<Record<string, unknown>>) => void,
      ) => resolve({ data: [...(options.rows ?? [])], error: null }),
    };
    return builder as unknown as never;
  },
  rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  auth: {
    setSession: vi.fn().mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    }),
  },
});

describe("SupabaseMemoryStore authorization and recall", () => {
  it("uses the verified access token for save, never the user id", async () => {
    const client = fakeClient({ single: row() });
    const clientFor = vi.fn(() => client);
    const store = new SupabaseMemoryStore({ clientFor });
    await store.save(
      {
        id: "00000000-0000-4000-8000-000000000011" as MemoryId,
        userId,
        kind: "preference",
        content: "Prefers morning workouts",
        source: "user",
        confidence: 1,
        importance: 5,
        status: "candidate",
      },
      { accessToken: "verified-access-token" },
    );
    expect(clientFor).toHaveBeenCalledWith("verified-access-token");
    expect(clientFor).not.toHaveBeenCalledWith(userId);
  });

  it("uses the verified token and filters candidates from recall", async () => {
    const client = fakeClient({
      rows: [row(), row({ id: crypto.randomUUID(), status: "candidate" })],
    });
    const clientFor = vi.fn(() => client);
    const store = new SupabaseMemoryStore({ clientFor });
    const results = await store.search({
      userId,
      accessToken: "verified-access-token",
      text: "",
      limit: 12,
      asOf: new Date("2026-07-26T12:00:00Z"),
    });
    expect(clientFor).toHaveBeenCalledWith("verified-access-token");
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("active");
  });
  it("exports more than 10,000 memories under a smaller server cap, including all retained states", async () => {
    const states = ["active", "candidate", "superseded", "deleted"];
    const ledger = Array.from({ length: 10_003 }, (_, index) =>
      row({
        id: String(index).padStart(8, "0"),
        status: states[index % states.length],
      }),
    );
    const queries: { owner?: string; orders: string[]; from?: number }[] = [];
    const client = {
      from: (table: string) => {
        expect(table).toBe("memory_items");
        const observed: (typeof queries)[number] = { orders: [] };
        queries.push(observed);
        const q = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn((column: string, owner: string) => {
            expect(column).toBe("user_id");
            observed.owner = owner;
            return q;
          }),
          order: vi.fn((column: string) => {
            observed.orders.push(column);
            return q;
          }),
          range: vi.fn(async (from: number, to: number) => {
            observed.from = from;
            return {
              data: ledger.slice(from, Math.min(to + 1, from + 137)),
              error: null,
            };
          }),
        };
        return q;
      },
    } as unknown as RepositorySupabaseClient;
    const clientFor = vi.fn(() => client);
    const result = await new SupabaseMemoryStore({ clientFor }).exportForUser(
      userId,
      { accessToken: "verified-token" },
    );
    expect(result.map((m) => m.id)).toEqual(ledger.map((m) => m.id));
    expect(new Set(result.map((m) => m.status))).toEqual(new Set(states));
    expect(
      queries.every(
        (q) => q.owner === userId && q.orders.join(",") === "created_at,id",
      ),
    ).toBe(true);
    expect(queries.at(-1)?.from).toBe(ledger.length);
    expect(clientFor).toHaveBeenCalledWith("verified-token");
  });

  it("rejects memory export without an access token before creating a client", async () => {
    const clientFor = vi.fn();
    await expect(
      new SupabaseMemoryStore({ clientFor }).exportForUser(userId, {
        accessToken: "",
      }),
    ).rejects.toThrow("verified access token");
    expect(clientFor).not.toHaveBeenCalled();
  });
});
