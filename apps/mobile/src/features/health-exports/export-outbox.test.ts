import { describe, expect, it, vi } from "vitest";
import type {
  HealthExportConfirmation,
  HealthNutritionExportSource,
  HealthWorkoutExportSource,
} from "@mizyun/core";
import { HealthExportOutbox, type HealthExportWriter } from "./export-outbox";
import { SecureHealthExportStorage } from "./export-storage";
import type { HealthExportResult } from "../../../modules/mizyun-health-export";

const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const ready = (): HealthExportResult => ({
  status: "ready",
  writeAccess: "granted",
  acknowledgedComponents: ["nutrition", "workout"],
});
const source = (): HealthNutritionExportSource => ({
  id: id(3),
  source: "manual",
  updatedAt: "2026-10-06T10:00:00Z",
  details: {},
  confirmedByUser: true,
  consumedAt: "2026-10-06T10:00:00Z",
  caloriesKcal: 300,
  proteinG: 20,
  carbohydrateG: null,
  fatG: 5,
});
const marker = (record = source()): HealthExportConfirmation => ({
  schemaVersion: 1,
  recordId: record.id,
  savedUpdatedAt: record.updatedAt,
  origin: "mizyun_user_entered",
  rights: "first_party",
  derivedFrom: [],
  timeBasis: "observed",
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const data = new Map<string, string>();
  const secure = {
    getItemAsync: vi.fn(async (key: string) => data.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      data.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key: string) => {
      data.delete(key);
    }),
  };
  const storage = new SecureHealthExportStorage(secure);
  const writer: HealthExportWriter = {
    installationIdAsync: vi.fn(async () => id(1)),
    availabilityAsync: vi.fn(async () => ready()),
    requestWritePermissionAsync: vi.fn(async () => ready()),
    applyOperationAsync: vi.fn(async () => ready()),
    invalidateAsync: vi.fn(async () => undefined),
  };
  let next = 100;
  const uuid = vi.fn(() => id(next++));
  const outbox = new HealthExportOutbox(storage, writer, uuid);
  return { data, secure, storage, writer, uuid, outbox };
}
describe("foreground health export outbox", () => {
  it("deletes every retained old and edited interval after a lost response and disabled time edit", async () => {
    const { outbox, writer, storage } = fixture();
    await outbox.activate(id(2));
    await outbox.enable("nutrition");
    vi.mocked(writer.applyOperationAsync).mockRejectedValueOnce(
      new Error("lost acknowledgement"),
    );
    await outbox.enqueueNutrition(id(2), source(), marker());
    outbox.disable("nutrition");
    const edited = { ...source(), consumedAt: "2026-10-05T09:00:00Z" };
    await outbox.enqueueNutrition(id(2), edited, marker(edited));
    await outbox.deleteRecord(id(2), "nutrition", source().id);
    const beforeRetry = (await storage.load(id(2), id(1)))[0]!;
    expect(beforeRetry.cleanupIntervals).toEqual([
      { from: source().consumedAt, to: source().consumedAt },
      { from: edited.consumedAt, to: edited.consumedAt },
    ]);
    await outbox.enable("nutrition");
    vi.mocked(writer.applyOperationAsync)
      .mockResolvedValueOnce(ready())
      .mockResolvedValueOnce({
        status: "partial",
        writeAccess: "partial",
        acknowledgedComponents: ["energy"],
      });
    await outbox.retry();
    expect(outbox.getSnapshot().pending.nutrition).toBe(1);
    expect((await storage.load(id(2), id(1)))[0]!.cleanupIntervals).toEqual([
      { from: edited.consumedAt, to: edited.consumedAt },
    ]);
    await outbox.retry();
    const calls = vi
      .mocked(writer.applyOperationAsync)
      .mock.calls.map(([operation]) => operation);
    expect(
      calls.slice(1).map((operation) => operation.nutrition?.consumedAt),
    ).toEqual([source().consumedAt, edited.consumedAt, edited.consumedAt]);
    expect(calls.slice(1).map((operation) => operation.revision)).toEqual([
      3, 3, 3,
    ]);
    expect(new Set(calls.map((operation) => operation.clientId)).size).toBe(1);
    expect(outbox.getSnapshot().pending.nutrition).toBe(0);
  });
  it("retains acknowledged interval authority when many paused edits exceed the storage bound", async () => {
    const { outbox, writer, storage } = fixture();
    await outbox.activate(id(2));
    await outbox.enable("nutrition");
    await outbox.enqueueNutrition(id(2), source(), marker());
    outbox.disable("nutrition");
    for (let hour = 11; hour <= 18; hour++) {
      const edited = { ...source(), consumedAt: `2026-10-06T${hour}:00:00Z` };
      await outbox.enqueueNutrition(id(2), edited, marker(edited));
    }
    expect(outbox.getSnapshot().errorCode).toBe("storage_full");
    const retained = (await storage.load(id(2), id(1)))[0]!;
    expect(retained.cleanupIntervals).toHaveLength(8);
    expect(retained.cleanupIntervals[0]!.from).toBe(source().consumedAt);
    expect(retained.operation.revision).toBe(8);
    expect(writer.applyOperationAsync).toHaveBeenCalledTimes(1);
  });
  it("does not mint an export for an unknown generic edit and reconciles a toggle during durable storage", async () => {
    const { outbox, writer, secure, data } = fixture();
    await outbox.activate(id(2));
    await outbox.enable("nutrition");
    await outbox.enqueueNutrition(id(2), source(), marker(), true);
    expect(data.size).toBe(0);
    const storageWrite = deferred<void>();
    secure.setItemAsync.mockImplementationOnce(async (key, value) => {
      await storageWrite.promise;
      data.set(key, value);
    });
    const save = outbox.enqueueNutrition(id(2), source(), marker());
    await vi.waitFor(() =>
      expect(secure.setItemAsync).toHaveBeenCalledTimes(1),
    );
    outbox.disable("nutrition");
    storageWrite.resolve();
    await save;
    expect(writer.applyOperationAsync).not.toHaveBeenCalled();
    await outbox.enable("nutrition");
    await outbox.retry();
    expect(writer.applyOperationAsync).toHaveBeenCalledTimes(1);
    expect(data.size).toBe(1);
  });
  it("does not dispatch a restored queue from another installation even after an explicit grant", async () => {
    const { outbox, writer, storage, uuid } = fixture();
    await outbox.activate(id(2));
    await outbox.enable("nutrition");
    vi.mocked(writer.applyOperationAsync).mockRejectedValueOnce(
      new Error("lost response"),
    );
    await outbox.enqueueNutrition(id(2), source(), marker());
    vi.mocked(writer.installationIdAsync).mockResolvedValue(id(999));
    const restored = new HealthExportOutbox(storage, writer, uuid);
    await restored.activate(id(2));
    await restored.enable("nutrition");
    await restored.retry();
    expect(restored.getSnapshot().pending.nutrition).toBe(0);
    expect(writer.applyOperationAsync).toHaveBeenCalledTimes(1);
  });
  it("keeps denied permission off and never requests permission from save or retry", async () => {
    const { outbox, writer, data } = fixture();
    await outbox.activate(id(2));
    vi.mocked(writer.requestWritePermissionAsync).mockResolvedValueOnce({
      status: "permission_required",
      writeAccess: "denied",
      acknowledgedComponents: [],
    });
    await outbox.enable("nutrition");
    await outbox.enqueueNutrition(id(2), source(), marker());
    await outbox.retry();
    expect(outbox.getSnapshot().enabled.nutrition).toBe(false);
    expect(writer.requestWritePermissionAsync).toHaveBeenCalledTimes(1);
    expect(writer.applyOperationAsync).not.toHaveBeenCalled();
    expect(data.size).toBe(0);
  });
  it("requires deliberate separate grants and does not queue disabled new saves", async () => {
    const { outbox, writer, data } = fixture();
    await outbox.activate(id(2));
    await outbox.enqueueNutrition(id(2), source(), marker());
    expect(data.size).toBe(0);
    expect(writer.requestWritePermissionAsync).not.toHaveBeenCalled();
    await outbox.enable("workout");
    await outbox.enqueueNutrition(id(2), source(), marker());
    expect(data.size).toBe(0);
    await outbox.enable("nutrition");
    await outbox.enqueueNutrition(id(2), source(), marker());
    expect(writer.requestWritePermissionAsync).toHaveBeenCalledTimes(2);
    expect(writer.applyOperationAsync).toHaveBeenCalledTimes(1);
    expect(outbox.getSnapshot().pending.nutrition).toBe(0);
  });
  it("keeps exact identities across ambiguous response, restart, enable and explicit retry", async () => {
    const { outbox, writer, storage, uuid } = fixture();
    await outbox.activate(id(2));
    await outbox.enable("nutrition");
    vi.mocked(writer.applyOperationAsync).mockRejectedValueOnce(
      new Error("lost response with private data"),
    );
    await outbox.enqueueNutrition(id(2), source(), marker());
    const operation = vi.mocked(writer.applyOperationAsync).mock.calls[0]![0];
    expect(outbox.getSnapshot()).toMatchObject({
      phase: "error",
      errorCode: "native_failed",
      pending: { nutrition: 1 },
    });
    const restored = new HealthExportOutbox(storage, writer, uuid);
    await restored.activate(id(2));
    await restored.retry();
    expect(writer.applyOperationAsync).toHaveBeenCalledTimes(1);
    expect(restored.getSnapshot().enabled.nutrition).toBe(false);
    await restored.enable("nutrition");
    expect(writer.applyOperationAsync).toHaveBeenCalledTimes(1);
    await restored.retry();
    expect(vi.mocked(writer.applyOperationAsync).mock.calls[1]![0]).toEqual(
      operation,
    );
    expect(uuid).toHaveBeenCalledTimes(1);
    expect(restored.getSnapshot().pending.nutrition).toBe(0);
  });
  it("persists partial component acknowledgement and retries the unchanged revision", async () => {
    const { outbox, writer, storage, uuid } = fixture();
    await outbox.activate(id(2));
    await outbox.enable("nutrition");
    vi.mocked(writer.applyOperationAsync).mockResolvedValueOnce({
      status: "partial",
      writeAccess: "partial",
      acknowledgedComponents: ["energy", "protein"],
    });
    await outbox.enqueueNutrition(id(2), source(), marker());
    expect(outbox.getSnapshot()).toMatchObject({
      phase: "partial",
      pending: { nutrition: 1 },
    });
    const restored = new HealthExportOutbox(storage, writer, uuid);
    await restored.activate(id(2));
    await restored.enable("nutrition");
    vi.mocked(writer.applyOperationAsync).mockResolvedValueOnce({
      status: "ready",
      writeAccess: "granted",
      acknowledgedComponents: ["carbs", "fat"],
    });
    await restored.retry();
    expect(restored.getSnapshot().pending.nutrition).toBe(0);
    expect(vi.mocked(writer.applyOperationAsync).mock.calls[1]![0]).toEqual(
      vi.mocked(writer.applyOperationAsync).mock.calls[0]![0],
    );
  });
  it("never uses another account's queue or late native acknowledgement", async () => {
    const { outbox, writer, storage } = fixture();
    await outbox.activate(id(2));
    await outbox.enable("nutrition");
    const response = deferred<HealthExportResult>();
    vi.mocked(writer.applyOperationAsync).mockImplementationOnce(
      () => response.promise,
    );
    const enqueued = outbox.enqueueNutrition(id(2), source(), marker());
    await vi.waitFor(() =>
      expect(writer.applyOperationAsync).toHaveBeenCalledTimes(1),
    );
    const switched = outbox.activate(id(9));
    expect(outbox.getSnapshot().enabled.nutrition).toBe(false);
    response.resolve(ready());
    await enqueued;
    await switched;
    await outbox.enable("nutrition");
    await outbox.retry();
    expect(writer.applyOperationAsync).toHaveBeenCalledTimes(1);
    expect((await storage.load(id(2), id(1)))[0]!.pending).toBe(true);
    await outbox.activate(id(2));
    await outbox.enable("nutrition");
    await outbox.retry();
    expect(writer.applyOperationAsync).toHaveBeenCalledTimes(2);
  });
  it("disabling during native dispatch suppresses completion and prompts, then retry reconciles", async () => {
    const { outbox, writer, storage } = fixture();
    await outbox.activate(id(2));
    await outbox.enable("nutrition");
    const response = deferred<HealthExportResult>();
    vi.mocked(writer.applyOperationAsync).mockImplementationOnce(
      () => response.promise,
    );
    const enqueued = outbox.enqueueNutrition(id(2), source(), marker());
    await vi.waitFor(() =>
      expect(writer.applyOperationAsync).toHaveBeenCalledTimes(1),
    );
    outbox.disable("nutrition");
    response.resolve(ready());
    await enqueued;
    expect((await storage.load(id(2), id(1)))[0]!.pending).toBe(true);
    await outbox.retry();
    expect(writer.applyOperationAsync).toHaveBeenCalledTimes(1);
    await outbox.enable("nutrition");
    await outbox.retry();
    expect(writer.applyOperationAsync).toHaveBeenCalledTimes(2);
    expect(writer.requestWritePermissionAsync).toHaveBeenCalledTimes(2);
  });
  it("preserves mappings and monotonic revisions for edit and delete, with no repeated completion writes", async () => {
    const { outbox, writer } = fixture();
    await outbox.activate(id(2));
    await outbox.enable("nutrition");
    await outbox.enqueueNutrition(id(2), source(), marker());
    await outbox.enqueueNutrition(id(2), source(), marker());
    expect(writer.applyOperationAsync).toHaveBeenCalledTimes(1);
    const edited = {
      ...source(),
      caloriesKcal: 400,
      updatedAt: "2026-10-06T10:01:00Z",
    };
    await outbox.enqueueNutrition(id(2), edited, marker(edited));
    await outbox.deleteRecord(id(2), "nutrition", source().id);
    const operations = vi
      .mocked(writer.applyOperationAsync)
      .mock.calls.map(([operation]) => operation);
    expect(operations.map((operation) => operation.revision)).toEqual([
      1, 2, 3,
    ]);
    expect(
      new Set(operations.map((operation) => operation.clientId)).size,
    ).toBe(1);
    expect(operations[2]).toMatchObject({
      type: "delete",
      nutrition: { energyKcal: 400, consumedAt: source().consumedAt },
    });
    expect(await outbox.hasRecord(id(2), "nutrition", source().id)).toBe(true);
  });
  it("ineligible edits retire an existing own mapping but unknown legacy records remain excluded", async () => {
    const { outbox, writer } = fixture();
    await outbox.activate(id(2));
    await outbox.enable("nutrition");
    const imported = { ...source(), source: "health_connect" };
    await outbox.enqueueNutrition(id(2), imported, marker(imported));
    expect(writer.applyOperationAsync).not.toHaveBeenCalled();
    await outbox.enqueueNutrition(id(2), source(), marker());
    await outbox.enqueueNutrition(id(2), imported, marker(imported));
    expect(
      vi.mocked(writer.applyOperationAsync).mock.calls[1]![0],
    ).toMatchObject({ type: "delete", revision: 2 });
  });
  it("records existing edits while disabled, and dispatches only after grant and explicit retry", async () => {
    const { outbox, writer, storage } = fixture();
    await outbox.activate(id(2));
    await outbox.enable("nutrition");
    await outbox.enqueueNutrition(id(2), source(), marker());
    outbox.disable("nutrition");
    const edited = { ...source(), caloriesKcal: 500 };
    await outbox.enqueueNutrition(id(2), edited, marker(edited));
    expect(writer.applyOperationAsync).toHaveBeenCalledTimes(1);
    expect((await storage.load(id(2), id(1)))[0]!.operation.revision).toBe(2);
    await outbox.enable("nutrition");
    expect(writer.applyOperationAsync).toHaveBeenCalledTimes(1);
    await outbox.retry();
    expect(writer.applyOperationAsync).toHaveBeenCalledTimes(2);
  });
  it("persists foreground saves during inactive state but performs no background or resume dispatch", async () => {
    const { outbox, writer } = fixture();
    await outbox.activate(id(2));
    await outbox.enable("nutrition");
    outbox.setActive(false);
    await outbox.enqueueNutrition(id(2), source(), marker());
    await outbox.retry();
    expect(writer.applyOperationAsync).not.toHaveBeenCalled();
    outbox.setActive(true);
    expect(writer.applyOperationAsync).not.toHaveBeenCalled();
    await outbox.retry();
    expect(writer.applyOperationAsync).toHaveBeenCalledTimes(1);
  });
  it("handles permission-sheet inactivity and logout retirement without restoring grants", async () => {
    const { outbox, writer } = fixture();
    await outbox.activate(id(2));
    const permission = deferred<HealthExportResult>();
    vi.mocked(writer.requestWritePermissionAsync).mockImplementationOnce(
      () => permission.promise,
    );
    const enabling = outbox.enable("nutrition");
    await vi.waitFor(() =>
      expect(writer.requestWritePermissionAsync).toHaveBeenCalledTimes(1),
    );
    outbox.setActive(false);
    permission.resolve(ready());
    await enabling;
    expect(outbox.getSnapshot().enabled.nutrition).toBe(true);
    outbox.deactivate();
    outbox.setActive(true);
    await outbox.activate(id(2));
    expect(outbox.getSnapshot().enabled.nutrition).toBe(false);
  });
  it("fails closed without installation sentinel and never leaks storage exceptions or writes before durability", async () => {
    const { outbox, writer, secure } = fixture();
    vi.mocked(writer.installationIdAsync).mockResolvedValueOnce(null);
    await outbox.activate(id(2));
    await outbox.enable("nutrition");
    expect(outbox.getSnapshot().errorCode).toBe("installation_unavailable");
    expect(writer.requestWritePermissionAsync).not.toHaveBeenCalled();
    await outbox.activate(id(2));
    await outbox.enable("nutrition");
    secure.setItemAsync.mockRejectedValueOnce(new Error("private nutrition"));
    await expect(
      outbox.enqueueNutrition(id(2), source(), marker()),
    ).resolves.toBeUndefined();
    expect(outbox.getSnapshot()).toMatchObject({
      phase: "error",
      errorCode: "storage_failed",
    });
    expect(writer.applyOperationAsync).not.toHaveBeenCalled();
  });
  it("keeps a native-success job durable when acknowledgement persistence fails", async () => {
    const { outbox, writer, secure, storage } = fixture();
    await outbox.activate(id(2));
    await outbox.enable("nutrition");
    // Explicitly fault only the second write: first persist the pending job.
    let writes = 0;
    const data = new Map<string, string>();
    secure.getItemAsync.mockImplementation(
      async (key) => data.get(key) ?? null,
    );
    secure.setItemAsync.mockImplementation(async (key, value) => {
      if (++writes === 2) throw new Error("private platform data");
      data.set(key, value);
    });
    await outbox.enqueueNutrition(id(2), source(), marker());
    expect(writer.applyOperationAsync).toHaveBeenCalledTimes(1);
    expect((await storage.load(id(2), id(1)))[0]!.pending).toBe(true);
    await outbox.retry();
    expect(writer.applyOperationAsync).toHaveBeenCalledTimes(2);
    expect(outbox.getSnapshot().pending.nutrition).toBe(0);
  });
  it("exports only completed locally marked workouts with a separate write grant", async () => {
    const { outbox, writer } = fixture();
    await outbox.activate(id(2));
    await outbox.enable("workout");
    const workout: HealthWorkoutExportSource = {
      id: id(4),
      updatedAt: source().updatedAt,
      source: "manual",
      startedAt: "2026-10-06T09:00:00Z",
      completedAt: "2026-10-06T10:00:00Z",
      details: {
        healthExportOrigin: { version: 1, origin: "mizyun_user_entered" },
        workoutLifecycle: { kind: "session" },
      },
    };
    const confirmation = { ...marker(), recordId: workout.id };
    await outbox.enqueueWorkout(
      id(2),
      { ...workout, completedAt: null },
      confirmation,
    );
    await outbox.enqueueWorkout(
      id(2),
      { ...workout, details: {} },
      confirmation,
    );
    expect(writer.applyOperationAsync).not.toHaveBeenCalled();
    await outbox.enqueueWorkout(id(2), workout, confirmation);
    expect(
      vi.mocked(writer.applyOperationAsync).mock.calls[0]![0],
    ).toMatchObject({
      category: "workout",
      workout: { startedAt: workout.startedAt, endedAt: workout.completedAt },
    });
  });
  it("forgetting an account cancels grants and clears only its local mappings without OS erasure", async () => {
    const { outbox, writer, storage } = fixture();
    await outbox.activate(id(2));
    await outbox.enable("nutrition");
    await outbox.enqueueNutrition(id(2), source(), marker());
    await outbox.clearAccount(id(2));
    expect(await storage.load(id(2), id(1))).toEqual([]);
    expect(outbox.getSnapshot().enabled.nutrition).toBe(false);
    expect(writer.applyOperationAsync).toHaveBeenCalledTimes(1);
  });
  it("cleans a captured account after Auth retirement without restoring authority", async () => {
    const { outbox, writer, storage } = fixture();
    await outbox.activate(id(2));
    await outbox.enable("nutrition");
    await outbox.enqueueNutrition(id(2), source(), marker());
    outbox.deactivate();
    await outbox.clearAccount(id(2));
    expect(await storage.load(id(2), id(1))).toEqual([]);
    expect(outbox.getSnapshot().enabled.nutrition).toBe(false);
    expect(writer.applyOperationAsync).toHaveBeenCalledTimes(1);
  });
  it("purges a deactivated account when the native sentinel is unavailable and preserves other accounts", async () => {
    const { outbox, writer, storage } = fixture();
    await outbox.activate(id(2));
    await outbox.enable("nutrition");
    await outbox.enqueueNutrition(id(2), source(), marker());
    await outbox.activate(id(9));
    await outbox.enable("nutrition");
    const otherSource = { ...source(), id: id(4) };
    await outbox.enqueueNutrition(id(9), otherSource, marker(otherSource));
    outbox.deactivate();
    vi.mocked(writer.installationIdAsync).mockResolvedValue(null).mockClear();
    await outbox.clearAccount(id(2));
    expect(writer.installationIdAsync).not.toHaveBeenCalled();
    expect(await storage.load(id(2), id(1))).toEqual([]);
    expect(await storage.load(id(9), id(1))).toHaveLength(1);
    expect(outbox.getSnapshot().enabled.nutrition).toBe(false);
    expect(writer.applyOperationAsync).toHaveBeenCalledTimes(2);
  });
  it("fails closed when an identity allocator returns a source or Auth identifier", async () => {
    const { writer, storage } = fixture();
    const outbox = new HealthExportOutbox(storage, writer, () => source().id);
    await outbox.activate(id(2));
    await outbox.enable("nutrition");
    await outbox.enqueueNutrition(id(2), source(), marker());
    expect(outbox.getSnapshot().errorCode).toBe("storage_invalid");
    expect(writer.applyOperationAsync).not.toHaveBeenCalled();
    expect(await storage.load(id(2), id(1))).toEqual([]);
  });
});
