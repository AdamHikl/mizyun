import { describe, expect, it, vi } from "vitest";
import {
  HEALTH_EXPORT_CAPACITY,
  HEALTH_EXPORT_MAX_BYTES,
  SecureHealthExportStorage,
  type HealthExportMapping,
} from "./export-storage";

vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7 }));
const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const mapping = (n = 3): HealthExportMapping => ({
  schemaVersion: 1,
  installationId: id(1),
  accountId: id(2),
  sourceId: id(n),
  operation: {
    type: "upsert",
    category: "nutrition",
    clientId: id(n + 100),
    revision: 1,
    nutrition: {
      consumedAt: "2026-10-06T10:00:00Z",
      energyKcal: 100,
      proteinG: null,
      carbsG: null,
      fatG: null,
    },
  },
  pending: true,
  acknowledgedComponents: [],
  cleanupIntervals: [
    { from: "2026-10-06T10:00:00Z", to: "2026-10-06T10:00:00Z" },
  ],
});
function fixture() {
  const data = new Map<string, string>();
  const store = {
    getItemAsync: vi.fn(async (key: string) => data.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      data.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key: string) => {
      data.delete(key);
    }),
  };
  return { data, store, storage: new SecureHealthExportStorage(store) };
}
describe("device-bound export storage", () => {
  it("persists each mapping atomically within the small-value budget and secure options", async () => {
    const { storage, store, data } = fixture();
    await storage.save(mapping());
    expect(data.size).toBe(1);
    expect([...data.values()][0]!.length).toBeLessThanOrEqual(
      HEALTH_EXPORT_MAX_BYTES,
    );
    expect(store.setItemAsync).toHaveBeenCalledWith(
      "mizyun.health-export.v1.slot.0",
      expect.any(String),
      { keychainAccessible: 7 },
    );
    expect(await storage.load(id(2), id(1))).toEqual([mapping()]);
    expect(await storage.load(id(9), id(1))).toEqual([]);
    expect(await storage.load(id(2), id(9))).toEqual([]);
  });
  it("retains completed identities, reports full capacity, and still permits edits", async () => {
    const { storage } = fixture();
    for (let n = 0; n < HEALTH_EXPORT_CAPACITY; n++)
      await storage.save({ ...mapping(n + 3), pending: false });
    await expect(storage.save(mapping(999))).rejects.toMatchObject({
      code: "storage_full",
    });
    const edited = {
      ...mapping(),
      operation: { ...mapping().operation, revision: 2 },
    };
    await storage.save(edited);
    expect((await storage.load(id(2), id(1)))[0]).toEqual(edited);
  });
  it("reuses old-install slots but never loads or replays their records", async () => {
    const { storage, data } = fixture();
    await storage.save(mapping());
    await storage.save({ ...mapping(4), installationId: id(99) });
    expect(data.size).toBe(1);
    expect(await storage.load(id(2), id(1))).toEqual([]);
    expect((await storage.load(id(2), id(99)))[0]?.sourceId).toBe(id(4));
  });
  it("fails closed on corrupt health payloads without returning private exception text", async () => {
    const { storage, data, store } = fixture();
    data.set(
      "mizyun.health-export.v1.slot.0",
      JSON.stringify({ ...mapping(), privateNote: "synthetic private value" }),
    );
    await expect(storage.load(id(2), id(1))).rejects.toThrow("storage_invalid");
    data.clear();
    store.getItemAsync.mockRejectedValueOnce(
      new Error("private platform payload"),
    );
    await expect(storage.load(id(2), id(1))).rejects.toThrow("storage_failed");
  });
  it("preserves the persisted identity after storage failures and rejects stale overwrites", async () => {
    const { storage, store } = fixture();
    await storage.save(mapping());
    store.setItemAsync.mockRejectedValueOnce(new Error("device locked"));
    await expect(
      storage.save({
        ...mapping(),
        operation: { ...mapping().operation, revision: 2 },
      }),
    ).rejects.toThrow("storage_failed");
    expect(await storage.load(id(2), id(1))).toEqual([mapping()]);
    await expect(
      storage.save({
        ...mapping(),
        operation: { ...mapping().operation, clientId: id(777) },
      }),
    ).rejects.toThrow("storage_invalid");
  });
  it("clears only captured account mappings and surfaces failed deletion", async () => {
    const { storage, store } = fixture();
    await storage.save(mapping());
    await storage.save({ ...mapping(4), accountId: id(9) });
    store.deleteItemAsync.mockRejectedValueOnce(new Error("private detail"));
    await expect(storage.clearAccount(id(2), id(1))).rejects.toThrow(
      "storage_failed",
    );
    expect(await storage.load(id(2), id(1))).toHaveLength(1);
    await storage.clearAccount(id(2), id(1));
    expect(await storage.load(id(2), id(1))).toEqual([]);
    expect(await storage.load(id(9), id(1))).toHaveLength(1);
  });
  it("purges an account across installations without affecting other accounts", async () => {
    const { storage, data, store } = fixture();
    data.set("mizyun.health-export.v1.slot.0", JSON.stringify(mapping()));
    data.set(
      "mizyun.health-export.v1.slot.1",
      JSON.stringify({ ...mapping(4), installationId: id(99) }),
    );
    data.set(
      "mizyun.health-export.v1.slot.2",
      JSON.stringify({
        ...mapping(5),
        accountId: id(9),
        installationId: id(99),
      }),
    );
    await storage.clearAccount(id(2));
    expect(store.deleteItemAsync).toHaveBeenCalledTimes(2);
    expect(await storage.load(id(2), id(1))).toEqual([]);
    expect(await storage.load(id(2), id(99))).toEqual([]);
    expect(await storage.load(id(9), id(99))).toHaveLength(1);
  });
  it("fails closed on a corrupt slot before any unfiltered purge", async () => {
    const { storage, data, store } = fixture();
    await storage.save(mapping());
    data.set("mizyun.health-export.v1.slot.1", "invalid private fixture");
    await expect(storage.clearAccount(id(2))).rejects.toThrow(
      "storage_invalid",
    );
    expect(store.deleteItemAsync).not.toHaveBeenCalled();
    expect(data.has("mizyun.health-export.v1.slot.0")).toBe(true);
  });
});
