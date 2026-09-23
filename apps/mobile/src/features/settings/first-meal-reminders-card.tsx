import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { IosTimePicker, formatTime12 } from "@/components/ui/ios-time-picker";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  applyFirstMealReminders,
  DEFAULT_FIRST_MEAL_REMINDERS,
  loadFirstMealReminders,
  type FirstMealReminderSettings,
} from "@/features/log-meal/first-meal-reminders";

export function FirstMealRemindersCard({
  userId,
}: {
  readonly userId: string;
}) {
  const [settings, setSettings] = useState<FirstMealReminderSettings>(
    DEFAULT_FIRST_MEAL_REMINDERS,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const theme = useTheme();

  useEffect(() => {
    let active = true;
    void loadFirstMealReminders(userId).then((stored) => {
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
    const result = await applyFirstMealReminders(userId, {
      enabled: settings.enabled,
      hour: settings.hour,
      minute: settings.minute,
      routineLabel: settings.routineLabel,
    });
    setSaving(false);
    if (!result.ok) {
      setMessage(
        result.reason === "permission_denied"
          ? "Notifications were not allowed. You can enable them in system settings."
          : "First-meal reminder could not be scheduled. Try again.",
      );
      return;
    }
    setSettings(result.settings);
    setMessage(
      result.settings.enabled
        ? `First-meal reminder scheduled for ${formatTime12(result.settings.hour, result.settings.minute)}.`
        : "First-meal reminder turned off.",
    );
  };

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">First-meal reminder</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Optional local reminder to log your first meal or repeat a recent one.
        Automatically suppressed for the rest of the day once you log food.
      </ThemedText>

      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading first-meal reminder" />
      ) : (
        <>
          {/* Daily Reminder Toggle */}
          <View
            style={[
              styles.insetGroup,
              {
                backgroundColor:
                  theme.background === "#F8FAF9"
                    ? "#FFFFFF"
                    : "rgba(255, 255, 255, 0.04)",
                borderColor: theme.border,
              },
            ]}
          >
            <View style={styles.row}>
              <ThemedText style={styles.rowLabel}>
                Daily first-meal reminder
              </ThemedText>
              <Switch
                accessibilityLabel="Daily first-meal reminder"
                value={settings.enabled}
                onValueChange={(enabled) =>
                  setSettings((current) => ({ ...current, enabled }))
                }
              />
            </View>
          </View>

          {/* Schedule & Routine Section */}
          {settings.enabled ? (
            <View style={styles.scheduleSection}>
              <ThemedText type="smallBold" style={styles.sectionHeaderTitle}>
                SCHEDULE & ROUTINE
              </ThemedText>

              <View
                style={[
                  styles.insetGroup,
                  {
                    backgroundColor:
                      theme.background === "#F8FAF9"
                        ? "#FFFFFF"
                        : "rgba(255, 255, 255, 0.04)",
                    borderColor: theme.border,
                  },
                ]}
              >
                {/* Time Picker */}
                <View style={styles.pickerRowContainer}>
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

                <View
                  style={[
                    styles.separator,
                    {
                      backgroundColor:
                        theme.background === "#F8FAF9"
                          ? "rgba(0, 0, 0, 0.06)"
                          : "rgba(255, 255, 255, 0.08)",
                    },
                  ]}
                />

                {/* Routine Context Input */}
                <View style={styles.inputRow}>
                  <TextInput
                    accessibilityLabel="Routine context (e.g. morning coffee)"
                    placeholder="Routine context (e.g. morning coffee)"
                    placeholderTextColor={
                      theme.background === "#F8FAF9" ? "#94A3B8" : "#64748B"
                    }
                    value={settings.routineLabel ?? ""}
                    onChangeText={(routineLabel) =>
                      setSettings((current) => ({
                        ...current,
                        routineLabel:
                          routineLabel.length > 0 ? routineLabel : null,
                      }))
                    }
                    style={[styles.input, { color: theme.text }]}
                    autoCapitalize="sentences"
                    autoCorrect
                    maxLength={60}
                  />
                </View>
              </View>
            </View>
          ) : null}

          {/* Save Button */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save first-meal reminder"
            accessibilityState={{ disabled: saving, busy: saving }}
            disabled={saving}
            onPress={() => void save()}
            style={styles.save}
          >
            <ThemedText type="smallBold" style={styles.saveText}>
              {saving ? "Saving…" : "Save reminder"}
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
  inputRow: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: Spacing.three,
  },
  input: {
    fontSize: 16,
    paddingVertical: Spacing.two,
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
