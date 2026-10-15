import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Switch, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Button, ListGroup, ListRow, SectionHeader } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { apiClient } from "@/composition/api-client";
import {
  applyWeeklyReviewReminder,
  DEFAULT_WEEKLY_REVIEW_REMINDER,
  loadWeeklyReviewReminder,
  type WeeklyReviewReminderSettings,
} from "@/features/weekly-review/weekly-review-notification";
import { loadActiveGoal } from "./goal-settings-data";

export function WeeklyReviewReminderCard({
  userId,
}: {
  readonly userId: string;
}) {
  const [settings, setSettings] = useState<WeeklyReviewReminderSettings>(
    DEFAULT_WEEKLY_REVIEW_REMINDER,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pending = useRef(false);
  const owner = useRef(userId);
  owner.current = userId;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setSettings(DEFAULT_WEEKLY_REVIEW_REMINDER);
    setMessage(null);
    void loadWeeklyReviewReminder(userId).then((stored) => {
      if (!active) return;
      setSettings(stored);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const save = async () => {
    if (pending.current) return;
    pending.current = true;
    const captured = userId;
    setSaving(true);
    setMessage(null);
    try {
      const goal = await loadActiveGoal(apiClient);
      const result = await applyWeeklyReviewReminder(
        userId,
        { enabled: settings.enabled },
        { hasActiveGoal: goal !== null },
      );
      if (owner.current !== captured) return;
      if (!result.ok) {
        setMessage(
          result.reason === "permission_denied"
            ? "Notifications were not allowed. You can enable them in system settings."
            : "The weekly check-in reminder could not be scheduled. Try again.",
        );
        return;
      }
      setSettings(result.settings);
      setMessage(
        !result.settings.enabled
          ? "Weekly calorie check-in reminder turned off."
          : result.settings.notificationId === null
            ? "Saved. Set a goal and the reminder will start on Mondays at 9:00 AM."
            : "Weekly calorie check-in reminder scheduled for Mondays at 9:00 AM.",
      );
    } finally {
      pending.current = false;
      if (owner.current === captured) setSaving(false);
    }
  };

  return (
    <View style={styles.section}>
      <SectionHeader title="Weekly calorie check-in" />
      <ThemedText type="footnote" themeColor="textSecondary">
        An optional Monday 9:00 AM reminder to review whether your calorie
        target still fits your progress. You choose whether to accept any
        change.
      </ThemedText>

      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading weekly check-in reminder" />
      ) : (
        <>
          <ListGroup>
            <ListRow
              title="Weekly calorie check-in"
              trailing={
                <Switch
                  accessibilityLabel="Weekly calorie check-in"
                  value={settings.enabled}
                  onValueChange={(enabled) =>
                    setSettings((current) => ({ ...current, enabled }))
                  }
                />
              }
            />
          </ListGroup>
          <Button
            label={saving ? "Saving…" : "Save reminder"}
            variant="tinted"
            block
            loading={saving}
            accessibilityLabel="Save weekly calorie check-in reminder"
            onPress={() => void save()}
          />
          {message ? (
            <ThemedText type="footnote" themeColor="textSecondary">
              {message}
            </ThemedText>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
});
