import { describe, it, expect } from "vitest";
import { challengeLocalDay, challengeProgress } from "./community-challenges";
describe("cooperative declarations", () => {
  it("distinguishes missing declarations from revoked zero", () => {
    expect(challengeProgress([])).toBeNull();
    expect(
      challengeProgress([{ day: "2026-10-01", kind: "workout", valid: false }]),
    ).toBe(0);
  });
  it("counts a day once with equal rest/workout credit", () => {
    expect(
      challengeProgress([
        { day: "2026-10-01", kind: "rest", valid: true },
        { day: "2026-10-01", kind: "workout", valid: true },
        { day: "2026-10-02", kind: "rest", valid: true },
      ]),
    ).toBe(2);
  });
  it("keeps repeated autumn DST hour on one local day", () => {
    expect(
      challengeLocalDay(new Date("2026-10-25T00:30:00Z"), "Europe/Bratislava"),
    ).toBe("2026-10-25");
    expect(
      challengeLocalDay(new Date("2026-10-25T01:30:00Z"), "Europe/Bratislava"),
    ).toBe("2026-10-25");
  });
  it("uses local date across UTC midnight and spring DST", () => {
    expect(
      challengeLocalDay(new Date("2026-03-29T01:30:00Z"), "Europe/Bratislava"),
    ).toBe("2026-03-29");
    expect(
      challengeLocalDay(
        new Date("2026-10-01T00:30:00Z"),
        "America/Los_Angeles",
      ),
    ).toBe("2026-09-30");
  });
});
