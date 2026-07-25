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

  it("never exposes protected content before a profile resolves", () => {
    expect(
      resolveSessionGateTarget({
        hasSession: true,
        recoveryState: false,
        profile: null,
      }),
    ).toBe("onboarding");
  });

  it("routes a fresh profile without a displayName to onboarding", () => {
    expect(
      resolveSessionGateTarget({
        hasSession: true,
        recoveryState: false,
        profile: { ...completeProfile, displayName: null },
      }),
    ).toBe("onboarding");
  });

  it("renders protected content only for a completed profile", () => {
    expect(
      resolveSessionGateTarget({
        hasSession: true,
        recoveryState: false,
        profile: completeProfile,
      }),
    ).toBe("content");
  });
});
