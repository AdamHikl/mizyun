import { describe, expect, it } from "vitest";

import { reviewHeadline, visibleTargetChange } from "./weekly-review-copy";
import { reviewFixture } from "./fixtures.test-util";

describe("visibleTargetChange", () => {
  it("uses the visible target change when the floor clamp absorbs calibration", () => {
    // Calibration rises by 300 but the target the user sees rises by 100.
    const review = reviewFixture({ deltaKcal: 300, targetChangeKcal: 100 });
    expect(visibleTargetChange(review)).toBe(100);
    expect(reviewHeadline(review)).toBe("Raise your calorie target?");
  });

  it("falls back to the calibration change for older servers", () => {
    const review = reviewFixture({ deltaKcal: -150 });
    expect(
      visibleTargetChange({ ...review, targetChangeKcal: undefined }),
    ).toBe(-150);
  });
});
