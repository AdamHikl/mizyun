import { describe, expect, it, vi } from "vitest";
import {
  COMMUNITY_TAP_TRANSIENT,
  CommunityTapController,
  type CommunityTapResolution,
} from "./tap-controller";
const eventId = "00000000-0000-4000-8000-000000000001";
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(
  resolve = vi.fn(
    async (): Promise<CommunityTapResolution> => "/community/relationships",
  ),
) {
  let principal: string | null = "alice";
  const ports = {
    resolve,
    markRead: vi.fn(async () => true),
    isPrincipalCurrent: (id: string) => principal === id,
    navigate: vi.fn(),
    clearLastResponse: vi.fn(),
  };
  return {
    ports,
    taps: new CommunityTapController(ports),
    setCurrent: (id: string | null) => {
      principal = id;
    },
  };
}
describe("native notification tap boundary", () => {
  it("does not route a read acknowledgement returned after losing foreground", async () => {
    const pending = deferred<boolean>();
    const { taps, ports } = setup();
    ports.markRead.mockReturnValueOnce(pending.promise);
    taps.setPrincipal("alice");
    taps.setForeground(true);
    taps.receive({ communityEventId: eventId });
    await flush();
    expect(ports.markRead).toHaveBeenCalledWith(
      "alice",
      eventId,
      expect.any(Function),
    );
    taps.setForeground(false);
    pending.resolve(true);
    await flush();
    expect(ports.navigate).not.toHaveBeenCalled();
    expect(ports.clearLastResponse).not.toHaveBeenCalled();
  });
  it("reports an offline tap as a connection problem, not an unavailable update", async () => {
    const { taps, ports } = setup(vi.fn(async () => COMMUNITY_TAP_TRANSIENT));
    taps.setPrincipal("alice");
    taps.setForeground(true);
    taps.receive({ communityEventId: eventId });
    await flush();
    expect(ports.markRead).not.toHaveBeenCalled();
    expect(ports.navigate).toHaveBeenCalledWith(
      "/community/inbox?notice=offline",
    );
  });
  it("reports failed read acknowledgement honestly", async () => {
    const { taps, ports } = setup();
    ports.markRead.mockResolvedValueOnce(false);
    taps.setPrincipal("alice");
    taps.setForeground(true);
    taps.receive({ communityEventId: eventId });
    await flush();
    expect(ports.navigate).toHaveBeenCalledWith(
      "/community/inbox?notice=read_unconfirmed",
    );
  });

  it("processes cold last response once, authorizes opaque id for current account and ignores payload URL", async () => {
    const { taps, ports } = setup();
    taps.setPrincipal("alice");
    taps.setForeground(true);
    const data = { communityEventId: eventId, url: "/private-source" };
    taps.receive(data);
    taps.receive(data);
    await flush();
    expect(ports.resolve).toHaveBeenCalledTimes(1);
    expect(ports.resolve).toHaveBeenCalledWith(
      "alice",
      eventId,
      expect.any(Function),
    );
    expect(ports.navigate).toHaveBeenCalledWith("/community/relationships");
    expect(ports.clearLastResponse).toHaveBeenCalledTimes(1);
    taps.receive(data);
    await flush();
    expect(ports.resolve).toHaveBeenCalledTimes(1);
  });
  it("queues a signed-out cold event until sign-in instead of routing without authority", async () => {
    const { taps, ports, setCurrent } = setup();
    setCurrent(null);
    taps.setForeground(true);
    taps.receive({ communityEventId: eventId });
    await flush();
    expect(ports.resolve).not.toHaveBeenCalled();
    setCurrent("alice");
    taps.setPrincipal("alice");
    await flush();
    expect(ports.navigate).toHaveBeenCalledTimes(1);
  });
  it("invalidates late resolve on background and reauthorizes retained event on resume", async () => {
    const pending = deferred<string | null>();
    const resolve = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(null);
    const { taps, ports } = setup(resolve);
    taps.setPrincipal("alice");
    taps.setForeground(true);
    taps.receive({ communityEventId: eventId });
    await flush();
    taps.setForeground(false);
    pending.resolve("/community/activity/old");
    await flush();
    expect(ports.navigate).not.toHaveBeenCalled();
    expect(ports.clearLastResponse).not.toHaveBeenCalled();
    taps.setForeground(true);
    await flush();
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(ports.navigate).toHaveBeenCalledWith(
      "/community/inbox?notice=unavailable",
    );
  });
  it("reauthorizes for next account and never routes late previous-account target", async () => {
    const pending = deferred<string | null>();
    const resolve = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(null);
    const { taps, ports, setCurrent } = setup(resolve);
    taps.setPrincipal("alice");
    taps.setForeground(true);
    taps.receive({ communityEventId: eventId });
    setCurrent("bob");
    taps.setPrincipal("bob");
    pending.resolve("/community/activity/alice-only");
    await flush();
    expect(resolve).toHaveBeenLastCalledWith(
      "bob",
      eventId,
      expect.any(Function),
    );
    expect(ports.navigate).toHaveBeenCalledTimes(1);
    expect(ports.navigate).toHaveBeenCalledWith(
      "/community/inbox?notice=unavailable",
    );
  });
  it("rejects callbacks after unmount and after render changed principal before effects run", async () => {
    const pending = deferred<string | null>();
    const { taps, ports, setCurrent } = setup(
      vi.fn().mockReturnValue(pending.promise),
    );
    taps.setPrincipal("alice");
    taps.setForeground(true);
    taps.receive({ communityEventId: eventId });
    setCurrent("bob");
    pending.resolve("/community/activity/old");
    await flush();
    expect(ports.navigate).not.toHaveBeenCalled();
    taps.stop();
    taps.receive({ communityEventId: "00000000-0000-4000-8000-000000000002" });
    expect(ports.resolve).toHaveBeenCalledTimes(1);
  });
});
