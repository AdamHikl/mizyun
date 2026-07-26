import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import {
  applyCoachReminders,
  DEFAULT_COACH_REMINDERS,
  loadCoachReminders,
  type CoachReminderSettings,
} from "@/features/coach/coach-reminders";

const hours = [8, 12, 18, 20] as const;
const weekdays = [
  [1, "Sunday"],
  [2, "Monday"],
  [6, "Friday"],
] as const;

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
        ? "Coach reminders scheduled on this device."
        : "Coach reminders are off and prior schedules were removed.",
    );
  };

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">Proactive Coach reminders</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Optional local reminders open a prefilled daily or weekly Coach check-in
        at the selected device-local time. Nothing is analyzed, logged, or
        changed in the background.
      </ThemedText>
      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading Coach reminders" />
      ) : (
        <>
          <View style={styles.row}>
            <ThemedText>Daily plan</ThemedText>
            <Switch
              accessibilityLabel="Daily Coach plan reminder"
              value={settings.dailyEnabled}
              onValueChange={(dailyEnabled) =>
                setSettings((current) => ({ ...current, dailyEnabled }))
              }
            />
          </View>
          <View style={styles.row}>
            <ThemedText>Weekly adaptation</ThemedText>
            <Switch
              accessibilityLabel="Weekly Coach adaptation reminder"
              value={settings.weeklyEnabled}
              onValueChange={(weeklyEnabled) =>
                setSettings((current) => ({ ...current, weeklyEnabled }))
              }
            />
          </View>
          <ThemedText type="smallBold">Reminder time</ThemedText>
          <View style={styles.choices}>
            {hours.map((hour) => (
              <Choice
                key={hour}
                label={`${String(hour).padStart(2, "0")}:00`}
                selected={settings.hour === hour}
                onPress={() => setSettings((current) => ({ ...current, hour }))}
              />
            ))}
          </View>
          {settings.weeklyEnabled ? (
            <>
              <ThemedText type="smallBold">Weekly review day</ThemedText>
              <View style={styles.choices}>
                {weekdays.map(([weekday, label]) => (
                  <Choice
                    key={weekday}
                    label={label}
                    selected={settings.weeklyWeekday === weekday}
                    onPress={() =>
                      setSettings((current) => ({
                        ...current,
                        weeklyWeekday: weekday,
                      }))
                    }
                  />
                ))}
              </View>
            </>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save proactive Coach reminders"
            accessibilityState={{ disabled: saving, busy: saving }}
            disabled={saving}
            onPress={() => void save()}
            style={styles.save}
          >
            <ThemedText type="smallBold">
              {saving ? "Saving…" : "Save reminders"}
            </ThemedText>
          </Pressable>
          {message ? (
            <ThemedText type="small" themeColor="textSecondary">
              {message}
            </ThemedText>
          ) : null}
        </>
      )}
    </ThemedView>
  );
}

function Choice({
  label,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.choice, selected && styles.choiceSelected]}
    >
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  row: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  choice: {
    minHeight: 44,
    minWidth: 72,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.35)",
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
  },
  choiceSelected: {
    borderColor: "#10B981",
    backgroundColor: "rgba(16, 185, 129, 0.15)",
  },
  save: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "#10B981",
    paddingHorizontal: Spacing.four,
  },
});
