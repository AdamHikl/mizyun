import type { Profile } from "@mizyun/contracts";

import { storedBirthYearIsUnderage } from "@/lib/adult-age";

export type SessionGateTarget =
  | "auth"
  | "recovery"
  | "age_restricted"
  | "loading"
  | "health_consent"
  | "consent_unavailable"
  | "content";

export const resolveSessionGateTarget = (input: {
  readonly hasSession: boolean;
  readonly recoveryState: boolean;
  readonly profile: Profile | null;
  /** Health-data consent (PRIV-01); content is reachable only once granted. */
  readonly healthDataConsent:
    "loading" | "granted" | "required" | "unavailable";
  /** UTC year, matching the server's adult birth-year rule. */
  readonly currentYear: number;
}): SessionGateTarget => {
  if (input.hasSession && input.recoveryState) return "recovery";
  if (!input.hasSession) return "auth";
  // PRIV-02: a stored under-18 birth year closes the app before anything else.
  if (storedBirthYearIsUnderage(input.profile?.birthYear, input.currentYear))
    return "age_restricted";
  if (input.healthDataConsent === "loading") return "loading";
  if (input.healthDataConsent === "required") return "health_consent";
  if (input.healthDataConsent === "unavailable") return "consent_unavailable";
  return "content";
};
