import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  Platform: { OS: "ios" as string },
  AccessibilityInfo: { announceForAccessibility: vi.fn() },
}));
vi.mock("react-native", () => native);

// A single-component hook runtime: refs persist across renders and an
// effect runs only when its dependencies change, as in React.
const runtime = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  deps: [] as (unknown[] | undefined)[],
  cursor: 0,
}));
vi.mock("react", () => ({
  useRef: (initial: unknown) => {
    const index = runtime.cursor++;
    runtime.refs[index] ??= { current: initial };
    return runtime.refs[index];
  },
  useEffect: (effect: () => void, deps: unknown[]) => {
    const index = runtime.cursor++;
    const previous = runtime.deps[index];
    runtime.deps[index] = deps;
    if (previous && deps.every((dep, i) => Object.is(dep, previous[i]))) {
      return;
    }
    effect();
  },
}));

import { announce, textOfChildren, useAnnouncement } from "./announce";

const spoken = native.AccessibilityInfo.announceForAccessibility;

function render(message: string | null | undefined) {
  runtime.cursor = 0;
  useAnnouncement(message);
}

beforeEach(() => {
  native.Platform.OS = "ios";
  spoken.mockClear();
  runtime.refs = [];
  runtime.deps = [];
});

describe("announce", () => {
  it("speaks trimmed text on iOS and ignores empty messages", () => {
    announce("  Meal saved. ");
    announce("   ");
    announce(null);
    expect(spoken.mock.calls).toEqual([["Meal saved."]]);
  });

  it("leaves Android to its live regions so text is not spoken twice", () => {
    native.Platform.OS = "android";
    announce("Meal saved.");
    expect(spoken).not.toHaveBeenCalled();
  });
});

describe("useAnnouncement", () => {
  it("announces a message once when it appears, not on re-render", () => {
    render(null);
    render("Workout saved.");
    render("Workout saved.");
    render("Workout saved.");
    expect(spoken.mock.calls).toEqual([["Workout saved."]]);
  });

  it("announces each new message and a repeat after it was cleared", () => {
    render("Couldn't save.");
    render("Couldn't save.");
    render("Saved.");
    render(null);
    render("Saved.");
    expect(spoken.mock.calls).toEqual([
      ["Couldn't save."],
      ["Saved."],
      ["Saved."],
    ]);
  });

  it("stays silent on Android", () => {
    native.Platform.OS = "android";
    render("Weight saved.");
    expect(spoken).not.toHaveBeenCalled();
  });
});

describe("textOfChildren", () => {
  it("joins plain text children and skips rich content", () => {
    expect(textOfChildren(["Saved ", 3, " sets"])).toBe("Saved 3 sets");
    expect(textOfChildren({ type: "Icon" } as never)).toBe("");
    expect(textOfChildren(null)).toBe("");
  });
});
