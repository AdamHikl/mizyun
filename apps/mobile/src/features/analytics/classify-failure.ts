import type { FailureReason } from "@mizyun/observability";

/** Maps only rendered, pre-defined error copy to a coarse enum. The original
 * message is never passed across the analytics boundary. */
export const classifyAnalyticsFailure = (message: string): FailureReason => {
  const normalized = message.toLowerCase();
  if (normalized.includes("network") || normalized.includes("offline")) {
    return "network";
  }
  if (normalized.includes("session") || normalized.includes("sign in")) {
    return "session";
  }
  if (normalized.includes("configured")) return "disabled";
  if (
    normalized.includes("enter") ||
    normalized.includes("select") ||
    normalized.includes("positive") ||
    normalized.includes("between") ||
    normalized.includes("double-check") ||
    normalized.includes("name a")
  ) {
    return "invalid_input";
  }
  if (normalized.includes("server") || normalized.includes("rejected")) {
    return "server";
  }
  return "unexpected";
};

export const isRetryableAnalyticsFailure = (reason: FailureReason): boolean =>
  reason !== "invalid_input" && reason !== "disabled";
