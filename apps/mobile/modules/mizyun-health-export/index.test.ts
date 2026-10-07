import { afterEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ module: null as unknown }));
vi.mock("expo", () => ({ requireOptionalNativeModule: () => bridge.module }));
afterEach(() => {
  vi.resetModules();
  vi.useRealTimers();
  bridge.module = null;
});

const operation = {
  type: "upsert" as const,
  category: "nutrition" as const,
  clientId: "b08ab4a5-46c4-4797-accc-146b707cf88d",
  revision: 1,
  nutrition: {
    consumedAt: "2026-10-06T12:34:00Z",
    energyKcal: 0,
    proteinG: null,
    carbsG: 2,
    fatG: null,
  },
};
const ready = {
  status: "ready",
  acknowledgedComponents: ["nutrition"],
  writeAccess: "granted",
};

describe("optional outbound health native boundary", () => {
  it("leaves web/older binaries usable with no native module", async () => {
    const module = await import("./index");
    const unavailable = {
      status: "unavailable",
      acknowledgedComponents: [],
      writeAccess: "unknown",
    };
    expect(await module.availabilityAsync()).toEqual(unavailable);
    expect(await module.requestWritePermissionAsync("nutrition")).toEqual(
      unavailable,
    );
    expect(await module.applyOperationAsync(operation)).toEqual(unavailable);
    expect(await module.installationIdAsync()).toBeNull();
    await expect(module.invalidateAsync()).resolves.toBeUndefined();
  });

  it("passes only explicit selected write category; applying and retrying never requests permission", async () => {
    const requestWritePermissionAsync = vi.fn().mockResolvedValue(ready);
    const applyOperationAsync = vi.fn().mockResolvedValue(ready);
    bridge.module = { requestWritePermissionAsync, applyOperationAsync };
    const module = await import("./index");
    await module.requestWritePermissionAsync("workout");
    expect(requestWritePermissionAsync).toHaveBeenCalledExactlyOnceWith(
      "workout",
    );
    await module.applyOperationAsync(operation);
    await module.applyOperationAsync(operation);
    expect(applyOperationAsync).toHaveBeenNthCalledWith(1, operation);
    expect(applyOperationAsync).toHaveBeenNthCalledWith(2, operation);
    expect(requestWritePermissionAsync).toHaveBeenCalledTimes(1);
  });

  it("preserves partial component acknowledgments without projecting platform records", async () => {
    const partial = {
      status: "partial",
      acknowledgedComponents: ["energy", "carbs"],
      writeAccess: "partial",
      errorCode: "operation_incomplete",
    };
    bridge.module = { applyOperationAsync: vi.fn().mockResolvedValue(partial) };
    const module = await import("./index");
    expect(await module.applyOperationAsync(operation)).toEqual(partial);
  });

  it("bounds a lost native response and does not start a second mutation", async () => {
    vi.useFakeTimers();
    const applyOperationAsync = vi.fn(() => new Promise(() => {}));
    bridge.module = { applyOperationAsync };
    const module = await import("./index");
    const pending = module.applyOperationAsync(operation);
    await vi.advanceTimersByTimeAsync(35_000);
    expect(await pending).toEqual({
      status: "error",
      acknowledgedComponents: [],
      writeAccess: "unknown",
      errorCode: "native_timeout",
    });
    expect(applyOperationAsync).toHaveBeenCalledTimes(1);
  });

  it("retires late mutation and permission results after clear/account change", async () => {
    let deliver: (value: typeof ready) => void = () => {};
    let grant: (value: typeof ready) => void = () => {};
    bridge.module = {
      applyOperationAsync: () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
      requestWritePermissionAsync: () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
      invalidateAsync: vi.fn(),
    };
    const module = await import("./index");
    const pending = module.applyOperationAsync(operation);
    const permission = module.requestWritePermissionAsync("nutrition");
    await module.invalidateAsync();
    deliver(ready);
    grant(ready);
    for (const result of [await pending, await permission]) {
      expect(result).toEqual({
        status: "error",
        acknowledgedComponents: [],
        writeAccess: "unknown",
        errorCode: "operation_invalidated",
      });
    }
  });

  it("redacts platform failures and refuses invalid installation sentinels", async () => {
    bridge.module = {
      applyOperationAsync: vi
        .fn()
        .mockRejectedValue(new Error("synthetic private health details")),
      installationIdAsync: vi.fn().mockResolvedValue("not-an-install-id"),
      invalidateAsync: vi
        .fn()
        .mockRejectedValue(new Error("private platform error")),
    };
    const module = await import("./index");
    expect(await module.applyOperationAsync(operation)).toEqual({
      status: "error",
      acknowledgedComponents: [],
      writeAccess: "unknown",
      errorCode: "native_failure",
    });
    expect(await module.installationIdAsync()).toBeNull();
    await expect(module.invalidateAsync()).resolves.toBeUndefined();
  });

  it("bounds stalled install and clear bridges without accepting late sentinels", async () => {
    vi.useFakeTimers();
    bridge.module = {
      installationIdAsync: () => new Promise(() => {}),
      invalidateAsync: () => new Promise(() => {}),
    };
    const module = await import("./index");
    const installation = module.installationIdAsync();
    const clear = module.invalidateAsync();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await installation).toBeNull();
    await expect(clear).resolves.toBeUndefined();
  });
});
