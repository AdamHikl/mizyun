import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCalendars: vi.fn(),
  native: true,
}));
vi.mock("expo", () => ({
  requireOptionalNativeModule: (name: string) =>
    name === "ExpoLocalization" && mocks.native
      ? { getCalendars: mocks.getCalendars }
      : null,
}));

import { deviceUses24HourClock, formatDeviceTime } from "./device-clock";
import { uses24HourClock } from "./native-date-time-values";

const calendar = (uses24hourClock: boolean | null) => [
  { calendar: "gregory", timeZone: "UTC", uses24hourClock, firstWeekday: 1 },
];

beforeEach(() => {
  mocks.getCalendars.mockReset();
  mocks.native = true;
});

describe("device clock", () => {
  it("follows the device's 24-hour setting over the locale", () => {
    mocks.getCalendars.mockReturnValue(calendar(true));
    expect(deviceUses24HourClock()).toBe(true);
    expect(formatDeviceTime(19, 30)).toBe("19:30");

    mocks.getCalendars.mockReturnValue(calendar(false));
    expect(deviceUses24HourClock()).toBe(false);
    expect(formatDeviceTime(19, 30).replace(/\s/g, " ")).toMatch(/^7:30 pm$/i);
  });

  it("reads the setting on every call, since Android sends no change event", () => {
    mocks.getCalendars.mockReturnValueOnce(calendar(false));
    mocks.getCalendars.mockReturnValueOnce(calendar(true));
    expect(deviceUses24HourClock()).toBe(false);
    expect(deviceUses24HourClock()).toBe(true);
  });

  it("falls back to the locale when the setting is unknown or unreadable", () => {
    mocks.getCalendars.mockReturnValue(calendar(null));
    expect(deviceUses24HourClock()).toBe(uses24HourClock());
    mocks.getCalendars.mockReturnValue([]);
    expect(deviceUses24HourClock()).toBe(uses24HourClock());
    mocks.getCalendars.mockImplementation(() => {
      throw new Error("native call failed");
    });
    expect(deviceUses24HourClock()).toBe(uses24HourClock());
  });

  it("uses the locale clock on a binary without the native module", () => {
    mocks.native = false;
    expect(deviceUses24HourClock()).toBe(uses24HourClock());
    expect(mocks.getCalendars).not.toHaveBeenCalled();
  });
});
