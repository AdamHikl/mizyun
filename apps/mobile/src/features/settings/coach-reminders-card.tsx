import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { IosTimePicker, formatTime12 } from "@/components/ui/ios-time-picker";
import { IosWeekdayPicker } from "@/components/ui/ios-weekday-picker";
import { Colors, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
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
  const theme = useTheme();

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
        ? `Coach reminders scheduled for ${formatTime12(result.settings.hour, result.settings.minute ?? 0)}.`
        : "Coach reminders are off and prior schedules were removed.",
    );
  };

  const isScheduleVisible = settings.dailyEnabled || settings.weeklyEnabled;

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">Proactive Coach reminders</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Optional local reminders open an auto-submitted daily plan or weekly
        review at your selected time. Nothing is analyzed, logged, or changed in
        the background.
      </ThemedText>

      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading Coach reminders" />
      ) : (
        <>
          {/* Toggles Group */}
          <View
            style={[
              styles.insetGroup,
              {
                backgroundColor:
                  theme.background === Colors.light.background
                    ? "#FFFFFF"
                    : "rgba(255, 255, 255, 0.04)",
                borderColor: theme.border,
              },
            ]}
          >
            <View style={styles.row}>
              <ThemedText style={styles.rowLabel}>Daily plan</ThemedText>
              <Switch
                accessibilityLabel="Daily Coach plan reminder"
                value={settings.dailyEnabled}
                onValueChange={(dailyEnabled) =>
                  setSettings((current) => ({ ...current, dailyEnabled }))
                }
              />
            </View>

            <View
              style={[
                styles.separator,
                {
                  backgroundColor:
                    theme.background === Colors.light.background
                      ? "rgba(0, 0, 0, 0.06)"
                      : "rgba(255, 255, 255, 0.08)",
                },
              ]}
            />

            <View style={styles.row}>
              <ThemedText style={styles.rowLabel}>Weekly adaptation</ThemedText>
              <Switch
                accessibilityLabel="Weekly Coach adaptation reminder"
                value={settings.weeklyEnabled}
                onValueChange={(weeklyEnabled) =>
                  setSettings((current) => ({ ...current, weeklyEnabled }))
                }
              />
            </View>
          </View>

          {/* Schedule Section */}
          {isScheduleVisible ? (
            <View style={styles.scheduleSection}>
              <ThemedText type="smallBold" style={styles.sectionHeaderTitle}>
                SCHEDULE
              </ThemedText>

              <View
                style={[
                  styles.insetGroup,
                  {
                    backgroundColor:
                      theme.background === Colors.light.background
                        ? "#FFFFFF"
                        : "rgba(255, 255, 255, 0.04)",
                    borderColor: theme.border,
                  },
                ]}
              >
                {/* Time Picker Row & Popover */}
                <View style={styles.pickerRowContainer}>
                  <IosTimePicker
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

                {/* Weekday Picker Row & Popover (when weekly is enabled) */}
                {settings.weeklyEnabled ? (
                  <>
                    <View
                      style={[
                        styles.separator,
                        {
                          backgroundColor:
                            theme.background === Colors.light.background
                              ? "rgba(0, 0, 0, 0.06)"
                              : "rgba(255, 255, 255, 0.08)",
                        },
                      ]}
                    />
                    <View style={styles.pickerRowContainer}>
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
                  </>
                ) : null}
              </View>
            </View>
          ) : null}

          {/* Save Button */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save proactive Coach reminders"
            accessibilityState={{ disabled: saving, busy: saving }}
            disabled={saving}
            onPress={() => void save()}
            style={styles.save}
          >
            <ThemedText type="smallBold" style={styles.saveText}>
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

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  insetGroup: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 4,
      },
      android: {
        elevation: 1,
      },
      default: {},
    }),
  },
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.three,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: "500",
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.three,
  },
  scheduleSection: {
    gap: Spacing.one,
  },
  sectionHeaderTitle: {
    fontSize: 12,
    letterSpacing: 0.5,
    color: "#64748B",
    marginLeft: Spacing.one,
    marginBottom: Spacing.half,
  },
  pickerRowContainer: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.half,
  },
  save: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "#10B981",
    paddingHorizontal: Spacing.four,
    marginTop: Spacing.one,
  },
  saveText: {
    color: "#FFFFFF",
  },
});
