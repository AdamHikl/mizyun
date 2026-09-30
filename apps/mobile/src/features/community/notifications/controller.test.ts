import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import { InboxController, notificationDestinationPath } from "./controller";
import { parseQuietHour, formatQuietHour } from "./quiet-hours";

const event = {
  id: "event-1",
  kind: "reaction",
  createdAt: "2026-09-30T10:00:00Z",
  readAt: null,
  targetId: "private-old-target",
};
function setup(request = vi.fn()) {
  return {
    request,
    controller: new InboxController(
      { request } as unknown as ApiClient,
      "account-a",
    ),
  };
}
function pending() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe("community inbox lifecycle", () => {
  it("rejects cached callbacks while paused and reloads only after resume", async () => {
    const { request, controller } = setup(
      vi.fn().mockResolvedValue({
        ok: true,
        value: { items: [], nextCursor: null },
      }),
    );
    controller.pause();
    await controller.load();
    await controller.load(true);
    expect(await controller.open("event-1")).toBeNull();
    expect(request).not.toHaveBeenCalled();
    controller.resume();
    await controller.load();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("suppresses a late read acknowledgement when paused, even after resume", async () => {
    const delayed = pending();
    const { request, controller } = setup(
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          value: { destination: "activity", targetId: "target" },
        })
        .mockReturnValueOnce(delayed.promise),
    );
    const opening = controller.open("event-1");
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    controller.pause();
    controller.resume();
    delayed.resolve({
      ok: true,
      value: { id: "event-1", readAt: "2026-09-30T12:00:00Z" },
    });
    expect(await opening).toBeNull();
    expect(controller.getSnapshot().items).toEqual([]);
  });

  it("clears cached references and cursor before refresh and after denied refresh", async () => {
    const { controller } = setup(
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          value: { items: [event], nextCursor: "old" },
        })
        .mockResolvedValueOnce({ ok: false, error: { kind: "no_session" } }),
    );
    await controller.load();
    expect(controller.getSnapshot().items).toHaveLength(1);
    const refreshing = controller.load();
    expect(controller.getSnapshot().items).toEqual([]);
    expect(controller.getSnapshot().nextCursor).toBeNull();
    await refreshing;
    expect(controller.getSnapshot().items).toEqual([]);
  });
  it("drops an old principal response after switching account", async () => {
    const delayed = pending();
    const { request, controller } = setup(
      vi
        .fn()
        .mockReturnValueOnce(delayed.promise)
        .mockResolvedValueOnce({
          ok: true,
          value: { items: [], nextCursor: null },
        }),
    );
    const loading = controller.load();
    controller.switchAccount("account-b");
    delayed.resolve({ ok: true, value: { items: [event], nextCursor: "old" } });
    await loading;
    expect(controller.getSnapshot().items).toEqual([]);
    await controller.load();
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedUserId: "account-b" }),
    );
  });
  it("reauthorizes opaque event before routing and does not navigate revoked events", async () => {
    const { request, controller } = setup(
      vi.fn().mockResolvedValue({ ok: false, error: { kind: "no_session" } }),
    );
    expect(await controller.open("event/opaque")).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/v1/community/notifications/inbox/event%2Fopaque",
        expectedUserId: "account-a",
      }),
    );
    expect(controller.getSnapshot().items).toEqual([]);
  });
  it("does not send read mutation or navigate after background reset during resolve", async () => {
    const delayed = pending();
    const { request, controller } = setup(
      vi.fn().mockReturnValue(delayed.promise),
    );
    const opening = controller.open("event-1");
    controller.reset();
    delayed.resolve({
      ok: true,
      value: { destination: "activity", targetId: "activity-1" },
    });
    expect(await opening).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("deduplicates pages and marks read only after acknowledged response", async () => {
    const { controller } = setup(
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          value: { items: [event], nextCursor: "page-2" },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: { items: [event], nextCursor: null },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: { destination: "activity", targetId: "authorized-new-target" },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: { id: event.id, readAt: "2026-09-30T12:00:00Z" },
        }),
    );
    await controller.load();
    await controller.load(true);
    expect(controller.getSnapshot().items).toHaveLength(1);
    const destination = await controller.open(event.id);
    expect(notificationDestinationPath(destination!)).toBe(
      "/community/activity/authorized-new-target",
    );
    expect(controller.getSnapshot().items[0]?.readAt).toBe(
      "2026-09-30T12:00:00Z",
    );
  });
  it("refuses unauthenticated requests", async () => {
    const { request, controller } = setup();
    controller.switchAccount(null);
    await controller.load();
    expect(request).not.toHaveBeenCalled();
  });
});
describe("quiet hours input", () => {
  it("accepts midnight and end of day but rejects overflow and ambiguous input", () => {
    expect(parseQuietHour("00:00")).toBe(0);
    expect(parseQuietHour("23:59")).toBe(1439);
    for (const value of ["24:00", "08:60", "8:00", "", "08:00 AM"])
      expect(parseQuietHour(value)).toBeNull();
    expect(formatQuietHour(480)).toBe("08:00");
  });
});
