import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import {
  kilogramsToDisplayWeight,
  parseTargetLoadToDisplay,
  weightUnitLabel,
  type WeightUnitSystem,
} from "@/lib/weight-units";

export const ACTIVE_WORKOUT_NOTIFICATION_ID = "active-workout-session";
export const ACTIVE_WORKOUT_CHANNEL_ID = "active-workout-session";

export interface ActiveWorkoutNotificationParams {
  workoutId: string;
  workoutName: string;
  currentExerciseName: string;
  completedSetsCount: number;
  totalPlannedSetsCount?: number;
  nextSetSequence?: number;
  nextSetSummary?: string;
  restTimer?: { endsAt: number; total: number; exerciseName: string } | null;
}

export const formatRestEndTime = (endsAtMs: number): string => {
  const date = new Date(endsAtMs);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
};

export const formatNextSetSummary = (
  entry: {
    name: string;
    targetLoad?: string;
    repsMin?: number | null;
    repsMax?: number | null;
  },
  nextSequence: number,
  unitSystem: WeightUnitSystem,
  lastCompletedSet?: {
    loadKg?: number | null;
    repetitions?: number | null;
  } | null,
): string => {
  if (lastCompletedSet) {
    const hasLoad =
      lastCompletedSet.loadKg !== null &&
      lastCompletedSet.loadKg !== undefined &&
      lastCompletedSet.loadKg > 0;
    const hasReps =
      lastCompletedSet.repetitions !== null &&
      lastCompletedSet.repetitions !== undefined &&
      lastCompletedSet.repetitions > 0;

    if (hasLoad && hasReps) {
      const load = kilogramsToDisplayWeight(
        lastCompletedSet.loadKg!,
        unitSystem,
      );
      const unit = weightUnitLabel(unitSystem);
      return `${load} ${unit} × ${lastCompletedSet.repetitions} reps`;
    }
    if (hasLoad) {
      const load = kilogramsToDisplayWeight(
        lastCompletedSet.loadKg!,
        unitSystem,
      );
      const unit = weightUnitLabel(unitSystem);
      return `${load} ${unit}`;
    }
    if (hasReps) {
      return `${lastCompletedSet.repetitions} reps`;
    }
  }

  let targetLoadText: string | null = null;
  if (entry.targetLoad && entry.targetLoad.trim().length > 0) {
    const displayLoad = parseTargetLoadToDisplay(entry.targetLoad, unitSystem);
    if (displayLoad !== null) {
      const unit = weightUnitLabel(unitSystem);
      targetLoadText = `${displayLoad} ${unit}`;
    } else {
      targetLoadText = entry.targetLoad.trim();
    }
  }

  let repsText: string | null = null;
  if (entry.repsMin != null && entry.repsMax != null) {
    if (entry.repsMin === entry.repsMax) {
      repsText = `${entry.repsMin} reps`;
    } else {
      repsText = `${entry.repsMin}-${entry.repsMax} reps`;
    }
  } else if (entry.repsMin != null) {
    repsText = `${entry.repsMin} reps`;
  } else if (entry.repsMax != null) {
    repsText = `${entry.repsMax} reps`;
  }

  if (targetLoadText && repsText) {
    return `Target: ${targetLoadText} × ${repsText}`;
  }
  if (targetLoadText) {
    return `Target: ${targetLoadText}`;
  }
  if (repsText) {
    return `Target: ${repsText}`;
  }

  return `Set ${nextSequence > 0 ? nextSequence : 1}`;
};

export const updateActiveWorkoutNotification = async (
  params: ActiveWorkoutNotificationParams,
): Promise<string | null> => {
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
      await Notifications.setNotificationChannelAsync(
        ACTIVE_WORKOUT_CHANNEL_ID,
        {
          name: "Active Workout Session",
          importance: Notifications.AndroidImportance.LOW,
          sound: undefined,
          vibrationPattern: null,
          enableVibrate: false,
        },
      );
    }

    const isResting =
      params.restTimer != null && Date.now() < params.restTimer.endsAt;

    const title = isResting
      ? `⏱️ Resting · ${params.restTimer!.exerciseName}`
      : `🏋️ Workout: ${params.workoutName || "Live Workout"}`;

    const subtitle = isResting
      ? `Rest until ${formatRestEndTime(params.restTimer!.endsAt)} · ${params.completedSetsCount} completed`
      : params.totalPlannedSetsCount
        ? `Set ${params.nextSetSequence ?? 1} · ${params.completedSetsCount}/${params.totalPlannedSetsCount} completed`
        : `${params.completedSetsCount} completed`;

    const body = isResting
      ? params.nextSetSummary
        ? `Next: ${params.nextSetSummary}`
        : "Next set ready soon"
      : params.nextSetSummary
        ? `Current: ${params.currentExerciseName} (${params.nextSetSummary})`
        : `Current: ${params.currentExerciseName}`;

    const trigger: Notifications.NotificationTriggerInput =
      Platform.OS === "android"
        ? { channelId: ACTIVE_WORKOUT_CHANNEL_ID }
        : null;

    const notificationId = await Notifications.scheduleNotificationAsync({
      identifier: ACTIVE_WORKOUT_NOTIFICATION_ID,
      content: {
        title,
        subtitle,
        body,
        data: {
          url: "/log-workout",
          workoutId: params.workoutId,
        },
        sticky: true,
        autoDismiss: false,
        sound: false,
        priority: "low",
        color: "#10B981",
      },
      trigger,
    });

    return notificationId;
  } catch {
    return null;
  }
};

export const dismissActiveWorkoutNotification = async (): Promise<void> => {
  try {
    await Notifications.dismissNotificationAsync(
      ACTIVE_WORKOUT_NOTIFICATION_ID,
    );
  } catch {
    // Silently ignore dismissal errors
  }
  try {
    await Notifications.cancelScheduledNotificationAsync(
      ACTIVE_WORKOUT_NOTIFICATION_ID,
    );
  } catch {
    // Silently ignore cancellation errors
  }
};
