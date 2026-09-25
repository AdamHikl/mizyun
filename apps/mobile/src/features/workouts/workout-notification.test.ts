import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetPermissionsAsync = vi.fn();
const mockRequestPermissionsAsync = vi.fn();
const mockSetNotificationChannelAsync = vi.fn();
const mockScheduleNotificationAsync = vi.fn();
const mockDismissNotificationAsync = vi.fn();
const mockCancelScheduledNotificationAsync = vi.fn();
const mockUpdateWorkoutLiveActivity = vi.fn();
const mockEndWorkoutLiveActivity = vi.fn();
const mockGetAppVariant = vi.fn();

vi.mock("@/composition/app-variant", () => ({
  getAppVariant: () => mockGetAppVariant(),
}));

vi.mock("expo-notifications", () => ({
  AndroidImportance: {
    HIGH: 4,
    DEFAULT: 3,
    LOW: 2,
  },
  SchedulableTriggerInputTypes: {
    TIME_INTERVAL: "timeInterval",
    DAILY: "daily",
    WEEKLY: "weekly",
  },
  getPermissionsAsync: () => mockGetPermissionsAsync(),
  requestPermissionsAsync: () => mockRequestPermissionsAsync(),
  setNotificationChannelAsync: (...args: unknown[]) =>
    mockSetNotificationChannelAsync(...args),
  scheduleNotificationAsync: (...args: unknown[]) =>
    mockScheduleNotificationAsync(...args),
  dismissNotificationAsync: (...args: unknown[]) =>
    mockDismissNotificationAsync(...args),
  cancelScheduledNotificationAsync: (...args: unknown[]) =>
    mockCancelScheduledNotificationAsync(...args),
}));

vi.mock("react-native", () => ({
  Platform: {
    OS: "ios",
  },
}));

vi.mock("./workout-live-activity", () => ({
  updateWorkoutLiveActivity: (...args: unknown[]) =>
    mockUpdateWorkoutLiveActivity(...args),
  endWorkoutLiveActivity: (...args: unknown[]) =>
    mockEndWorkoutLiveActivity(...args),
}));

import { Platform } from "react-native";
import {
  ACTIVE_WORKOUT_CHANNEL_ID,
  ACTIVE_WORKOUT_NOTIFICATION_ID,
  completedSetsForNotificationEntry,
  dismissActiveWorkoutNotification,
  dismissOrphanedDevWorkoutLiveActivity,
  formatNextSetSummary,
  formatRestEndTime,
  selectNextExerciseIndexForNotification,
  shouldSyncActiveWorkoutNotification,
  updateActiveWorkoutNotification,
} from "./workout-notification";

