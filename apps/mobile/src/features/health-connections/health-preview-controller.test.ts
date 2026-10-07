import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HealthPreviewController,
  type HealthPreviewPage,
  type HealthPreviewReader,
} from "./health-preview-controller";

const now = () => new Date("2026-10-06T12:00:00.000Z");
const page = (
  records: unknown[] = [],
  nextPageToken: string | null = null,
): HealthPreviewPage => ({
  status: "ready",
  records,
  nextPageToken,
  readAccess: "unknown",
});
const weight = (externalId = "sample-1") => ({
  kind: "weight",
  provider: "apple_health",
  externalId,
  sourceAppId: "com.example.synthetic-scale",
  sourceAppName: "Synthetic Scale",
  sourceTimeZone: null,
  measuredAt: "2026-10-05T12:00:00.000Z",
  weightKg: 80,
});
function setup(provider: "apple_health" | "health_connect" = "apple_health") {
  const reader = {
    availabilityAsync: vi.fn(async () => page()),
    requestReadPermissionAsync: vi.fn(async () => page()),
    readPageAsync: vi.fn(async () => page([weight()])),
    invalidateAsync: vi.fn(async () => undefined),
  } satisfies HealthPreviewReader;
  return {
    reader,
    controller: new HealthPreviewController(reader, provider, now, 20),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => vi.useRealTimers());

describe("ephemeral health preview", () => {
  it("does nothing until an explicit category action and requests only that category", async () => {
    const { controller, reader } = setup();
    expect(controller.getSnapshot().phase).toBe("disabled");
    expect(reader.readPageAsync).not.toHaveBeenCalled();
    await controller.connect("weight");
    expect(reader.requestReadPermissionAsync).toHaveBeenCalledExactlyOnceWith(
      "weight",
    );
    expect(reader.readPageAsync).toHaveBeenCalledWith(
      "weight",
      "2026-09-06T12:00:00.000Z",
      "2026-10-06T12:00:00.000Z",
      null,
    );
    expect(controller.getSnapshot().records).toEqual([weight()]);
  });
  it("does not request any permission when native support is unavailable", async () => {
    const { controller, reader } = setup();
    reader.availabilityAsync.mockResolvedValue({
      ...page(),
      status: "unavailable",
    });
    await controller.connect("weight");
    expect(reader.requestReadPermissionAsync).not.toHaveBeenCalled();
    expect(controller.getSnapshot().message).toMatch(/device or build/);
  });
  it("shows provider installation and permission failure without reading", async () => {
    for (const status of ["install_required", "permission_required"] as const) {
      const { controller, reader } = setup();
      reader.requestReadPermissionAsync.mockResolvedValue({
        ...page(),
        status,
      });
      await controller.connect("workout");
      expect(reader.readPageAsync).not.toHaveBeenCalled();
      expect(controller.getSnapshot().phase).toBe("error");
    }
  });
  it("does not call an empty iOS read zero or confirmed denial", async () => {
    const { controller, reader } = setup();
    reader.readPageAsync.mockResolvedValue(page());
    await controller.connect("weight");
    expect(controller.getSnapshot().phase).toBe("ready");
    expect(controller.getSnapshot().message).toMatch(
      /does not confirm a zero or permission denial/,
    );
  });
  it("replays only the exact source record, retaining distinct same-time values", async () => {
    const { controller, reader } = setup();
    reader.readPageAsync
      .mockResolvedValueOnce(page([weight()], "page-two"))
      .mockResolvedValueOnce(page([weight(), weight("sample-2")]));
    await controller.connect("weight");
    expect(controller.getSnapshot().records).toHaveLength(2);
    expect(controller.getSnapshot().phase).toBe("ready");
  });
  it("reports partial results when the next page fails", async () => {
    const { controller, reader } = setup();
    reader.readPageAsync
      .mockResolvedValueOnce(page([weight()], "page-two"))
      .mockRejectedValueOnce(new Error("synthetic failure"));
    await controller.connect("weight");
    expect(controller.getSnapshot().records).toHaveLength(1);
    expect(controller.getSnapshot().phase).toBe("partial");
    expect(controller.getSnapshot().message).toMatch(/interrupted/);
  });
  it("rejects scope spoofing and labels partial coverage", async () => {
    const { controller, reader } = setup();
    reader.readPageAsync.mockResolvedValue(
      page([
        { ...weight(), permittedUses: ["developer_api"] },
        { ...weight("bad-provider"), provider: "health_connect" },
        weight(),
      ]),
    );
    await controller.connect("weight");
    expect(controller.getSnapshot().records).toEqual([weight()]);
    expect(controller.getSnapshot().phase).toBe("partial");
  });
  it("bounds page count and marks unread remainder incomplete", async () => {
    const { controller, reader } = setup();
    reader.readPageAsync.mockImplementation(async () =>
      page(
        [weight(String(reader.readPageAsync.mock.calls.length))],
        String(reader.readPageAsync.mock.calls.length),
      ),
    );
    await controller.connect("weight");
    expect(reader.readPageAsync).toHaveBeenCalledTimes(5);
    expect(controller.getSnapshot().phase).toBe("partial");
  });
  it("stops a repeating pagination token instead of looping", async () => {
    const { controller, reader } = setup();
    reader.readPageAsync.mockResolvedValue(page([weight()], "same-token"));
    await controller.connect("weight");
    expect(reader.readPageAsync).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().phase).toBe("partial");
  });
  it("a late read cannot repopulate a cleared preview", async () => {
    const { controller, reader } = setup();
    const pending = deferred<HealthPreviewPage>();
    reader.readPageAsync.mockReturnValue(pending.promise);
    const connecting = controller.connect("weight");
    await vi.waitFor(() => expect(reader.readPageAsync).toHaveBeenCalled());
    controller.clear();
    pending.resolve(page([weight()]));
    await connecting;
    expect(controller.getSnapshot().records).toEqual([]);
    expect(controller.getSnapshot().phase).toBe("disabled");
  });
  it("old-account permission completion cannot start a read after destruction", async () => {
    const { controller, reader } = setup();
    const pending = deferred<HealthPreviewPage>();
    reader.requestReadPermissionAsync.mockReturnValue(pending.promise);
    const connecting = controller.connect("workout");
    await vi.waitFor(() =>
      expect(reader.requestReadPermissionAsync).toHaveBeenCalled(),
    );
    controller.destroy();
    pending.resolve(page());
    await connecting;
    expect(reader.readPageAsync).not.toHaveBeenCalled();
    expect(controller.getSnapshot().records).toEqual([]);
  });
  it("background clears readings and returning does not silently reconnect", async () => {
    const { controller, reader } = setup();
    await controller.connect("weight");
    controller.setActive(false);
    controller.setActive(true);
    expect(controller.getSnapshot().records).toEqual([]);
    expect(controller.getSnapshot().phase).toBe("disabled");
    expect(reader.readPageAsync).toHaveBeenCalledTimes(1);
  });
  it("permission dialog deactivation preserves only its pending action", async () => {
    const { controller, reader } = setup();
    const pending = deferred<HealthPreviewPage>();
    reader.requestReadPermissionAsync.mockReturnValue(pending.promise);
    const connecting = controller.connect("weight");
    await vi.waitFor(() =>
      expect(reader.requestReadPermissionAsync).toHaveBeenCalled(),
    );
    const invalidationsBeforeDialog = reader.invalidateAsync.mock.calls.length;
    controller.setActive(false);
    expect(reader.invalidateAsync).toHaveBeenCalledTimes(
      invalidationsBeforeDialog,
    );
    controller.setActive(true);
    pending.resolve(page());
    await connecting;
    expect(controller.getSnapshot().records).toEqual([weight()]);
  });
  it("permission completion while backgrounded cannot read", async () => {
    const { controller, reader } = setup();
    const pending = deferred<HealthPreviewPage>();
    reader.requestReadPermissionAsync.mockReturnValue(pending.promise);
    const connecting = controller.connect("weight");
    await vi.waitFor(() =>
      expect(reader.requestReadPermissionAsync).toHaveBeenCalled(),
    );
    controller.setActive(false);
    pending.resolve(page());
    await connecting;
    expect(reader.readPageAsync).not.toHaveBeenCalled();
    expect(controller.getSnapshot().records).toEqual([]);
  });
  it("times out a hanging read without logging provider error data", async () => {
    vi.useFakeTimers();
    const { controller, reader } = setup();
    reader.readPageAsync.mockReturnValue(new Promise(() => undefined));
    const connecting = controller.connect("weight");
    await vi.advanceTimersByTimeAsync(25);
    await connecting;
    expect(controller.getSnapshot().phase).toBe("error");
    expect(controller.getSnapshot().message).toBe(
      "Could not read health records. Try again.",
    );
  });
  it("refresh replaces old records instead of hiding a source deletion", async () => {
    const { controller, reader } = setup();
    await controller.connect("weight");
    reader.readPageAsync.mockResolvedValue(page());
    await controller.refresh();
    expect(controller.getSnapshot().records).toEqual([]);
    expect(reader.requestReadPermissionAsync).toHaveBeenCalledTimes(1);
  });
});
