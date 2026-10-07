import { afterEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ module: null as unknown }));
vi.mock("expo", () => ({
  requireOptionalNativeModule: () => bridge.module,
}));

afterEach(() => {
  vi.resetModules();
  bridge.module = null;
});

describe("optional health preview native boundary", () => {
  it("keeps web and older binaries usable without a native module", async () => {
    const module = await import("./index");
    const unavailable = {
      status: "unavailable",
      records: [],
      nextPageToken: null,
      readAccess: "unknown",
    };
    expect(await module.availabilityAsync()).toEqual(unavailable);
    expect(await module.requestReadPermissionAsync("weight")).toEqual(
      unavailable,
    );
    expect(await module.readPageAsync("workout", "from", "to")).toEqual(
      unavailable,
    );
    await expect(module.invalidateAsync()).resolves.toBeUndefined();
  });

  it("passes only the selected type, exact window and opaque token to the native read", async () => {
    const response = {
      status: "ready",
      records: [],
      nextPageToken: "opaque-next",
      readAccess: "unknown",
    };
    const readPageAsync = vi.fn().mockResolvedValue(response);
    bridge.module = { readPageAsync };
    const module = await import("./index");
    expect(
      await module.readPageAsync(
        "weight",
        "2026-10-01T00:00:00Z",
        "2026-10-06T00:00:00Z",
        "opaque-current",
      ),
    ).toEqual(response);
    expect(readPageAsync).toHaveBeenCalledWith(
      "weight",
      "2026-10-01T00:00:00Z",
      "2026-10-06T00:00:00Z",
      "opaque-current",
    );
  });

  it("masks platform errors and still settles clear on a failing old binary", async () => {
    const failure = new Error("synthetic private platform details");
    bridge.module = {
      readPageAsync: vi.fn().mockRejectedValue(failure),
      invalidateAsync: vi.fn().mockRejectedValue(failure),
    };
    const module = await import("./index");
    expect(await module.readPageAsync("weight", "from", "to")).toEqual({
      status: "error",
      records: [],
      nextPageToken: null,
      readAccess: "unknown",
      errorCode: "native_failure",
    });
    await expect(module.invalidateAsync()).resolves.toBeUndefined();
  });
});