describe("workout-notification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Platform.OS = "ios";
    mockGetAppVariant.mockReturnValue("dev");
    mockUpdateWorkoutLiveActivity.mockResolvedValue("live-activity-123");
    mockEndWorkoutLiveActivity.mockResolvedValue(undefined);
  });

  describe("shouldSyncActiveWorkoutNotification", () => {
    it("waits for persisted preferences before exposing workout data", () => {
      expect(shouldSyncActiveWorkoutNotification(false, true, true)).toBe(
        false,
      );
      expect(shouldSyncActiveWorkoutNotification(true, false, true)).toBe(
        false,
      );
      expect(shouldSyncActiveWorkoutNotification(true, true, false)).toBe(
        false,
      );
      expect(shouldSyncActiveWorkoutNotification(true, true, true)).toBe(true);
    });
  });

  describe("formatRestEndTime", () => {
    it("formats local time as HH:MM with leading zero padding", () => {
      const target = new Date();
      target.setHours(14, 5, 0, 0);
      expect(formatRestEndTime(target.getTime())).toBe("14:05");

      target.setHours(9, 2, 0, 0);
      expect(formatRestEndTime(target.getTime())).toBe("09:02");

      target.setHours(0, 0, 0, 0);
      expect(formatRestEndTime(target.getTime())).toBe("00:00");
    });
  });

  describe("formatNextSetSummary", () => {
    it("formats last completed set with metric units", () => {
      const result = formatNextSetSummary(
        { name: "Bench Press", targetLoad: "80 kg", repsMin: 8, repsMax: 10 },
        2,
        "metric",
        { loadKg: 80, repetitions: 8 },
      );
      expect(result).toBe("80 kg × 8 reps");
    });

    it("formats last completed set with imperial units", () => {
      const result = formatNextSetSummary(
        { name: "Bench Press", targetLoad: "80 kg", repsMin: 8, repsMax: 10 },
        2,
        "imperial",
        { loadKg: 80, repetitions: 8 },
      );
      expect(result).toBe("176.4 lb × 8 reps");
    });

    it("formats last completed set with only load or only reps", () => {
      const loadOnly = formatNextSetSummary(
        { name: "Bench Press" },
        2,
        "metric",
        { loadKg: 80, repetitions: null },
      );
      expect(loadOnly).toBe("80 kg");

      const repsOnly = formatNextSetSummary({ name: "Pull Up" }, 2, "metric", {
        loadKg: null,
        repetitions: 10,
      });
      expect(repsOnly).toBe("10 reps");
    });

    it("formats targetLoad and rep ranges in metric when no completed set", () => {
      const result = formatNextSetSummary(
        { name: "Bench Press", targetLoad: "80 kg", repsMin: 8, repsMax: 10 },
        1,
        "metric",
        null,
      );
      expect(result).toBe("Target: 80 kg × 8-10 reps");
    });

    it("formats targetLoad and rep ranges in imperial when no completed set", () => {
      const result = formatNextSetSummary(
        { name: "Bench Press", targetLoad: "80 kg", repsMin: 8, repsMax: 10 },
        1,
        "imperial",
        null,
      );
      expect(result).toBe("Target: 176.4 lb × 8-10 reps");
    });

    it("formats targetLoad only when no reps are specified", () => {
      const result = formatNextSetSummary(
        { name: "Deadlift", targetLoad: "120 kg" },
        1,
        "metric",
        null,
      );
      expect(result).toBe("Target: 120 kg");
    });

    it("formats rep range only when no targetLoad is specified", () => {
      const result = formatNextSetSummary(
        { name: "Push Ups", repsMin: 15, repsMax: 20 },
        1,
        "metric",
        null,
      );
      expect(result).toBe("Target: 15-20 reps");
    });

    it("formats single rep count when repsMin equals repsMax", () => {
      const result = formatNextSetSummary(
        { name: "Pull Ups", repsMin: 5, repsMax: 5 },
        1,
        "metric",
        null,
      );
      expect(result).toBe("Target: 5 reps");
    });

    it("formats single rep count when only repsMin or only repsMax is provided", () => {
      const minOnly = formatNextSetSummary(
        { name: "Pull Ups", repsMin: 8, repsMax: null },
        1,
        "metric",
        null,
      );
      expect(minOnly).toBe("Target: 8 reps");

      const maxOnly = formatNextSetSummary(
        { name: "Pull Ups", repsMin: null, repsMax: 12 },
        1,
        "metric",
        null,
      );
      expect(maxOnly).toBe("Target: 12 reps");
    });

    it("formats fallback sequence number when no weight or reps known", () => {
      const result = formatNextSetSummary({ name: "Plank" }, 2, "metric", null);
      expect(result).toBe("Set 2");

      const fallbackFirst = formatNextSetSummary(
        { name: "Plank" },
        0,
        "metric",
        null,
      );
      expect(fallbackFirst).toBe("Set 1");
    });
  });

  describe("selectNextExerciseIndexForNotification", () => {
    const progress = [
      { name: "Squat", completedSetsCount: 3, targetSetsCount: 3 },
      { name: "Bench Press", completedSetsCount: 1, targetSetsCount: 3 },
      { name: "Row", completedSetsCount: 0, targetSetsCount: 3 },
    ];

    it("keeps the resting exercise selected while it has planned sets remaining", () => {
      expect(
        selectNextExerciseIndexForNotification(progress, "Bench Press"),
      ).toBe(1);
    });

    it("advances from a completed resting exercise to the next incomplete exercise", () => {
      expect(selectNextExerciseIndexForNotification(progress, "Squat")).toBe(1);
    });

    it("falls back to the first incomplete exercise when progress was logged out of order", () => {
      const outOfOrder = [
        { name: "Squat", completedSetsCount: 1, targetSetsCount: 3 },
        { name: "Bench Press", completedSetsCount: 3, targetSetsCount: 3 },
      ];

      expect(
        selectNextExerciseIndexForNotification(outOfOrder, "Bench Press"),
      ).toBe(0);
    });

    it("returns null when every planned exercise is complete", () => {
      expect(
        selectNextExerciseIndexForNotification(
          progress.map((exercise) => ({
            ...exercise,
            completedSetsCount: exercise.targetSetsCount,
          })),
          "Row",
        ),
      ).toBeNull();
    });
  });

  describe("completedSetsForNotificationEntry", () => {
    it("counts a newly created planned exercise through its resolved id override", () => {
      const completed = completedSetsForNotificationEntry(
        { id: "planned-squat", name: "Squat" },
        [],
        [{ exerciseId: "exercise-new", sequence: 1 }],
        "exercise-new",
      );

      expect(completed).toEqual([{ exerciseId: "exercise-new", sequence: 1 }]);
    });

    it("matches an existing planned exercise by normalized name", () => {
      const completed = completedSetsForNotificationEntry(
        { id: "planned-bench", name: " Bench Press " },
        [{ id: "exercise-existing", name: "bench press" }],
        [{ exerciseId: "exercise-existing", sequence: 1 }],
      );

      expect(completed).toHaveLength(1);
    });
  });

  describe("updateActiveWorkoutNotification", () => {
    it("updates one iOS Live Activity without scheduling an ordinary status notification", async () => {
      const result = await updateActiveWorkoutNotification({
        workoutId: "w-123",
        workoutName: "Upper Body Power",
        currentExerciseName: "Barbell Bench Press",
        completedSetsCount: 2,
        totalPlannedSetsCount: 12,
        nextSetSequence: 3,
        nextSetSummary: "80 kg × 8 reps",
      });

      expect(result).toBe("live-activity-123");
      expect(mockUpdateWorkoutLiveActivity).toHaveBeenCalledWith({
        workoutId: "w-123",
        workoutName: "Upper Body Power",
        currentExerciseName: "Barbell Bench Press",
        completedSetsCount: 2,
        totalPlannedSetsCount: 12,
        nextSetSummary: "80 kg × 8 reps",
        state: "active",
        restStartedAt: null,
        restEndsAt: null,
      });
      expect(mockDismissNotificationAsync).toHaveBeenCalledWith(
        ACTIVE_WORKOUT_NOTIFICATION_ID,
      );
      expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith(
        ACTIVE_WORKOUT_NOTIFICATION_ID,
      );
      expect(mockGetPermissionsAsync).not.toHaveBeenCalled();
      expect(mockSetNotificationChannelAsync).not.toHaveBeenCalled();
      expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
    });

    it("keeps Android permission handling and returns null if denied", async () => {
      Platform.OS = "android";
      mockGetPermissionsAsync.mockResolvedValueOnce({ status: "undetermined" });
      mockRequestPermissionsAsync.mockResolvedValueOnce({ status: "denied" });

      const result = await updateActiveWorkoutNotification({
        workoutId: "w-123",
        workoutName: "Push",
        currentExerciseName: "Bench Press",
        completedSetsCount: 0,
      });

      expect(result).toBeNull();
      expect(mockRequestPermissionsAsync).toHaveBeenCalledTimes(1);
      expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
      expect(mockUpdateWorkoutLiveActivity).not.toHaveBeenCalled();
    });

    it("keeps the existing ordinary notification in the Production iOS variant", async () => {
      mockGetAppVariant.mockReturnValue("production");
      mockGetPermissionsAsync.mockResolvedValueOnce({ status: "granted" });
      mockScheduleNotificationAsync.mockResolvedValueOnce(
        "production-notification-id",
      );

      const result = await updateActiveWorkoutNotification({
        workoutId: "w-prod",
        workoutName: "Production Workout",
        currentExerciseName: "Squat",
        completedSetsCount: 1,
      });

      expect(result).toBe("production-notification-id");
      expect(mockUpdateWorkoutLiveActivity).not.toHaveBeenCalled();
      expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: ACTIVE_WORKOUT_NOTIFICATION_ID,
          trigger: null,
        }),
      );
    });

    it("configures notification channel with LOW importance on Android", async () => {
      Platform.OS = "android";
      mockGetPermissionsAsync.mockResolvedValueOnce({ status: "granted" });
      mockScheduleNotificationAsync.mockResolvedValueOnce("android-notif-1");

      const result = await updateActiveWorkoutNotification({
        workoutId: "w-456",
        workoutName: "Leg Day",
        currentExerciseName: "Squat",
        completedSetsCount: 1,
      });

      expect(result).toBe("android-notif-1");
      expect(mockSetNotificationChannelAsync).toHaveBeenCalledWith(
        ACTIVE_WORKOUT_CHANNEL_ID,
        {
          name: "Active Workout Session",
          importance: 2,
          sound: undefined,
          vibrationPattern: null,
          enableVibrate: false,
        },
      );
      expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: ACTIVE_WORKOUT_NOTIFICATION_ID,
          trigger: { channelId: ACTIVE_WORKOUT_CHANNEL_ID },
        }),
      );
    });

    it("formats title, subtitle, and body with rest info when rest timer is active", async () => {
      Platform.OS = "android";
      mockGetPermissionsAsync.mockResolvedValueOnce({ status: "granted" });
      mockScheduleNotificationAsync.mockResolvedValueOnce("rest-notif-id");

      const restEndsAt = Date.now() + 90000;
      const result = await updateActiveWorkoutNotification({
        workoutId: "w-123",
        workoutName: "Full Body",
        currentExerciseName: "Deadlift",
        completedSetsCount: 3,
        totalPlannedSetsCount: 15,
        nextSetSequence: 4,
        nextSetSummary: "140 kg × 5 reps",
        restTimer: {
          endsAt: restEndsAt,
          total: 90,
          exerciseName: "Deadlift",
        },
      });

      expect(result).toBe("rest-notif-id");
      expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            title: "⏱️ Resting · Deadlift",
            subtitle: `Rest until ${formatRestEndTime(restEndsAt)} · 3 completed`,
            body: "Next: Deadlift (140 kg × 5 reps)",
          }),
        }),
      );
    });

    it("formats rest body with fallback when nextSetSummary is omitted", async () => {
      Platform.OS = "android";
      mockGetPermissionsAsync.mockResolvedValueOnce({ status: "granted" });
      mockScheduleNotificationAsync.mockResolvedValueOnce("rest-notif-id-2");

      const restEndsAt = Date.now() + 60000;
      const result = await updateActiveWorkoutNotification({
        workoutId: "w-123",
        workoutName: "Full Body",
        currentExerciseName: "Overhead Press",
        completedSetsCount: 1,
        restTimer: {
          endsAt: restEndsAt,
          total: 60,
          exerciseName: "Overhead Press",
        },
      });

      expect(result).toBe("rest-notif-id-2");
      expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            body: "Next: Overhead Press",
          }),
        }),
      );
    });

    it("prompts finishing instead of another set when the plan is complete", async () => {
      Platform.OS = "android";
      mockGetPermissionsAsync.mockResolvedValueOnce({ status: "granted" });
      mockScheduleNotificationAsync.mockResolvedValueOnce("complete-notif-id");

      const restEndsAt = Date.now() + 60000;
      await updateActiveWorkoutNotification({
        workoutId: "w-123",
        workoutName: "Full Body",
        currentExerciseName: "Workout",
        completedSetsCount: 9,
        totalPlannedSetsCount: 9,
        allPlannedSetsCompleted: true,
        restTimer: {
          endsAt: restEndsAt,
          total: 60,
          exerciseName: "Row",
        },
      });

      expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            body: "All planned sets completed — finish when ready",
          }),
        }),
      );
    });

    it("keeps the finish prompt after the rest timer clears", async () => {
      Platform.OS = "android";
      mockGetPermissionsAsync.mockResolvedValueOnce({ status: "granted" });
      mockScheduleNotificationAsync.mockResolvedValueOnce(
        "complete-lifting-notif-id",
      );

      await updateActiveWorkoutNotification({
        workoutId: "w-123",
        workoutName: "Full Body",
        currentExerciseName: "Workout",
        completedSetsCount: 9,
        totalPlannedSetsCount: 9,
        nextSetSequence: 10,
        allPlannedSetsCompleted: true,
        restTimer: null,
      });

      expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            subtitle: "9/9 completed",
            body: "All planned sets completed — finish when ready",
          }),
        }),
      );
    });

    it("formats lifting state without nextSetSummary or totalPlannedSetsCount", async () => {
      Platform.OS = "android";
      mockGetPermissionsAsync.mockResolvedValueOnce({ status: "granted" });
      mockScheduleNotificationAsync.mockResolvedValueOnce("lift-notif-id");

      const result = await updateActiveWorkoutNotification({
        workoutId: "w-123",
        workoutName: "",
        currentExerciseName: "Pull Up",
        completedSetsCount: 4,
      });

      expect(result).toBe("lift-notif-id");
      expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            title: "🏋️ Workout: Live Workout",
            subtitle: "4 completed",
            body: "Current: Pull Up",
          }),
        }),
      );
    });

    it("returns null when scheduleNotificationAsync throws an error", async () => {
      Platform.OS = "android";
      mockGetPermissionsAsync.mockResolvedValueOnce({ status: "granted" });
      mockScheduleNotificationAsync.mockRejectedValueOnce(
        new Error("Scheduling failed"),
      );

      const result = await updateActiveWorkoutNotification({
        workoutId: "w-123",
        workoutName: "Push",
        currentExerciseName: "Bench Press",
        completedSetsCount: 0,
      });

      expect(result).toBeNull();
    });

    it("maps an active rest timer into the iOS Live Activity countdown state", async () => {
      const now = Date.now();
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
      const restEndsAt = now + 90000;

      await updateActiveWorkoutNotification({
        workoutId: "w-123",
        workoutName: "Full Body",
        currentExerciseName: "Deadlift",
        completedSetsCount: 3,
        totalPlannedSetsCount: 15,
        nextSetSummary: "140 kg × 5 reps",
        restTimer: {
          endsAt: restEndsAt,
          total: 90,
          exerciseName: "Deadlift",
        },
      });

      expect(mockUpdateWorkoutLiveActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          state: "resting",
          restStartedAt: now,
          restEndsAt,
        }),
      );
      nowSpy.mockRestore();
    });

    it("maps completed planned sets into the iOS completion state", async () => {
      await updateActiveWorkoutNotification({
        workoutId: "w-123",
        workoutName: "Full Body",
        currentExerciseName: "Workout",
        completedSetsCount: 9,
        totalPlannedSetsCount: 9,
        allPlannedSetsCompleted: true,
      });

      expect(mockUpdateWorkoutLiveActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          state: "complete",
          restStartedAt: null,
          restEndsAt: null,
        }),
      );
    });

    it("returns null without falling back to normal iOS notifications when Live Activities fail", async () => {
      mockUpdateWorkoutLiveActivity.mockRejectedValueOnce(
        new Error("Live Activities disabled"),
      );

      const result = await updateActiveWorkoutNotification({
        workoutId: "w-123",
        workoutName: "Push",
        currentExerciseName: "Bench Press",
        completedSetsCount: 0,
      });

      expect(result).toBeNull();
      expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
    });
  });

  describe("dismissActiveWorkoutNotification", () => {
    it("ends the iOS Live Activity and cleans up a legacy delivered notification", async () => {
      await dismissActiveWorkoutNotification();

      expect(mockEndWorkoutLiveActivity).toHaveBeenCalledTimes(1);
      expect(mockDismissNotificationAsync).toHaveBeenCalledWith(
        ACTIVE_WORKOUT_NOTIFICATION_ID,
      );
      expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith(
        ACTIVE_WORKOUT_NOTIFICATION_ID,
      );
    });

    it("keeps Android notification dismissal unchanged", async () => {
      Platform.OS = "android";

      await dismissActiveWorkoutNotification();

      expect(mockEndWorkoutLiveActivity).not.toHaveBeenCalled();
      expect(mockDismissNotificationAsync).toHaveBeenCalledWith(
        ACTIVE_WORKOUT_NOTIFICATION_ID,
      );
      expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith(
        ACTIVE_WORKOUT_NOTIFICATION_ID,
      );
    });

    it("keeps Production iOS dismissal on the existing notification path", async () => {
      mockGetAppVariant.mockReturnValue("production");

      await dismissActiveWorkoutNotification();

      expect(mockEndWorkoutLiveActivity).not.toHaveBeenCalled();
      expect(mockDismissNotificationAsync).toHaveBeenCalledWith(
        ACTIVE_WORKOUT_NOTIFICATION_ID,
      );
      expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith(
        ACTIVE_WORKOUT_NOTIFICATION_ID,
      );
    });

    it("handles rejections gracefully without throwing", async () => {
      mockDismissNotificationAsync.mockRejectedValueOnce(
        new Error("Dismiss failed"),
      );
      mockCancelScheduledNotificationAsync.mockRejectedValueOnce(
        new Error("Cancel failed"),
      );

      await expect(dismissActiveWorkoutNotification()).resolves.not.toThrow();
    });
  });

  describe("dismissOrphanedDevWorkoutLiveActivity", () => {
    it("ends a recovered Dev iOS activity after authoritative no-workout recovery", async () => {
      await dismissOrphanedDevWorkoutLiveActivity();

      expect(mockEndWorkoutLiveActivity).toHaveBeenCalledTimes(1);
      expect(mockDismissNotificationAsync).toHaveBeenCalledWith(
        ACTIVE_WORKOUT_NOTIFICATION_ID,
      );
    });

    it("does not alter Production iOS notification state", async () => {
      mockGetAppVariant.mockReturnValue("production");

      await dismissOrphanedDevWorkoutLiveActivity();

      expect(mockEndWorkoutLiveActivity).not.toHaveBeenCalled();
      expect(mockDismissNotificationAsync).not.toHaveBeenCalled();
      expect(mockCancelScheduledNotificationAsync).not.toHaveBeenCalled();
    });
  });
});
