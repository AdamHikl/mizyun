import { describe, expect, it } from "vitest";
import { VisibilityEpoch } from "./visibility-epoch";

describe("social visibility epoch", () => {
  it("never revives a prior read, report receipt or confirmation after resume", () => {
    const epoch = new VisibilityEpoch();
    const displayedIntent = epoch.capture();
    epoch.invalidate();
    const foregroundIntent = epoch.capture();
    expect(displayedIntent()).toBe(false);
    expect(foregroundIntent()).toBe(true);
    epoch.invalidate();
    expect(displayedIntent()).toBe(false);
    expect(foregroundIntent()).toBe(false);
  });
});
