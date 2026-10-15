import { describe, expect, it } from "vitest";
import {
  detectRoutineSuggestion,
  routineExerciseSetSignature,
  type RoutineSuggestionSession,
} from "./workout-routine-suggestion";

const now = new Date("2026-10-15T12:00:00Z");
const session = (
  id: string,
  day: string,
  keys: string[],
): RoutineSuggestionSession => ({
  id,
  completedAt: `${day}T10:00:00Z`,
  exerciseKeys: keys,
});
const three = [
  session("a", "2026-10-01", ["squat", "bench"]),
  session("b", "2026-10-08", ["bench", "squat"]),
  session("c", "2026-10-13", ["squat", "bench"]),
];

describe("detectRoutineSuggestion", () => {
  it("suggests after three matching one-time workouts, order-insensitive", () => {
    const result = detectRoutineSuggestion({
      sessions: three,
      existingRoutines: [],
      now,
    });
    expect(result?.signature).toBe("bench|squat");
    expect(result?.exerciseKeys).toEqual(["squat", "bench"]);
    expect(result?.latestSessionId).toBe("c");
    expect(result?.sessionIds).toEqual(["c", "b", "a"]);
  });

  it("needs three sessions and at least two exercises", () => {
    expect(
      detectRoutineSuggestion({
        sessions: three.slice(0, 2),
        existingRoutines: [],
        now,
      }),
    ).toBeNull();
    expect(
      detectRoutineSuggestion({
        sessions: [
          session("a", "2026-10-01", ["squat"]),
          session("b", "2026-10-08", ["squat"]),
          session("c", "2026-10-13", ["squat", "squat"]),
        ],
        existingRoutines: [],
        now,
      }),
    ).toBeNull();
  });

  it("does not match different exercise sets", () => {
    expect(
      detectRoutineSuggestion({
        sessions: [
          ...three.slice(0, 2),
          session("c", "2026-10-13", ["squat", "bench", "row"]),
        ],
        existingRoutines: [],
        now,
      }),
    ).toBeNull();
  });

  it("is suppressed by an existing routine with the same set", () => {
    expect(
      detectRoutineSuggestion({
        sessions: three,
        existingRoutines: [{ exerciseKeys: ["bench", "squat"] }],
        now,
      }),
    ).toBeNull();
    expect(
      detectRoutineSuggestion({
        sessions: three,
        existingRoutines: [{ exerciseKeys: ["bench", "squat", "row"] }],
        now,
      }),
    ).not.toBeNull();
  });

  it("only counts the last 28 days and ignores incomplete or future sessions", () => {
    expect(
      detectRoutineSuggestion({
        sessions: [
          session("a", "2026-09-10", ["squat", "bench"]),
          three[1]!,
          three[2]!,
        ],
        existingRoutines: [],
        now,
      }),
    ).toBeNull();
    expect(
      detectRoutineSuggestion({
        sessions: [{ ...three[0]!, completedAt: null }, three[1]!, three[2]!],
        existingRoutines: [],
        now,
      }),
    ).toBeNull();
    expect(
      detectRoutineSuggestion({
        sessions: [
          session("a", "2026-10-20", ["squat", "bench"]),
          three[1]!,
          three[2]!,
        ],
        existingRoutines: [],
        now,
      }),
    ).toBeNull();
  });

  it("honours dismissed signatures", () => {
    expect(
      detectRoutineSuggestion({
        sessions: three,
        existingRoutines: [],
        now,
        dismissedSignatures: new Set([
          routineExerciseSetSignature(["squat", "bench"]),
        ]),
      }),
    ).toBeNull();
  });

  it("honours a dismissal predicate", () => {
    expect(
      detectRoutineSuggestion({
        sessions: three,
        existingRoutines: [],
        now,
        isDismissed: (signature) => signature === "bench|squat",
      }),
    ).toBeNull();
  });

  it("is deterministic regardless of input order and picks the most repeated set", () => {
    const extra = [
      session("d", "2026-10-02", ["row", "curl"]),
      session("e", "2026-10-05", ["curl", "row"]),
      session("f", "2026-10-09", ["row", "curl"]),
      session("g", "2026-10-14", ["row", "curl"]),
    ];
    const forward = detectRoutineSuggestion({
      sessions: [...three, ...extra],
      existingRoutines: [],
      now,
    });
    const reversed = detectRoutineSuggestion({
      sessions: [...three, ...extra].reverse(),
      existingRoutines: [],
      now,
    });
    expect(forward).toEqual(reversed);
    expect(forward?.signature).toBe("curl|row");
  });
});
