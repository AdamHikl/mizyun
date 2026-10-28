import { describe, expect, it } from "vitest";
import {
  coachDailyLimitMessage,
  coachMessagesLeftLabel,
  localResetTime,
  monthlyAllowanceMessage,
} from "./ai-allowance";

describe("monthlyAllowanceMessage", () => {
  const now = Date.parse("2026-10-26T12:00:00.000Z");

  it("names the renewal date when the reset is more than a day away", () => {
    expect(monthlyAllowanceMessage("2026-11-01T00:00:00.000Z", now)).toBe(
      "You've used this month's AI allowance. It renews on 1 November.",
    );
  });

  it("leaves daily resets and missing values to the caller", () => {
    expect(monthlyAllowanceMessage("2026-10-27T00:00:00.000Z", now)).toBeNull();
    expect(monthlyAllowanceMessage(undefined, now)).toBeNull();
    expect(monthlyAllowanceMessage("not a date", now)).toBeNull();
  });
});

describe("Coach message allowance copy (ADR-0085)", () => {
  const resetsAt = "2026-10-28T00:00:00.000Z";

  it("shows the reset in the device's own time, never UTC", () => {
    const time = localResetTime(resetsAt, "Europe/Bratislava");
    expect(time).toMatch(/^0?1[:.]00/);
    expect(coachDailyLimitMessage(resetsAt, "Europe/Bratislava")).toBe(
      `You've reached today's Coach limit. More messages from ${time}.`,
    );
    expect(coachDailyLimitMessage(resetsAt, "Europe/Bratislava")).not.toMatch(
      /UTC|token/i,
    );
    expect(coachDailyLimitMessage(undefined)).toBe(
      "You've reached today's Coach limit. More messages tomorrow.",
    );
  });

  it("stays quiet until few messages are left, then counts them", () => {
    expect(
      coachMessagesLeftLabel({ messagesRemaining: 4, resetsAt }),
    ).toBeNull();
    expect(coachMessagesLeftLabel({ messagesRemaining: 3, resetsAt })).toBe(
      "3 Coach messages left today",
    );
    expect(coachMessagesLeftLabel({ messagesRemaining: 1, resetsAt })).toBe(
      "1 Coach message left today",
    );
    const none = coachMessagesLeftLabel(
      { messagesRemaining: 0, resetsAt },
      "Europe/Bratislava",
    );
    expect(none).toBe(
      `No Coach messages left today. More from ${localResetTime(resetsAt, "Europe/Bratislava")}.`,
    );
  });
});
