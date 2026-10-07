import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FoodEntry, Workout } from "@mizyun/contracts";
const state = vi.hoisted(() => ({
  variant: "dev",
  writer: {
    activate: vi.fn(async () => undefined),
    deactivate: vi.fn(),
    setActive: vi.fn(),
    hasRecord: vi.fn(async () => true),
    enqueueNutrition: vi.fn(async () => undefined),
    enqueueWorkout: vi.fn(async () => undefined),
    deleteRecord: vi.fn(async () => undefined),
    clearAccount: vi.fn(async () => undefined),
  },
}));
vi.mock("@/composition/app-variant", () => ({
  getAppVariant: () => state.variant,
}));
vi.mock("./native-writer", () => ({ healthExportOutbox: state.writer }));
import {
  activateHealthExports,
  captureHealthExportOwner,
  exportSavedNutrition,
  exportSavedWorkout,
  deleteHealthExport,
  clearLocalHealthExports,
  markFirstPartyWorkout,
} from "./service";
const account = "00000000-0000-4000-8000-000000000001";
const record = {
  id: "00000000-0000-4000-8000-000000000002",
  userId: account,
  updatedAt: "2026-10-06T10:00:00Z",
} as FoodEntry;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
beforeEach(async () => {
  state.variant = "dev";
  activateHealthExports(null);
  await tick();
  vi.clearAllMocks();
  state.writer.hasRecord.mockResolvedValue(true);
});
async function session() {
  activateHealthExports(account);
  await tick();
  return captureHealthExportOwner();
}
describe("saved-record export authority", () => {
  it("binds a saved DTO and receipt to captured account, never forwards private metadata as native payload", async () => {
    const binding = await session();
    exportSavedNutrition(binding, record, {
      firstParty: true,
      timeBasis: "observed",
    });
    await tick();
    expect(state.writer.enqueueNutrition).toHaveBeenCalledWith(
      account,
      record,
      expect.objectContaining({
        recordId: record.id,
        savedUpdatedAt: record.updatedAt,
        timeBasis: "observed",
      }),
      false,
    );
  });
  it("drops a delayed old-owner save after logout and same-account reauthentication", async () => {
    const old = await session();
    activateHealthExports(null);
    await session();
    exportSavedNutrition(old, record, {
      firstParty: true,
      timeBasis: "observed",
    });
    deleteHealthExport(old, "nutrition", record.id);
    await tick();
    expect(state.writer.enqueueNutrition).not.toHaveBeenCalled();
    expect(state.writer.deleteRecord).not.toHaveBeenCalled();
  });
  it("rejects a server DTO owned by another account", async () => {
    const binding = await session();
    exportSavedNutrition(
      binding,
      { ...record, userId: "00000000-0000-4000-8000-000000000009" },
      { firstParty: true, timeBasis: "observed" },
    );
    await tick();
    expect(state.writer.enqueueNutrition).not.toHaveBeenCalled();
  });
  it("does not mint mappings for historical generic edits", async () => {
    const binding = await session();
    state.writer.hasRecord.mockResolvedValue(false);
    exportSavedNutrition(binding, record, {
      firstParty: true,
      timeBasis: "observed",
      existingOnly: true,
    });
    exportSavedWorkout(binding, record as unknown as Workout, true);
    await tick();
    expect(state.writer.enqueueNutrition).not.toHaveBeenCalled();
    expect(state.writer.enqueueWorkout).not.toHaveBeenCalled();
  });
  it("retires an existing export when a new save loses first-party eligibility", async () => {
    const binding = await session();
    exportSavedNutrition(binding, record, {
      firstParty: false,
      timeBasis: "observed",
    });
    await tick();
    expect(state.writer.deleteRecord).toHaveBeenCalledWith(
      account,
      "nutrition",
      record.id,
    );
    expect(state.writer.enqueueNutrition).not.toHaveBeenCalled();
  });
  it("Production cannot capture export authority or activate a writer", async () => {
    state.variant = "production";
    activateHealthExports(account);
    expect(captureHealthExportOwner()).toBeNull();
    await tick();
    expect(state.writer.activate).not.toHaveBeenCalled();
  });
  it("purges captured account data and invalidates save authority", async () => {
    await session();
    await clearLocalHealthExports(account);
    expect(captureHealthExportOwner()).toBeNull();
    expect(state.writer.clearAccount).toHaveBeenCalledWith(account);
  });
  it("does not mark unknown, routine or AI-derived workout producers", () => {
    expect(markFirstPartyWorkout({ coachPlan: {} })).toEqual({ coachPlan: {} });
    expect(
      markFirstPartyWorkout({
        workoutLifecycle: { kind: "session", routineId: record.id },
      }),
    ).not.toHaveProperty("healthExportOrigin");
    expect(markFirstPartyWorkout()).toHaveProperty("healthExportOrigin", {
      version: 1,
      origin: "mizyun_user_entered",
    });
  });
});
