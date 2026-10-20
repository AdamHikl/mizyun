import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Switch, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import {
  Button,
  Chip,
  ListGroup,
  ListRow,
  SectionHeader,
} from "@/components/ui";
import { NativeTimePicker } from "@/components/ui/native-date-time-picker";
import {
  formatTime12,
  getWeekdayLabel,
} from "@/components/ui/ios-time-picker-utils";
import { MinTouchTarget, Spacing } from "@/constants/theme";
import {
  isWeightLoggedToday,
  readLastBodyEntry,
} from "@/features/log-weight/log-weight-data";
import {
  applyWeighInReminders,
  DEFAULT_WEIGH_IN_REMINDERS,
  loadWeighInReminders,
  type WeighInReminderSettings,
} from "@/features/log-weight/weigh-in-reminders";

/** Display order Monday first; ids follow expo weekdays (Sunday = 1). */
export const WEIGH_IN_DAY_ORDER = [2, 3, 4, 5, 6, 7, 1] as const;

export const describeWeighInDays = (weekdays: readonly number[]): string => {
  if (weekdays.length === 7) return "every day";
  return WEIGH_IN_DAY_ORDER.filter((day) => weekdays.includes(day))
    .map((day) => getWeekdayLabel(day, "short"))
    .join(", ");
};

export function WeighInReminderCard({ userId }: { readonly userId: string }) {
  const [settings, setSettings] = useState<WeighInReminderSettings>(
    DEFAULT_WEIGH_IN_REMINDERS,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const owner = useRef(userId);
  owner.current = userId;
  const pending = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setSaving(false);
    setSettings(DEFAULT_WEIGH_IN_REMINDERS);
    setMessage(null);
    void loadWeighInReminders(userId).then((stored) => {
      if (!active) return;
      setSettings(stored);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const toggleDay = (day: number) =>
    setSettings((current) => ({
      ...current,
      weekdays: current.weekdays.includes(day)
        ? current.weekdays.filter((value) => value !== day)
        : [...current.weekdays, day],
    }));

  const save = async () => {
    if (pending.current) return;
    if (settings.enabled && settings.weekdays.length === 0) {
      setMessage("Choose at least one day for the reminder.");
      return;
    }
    pending.current = true;
    const capturedOwner = userId;
    setSaving(true);
    setMessage(null);
    let todayLogged: boolean | undefined;
    if (settings.enabled) {
      // Saving after today's weigh-in must not schedule today's reminder.
      const read = await readLastBodyEntry({ expectedUserId: userId }).catch(
        () => null,
      );
      if (read?.ok) todayLogged = isWeightLoggedToday(read.entry);
    }
    const result = await applyWeighInReminders(
      userId,
      {
        enabled: settings.enabled,
        hour: settings.hour,
        minute: settings.minute,
        weekdays: settings.weekdays,
      },
      { todayLogged },
    );
    pending.current = false;
    if (capturedOwner !== owner.current) return;
    setSaving(false);
    if (!result.ok) {
      setMessage(
        result.reason === "permission_denied"
          ? "Notifications were not allowed. You can enable them in system settings."
          : result.reason === "no_days"
            ? "Choose at least one day for the reminder."
            : "Weigh-in reminder could not be scheduled. Try again.",
      );
      return;
    }
    setSettings(result.settings);
    setMessage(
      result.settings.enabled
        ? `Weigh-in reminder scheduled for ${describeWeighInDays(result.settings.weekdays)} at ${formatTime12(result.settings.hour, result.settings.minute)}.`
        : "Weigh-in reminder turned off.",
    );
  };

  return (
    <View style={styles.section}>
      <SectionHeader title="Weigh-in reminder" />
      <ThemedText type="footnote" themeColor="textSecondary">
        Optional and off until you turn it on. The notification only says “Time
        for a weigh-in”, never a weight. Skipped on a day you have already
        logged your weight. Open Mizyun at least every two weeks to keep the
        local schedule up to date.
      </ThemedText>

      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading weigh-in reminder" />
      ) : (
        <>
          <ListGroup>
            <ListRow
              title="Weigh-in reminder"
              trailing={
                <Switch
                  accessibilityLabel="Weigh-in reminder"
                  value={settings.enabled}
                  onValueChange={(enabled) =>
                    setSettings((current) => ({ ...current, enabled }))
                  }
                />
              }
            />
          </ListGroup>

          {settings.enabled ? (
            <>
              <ListGroup>
                <View style={styles.pickerRow}>
                  <NativeTimePicker
                    label="Reminder time"
                    hour={settings.hour}
                    minute={settings.minute}
                    onChange={(hour, minute) =>
                      setSettings((current) => ({ ...current, hour, minute }))
                    }
                  />
                </View>
              </ListGroup>
              <View style={styles.days} accessibilityLabel="Weigh-in days">
                {WEIGH_IN_DAY_ORDER.map((day) => {
                  const selected = settings.weekdays.includes(day);
                  return (
                    <Chip
                      key={day}
                      label={getWeekdayLabel(day, "short")}
                      selected={selected}
                      style={styles.day}
                      accessibilityRole="checkbox"
                      accessibilityLabel={getWeekdayLabel(day, "full")}
                      accessibilityState={{ checked: selected }}
                      onPress={() => toggleDay(day)}
                    />
                  );
                })}
              </View>
            </>
          ) : null}

          <Button
            label={saving ? "Saving…" : "Save reminder"}
            variant="tinted"
            block
            loading={saving}
            accessibilityLabel="Save weigh-in reminder"
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
  pickerRow: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.half,
  },
  days: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  day: { minHeight: MinTouchTarget, minWidth: MinTouchTarget },
});
