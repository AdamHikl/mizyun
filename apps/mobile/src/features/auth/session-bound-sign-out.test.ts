import { describe, expect, it, vi } from "vitest";
import type { AuthSession } from "@mizyun/identity";
import type { UserId } from "@mizyun/core";
import { signOutCapturedSession } from "./session-bound-sign-out";

const alice: AuthSession = {
  user: { id: "alice" as UserId },
  accessToken: "alice-token",
};
const bob: AuthSession = {
  user: { id: "bob" as UserId },
  accessToken: "bob-token",
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  let current: AuthSession | null = alice;
  const ports = {
    current: () => current,
    purge: vi.fn(async () => {}),
    deregister: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    clear: vi.fn(() => {
      current = null;
    }),
  };
  return {
    ports,
    switchTo: (next: AuthSession | null) => {
      current = next;
    },
  };
}
describe("captured-session sign out", () => {
  it("does not start logout from a callback belonging to an earlier account", async () => {
    const { ports, switchTo } = setup();
    switchTo(bob);
    await signOutCapturedSession(alice, ports);
    expect(ports.purge).not.toHaveBeenCalled();
    expect(ports.deregister).not.toHaveBeenCalled();
    expect(ports.signOut).not.toHaveBeenCalled();
    expect(ports.clear).not.toHaveBeenCalled();
  });
  it.each(["purge", "deregister", "signOut"] as const)(
    "preserves a newer account after deferred %s completion",
    async (boundary) => {
      const { ports, switchTo } = setup();
      const waiting = deferred();
      ports[boundary].mockImplementation(async () => waiting.promise);
      const signingOut = signOutCapturedSession(alice, ports);
      for (let i = 0; i < 10; i++) await Promise.resolve();
      expect(ports[boundary]).toHaveBeenCalledTimes(1);
      switchTo(bob);
      waiting.resolve();
      await signingOut;
      expect(ports.current()).toBe(bob);
      expect(ports.clear).not.toHaveBeenCalled();
      if (boundary !== "signOut") expect(ports.signOut).not.toHaveBeenCalled();
      if (boundary === "purge") expect(ports.deregister).not.toHaveBeenCalled();
    },
  );
  it("logs out the captured account after cleanup even when cache purge fails", async () => {
    const { ports } = setup();
    ports.purge.mockRejectedValue(new Error("cache unavailable"));
    await signOutCapturedSession(alice, ports);
    expect(ports.deregister).toHaveBeenCalledWith(alice);
    expect(ports.signOut).toHaveBeenCalledTimes(1);
    expect(ports.clear).toHaveBeenCalledTimes(1);
  });
  it("clears only the current preview session without network logout", async () => {
    const { ports, switchTo } = setup();
    const preview = { ...alice, accessToken: "preview-token" };
    switchTo(preview);
    await signOutCapturedSession(preview, ports);
    expect(ports.clear).toHaveBeenCalledTimes(1);
    expect(ports.purge).not.toHaveBeenCalled();
    expect(ports.deregister).not.toHaveBeenCalled();
    expect(ports.signOut).not.toHaveBeenCalled();
  });
});
