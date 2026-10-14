import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Button, ListGroup, ListRow, SectionHeader } from "@/components/ui";
import { IosTimePicker, formatTime12 } from "@/components/ui/ios-time-picker";
import { MinTouchTarget, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  DEFAULT_FIRST_MEAL_REMINDERS,
  loadFirstMealReminders,
  type FirstMealReminderSettings,
} from "@/features/log-meal/first-meal-reminders";
import { saveFirstMealReminderPreferences } from "./first-meal-reminder-preferences";

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
  const owner = useRef(userId);
  owner.current = userId;
  const pending = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setSaving(false);
    setSettings(DEFAULT_FIRST_MEAL_REMINDERS);
    setMessage(null);
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
    if (pending.current) return;
    pending.current = true;
    const capturedOwner = userId;
    setSaving(true);
    setMessage(null);
    const result = await saveFirstMealReminderPreferences(userId, settings);
    pending.current = false;
    if (capturedOwner !== owner.current) return;
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
    <View style={styles.section}>
      <SectionHeader title="First-meal reminder" />
      <ThemedText type="footnote" themeColor="textSecondary">
        Optional local reminder to log your first meal or repeat a recent one.
        Automatically suppressed for the rest of the day once you log food. Open
        Mizyun at least weekly to keep the local schedule up to date.
      </ThemedText>

      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading first-meal reminder" />
      ) : (
        <>
          <ListGroup>
            <ListRow
              title="Daily first-meal reminder"
              trailing={
                <Switch
                  accessibilityLabel="Daily first-meal reminder"
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
              <View style={styles.inputRow}>
                <TextInput
                  accessibilityLabel="Routine context (e.g. morning coffee)"
                  placeholder="Routine context (e.g. morning coffee)"
                  placeholderTextColor={theme.textTertiary}
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
            </ListGroup>
          ) : null}

          <Button
            label={saving ? "Saving…" : "Save reminder"}
            variant="tinted"
            block
            loading={saving}
            accessibilityLabel="Save first-meal reminder"
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
  inputRow: {
    minHeight: MinTouchTarget + 4,
    justifyContent: "center",
    paddingHorizontal: Spacing.three,
  },
  input: {
    fontSize: 17,
    paddingVertical: Spacing.two,
  },
});
