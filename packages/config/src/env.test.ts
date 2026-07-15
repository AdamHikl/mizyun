import { describe, expect, it } from "vitest";

import { envSnapshotFrom, isPublicEnvKey, readProcessEnv } from "./env.js";

describe("envSnapshotFrom", () => {
  it("returns a frozen snapshot independent of later source mutations", () => {
    const source: Record<string, string | undefined> = {
      FOO: "bar",
    };
    const snapshot = envSnapshotFrom(source);

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.FOO).toBe("bar");

    // Mutating the source after snapshotting must not change the snapshot.
    source.FOO = "changed";
    expect(snapshot.FOO).toBe("bar");

    // The snapshot itself must be immutable.
    expect(() => {
      (snapshot as { FOO?: string }).FOO = "hijack";
    }).toThrow();
  });

  it("preserves undefined values from the source", () => {
    const source: Record<string, string | undefined> = {
      PRESENT: "yes",
      MISSING: undefined,
    };
    const snapshot = envSnapshotFrom(source);
    expect(snapshot.PRESENT).toBe("yes");
    expect(snapshot.MISSING).toBeUndefined();
  });
});

describe("readProcessEnv", () => {
  it("returns a frozen snapshot", () => {
    const snapshot = readProcessEnv();
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
});

describe("isPublicEnvKey", () => {
  it("returns true for keys with the EXPO_PUBLIC_ prefix", () => {
    expect(isPublicEnvKey("EXPO_PUBLIC_API_URL")).toBe(true);
    expect(isPublicEnvKey("EXPO_PUBLIC_SUPABASE_URL")).toBe(true);
  });

  it("returns false for non-prefixed keys", () => {
    expect(isPublicEnvKey("API_URL")).toBe(false);
    expect(isPublicEnvKey("SUPABASE_URL")).toBe(false);
    expect(isPublicEnvKey("EXPO_PUBLIC")).toBe(false);
    expect(isPublicEnvKey("")).toBe(false);
  });
});
