import { describe, expect, it, vi } from "vitest";
import type { AuthSession } from "@mizyun/identity";
import type { UserId } from "@mizyun/core";
import { hydrateAuthBootstrap } from "./auth-bootstrap";
const alice: AuthSession = {
  user: { id: "alice" as UserId },
  accessToken: "alice-token",
};
const bob: AuthSession = {
  user: { id: "bob" as UserId },
  accessToken: "bob-token",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe("auth bootstrap hydration", () => {
  it.each(["session", "cache"])(
    "a newer subscribed session survives deferred bootstrap %s",
    async (boundary) => {
      let revision = 0;
      let displayedSession: AuthSession | null = null;
      let displayedProfile: string | null = null;
      const startedRevision = revision;
      const session = deferred<AuthSession | null>();
      const cache = deferred<string | null>();
      const cachedProfile = vi.fn(() => cache.promise);
      const boot = hydrateAuthBootstrap({
        isCurrent: () => revision === startedRevision,
        getSession: () => session.promise,
        cachedProfile,
        applyProfile: (value) => {
          displayedProfile = value;
        },
        applySession: (value) => {
          displayedSession = value;
        },
      });
      if (boundary === "cache") {
        session.resolve(alice);
        for (let i = 0; i < 5; i++) await Promise.resolve();
        expect(cachedProfile).toHaveBeenCalledWith("alice");
      }
      // This is the provider subscription's applySession(B) boundary.
      revision++;
      displayedSession = bob;
      displayedProfile = "bob-private-profile";
      session.resolve(alice);
      cache.resolve("alice-private-profile");
      await boot;
      expect(displayedSession).toBe(bob);
      expect(displayedProfile).toBe("bob-private-profile");
      if (boundary === "session") expect(cachedProfile).not.toHaveBeenCalled();
    },
  );
  it("hydrates the current bootstrap and tolerates unavailable owner cache", async () => {
    const applySession = vi.fn();
    const applyProfile = vi.fn();
    await hydrateAuthBootstrap({
      isCurrent: () => true,
      getSession: async () => alice,
      cachedProfile: async () => {
        throw new Error("offline cache unavailable");
      },
      applySession,
      applyProfile,
    });
    expect(applySession).toHaveBeenCalledWith(alice);
    expect(applyProfile).not.toHaveBeenCalled();
  });
});
