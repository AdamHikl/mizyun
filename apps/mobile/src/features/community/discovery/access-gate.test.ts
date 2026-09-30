import { describe, it, expect } from "vitest";
import { DiscoveryAccessGate } from "./access-gate";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
describe("owner identity rendering freshness", () => {
  it("hides a previously ready owner immediately on background and requires a new check", async () => {
    const gate = new DiscoveryAccessGate();
    await gate.revalidate(async () => {});
    expect(gate.getState()).toBe(true);
    gate.invalidate();
    expect(gate.getState()).toBe(false);
    const load = deferred();
    const foreground = gate.revalidate(() => load.promise);
    expect(gate.getState()).toBe(false);
    load.resolve();
    await foreground;
    expect(gate.getState()).toBe(true);
  });
  it("does not let a pre-background profile response authorize resumed identity", async () => {
    const gate = new DiscoveryAccessGate();
    const old = deferred();
    const fresh = deferred();
    const first = gate.revalidate(() => old.promise);
    gate.invalidate();
    const second = gate.revalidate(() => fresh.promise);
    old.resolve();
    await first;
    expect(gate.getState()).toBe(false);
    fresh.resolve();
    await second;
    expect(gate.getState()).toBe(true);
  });
  it("suppresses a fresh profile completion after blur or principal retirement", async () => {
    const gate = new DiscoveryAccessGate();
    const load = deferred();
    const pending = gate.revalidate(() => load.promise);
    gate.invalidate();
    load.resolve();
    await pending;
    expect(gate.getState()).toBe(false);
  });
});
