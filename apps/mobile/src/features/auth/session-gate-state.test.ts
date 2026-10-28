import { describe, expect, it } from "vitest";
import type { Profile } from "@mizyun/contracts";

import { resolveSessionGateTarget } from "./session-gate-state";

const completeProfile = {
  displayName: "MOB Tester",
  birthYear: 1990,
} as Profile;

const signedIn = {
  hasSession: true,
  recoveryState: false,
  profile: completeProfile,
  healthDataConsent: "granted" as const,
  currentYear: 2026,
};

describe("resolveSessionGateTarget", () => {
  it("keeps signed-out users on authentication", () => {
    expect(
      resolveSessionGateTarget({
        ...signedIn,
        hasSession: false,
        profile: null,
        healthDataConsent: "loading",
      }),
    ).toBe("auth");
  });

  it("prioritizes password recovery for a signed-in recovery session", () => {
    expect(
      resolveSessionGateTarget({
        ...signedIn,
        recoveryState: true,
        healthDataConsent: "required",
      }),
    ).toBe("recovery");
  });

  it("routes authenticated users with consent directly to content so they can explore the app first", () => {
    expect(resolveSessionGateTarget({ ...signedIn, profile: null })).toBe(
      "content",
    );
  });

  it("routes a profile without a displayName to content so onboarding is accessible via setup prompt", () => {
    expect(
      resolveSessionGateTarget({
        ...signedIn,
        profile: { ...completeProfile, displayName: null },
      }),
    ).toBe("content");
  });

  it("renders protected content for a completed profile", () => {
    expect(resolveSessionGateTarget(signedIn)).toBe("content");
  });

  it("asks for health-data consent before any content or onboarding (PRIV-01)", () => {
    expect(
      resolveSessionGateTarget({
        ...signedIn,
        profile: null,
        healthDataConsent: "required",
      }),
    ).toBe("health_consent");
    expect(
      resolveSessionGateTarget({ ...signedIn, healthDataConsent: "required" }),
    ).toBe("health_consent");
  });

  it("offers a retry when the consent answer is unavailable", () => {
    expect(
      resolveSessionGateTarget({
        ...signedIn,
        healthDataConsent: "unavailable",
      }),
    ).toBe("consent_unavailable");
  });

  it("waits for the consent answer instead of showing content", () => {
    expect(
      resolveSessionGateTarget({ ...signedIn, healthDataConsent: "loading" }),
    ).toBe("loading");
  });

  it("closes the app for a stored under-18 birth year, even with consent (PRIV-02)", () => {
    expect(
      resolveSessionGateTarget({
        ...signedIn,
        profile: { ...completeProfile, birthYear: 2009 },
      }),
    ).toBe("age_restricted");
    expect(
      resolveSessionGateTarget({
        ...signedIn,
        profile: { ...completeProfile, birthYear: 2008 },
      }),
    ).toBe("content");
  });
});
