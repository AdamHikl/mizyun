import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export const scheduleRestNotification = async (
  nextAction: {
    readonly exerciseName?: string;
    readonly setSummary?: string;
    readonly allPlannedSetsCompleted?: boolean;
  },
  seconds: number,
): Promise<string | null> => {
  if (seconds <= 0) {
    return null;
  }

  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }
    if (status !== "granted") {
      return null;
    }

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("workout-rest-timer", {
        name: "Rest Timer",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Rest Over!",
        body: nextAction.allPlannedSetsCompleted
          ? "All planned sets completed — finish when ready"
          : nextAction.setSummary
            ? `Next: ${nextAction.exerciseName ?? "exercise"} (${nextAction.setSummary})`
            : `Next: ${nextAction.exerciseName ?? "exercise"}`,
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.max(1, Math.round(seconds)),
        channelId: "workout-rest-timer",
      },
    });

    return notificationId;
  } catch {
    return null;
  }
};

export const cancelRestNotification = async (
  notificationId?: string | null,
): Promise<void> => {
  if (!notificationId) {
    return;
  }

  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch {
    // Silently ignore cancellation errors
  }
};
