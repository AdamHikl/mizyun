import { useCallback, useEffect, useState } from "react";
import { Platform, StyleSheet, Switch, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import {
  Button,
  Card,
  Chip,
  ListGroup,
  ListRow,
  SectionHeader,
} from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { dismissActiveWorkoutNotification } from "@/features/workouts/workout-notification";
import {
  DEFAULT_REST_SECONDS,
  formatRestDuration,
  formatRestDurationLabel,
  loadWorkoutPreferences,
  MAX_REST_SECONDS,
  MIN_REST_SECONDS,
  REST_DURATION_PRESETS,
  saveWorkoutPreferences,
  type WorkoutPreferences,
} from "@/features/workouts/workout-preferences";

interface WorkoutSettingsCardProps {
  readonly userId?: string;
  readonly onSaved?: (preferences: WorkoutPreferences) => void;
}

export function WorkoutSettingsCard({
  userId,
  onSaved,
}: WorkoutSettingsCardProps) {
  const usesWorkoutLiveActivity = Platform.OS === "ios";
  const theme = useTheme();
  const [restSeconds, setRestSeconds] = useState<number>(DEFAULT_REST_SECONDS);
  const [liveNotificationEnabled, setLiveNotificationEnabled] =
    useState<boolean>(true);
  const [autoAdvanceTargetWeights, setAutoAdvanceTargetWeights] =
    useState<boolean>(true);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadWorkoutPreferences(userId).then((prefs) => {
      if (active) {
        setRestSeconds(prefs.defaultRestSeconds);
        setLiveNotificationEnabled(prefs.liveNotificationEnabled);
        setAutoAdvanceTargetWeights(prefs.autoAdvanceTargetWeights);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const updateDuration = useCallback(
    async (nextSeconds: number) => {
      const clamped = Math.min(
        MAX_REST_SECONDS,
        Math.max(MIN_REST_SECONDS, nextSeconds),
      );
      setRestSeconds(clamped);
      setFeedback(null);

      const prefs: WorkoutPreferences = {
        defaultRestSeconds: clamped,
        liveNotificationEnabled,
        autoAdvanceTargetWeights,
      };
      const saved = await saveWorkoutPreferences(prefs, userId);
      if (saved) {
        setFeedback(`Saved: ${formatRestDurationLabel(clamped)} default rest`);
        onSaved?.(prefs);
      }
    },
    [autoAdvanceTargetWeights, liveNotificationEnabled, onSaved, userId],
  );

  const toggleLiveNotification = useCallback(
    async (nextVal: boolean) => {
      setLiveNotificationEnabled(nextVal);
      setFeedback(null);

      const prefs: WorkoutPreferences = {
        defaultRestSeconds: restSeconds,
        liveNotificationEnabled: nextVal,
        autoAdvanceTargetWeights,
      };
      const saved = await saveWorkoutPreferences(prefs, userId);
      if (!saved) {
        setLiveNotificationEnabled(!nextVal);
        setFeedback(
          "Couldn't save workout notification preference. Try again.",
        );
        return;
      }
      if (saved) {
        if (!nextVal) await dismissActiveWorkoutNotification();
        setFeedback(
          nextVal
            ? `Saved: ${usesWorkoutLiveActivity ? "Workout Live Activity" : "Live workout notification"} enabled`
            : `Saved: ${usesWorkoutLiveActivity ? "Workout Live Activity" : "Live workout notification"} disabled`,
        );
        onSaved?.(prefs);
      }
    },
    [
      autoAdvanceTargetWeights,
      onSaved,
      restSeconds,
      userId,
      usesWorkoutLiveActivity,
    ],
  );

  const toggleAutoAdvance = useCallback(
    async (nextVal: boolean) => {
      setAutoAdvanceTargetWeights(nextVal);
      setFeedback(null);

      const prefs: WorkoutPreferences = {
        defaultRestSeconds: restSeconds,
        liveNotificationEnabled,
        autoAdvanceTargetWeights: nextVal,
      };
      const saved = await saveWorkoutPreferences(prefs, userId);
      if (saved) {
        setFeedback(
          nextVal
            ? "Saved: Auto-advance target weights enabled"
            : "Saved: Auto-advance target weights disabled",
        );
        onSaved?.(prefs);
      }
    },
    [liveNotificationEnabled, onSaved, restSeconds, userId],
  );

  const switchTrack = { true: theme.primary };

  return (
    <View style={styles.page}>
      <SectionHeader title="Rest timer" />
      <Card style={styles.timerCard}>
        <View style={styles.displayRow}>
          <View style={styles.timerValue}>
            <ThemedText
              type="title"
              themeColor="primary"
              accessibilityLabel={
                loading
                  ? "Loading rest duration"
                  : `Default rest ${formatRestDurationLabel(restSeconds)}`
              }
            >
              {loading ? "…" : formatRestDuration(restSeconds)}
            </ThemedText>
            <Chip label={formatRestDurationLabel(restSeconds)} tone="primary" />
          </View>

          <View style={styles.stepperContainer}>
            <Button
              label="−15s"
              variant="secondary"
              size="small"
              accessibilityLabel="Subtract 15 seconds"
              disabled={restSeconds <= MIN_REST_SECONDS}
              onPress={() => void updateDuration(restSeconds - 15)}
            />
            <Button
              label="+15s"
              variant="secondary"
              size="small"
              accessibilityLabel="Add 15 seconds"
              disabled={restSeconds >= MAX_REST_SECONDS}
              onPress={() => void updateDuration(restSeconds + 15)}
            />
          </View>
        </View>

        <View style={styles.presetsGrid}>
          {REST_DURATION_PRESETS.map((seconds) => (
            <Chip
              key={seconds}
              label={formatRestDurationLabel(seconds)}
              selected={restSeconds === seconds}
              accessibilityLabel={`Set rest timer to ${formatRestDurationLabel(seconds)}`}
              onPress={() => void updateDuration(seconds)}
              style={styles.presetChip}
            />
          ))}
        </View>
      </Card>
      <ThemedText type="footnote" themeColor="textSecondary">
        The rest timer automatically starts after logging a set. It continues
        tracking in the background and sends an alert when your phone is locked.
      </ThemedText>

      <SectionHeader title="During workouts" />
      <ListGroup>
        <ListRow
          title={
            usesWorkoutLiveActivity
              ? "Workout Live Activity"
              : "Live workout notification"
          }
          subtitle={
            usesWorkoutLiveActivity
              ? "Show one updating workout card on the Lock Screen and Dynamic Island with your current exercise, set progress, and rest timer."
              : "Show an always-on lock screen notification with current exercise, target load, reps, and rest timer during active sessions."
          }
          trailing={
            <Switch
              accessibilityLabel={
                usesWorkoutLiveActivity
                  ? "Toggle workout Live Activity"
                  : "Toggle live workout notification"
              }
              value={liveNotificationEnabled}
              onValueChange={(val) => void toggleLiveNotification(val)}
              trackColor={switchTrack}
            />
          }
        />
        <ListRow
          title="Auto-advance target weights"
          subtitle="Automatically carry over in-workout weight progression to routine and exercise targets for your next session."
          trailing={
            <Switch
              accessibilityLabel="Toggle auto-advance target weights"
              value={autoAdvanceTargetWeights}
              onValueChange={(val) => void toggleAutoAdvance(val)}
              trackColor={switchTrack}
            />
          }
        />
      </ListGroup>

      {feedback ? (
        <ThemedText
          type="footnote"
          themeColor="primary"
          accessibilityLiveRegion="polite"
        >
          {feedback}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    gap: Spacing.two,
  },
  timerCard: {
    gap: Spacing.three,
  },
  displayRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: Spacing.two,
  },
  timerValue: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  stepperContainer: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  presetsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  presetChip: {
    minHeight: 36,
    paddingHorizontal: 12,
  },
});
