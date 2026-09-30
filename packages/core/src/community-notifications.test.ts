import { describe, it, expect } from "vitest";
import { isCommunityQuietTime } from "./community-notifications";
describe("Community quiet time", () => {
  it("handles overnight and timezone wall clock boundaries", () => {
    const quiet = { startMinutes: 1320, endMinutes: 480 };
    expect(
      isCommunityQuietTime(
        new Date("2026-09-30T20:00:00Z"),
        "Europe/Bratislava",
        quiet,
      ),
    ).toBe(true);
    expect(
      isCommunityQuietTime(
        new Date("2026-10-01T06:00:00Z"),
        "Europe/Bratislava",
        quiet,
      ),
    ).toBe(false);
  });
  it("handles DST repeated hour and absent quiet interval", () => {
    expect(
      isCommunityQuietTime(
        new Date("2026-10-25T01:30:00Z"),
        "Europe/Bratislava",
        { startMinutes: 120, endMinutes: 180 },
      ),
    ).toBe(true);
    expect(isCommunityQuietTime(new Date(), "UTC", null)).toBe(false);
  });
});
