import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Switch, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Button, ListGroup, ListRow, SectionHeader } from "@/components/ui";
import { IosTimePicker, formatTime12 } from "@/components/ui/ios-time-picker";
import { Spacing } from "@/constants/theme";
import {
  applyEveningReminders,
  DEFAULT_EVENING_REMINDERS,
  loadEveningReminders,
  type EveningCatchUpReminderSettings,
} from "@/features/log-meal/evening-catch-up-reminders";
import {
  getIsoLocalDate,
  isFoodDayCompleted,
} from "@/features/log-meal/food-day-completion";

export function EveningCatchUpRemindersCard({
  userId,
}: {
  readonly userId: string;
}) {
  const [settings, setSettings] = useState<EveningCatchUpReminderSettings>(
    DEFAULT_EVENING_REMINDERS,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadEveningReminders(userId).then((stored) => {
      if (!active) return;
      setSettings(stored);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    const todayCompleted = await isFoodDayCompleted(userId, getIsoLocalDate());
    const result = await applyEveningReminders(
      userId,
      {
        enabled: settings.enabled,
        hour: settings.hour,
        minute: settings.minute,
      },
      { todayCompleted },
    );
    setSaving(false);
    if (!result.ok) {
      setMessage(
        result.reason === "permission_denied"
          ? "Notifications were not allowed. You can enable them in system settings."
          : "Evening catch-up reminder could not be scheduled. Try again.",
      );
      return;
    }
    setSettings(result.settings);
    setMessage(
      result.settings.enabled
        ? `Evening catch-up reminder scheduled for ${formatTime12(result.settings.hour, result.settings.minute)}.`
        : "Evening catch-up reminder turned off.",
    );
  };

  return (
    <View style={styles.section}>
      <SectionHeader title="Evening catch-up" />
      <ThemedText type="footnote" themeColor="textSecondary">
        Optional reminder asking: “Anything else to add from today?” Review your
        day without the app guessing. Automatically suppressed once you’ve
        logged a meal after 6:00 PM or reached your calorie target. Missed a
        meal or day? No stress — habit consistency is built over time, not
        perfection.
      </ThemedText>

      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading evening catch-up reminder" />
      ) : (
        <>
          <ListGroup>
            <ListRow
              title="Daily evening catch-up"
              trailing={
                <Switch
                  accessibilityLabel="Daily evening catch-up"
                  value={settings.enabled}
                  onValueChange={(enabled) =>
                    setSettings((current) => ({ ...current, enabled }))
                  }
                />
              }
            />
          </ListGroup>

          {settings.enabled ? (
            <ListGroup>
              <View style={styles.pickerRow}>
                <IosTimePicker
                  label="Reminder time"
                  hour={settings.hour}
                  minute={settings.minute}
                  onChange={(hour, minute) =>
                    setSettings((current) => ({
                      ...current,
                      hour,
                      minute,
                    }))
                  }
                />
              </View>
            </ListGroup>
          ) : null}

          <Button
            label={saving ? "Saving…" : "Save reminder"}
            variant="tinted"
            block
            loading={saving}
            accessibilityLabel="Save evening catch-up reminder"
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
  section: {
    gap: Spacing.two,
  },
  pickerRow: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.half,
  },
});
