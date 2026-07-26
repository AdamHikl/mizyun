import { describe, expect, it } from "vitest";
import type { Profile } from "@mizyun/contracts";

import { resolveSessionGateTarget } from "./session-gate-state";

const completeProfile = {
  displayName: "MOB Tester",
} as Profile;

describe("resolveSessionGateTarget", () => {
  it("keeps signed-out users on authentication", () => {
    expect(
      resolveSessionGateTarget({
        hasSession: false,
        recoveryState: false,
        profile: null,
      }),
    ).toBe("auth");
  });

  it("prioritizes password recovery for a signed-in recovery session", () => {
    expect(
      resolveSessionGateTarget({
        hasSession: true,
        recoveryState: true,
        profile: completeProfile,
      }),
    ).toBe("recovery");
  });

  it("routes authenticated users directly to content so they can explore the app first", () => {
    expect(
      resolveSessionGateTarget({
        hasSession: true,
        recoveryState: false,
        profile: null,
      }),
    ).toBe("content");
  });

  it("routes a profile without a displayName to content so onboarding is accessible via setup prompt", () => {
    expect(
      resolveSessionGateTarget({
        hasSession: true,
        recoveryState: false,
        profile: { ...completeProfile, displayName: null },
      }),
    ).toBe("content");
  });

  it("renders protected content for a completed profile", () => {
    expect(
      resolveSessionGateTarget({
        hasSession: true,
        recoveryState: false,
        profile: completeProfile,
      }),
    ).toBe("content");
  });
});
