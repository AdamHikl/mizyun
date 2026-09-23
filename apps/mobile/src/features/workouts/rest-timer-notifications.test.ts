import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetPermissionsAsync = vi.fn();
const mockRequestPermissionsAsync = vi.fn();
const mockSetNotificationChannelAsync = vi.fn();
const mockScheduleNotificationAsync = vi.fn();
const mockCancelScheduledNotificationAsync = vi.fn();

vi.mock("expo-notifications", () => ({
  AndroidImportance: {
    HIGH: 4,
    DEFAULT: 3,
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
  scheduleRestNotification,
  cancelRestNotification,
} from "./rest-timer-notifications";

describe("rest-timer-notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Platform.OS = "ios";
  });

  describe("scheduleRestNotification", () => {
    it("returns null when seconds <= 0", async () => {
      const result = await scheduleRestNotification(
        { exerciseName: "Bench Press" },
        0,
      );
      expect(result).toBeNull();
      expect(mockGetPermissionsAsync).not.toHaveBeenCalled();

      const negativeResult = await scheduleRestNotification(
        { exerciseName: "Bench Press" },
        -10,
      );
      expect(negativeResult).toBeNull();
    });

    it("requests permission if not already granted, and returns null if denied", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({ status: "undetermined" });
      mockRequestPermissionsAsync.mockResolvedValueOnce({ status: "denied" });

      const result = await scheduleRestNotification(
        { exerciseName: "Bench Press" },
        90,
      );
      expect(result).toBeNull();
      expect(mockRequestPermissionsAsync).toHaveBeenCalledTimes(1);
      expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
    });

    it("schedules notification on iOS when permission is granted", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({ status: "granted" });
      mockScheduleNotificationAsync.mockResolvedValueOnce("notif-123");

      const result = await scheduleRestNotification(
        { exerciseName: "Bench Press", setSummary: "80 kg × 8 reps" },
        120,
      );
      expect(result).toBe("notif-123");
      expect(mockSetNotificationChannelAsync).not.toHaveBeenCalled();
      expect(mockScheduleNotificationAsync).toHaveBeenCalledWith({
        content: {
          title: "Rest Over!",
          body: "Next: Bench Press (80 kg × 8 reps)",
          sound: true,
        },
        trigger: {
          type: "timeInterval",
          seconds: 120,
          channelId: "workout-rest-timer",
        },
      });
    });

    it("configures notification channel on Android before scheduling", async () => {
      Platform.OS = "android";
      mockGetPermissionsAsync.mockResolvedValueOnce({ status: "granted" });
      mockScheduleNotificationAsync.mockResolvedValueOnce("android-notif-456");

      const result = await scheduleRestNotification(
        { exerciseName: "Deadlift" },
        180,
      );
      expect(result).toBe("android-notif-456");
      expect(mockSetNotificationChannelAsync).toHaveBeenCalledWith(
        "workout-rest-timer",
        {
          name: "Rest Timer",
          importance: 4,
          sound: "default",
          vibrationPattern: [0, 250, 250, 250],
        },
      );
      expect(mockScheduleNotificationAsync).toHaveBeenCalledWith({
        content: {
          title: "Rest Over!",
          body: "Next: Deadlift",
          sound: true,
        },
        trigger: {
          type: "timeInterval",
          seconds: 180,
          channelId: "workout-rest-timer",
        },
      });
    });

    it("returns null if scheduling throws an error", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({ status: "granted" });
      mockScheduleNotificationAsync.mockRejectedValueOnce(
        new Error("Scheduling failed"),
      );

      const result = await scheduleRestNotification(
        { exerciseName: "Pull Up" },
        60,
      );
      expect(result).toBeNull();
    });

    it("prompts finishing when all planned sets are complete", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({ status: "granted" });
      mockScheduleNotificationAsync.mockResolvedValueOnce("complete-notif");

      await scheduleRestNotification({ allPlannedSetsCompleted: true }, 60);

      expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            body: "All planned sets completed — finish when ready",
          }),
        }),
      );
    });
  });

  describe("cancelRestNotification", () => {
    it("cancels the notification when notificationId is provided", async () => {
      await cancelRestNotification("notif-123");
      expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith(
        "notif-123",
      );
    });

    it("does nothing when notificationId is null or undefined", async () => {
      await cancelRestNotification(null);
      await cancelRestNotification(undefined);
      expect(mockCancelScheduledNotificationAsync).not.toHaveBeenCalled();
    });

    it("swallows errors silently if cancel throws", async () => {
      mockCancelScheduledNotificationAsync.mockRejectedValueOnce(
        new Error("Failed to cancel"),
      );
      await expect(
        cancelRestNotification("notif-error"),
      ).resolves.not.toThrow();
    });
  });
});
