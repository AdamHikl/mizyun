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
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
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
  const theme = useTheme();

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
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">Evening food-log catch-up</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Optional reminder asking: “Anything else to add from today?” Review your
        day without the app guessing. Automatically suppressed once you've
        logged a meal after 6:00 PM or reached your calorie target.
      </ThemedText>
      <ThemedText type="small" style={styles.supportiveText}>
        Missed a meal or day? No stress — habit consistency is built over time,
        not perfection.
      </ThemedText>

      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading evening catch-up reminder" />
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
                Daily evening catch-up
              </ThemedText>
              <Switch
                accessibilityLabel="Daily evening catch-up"
                value={settings.enabled}
                onValueChange={(enabled) =>
                  setSettings((current) => ({ ...current, enabled }))
                }
              />
            </View>
          </View>

          {/* Schedule Section */}
          {settings.enabled ? (
            <View style={styles.scheduleSection}>
              <ThemedText type="smallBold" style={styles.sectionHeaderTitle}>
                SCHEDULE
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
              </View>
            </View>
          ) : null}

          {/* Save Button */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save evening catch-up reminder"
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
  supportiveText: {
    fontStyle: "italic",
    color: "#64748B",
    fontSize: 13,
    lineHeight: 18,
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
