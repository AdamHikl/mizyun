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
    expect(await module.requestReadPermissionAsync("run")).toEqual(unavailable);
    expect(await module.readPageAsync("run", "from", "to")).toEqual(
      unavailable,
    );
    await expect(module.invalidateAsync()).resolves.toBeUndefined();
  });

  it("requests the run kind and returns run records with nullable distance unchanged", async () => {
    const response = {
      status: "ready",
      records: [
        {
          kind: "run",
          provider: "health_connect",
          externalId: "synthetic-run-1",
          sourceAppId: "com.example.runner",
          sourceAppName: null,
          sourceTimeZone: "+02:00",
          startedAt: "2026-10-02T06:00:00Z",
          endedAt: "2026-10-02T06:30:00Z",
          durationSeconds: 1800,
          durationBasis: "elapsed",
          distanceMeters: null,
          indoor: true,
        },
      ],
      nextPageToken: null,
      readAccess: "unknown",
    };
    const requestReadPermissionAsync = vi
      .fn()
      .mockResolvedValue({ ...response, records: [] });
    const readPageAsync = vi.fn().mockResolvedValue(response);
    bridge.module = { requestReadPermissionAsync, readPageAsync };
    const module = await import("./index");
    expect((await module.requestReadPermissionAsync("run")).status).toBe(
      "ready",
    );
    expect(requestReadPermissionAsync).toHaveBeenCalledWith("run");
    const result = await module.readPageAsync(
      "run",
      "2026-10-01T00:00:00Z",
      "2026-10-06T00:00:00Z",
    );
    expect(result).toEqual(response);
    const [record] = result.records;
    expect(record?.kind === "run" ? record.distanceMeters : "wrong").toBeNull();
    expect(readPageAsync).toHaveBeenCalledWith(
      "run",
      "2026-10-01T00:00:00Z",
      "2026-10-06T00:00:00Z",
      null,
    );
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
