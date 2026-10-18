import { describe, expect, it } from "vitest";

import type { StretchStep } from "@mizyun/core";
import {
  advanceProgress,
  formatMinutes,
  sideLabel,
  skipStretch,
  startProgress,
  tickProgress,
  togglePause,
  type StretchProgress,
} from "./stretch-progress";

const step = (
  exerciseId: string,
  holdSeconds: number,
  bothSides: boolean,
): StretchStep => ({
  exerciseId,
  name: exerciseId,
  targetMuscles: [],
  instructions: [],
  holdSeconds,
  bothSides,
});

const oneSided = step("fold", 30, false);
const twoSided = step("hip", 20, true);
const last = step("calf", 10, false);
const steps = [oneSided, twoSided, last];

const holding = (progress: StretchProgress) => {
  if (progress.phase !== "holding") throw new Error("expected holding");
  return progress;
};

/** Advances `count` holds from the start (fold, hip L, hip R, calf, done). */
const advanceTimes = (count: number): StretchProgress => {
  let progress = startProgress(steps, 0);
  for (let i = 0; i < count; i++)
    progress = advanceProgress(steps, progress, 0);
  return progress;
};

describe("startProgress", () => {
  it("starts holding the first stretch's first side", () => {
    expect(startProgress(steps, 1000)).toEqual({
      phase: "holding",
      index: 0,
      side: 0,
      endsAt: 31_000,
      remainingMs: 30_000,
    });
  });

  it("is done immediately when there are no steps", () => {
    expect(startProgress([], 0)).toEqual({ phase: "done" });
  });
});

describe("tickProgress", () => {
  it("updates the remaining time while holding", () => {
    const start = startProgress(steps, 0);

    expect(holding(tickProgress(steps, start, 12_000)).remainingMs).toBe(
      18_000,
    );
  });

  it("returns the same object when nothing changed", () => {
    const start = startProgress(steps, 0);

    expect(tickProgress(steps, start, 0)).toBe(start);
  });

  it("advances a one-sided stretch to the next stretch when the hold ends", () => {
    const next = holding(tickProgress(steps, startProgress(steps, 0), 30_000));

    expect(next).toMatchObject({
      index: 1,
      side: 0,
      endsAt: 50_000,
      remainingMs: 20_000,
    });
  });

  it("advances late ticks from the tick time", () => {
    const next = holding(tickProgress(steps, startProgress(steps, 0), 45_000));

    expect(next.index).toBe(1);
    expect(next.endsAt).toBe(65_000);
  });

  it("holds the second side of a two-sided stretch before moving on", () => {
    const secondStretch = holding(
      tickProgress(steps, startProgress(steps, 0), 30_000),
    );

    const secondSide = holding(tickProgress(steps, secondStretch, 50_000));
    expect(secondSide).toMatchObject({
      index: 1,
      side: 1,
      endsAt: 70_000,
      remainingMs: 20_000,
    });

    const third = holding(tickProgress(steps, secondSide, 70_000));
    expect(third).toMatchObject({ index: 2, side: 0, remainingMs: 10_000 });
  });

  it("finishes after the last step", () => {
    const lastHold = holding(advanceTimes(3));
    expect(lastHold.index).toBe(2);

    expect(tickProgress(steps, lastHold, lastHold.endsAt as number)).toEqual({
      phase: "done",
    });
  });

  it("is a no-op while paused", () => {
    const paused = togglePause(startProgress(steps, 0), 5_000);

    expect(tickProgress(steps, paused, 999_999)).toBe(paused);
  });

  it("ignores the overview and done phases", () => {
    const overview: StretchProgress = { phase: "overview" };
    const done: StretchProgress = { phase: "done" };

    expect(tickProgress(steps, overview, 1)).toBe(overview);
    expect(tickProgress(steps, done, 1)).toBe(done);
  });
});

describe("advanceProgress", () => {
  it("moves from the first to the second side of a two-sided stretch", () => {
    const atHip = advanceProgress(steps, startProgress(steps, 0), 0);

    expect(holding(advanceProgress(steps, atHip, 100))).toMatchObject({
      index: 1,
      side: 1,
      endsAt: 20_100,
    });
  });

  it("moves to the next stretch after the second side", () => {
    const secondSide = advanceProgress(
      steps,
      advanceProgress(steps, startProgress(steps, 0), 0),
      0,
    );

    expect(holding(advanceProgress(steps, secondSide, 0))).toMatchObject({
      index: 2,
      side: 0,
    });
  });

  it("finishes past the last step", () => {
    expect(advanceTimes(4)).toEqual({ phase: "done" });
  });

  it("leaves non-holding phases unchanged", () => {
    const overview: StretchProgress = { phase: "overview" };

    expect(advanceProgress(steps, overview, 0)).toBe(overview);
  });
});

describe("skipStretch", () => {
  it("skips both sides of a two-sided stretch", () => {
    const atHip = advanceProgress(steps, startProgress(steps, 0), 0);

    expect(holding(skipStretch(steps, atHip, 0))).toMatchObject({
      index: 2,
      side: 0,
    });
  });

  it("skips from the second side as well", () => {
    const secondSide = advanceProgress(
      steps,
      advanceProgress(steps, startProgress(steps, 0), 0),
      0,
    );

    expect(holding(skipStretch(steps, secondSide, 0)).index).toBe(2);
  });

  it("finishes when skipping the last stretch", () => {
    const atLast = holding(
      skipStretch(steps, skipStretch(steps, startProgress(steps, 0), 0), 0),
    );

    expect(skipStretch(steps, atLast, 0)).toEqual({ phase: "done" });
  });

  it("leaves non-holding phases unchanged", () => {
    const done: StretchProgress = { phase: "done" };

    expect(skipStretch(steps, done, 0)).toBe(done);
  });
});

describe("togglePause", () => {
  it("pauses with the remaining time and resumes from it after a gap", () => {
    const running = startProgress(steps, 0);

    const paused = holding(togglePause(running, 10_000));
    expect(paused.endsAt).toBeNull();
    expect(paused.remainingMs).toBe(20_000);

    // A long gap while paused does not consume hold time.
    const resumed = holding(togglePause(paused, 600_000));
    expect(resumed.endsAt).toBe(620_000);
    expect(resumed.remainingMs).toBe(20_000);
    expect(holding(tickProgress(steps, resumed, 605_000)).remainingMs).toBe(
      15_000,
    );
  });

  it("never records negative remaining time", () => {
    const paused = holding(togglePause(startProgress(steps, 0), 99_000));

    expect(paused.remainingMs).toBe(0);
  });

  it("ignores the overview and done phases", () => {
    const overview: StretchProgress = { phase: "overview" };
    const done: StretchProgress = { phase: "done" };

    expect(togglePause(overview, 0)).toBe(overview);
    expect(togglePause(done, 0)).toBe(done);
  });
});

describe("sideLabel", () => {
  it("labels both sides of a two-sided stretch", () => {
    expect(sideLabel(twoSided, 0)).toBe("First side");
    expect(sideLabel(twoSided, 1)).toBe("Second side");
  });

  it("has no label for a one-sided stretch", () => {
    expect(sideLabel(oneSided, 0)).toBeNull();
  });
});

describe("formatMinutes", () => {
  it("rounds to the nearest minute", () => {
    expect(formatMinutes(89)).toBe("1 min");
    expect(formatMinutes(90)).toBe("2 min");
    expect(formatMinutes(300)).toBe("5 min");
  });

  it("never shows less than one minute", () => {
    expect(formatMinutes(0)).toBe("1 min");
    expect(formatMinutes(20)).toBe("1 min");
  });
});
