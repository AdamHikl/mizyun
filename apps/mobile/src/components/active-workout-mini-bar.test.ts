import { describe, expect, it, vi, beforeEach } from "vitest";

let mockActiveWorkoutContext: any = null;

vi.mock("react-native", () => ({
  Platform: {
    select: (options: Record<string, unknown>) =>
      options.ios ?? options.default,
  },
  Pressable: "Pressable",
  StyleSheet: {
    create: (styles: unknown) => styles,
    hairlineWidth: 1,
  },
  View: "View",
}));

vi.mock("expo-router", () => {
  const push = vi.fn();
  const usePathname = vi.fn();
  return {
    router: {
      push,
    },
    usePathname,
  };
});

vi.mock("@/components/themed-text", () => ({
  ThemedText: "ThemedText",
}));

vi.mock("@/components/themed-view", () => ({
  ThemedView: "ThemedView",
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({
    backgroundElement: "#EEF3F0",
    border: "#CBD5E1",
    primary: "#059669",
    text: "#0F172A",
    textSecondary: "#64748B",
  }),
}));

vi.mock("@/constants/theme", () => ({
  BottomTabInset: 90,
  MaxContentWidth: 800,
  Spacing: {
    half: 2,
    one: 4,
    two: 8,
    three: 16,
    four: 24,
    five: 32,
    six: 64,
  },
}));

vi.mock("@/features/workouts", () => ({
  formatStopwatch: (s: number) => {
    const mins = String(Math.floor(s / 60)).padStart(2, "0");
    const secs = String(s % 60).padStart(2, "0");
    return `${mins}:${secs}`;
  },
  useOptionalActiveWorkout: () => mockActiveWorkoutContext,
}));

import { router, usePathname } from "expo-router";
import { ActiveWorkoutMiniBar } from "./active-workout-mini-bar";

describe("ActiveWorkoutMiniBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(usePathname).mockReturnValue("/");
    mockActiveWorkoutContext = null;
  });

  it("renders null when there is no active workout", () => {
    mockActiveWorkoutContext = null;
    const element = ActiveWorkoutMiniBar();
    expect(element).toBeNull();
  });

  it("renders null when currently on /log-workout", () => {
    vi.mocked(usePathname).mockReturnValue("/log-workout");
    mockActiveWorkoutContext = {
      activeWorkout: {
        id: "workout-123",
        name: "Leg Day",
        startedAt: "2026-09-24T10:00:00.000Z",
      },
      elapsedSeconds: 300,
      restTimer: null,
      restRemainingSeconds: 0,
    };

    const element = ActiveWorkoutMiniBar();
    expect(element).toBeNull();
  });

  it("renders the mini-bar when active workout exists and not on /log-workout", () => {
    vi.mocked(usePathname).mockReturnValue("/");
    mockActiveWorkoutContext = {
      activeWorkout: {
        id: "workout-123",
        name: "Leg Day",
        startedAt: "2026-09-24T10:00:00.000Z",
      },
      elapsedSeconds: 300,
      restTimer: null,
      restRemainingSeconds: 0,
    };

    const element = ActiveWorkoutMiniBar();
    expect(element).not.toBeNull();
    expect(element?.type).toBe("View");
  });

  it("navigates to /log-workout when pressed", () => {
    vi.mocked(usePathname).mockReturnValue("/workouts");
    mockActiveWorkoutContext = {
      activeWorkout: {
        id: "workout-456",
        name: "Chest & Shoulders",
        startedAt: "2026-09-24T10:00:00.000Z",
      },
      elapsedSeconds: 125,
      restTimer: null,
      restRemainingSeconds: 0,
    };

    const element = ActiveWorkoutMiniBar();
    expect(element).not.toBeNull();

    // The pressable child
    const pressableChild = (element?.props as any).children;
    expect(pressableChild.type).toBe("Pressable");
    expect(pressableChild.props.accessibilityRole).toBe("button");

    pressableChild.props.onPress();
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/log-workout",
      params: { workoutId: "workout-456" },
    });
  });

  it("includes rest timer in accessibility label and render when resting", () => {
    vi.mocked(usePathname).mockReturnValue("/meals");
    mockActiveWorkoutContext = {
      activeWorkout: {
        id: "workout-789",
        name: "Full Body A",
        startedAt: "2026-09-24T10:00:00.000Z",
      },
      elapsedSeconds: 600,
      restTimer: {
        endsAt: Date.now() + 45000,
        total: 60,
        exerciseName: "Squat",
      },
      restRemainingSeconds: 45,
    };

    const element = ActiveWorkoutMiniBar();
    const pressableChild = (element?.props as any).children;
    expect(pressableChild.props.accessibilityLabel).toContain(
      "rest timer 00:45 remaining",
    );
  });

  it("allows full workout and Resume labels to grow without losing the accessible target", () => {
    mockActiveWorkoutContext = {
      activeWorkout: {
        id: "workout-long",
        name: "A long full body workout with strength and conditioning",
        startedAt: "2026-09-24T10:00:00.000Z",
      },
      elapsedSeconds: 600,
      restTimer: null,
      restRemainingSeconds: 0,
    };
    const element = ActiveWorkoutMiniBar();
    const pressable = (element?.props as any).children;
    const [, info, resume] = pressable.props.children;
    expect(info.props.children[0].props.children).toBe(
      mockActiveWorkoutContext.activeWorkout.name,
    );
    expect(info.props.children[0].props.numberOfLines).toBeUndefined();
    const cardStyle = Object.assign(
      {},
      ...pressable.props.style({ pressed: false }).filter(Boolean),
    );
    expect(cardStyle.flexWrap).toBe("wrap");
    const resumeStyle = Object.assign({}, ...resume.props.style);
    expect(resumeStyle.minHeight).toBeGreaterThanOrEqual(44);
    expect(resumeStyle.maxWidth).toBe("100%");
    expect(resume.props.children.props.children).toBe("Resume →");
    expect(resume.props.children.props.numberOfLines).toBeUndefined();
    pressable.props.onPress();
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/log-workout",
      params: { workoutId: "workout-long" },
    });
  });

  it("resumes an active bouldering session into its own screen", () => {
    vi.mocked(usePathname).mockReturnValue("/workouts");
    mockActiveWorkoutContext = {
      activeWorkout: null,
      elapsedSeconds: 0,
      restTimer: null,
      restRemainingSeconds: 0,
      activeBouldering: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Bouldering",
        startedAt: "2026-10-16T10:00:00.000Z",
      },
      boulderingElapsedSeconds: 65,
    };
    const element = ActiveWorkoutMiniBar();
    const pressable = (element?.props as any).children;
    expect(pressable.props.accessibilityLabel).toBe(
      "Resume bouldering session: Bouldering, 01:05 elapsed",
    );
    pressable.props.onPress();
    expect(router.push).toHaveBeenCalledWith("/bouldering/session");
  });

  it("hides the bouldering mini-bar on bouldering screens", () => {
    vi.mocked(usePathname).mockReturnValue("/bouldering/session");
    mockActiveWorkoutContext = {
      activeWorkout: null,
      elapsedSeconds: 0,
      restTimer: null,
      restRemainingSeconds: 0,
      activeBouldering: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Bouldering",
        startedAt: "2026-10-16T10:00:00.000Z",
      },
      boulderingElapsedSeconds: 65,
    };
    expect(ActiveWorkoutMiniBar()).toBeNull();
  });
});
