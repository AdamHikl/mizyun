import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Switch, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Button, ListGroup, ListRow, SectionHeader } from "@/components/ui";
import { formatDeviceTime } from "@/components/ui/device-clock";
import { NativeTimePicker } from "@/components/ui/native-date-time-picker";
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
import { fetchFoodDay } from "@/features/log-meal/meal-lifecycle-data";
import { ReminderTimeSuggestionRow } from "./reminder-time-suggestion-row";
import { useReminderTimeSuggestion } from "./use-reminder-time-suggestion";

/** True when a meal is already logged today at or after 6:00 PM (unknown: false). */
const hasLoggedMealAfter6Pm = async (): Promise<boolean> => {
  try {
    const day = await fetchFoodDay(getIsoLocalDate());
    if (day.message !== null) return false;
    return day.entries.some(
      (entry) => new Date(entry.consumedAt).getHours() >= 18,
    );
  } catch {
    return false;
  }
};

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
  // The last persisted schedule; suggestions compare against it, not the picker.
  const [saved, setSaved] = useState({
    enabled: false,
    hour: DEFAULT_EVENING_REMINDERS.hour,
    minute: DEFAULT_EVENING_REMINDERS.minute,
  });

  useEffect(() => {
    let active = true;
    void loadEveningReminders(userId).then((stored) => {
      if (!active) return;
      setSettings(stored);
      setSaved({
        enabled: stored.enabled,
        hour: stored.hour,
        minute: stored.minute,
      });
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const { suggestion, dismiss } = useReminderTimeSuggestion({
    userId,
    kind: "evening",
    enabled: saved.enabled,
    saved,
  });

  const save = async (next: EveningCatchUpReminderSettings = settings) => {
    setSaving(true);
    setMessage(null);
    const todayCompleted = await isFoodDayCompleted(userId, getIsoLocalDate());
    // Saving after dinner must not bring back today's already-answered prompt.
    const hasMealAfter6Pm = next.enabled
      ? await hasLoggedMealAfter6Pm()
      : false;
    const result = await applyEveningReminders(
      userId,
      {
        enabled: next.enabled,
        hour: next.hour,
        minute: next.minute,
      },
      { todayCompleted, hasMealAfter6Pm },
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
    setSaved({
      enabled: result.settings.enabled,
      hour: result.settings.hour,
      minute: result.settings.minute,
    });
    setMessage(
      result.settings.enabled
        ? `Evening catch-up reminder scheduled for ${formatDeviceTime(result.settings.hour, result.settings.minute)}.`
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
                <NativeTimePicker
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

          {suggestion !== null ? (
            <ReminderTimeSuggestionRow
              kind="evening"
              suggestion={suggestion}
              busy={saving}
              onApply={() => {
                // Same confirmed save path as a manual change.
                const next = {
                  ...settings,
                  enabled: true,
                  hour: suggestion.hour,
                  minute: suggestion.minute,
                };
                setSettings(next);
                void save(next);
              }}
              onDismiss={() => void dismiss()}
            />
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
