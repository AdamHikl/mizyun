import { describe, expect, it, vi } from "vitest";
import {
  CommunityPushLifecycle,
  communityEventId,
  type CommunityPushPorts,
  type PushBinding,
} from "./push-lifecycle";
const alice = { user: { id: "alice" }, accessToken: "alice-captured-token" };
const bob = { user: { id: "bob" }, accessToken: "bob-captured-token" };
const id = "00000000-0000-4000-8000-000000000001";
const token = "ExpoPushToken[valid-token123]";
function setup() {
  let binding: PushBinding | null = null;
  const ports: CommunityPushPorts = {
    installationId: vi.fn(async () => id),
    readBinding: vi.fn(async () => binding),
    writeBinding: vi.fn(async (value) => {
      binding = value;
    }),
    permission: vi.fn(async () => true),
    expoToken: vi.fn(async () => token),
    register: vi.fn(async () => true),
    remove: vi.fn(async () => true),
  };
  return {
    ports,
    manager: new CommunityPushLifecycle(ports),
    binding: () => binding,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe("optional community device registration", () => {
  it("does not ask permission or register on an account without its own opt-in", async () => {
    const { manager, ports } = setup();
    await manager.setPrincipal(alice);
    expect(await manager.refreshToken()).toBe("not_enabled");
    expect(ports.permission).not.toHaveBeenCalled();
    expect(ports.register).not.toHaveBeenCalled();
  });
  it("permission denial keeps in-app access independent and never obtains a token", async () => {
    const { manager, ports } = setup();
    vi.mocked(ports.permission).mockResolvedValue(false);
    await manager.setPrincipal(alice);
    expect(await manager.registerExplicit("alice")).toBe("denied");
    expect(ports.expoToken).not.toHaveBeenCalled();
    expect(ports.register).not.toHaveBeenCalled();
  });
  it("registers Expo tokens against a stable installation and uses captured account authority", async () => {
    const { manager, ports, binding } = setup();
    await manager.setPrincipal(alice);
    expect(await manager.registerExplicit("alice")).toBe("registered");
    expect(ports.register).toHaveBeenCalledWith(alice, id, token);
    expect(binding()).toEqual({ userId: "alice", installationId: id });
    expect(await manager.refreshToken()).toBe("registered");
    expect(ports.permission).toHaveBeenLastCalledWith(false);
  });
  it("deregisters previous captured bearer and does not enroll next account", async () => {
    const { manager, ports, binding } = setup();
    await manager.setPrincipal(alice);
    await manager.registerExplicit("alice");
    await manager.setPrincipal(bob);
    expect(ports.remove).toHaveBeenCalledWith(alice, id);
    expect(binding()).toBeNull();
    expect(await manager.refreshToken()).toBe("not_enabled");
    expect(ports.register).toHaveBeenCalledTimes(1);
  });
  it("rejects an explicit callback captured for the old account", async () => {
    const { manager, ports } = setup();
    await manager.setPrincipal(bob);
    expect(await manager.registerExplicit("alice")).toBe("cancelled");
    expect(ports.permission).not.toHaveBeenCalled();
  });
  it("a switch while Expo token lookup is in flight prevents any old registration", async () => {
    const { manager, ports } = setup();
    const waiting = deferred<string>();
    vi.mocked(ports.expoToken).mockReturnValue(waiting.promise);
    await manager.setPrincipal(alice);
    const registering = manager.registerExplicit("alice");
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const switching = manager.setPrincipal(bob);
    waiting.resolve(token);
    expect(await registering).toBe("cancelled");
    await switching;
    expect(ports.register).not.toHaveBeenCalled();
  });
  it("serializes logout removal after a pending/lost registration response", async () => {
    const { manager, ports, binding } = setup();
    const waiting = deferred<boolean>();
    vi.mocked(ports.register).mockReturnValue(waiting.promise);
    await manager.setPrincipal(alice);
    const registering = manager.registerExplicit("alice");
    for (let i = 0; i < 15; i++) await Promise.resolve();
    expect(binding()).not.toBeNull();
    const logout = manager.deregister(alice);
    expect(ports.remove).not.toHaveBeenCalled();
    waiting.resolve(false);
    expect(await registering).toBe("cancelled");
    expect(await logout).toBe(true);
    expect(ports.remove).toHaveBeenCalledWith(alice, id);
    expect(binding()).toBeNull();
  });
  it("allows retrying removal after offline failure even though local opt-in is cleared", async () => {
    const { manager, ports } = setup();
    await manager.setPrincipal(alice);
    await manager.registerExplicit("alice");
    vi.mocked(ports.remove)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    expect(await manager.deregister(alice)).toBe(false);
    expect(await manager.deregister(alice)).toBe(true);
    expect(ports.remove).toHaveBeenCalledTimes(2);
  });
  it("a delayed old-account cleanup preserves the new account's opt-in and authority", async () => {
    const { manager, ports, binding } = setup();
    await manager.setPrincipal(alice);
    await manager.registerExplicit("alice");
    await manager.setPrincipal(bob);
    await manager.registerExplicit("bob");
    expect(await manager.deregister(alice)).toBe(true);
    expect(binding()).toEqual({ userId: "bob", installationId: id });
    expect(ports.remove).toHaveBeenLastCalledWith(alice, id);
    expect(await manager.refreshToken()).toBe("registered");
    expect(ports.register).toHaveBeenLastCalledWith(bob, id, token);
  });
  it("an old explicit null cleanup cannot deregister the current account", async () => {
    const { manager, ports, binding } = setup();
    await manager.setPrincipal(bob);
    await manager.registerExplicit("bob");
    expect(await manager.deregister(null)).toBe(true);
    expect(binding()).toEqual({ userId: "bob", installationId: id });
    expect(ports.remove).not.toHaveBeenCalled();
    expect(await manager.refreshToken()).toBe("registered");
  });
  it("an old same-user login cannot remove a newer login's device registration", async () => {
    const { manager, ports, binding } = setup();
    const first = { ...alice, sessionId: "first-session" };
    const next = {
      ...alice,
      accessToken: "new-login-token",
      sessionId: "next-session",
    };
    await manager.setPrincipal(first);
    await manager.registerExplicit("alice");
    await manager.setPrincipal(next);
    expect(await manager.refreshToken()).toBe("not_enabled");
    await manager.registerExplicit("alice");
    vi.mocked(ports.remove).mockClear();
    expect(await manager.deregister(first)).toBe(true);
    expect(ports.remove).not.toHaveBeenCalled();
    expect(binding()).toEqual({ userId: "alice", installationId: id });
    expect(await manager.refreshToken()).toBe("registered");
    expect(ports.register).toHaveBeenLastCalledWith(next, id, token);
  });
  it("same-session token rotation preserves opt-in and permits captured teardown", async () => {
    const { manager, ports, binding } = setup();
    const first = { ...alice, sessionId: "same-session" };
    const rotated = { ...first, accessToken: "rotated-token" };
    await manager.setPrincipal(first);
    await manager.registerExplicit("alice");
    await manager.setPrincipal(rotated);
    expect(await manager.refreshToken()).toBe("registered");
    expect(ports.remove).not.toHaveBeenCalled();
    expect(await manager.deregister(first)).toBe(true);
    expect(binding()).toBeNull();
    expect(ports.remove).toHaveBeenCalledWith(first, id);
    expect(await manager.refreshToken()).toBe("cancelled");
  });
  it("a newer account survives a pending old-account server removal", async () => {
    const { manager, ports, binding } = setup();
    await manager.setPrincipal(alice);
    await manager.registerExplicit("alice");
    const waiting = deferred<boolean>();
    vi.mocked(ports.remove).mockReturnValueOnce(waiting.promise);
    const removing = manager.deregister(alice);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(ports.remove).toHaveBeenCalledWith(alice, id);
    const switching = manager.setPrincipal(bob);
    const registering = manager.registerExplicit("bob");
    waiting.resolve(true);
    await removing;
    await switching;
    expect(await registering).toBe("registered");
    expect(binding()).toEqual({ userId: "bob", installationId: id });
    expect(ports.register).toHaveBeenLastCalledWith(bob, id, token);
  });
  it("ignores arbitrary payload URLs and accepts only an opaque UUID event reference", () => {
    expect(
      communityEventId({ url: "/account-settings", communityEventId: id }),
    ).toBe(id);
    expect(communityEventId({ url: "https://example.test" })).toBeNull();
    expect(communityEventId({ communityEventId: "not-an-event" })).toBeNull();
  });
});
