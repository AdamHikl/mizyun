import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
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
      if (saved) {
        setFeedback(
          nextVal
            ? "Saved: Live workout notification enabled"
            : "Saved: Live workout notification disabled",
        );
        onSaved?.(prefs);
      }
    },
    [autoAdvanceTargetWeights, onSaved, restSeconds, userId],
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

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.header}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          WORKOUT & REST TIMER
        </ThemedText>
        <ThemedText type="subtitle">Default rest duration</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          The rest timer automatically starts after logging a set. It continues
          tracking in the background and sends an alert when your phone is
          locked.
        </ThemedText>
      </View>

      {/* Prominent display of current setting */}
      <View style={styles.displayRow}>
        <View style={styles.timerDisplayBadge}>
          <ThemedText style={styles.timerClockIcon}>⏱</ThemedText>
          <ThemedText type="title" style={styles.timerDisplayTime}>
            {loading ? "…" : formatRestDuration(restSeconds)}
          </ThemedText>
          <View style={styles.labelTag}>
            <ThemedText type="smallBold" style={styles.labelTagText}>
              {formatRestDurationLabel(restSeconds)}
            </ThemedText>
          </View>
        </View>

        {/* Stepper controls (-15s / +15s) */}
        <View style={styles.stepperContainer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Subtract 15 seconds"
            disabled={restSeconds <= MIN_REST_SECONDS}
            onPress={() => void updateDuration(restSeconds - 15)}
            style={({ pressed }) => [
              styles.stepperBtn,
              pressed && styles.stepperBtnPressed,
              restSeconds <= MIN_REST_SECONDS && styles.btnDisabled,
            ]}
          >
            <ThemedText type="smallBold" style={styles.stepperBtnText}>
              −15s
            </ThemedText>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add 15 seconds"
            disabled={restSeconds >= MAX_REST_SECONDS}
            onPress={() => void updateDuration(restSeconds + 15)}
            style={({ pressed }) => [
              styles.stepperBtn,
              pressed && styles.stepperBtnPressed,
              restSeconds >= MAX_REST_SECONDS && styles.btnDisabled,
            ]}
          >
            <ThemedText type="smallBold" style={styles.stepperBtnText}>
              +15s
            </ThemedText>
          </Pressable>
        </View>
      </View>

      {/* Presets Chips Grid */}
      <View style={styles.presetsSection}>
        <ThemedText type="small" themeColor="textSecondary">
          Quick presets:
        </ThemedText>
        <View style={styles.presetsGrid}>
          {REST_DURATION_PRESETS.map((seconds) => {
            const isSelected = restSeconds === seconds;
            return (
              <Pressable
                key={seconds}
                accessibilityRole="button"
                accessibilityLabel={`Set rest timer to ${formatRestDurationLabel(seconds)}`}
                onPress={() => void updateDuration(seconds)}
                style={({ pressed }) => [
                  styles.presetChip,
                  isSelected && styles.presetChipSelected,
                  pressed && styles.presetChipPressed,
                ]}
              >
                <ThemedText
                  type="smallBold"
                  style={[
                    styles.presetChipText,
                    isSelected && styles.presetChipTextSelected,
                  ]}
                >
                  {formatRestDurationLabel(seconds)}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Live Workout Notification Toggle */}
      <View style={styles.notificationToggleSection}>
        <View style={styles.notificationToggleInfo}>
          <ThemedText type="smallBold">Live workout notification</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Show an always-on lock screen notification with current exercise,
            target load, reps, and rest timer during active sessions.
          </ThemedText>
        </View>
        <Switch
          accessibilityLabel="Toggle live workout notification"
          value={liveNotificationEnabled}
          onValueChange={(val) => void toggleLiveNotification(val)}
          trackColor={{ false: "rgba(148, 163, 184, 0.2)", true: "#10B981" }}
          thumbColor="#FFFFFF"
        />
      </View>

      {/* Auto-advance target weights toggle */}
      <View style={styles.notificationToggleSection}>
        <View style={styles.notificationToggleInfo}>
          <ThemedText type="smallBold">Auto-advance target weights</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Automatically carry over in-workout weight progression to routine
            and exercise targets for your next session.
          </ThemedText>
        </View>
        <Switch
          accessibilityLabel="Toggle auto-advance target weights"
          value={autoAdvanceTargetWeights}
          onValueChange={(val) => void toggleAutoAdvance(val)}
          trackColor={{ false: "rgba(148, 163, 184, 0.2)", true: "#10B981" }}
          thumbColor="#FFFFFF"
        />
      </View>

      {feedback ? (
        <View style={styles.feedbackBanner}>
          <ThemedText type="small" style={styles.feedbackText}>
            ✓ {feedback}
          </ThemedText>
        </View>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.four,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
    gap: Spacing.four,
  },
  header: {
    gap: Spacing.one,
  },
  displayRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "rgba(16, 185, 129, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.2)",
    borderRadius: 14,
    padding: Spacing.three,
  },
  timerDisplayBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  timerClockIcon: {
    fontSize: 22,
  },
  timerDisplayTime: {
    fontSize: 24,
    color: "#10B981",
    fontWeight: "700",
  },
  labelTag: {
    backgroundColor: "rgba(16, 185, 129, 0.18)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  labelTagText: {
    color: "#10B981",
    fontSize: 11,
  },
  stepperContainer: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  stepperBtn: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "rgba(148, 163, 184, 0.15)",
  },
  stepperBtnPressed: {
    opacity: 0.7,
  },
  stepperBtnText: {
    fontSize: 13,
  },
  btnDisabled: {
    opacity: 0.3,
  },
  presetsSection: {
    gap: Spacing.two,
  },
  presetsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "rgba(148, 163, 184, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.18)",
  },
  presetChipSelected: {
    backgroundColor: "#10B981",
    borderColor: "#10B981",
  },
  presetChipPressed: {
    opacity: 0.8,
  },
  presetChipText: {
    fontSize: 13,
  },
  presetChipTextSelected: {
    color: "#FFFFFF",
  },
  feedbackBanner: {
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  feedbackText: {
    color: "#10B981",
    fontSize: 12,
  },
  notificationToggleSection: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(148, 163, 184, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
    borderRadius: 14,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  notificationToggleInfo: {
    flex: 1,
    gap: 2,
  },
});
