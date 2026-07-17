import { describe, expect, it } from "vitest";

import type { UserId } from "./index.js";
import {
  applyProfilePatch,
  type ProfilePatch,
  type StoredProfile,
  validateProfilePatch,
} from "./profile.js";

const baseStored = (overrides: Partial<StoredProfile> = {}): StoredProfile => ({
  userId: "00000000-0000-4000-8000-000000000001" as UserId,
  displayName: "Tester",
  unitSystem: "metric",
  timezone: "UTC",
  birthYear: 1990,
  heightCm: 170,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

describe("validateProfilePatch", () => {
  it("rejects an empty patch", () => {
    expect(validateProfilePatch({})).toEqual({ kind: "empty_patch" });
  });

  it("accepts a minimal timezone-only patch", () => {
    expect(validateProfilePatch({ timezone: "Europe/Paris" })).toBeNull();
  });

  it("accepts a clearing patch (displayName = null)", () => {
    expect(validateProfilePatch({ displayName: null })).toBeNull();
  });

  it("rejects a blank display name", () => {
    expect(validateProfilePatch({ displayName: "   " })).toEqual({
      kind: "display_name_empty",
    });
  });

  it("rejects an over-long display name", () => {
    const long = "a".repeat(81);
    expect(validateProfilePatch({ displayName: long })).toEqual({
      kind: "display_name_too_long",
      max: 80,
    });
  });

  it("rejects an invalid unit system", () => {
    // Type system would catch this in callers; the runtime guard is
    // here for defence in depth against untyped inputs.
    expect(validateProfilePatch({ unitSystem: "furlongs" as never })).toEqual({
      kind: "invalid_unit_system",
      value: "furlongs",
    });
  });

  it("rejects an invalid timezone shape", () => {
    expect(validateProfilePatch({ timezone: "not a tz!" })).toEqual({
      kind: "invalid_timezone",
      value: "not a tz!",
    });
  });

  it("rejects a height outside the plausible range", () => {
    expect(validateProfilePatch({ heightCm: 30 })).toEqual({
      kind: "height_out_of_range",
      min: 50,
      max: 260,
    });
    expect(validateProfilePatch({ heightCm: 300 })).toEqual({
      kind: "height_out_of_range",
      min: 50,
      max: 260,
    });
  });

  it("accepts a height at the boundaries", () => {
    expect(validateProfilePatch({ heightCm: 50 })).toBeNull();
    expect(validateProfilePatch({ heightCm: 260 })).toBeNull();
  });

  it("rejects a birth year outside the plausible range", () => {
    const lastYear = new Date().getUTCFullYear() + 1;
    expect(validateProfilePatch({ birthYear: 1800 })).toEqual({
      kind: "birth_year_out_of_range",
      min: 1900,
      max: new Date().getUTCFullYear(),
    });
    expect(validateProfilePatch({ birthYear: lastYear })).toEqual({
      kind: "birth_year_out_of_range",
      min: 1900,
      max: new Date().getUTCFullYear(),
    });
  });

  it("accepts a birth year equal to the current year", () => {
    const thisYear = new Date().getUTCFullYear();
    expect(validateProfilePatch({ birthYear: thisYear })).toBeNull();
  });
});

describe("applyProfilePatch", () => {
  it("advances updatedAt and preserves untouched fields", () => {
    const stored = baseStored();
    const patch: ProfilePatch = { timezone: "America/New_York" };
    const next = applyProfilePatch(
      stored,
      patch,
      new Date("2026-06-01T00:00:00Z"),
    );
    expect(next.timezone).toBe("America/New_York");
    expect(next.displayName).toBe(stored.displayName);
    expect(next.unitSystem).toBe(stored.unitSystem);
    expect(next.birthYear).toBe(stored.birthYear);
    expect(next.heightCm).toBe(stored.heightCm);
    expect(next.createdAt).toEqual(stored.createdAt);
    expect(next.updatedAt).toEqual(new Date("2026-06-01T00:00:00Z"));
  });

  it("clears nullable fields when patch sets them to null", () => {
    const stored = baseStored({ displayName: "Renamed", birthYear: 1995 });
    const next = applyProfilePatch(
      stored,
      { displayName: null, birthYear: null },
      new Date("2026-06-01T00:00:00Z"),
    );
    expect(next.displayName).toBeNull();
    expect(next.birthYear).toBeNull();
  });

  it("preserves userId and createdAt across updates", () => {
    const stored = baseStored();
    const next = applyProfilePatch(
      stored,
      { unitSystem: "imperial" },
      new Date("2026-06-01T00:00:00Z"),
    );
    expect(next.userId).toBe(stored.userId);
    expect(next.createdAt).toEqual(stored.createdAt);
  });
});
