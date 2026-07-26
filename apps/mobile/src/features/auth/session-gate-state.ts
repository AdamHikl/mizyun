import type { Profile } from "@mizyun/contracts";

export type SessionGateTarget = "auth" | "recovery" | "content";

export const resolveSessionGateTarget = (input: {
  readonly hasSession: boolean;
  readonly recoveryState: boolean;
  readonly profile: Profile | null;
}): SessionGateTarget => {
  if (input.hasSession && input.recoveryState) return "recovery";
  if (!input.hasSession) return "auth";
  return "content";
};
