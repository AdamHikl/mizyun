import { useEffect, useRef, useState } from "react";
import { StyleSheet, Switch, View } from "react-native";
import { WEEKLY_LOG_GOAL_MAX, WEEKLY_LOG_GOAL_MIN } from "@mizyun/core";

import { ThemedText } from "@/components/themed-text";
import { Chip, ListGroup, ListRow, SectionHeader } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import {
  DEFAULT_LOGGING_CONSISTENCY_PREFERENCES,
  loadLoggingConsistencyPreferences,
  saveLoggingConsistencyPreferences,
  type LoggingConsistencyPreferences,
} from "@/features/dashboard/logging-consistency-preferences";

export const LOGGING_GOAL_OPTIONS: readonly number[] = Array.from(
  { length: WEEKLY_LOG_GOAL_MAX - WEEKLY_LOG_GOAL_MIN + 1 },
  (_, index) => WEEKLY_LOG_GOAL_MIN + index,
);

export function LoggingGoalCard({ userId }: { readonly userId: string }) {
  const [preferences, setPreferences] = useState<LoggingConsistencyPreferences>(
    DEFAULT_LOGGING_CONSISTENCY_PREFERENCES,
  );
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const owner = useRef(userId);
  owner.current = userId;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setMessage(null);
    setPreferences(DEFAULT_LOGGING_CONSISTENCY_PREFERENCES);
    void loadLoggingConsistencyPreferences(userId).then((stored) => {
      if (!active) return;
      setPreferences(stored);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const update = async (next: LoggingConsistencyPreferences) => {
    const previous = preferences;
    setPreferences(next);
    setMessage(null);
    const saved = await saveLoggingConsistencyPreferences(userId, next);
    if (owner.current !== userId) return;
    if (!saved) {
      setPreferences(previous);
      setMessage("Couldn't save this preference. Try again.");
      return;
    }
    setMessage(
      next.hidden
        ? "Saved: weekly logging card hidden"
        : `Saved: ${next.weeklyGoal} days a week`,
    );
  };

  return (
    <View style={styles.section} testID="logging-goal-card">
      <SectionHeader title="Weekly logging goal" />
      <ThemedText type="footnote" themeColor="textSecondary">
        A gentle target for how many days a week you log meals. There is no
        streak to keep: each week simply starts fresh on Monday.
      </ThemedText>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Days to log per week"
        style={styles.chips}
      >
        {LOGGING_GOAL_OPTIONS.map((days) => (
          <Chip
            key={days}
            label={`${days} days`}
            selected={preferences.weeklyGoal === days}
            disabled={loading}
            accessibilityLabel={`Log ${days} days a week`}
            accessibilityRole="radio"
            accessibilityState={{
              selected: preferences.weeklyGoal === days,
              disabled: loading,
            }}
            onPress={() => void update({ ...preferences, weeklyGoal: days })}
          />
        ))}
      </View>
      <ListGroup>
        <ListRow
          title="Show weekly logging card"
          subtitle="Shown on the dashboard once you have logged meals"
          trailing={
            <Switch
              accessibilityLabel="Show weekly logging card"
              disabled={loading}
              value={!preferences.hidden}
              onValueChange={(show) =>
                void update({ ...preferences, hidden: !show })
              }
            />
          }
        />
      </ListGroup>
      {message ? (
        <ThemedText
          type="footnote"
          themeColor="textSecondary"
          accessibilityLiveRegion="polite"
        >
          {message}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
});
