import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetPermissionsAsync = vi.fn();
const mockRequestPermissionsAsync = vi.fn();
const mockSetNotificationChannelAsync = vi.fn();
const mockScheduleNotificationAsync = vi.fn();
const mockDismissNotificationAsync = vi.fn();
const mockCancelScheduledNotificationAsync = vi.fn();

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

import { Platform } from "react-native";
import {
  ACTIVE_WORKOUT_CHANNEL_ID,
  ACTIVE_WORKOUT_NOTIFICATION_ID,
  dismissActiveWorkoutNotification,
  formatNextSetSummary,
  formatRestEndTime,
  updateActiveWorkoutNotification,
} from "./workout-notification";

describe("workout-notification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Platform.OS = "ios";
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

  describe("updateActiveWorkoutNotification", () => {
    it("returns notification ID and schedules immediately with trigger: null when permission is granted", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({ status: "granted" });
      mockScheduleNotificationAsync.mockResolvedValueOnce(
        "notification-id-123",
      );

      const result = await updateActiveWorkoutNotification({
        workoutId: "w-123",
        workoutName: "Upper Body Power",
        currentExerciseName: "Barbell Bench Press",
        completedSetsCount: 2,
        totalPlannedSetsCount: 12,
        nextSetSequence: 3,
        nextSetSummary: "80 kg × 8 reps",
      });

      expect(result).toBe("notification-id-123");
      expect(mockSetNotificationChannelAsync).not.toHaveBeenCalled();
      expect(mockScheduleNotificationAsync).toHaveBeenCalledWith({
        identifier: ACTIVE_WORKOUT_NOTIFICATION_ID,
        content: {
          title: "🏋️ Workout: Upper Body Power",
          subtitle: "Set 3 · 2/12 completed",
          body: "Current: Barbell Bench Press (80 kg × 8 reps)",
          data: {
            url: "/log-workout",
            workoutId: "w-123",
          },
          sticky: true,
          autoDismiss: false,
          sound: false,
          priority: "low",
          color: "#10B981",
        },
        trigger: null,
      });
    });

    it("requests permission if undetermined and returns null if denied", async () => {
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
            body: "Next: 140 kg × 5 reps",
          }),
        }),
      );
    });

    it("formats rest body with fallback when nextSetSummary is omitted", async () => {
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
            body: "Next set ready soon",
          }),
        }),
      );
    });

    it("formats lifting state without nextSetSummary or totalPlannedSetsCount", async () => {
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
  });

  describe("dismissActiveWorkoutNotification", () => {
    it("calls dismissNotificationAsync and cancelScheduledNotificationAsync", async () => {
      await dismissActiveWorkoutNotification();

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
});
