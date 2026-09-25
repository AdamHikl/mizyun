import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateURL, mockStart, mockGetInstances, mockCreateLiveActivity } =
  vi.hoisted(() => {
    const createURL = vi.fn();
    const start = vi.fn();
    const getInstances = vi.fn();
    const createLiveActivity = vi.fn((_name: string, _layout: unknown) => ({
      start: (props: unknown, url?: string, staleDate?: Date) =>
        start(props, url, staleDate),
      getInstances: () => getInstances(),
    }));
    return {
      mockCreateURL: createURL,
      mockStart: start,
      mockGetInstances: getInstances,
      mockCreateLiveActivity: createLiveActivity,
    };
  });

vi.mock("expo-linking", () => ({
  createURL: (path: string, options?: unknown) => mockCreateURL(path, options),
}));

vi.mock("expo-widgets", () => ({
  createLiveActivity: (name: string, layout: unknown) =>
    mockCreateLiveActivity(name, layout),
}));

vi.mock("@expo/ui/swift-ui", () => ({
  HStack: "HStack",
  Image: "Image",
  Text: "Text",
  VStack: "VStack",
}));

vi.mock("@expo/ui/swift-ui/modifiers", () => ({
  font: vi.fn(),
  foregroundStyle: vi.fn(),
  frame: vi.fn(),
  lineLimit: vi.fn(),
  padding: vi.fn(),
}));

import {
  endWorkoutLiveActivity,
  updateWorkoutLiveActivity,
} from "./workout-live-activity.ios";
import type { WorkoutLiveActivityProps } from "./workout-live-activity";

const activeProps: WorkoutLiveActivityProps = {
  workoutId: "workout-1",
  workoutName: "Upper Body",
  currentExerciseName: "Bench Press",
  completedSetsCount: 2,
  totalPlannedSetsCount: 10,
  nextSetSummary: "80 kg × 8 reps",
  state: "active",
  restStartedAt: null,
  restEndsAt: null,
};

describe("workout-live-activity iOS adapter", () => {
  beforeEach(async () => {
    mockGetInstances.mockReturnValue([]);
    await endWorkoutLiveActivity();
    vi.clearAllMocks();
    mockCreateURL.mockReturnValue(
      "mizyun-dev://log-workout?workoutId=workout-1",
    );
    mockGetInstances.mockReturnValue([]);
  });

  it("starts one activity with a variant-safe workout deep link", async () => {
    const startedActivity = { getId: vi.fn(() => "activity-1") };
    mockStart.mockReturnValue(startedActivity);

    const result = await updateWorkoutLiveActivity(activeProps);

    expect(mockCreateURL).toHaveBeenCalledWith("/log-workout", {
      queryParams: { workoutId: "workout-1" },
    });
    expect(mockStart).toHaveBeenCalledWith(
      activeProps,
      "mizyun-dev://log-workout?workoutId=workout-1",
      undefined,
    );
    expect(result).toBe("activity-1");
  });

  it("recovers the primary activity, updates it, and removes duplicates", async () => {
    mockStart.mockReturnValue({ getId: vi.fn(() => "seed-activity") });
    await updateWorkoutLiveActivity(activeProps);
    mockStart.mockClear();

    const primary = {
      getId: vi.fn(() => "activity-1"),
      update: vi.fn().mockResolvedValue(undefined),
      end: vi.fn(),
    };
    const duplicate = {
      getId: vi.fn(() => "activity-2"),
      update: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    };
    mockGetInstances.mockReturnValue([primary, duplicate]);
    const restEndsAt = Date.now() + 60000;
    const restingProps: WorkoutLiveActivityProps = {
      ...activeProps,
      state: "resting",
      restStartedAt: restEndsAt - 90000,
      restEndsAt,
    };

    const result = await updateWorkoutLiveActivity(restingProps);

    expect(primary.update).toHaveBeenCalledWith(
      restingProps,
      new Date(restEndsAt),
    );
    expect(duplicate.end).toHaveBeenCalledWith("immediate");
    expect(mockStart).not.toHaveBeenCalled();
    expect(result).toBe("activity-1");
  });

  it("replaces a recovered activity when its workout identity is unknown after relaunch", async () => {
    const recovered = { end: vi.fn().mockResolvedValue(undefined) };
    const started = { getId: vi.fn(() => "replacement-activity") };
    mockGetInstances.mockReturnValue([recovered]);
    mockStart.mockReturnValue(started);

    const result = await updateWorkoutLiveActivity(activeProps);

    expect(recovered.end).toHaveBeenCalledWith("immediate");
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(result).toBe("replacement-activity");
  });

  it("ends every recovered activity immediately", async () => {
    const first = { end: vi.fn().mockResolvedValue(undefined) };
    const second = { end: vi.fn().mockResolvedValue(undefined) };
    mockGetInstances.mockReturnValue([first, second]);

    await endWorkoutLiveActivity();

    expect(first.end).toHaveBeenCalledWith("immediate");
    expect(second.end).toHaveBeenCalledWith("immediate");
  });
});
