import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Switch, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Button, ListGroup, ListRow, SectionHeader } from "@/components/ui";
import { formatDeviceTime } from "@/components/ui/device-clock";
import { NativeTimePicker } from "@/components/ui/native-date-time-picker";
import { IosWeekdayPicker } from "@/components/ui/ios-weekday-picker";
import { Spacing } from "@/constants/theme";
import {
  applyCoachReminders,
  DEFAULT_COACH_REMINDERS,
  loadCoachReminders,
  type CoachReminderSettings,
} from "@/features/coach/coach-reminders";

export function CoachRemindersCard({ userId }: { readonly userId: string }) {
  const [settings, setSettings] = useState<CoachReminderSettings>(
    DEFAULT_COACH_REMINDERS,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadCoachReminders(userId).then((stored) => {
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
    const result = await applyCoachReminders(userId, {
      dailyEnabled: settings.dailyEnabled,
      weeklyEnabled: settings.weeklyEnabled,
      hour: settings.hour,
      minute: settings.minute ?? 0,
      weeklyWeekday: settings.weeklyWeekday,
    });
    setSaving(false);
    if (!result.ok) {
      setMessage(
        result.reason === "permission_denied"
          ? "Notifications were not allowed. You can enable them later in system settings."
          : "Coach reminders could not be scheduled. Try again.",
      );
      return;
    }
    setSettings(result.settings);
    setMessage(
      result.settings.dailyEnabled || result.settings.weeklyEnabled
        ? `Coach reminders scheduled for ${formatDeviceTime(result.settings.hour, result.settings.minute ?? 0)}.`
        : "Coach reminders are off and prior schedules were removed.",
    );
  };

  const isScheduleVisible = settings.dailyEnabled || settings.weeklyEnabled;

  return (
    <View style={styles.section}>
      <SectionHeader title="Coach reminders" />
      <ThemedText type="footnote" themeColor="textSecondary">
        Optional local reminders open an auto-submitted daily plan or weekly
        review at your selected time. Nothing is analyzed, logged, or changed in
        the background.
      </ThemedText>

      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading Coach reminders" />
      ) : (
        <>
          <ListGroup>
            <ListRow
              title="Daily plan"
              trailing={
                <Switch
                  accessibilityLabel="Daily Coach plan reminder"
                  value={settings.dailyEnabled}
                  onValueChange={(dailyEnabled) =>
                    setSettings((current) => ({ ...current, dailyEnabled }))
                  }
                />
              }
            />
            <ListRow
              title="Weekly adaptation"
              trailing={
                <Switch
                  accessibilityLabel="Weekly Coach adaptation reminder"
                  value={settings.weeklyEnabled}
                  onValueChange={(weeklyEnabled) =>
                    setSettings((current) => ({ ...current, weeklyEnabled }))
                  }
                />
              }
            />
          </ListGroup>

          {isScheduleVisible ? (
            <ListGroup>
              <View style={styles.pickerRow}>
                <NativeTimePicker
                  label="Reminder time"
                  hour={settings.hour}
                  minute={settings.minute ?? 0}
                  onChange={(hour, minute) =>
                    setSettings((current) => ({
                      ...current,
                      hour,
                      minute,
                    }))
                  }
                />
              </View>
              {settings.weeklyEnabled ? (
                <View style={styles.pickerRow}>
                  <IosWeekdayPicker
                    label="Weekly review day"
                    weekday={settings.weeklyWeekday}
                    onChange={(weeklyWeekday) =>
                      setSettings((current) => ({
                        ...current,
                        weeklyWeekday,
                      }))
                    }
                  />
                </View>
              ) : null}
            </ListGroup>
          ) : null}

          <Button
            label={saving ? "Saving…" : "Save reminders"}
            variant="tinted"
            block
            loading={saving}
            accessibilityLabel="Save proactive Coach reminders"
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
