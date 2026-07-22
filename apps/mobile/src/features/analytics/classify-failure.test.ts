import { describe, expect, it } from "vitest";

import {
  classifyAnalyticsFailure,
  isRetryableAnalyticsFailure,
} from "./classify-failure";

describe("analytics failure classification", () => {
  it.each([
    ["Network unavailable. Try again when you're online.", "network"],
    ["Your session expired. Sign in again.", "session"],
    ["The API isn't configured yet.", "disabled"],
    ["Name a meal first.", "invalid_input"],
    ["Please double-check the values and try again.", "invalid_input"],
    ["The server rejected the entry.", "server"],
    ["Could not save the entry.", "unexpected"],
  ] as const)(
    "maps fixed UI copy without retaining it: %s",
    (message, expected) => {
      expect(classifyAnalyticsFailure(message)).toBe(expected);
    },
  );

  it("marks user correction and disabled configuration as non-retryable", () => {
    expect(isRetryableAnalyticsFailure("invalid_input")).toBe(false);
    expect(isRetryableAnalyticsFailure("disabled")).toBe(false);
    expect(isRetryableAnalyticsFailure("network")).toBe(true);
  });
});
