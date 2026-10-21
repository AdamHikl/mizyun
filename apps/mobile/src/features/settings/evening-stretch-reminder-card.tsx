import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Switch, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Button, ListGroup, ListRow, SectionHeader } from "@/components/ui";
import { formatDeviceTime } from "@/components/ui/device-clock";
import { NativeTimePicker } from "@/components/ui/native-date-time-picker";
import { Spacing } from "@/constants/theme";
import {
  DEFAULT_EVENING_STRETCH,
  ensureEveningStretchPermission,
  eveningStretchRuntime,
  loadEveningStretch,
  saveEveningStretchPreference,
  type EveningStretchSyncStatus,
} from "@/features/evening-stretch";

const savedMessage = (
  enabled: boolean,
  time: string,
  status: EveningStretchSyncStatus | null,
): string => {
  if (!enabled) return "Evening stretch reminder turned off.";
  switch (status) {
    case "scheduled":
      return `Tonight's stretch reminder is set for ${time}.`;
    case "permission_denied":
      return "Notifications are off for Mizyun. Turn them on in system settings to get the reminder.";
    default:
      return `Saved. On days you train, you'll be reminded at ${time}.`;
  }
};

/** Settings → Workouts & reminders → Evening stretch (#298). */
export function EveningStretchReminderCard({
  userId,
}: {
  readonly userId: string;
}) {
  const [enabled, setEnabled] = useState(DEFAULT_EVENING_STRETCH.enabled);
  const [hour, setHour] = useState(DEFAULT_EVENING_STRETCH.hour);
  const [minute, setMinute] = useState(DEFAULT_EVENING_STRETCH.minute);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadEveningStretch(userId).then((stored) => {
      if (!active) return;
      setEnabled(stored.enabled);
      setHour(stored.hour);
      setMinute(stored.minute);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await saveEveningStretchPreference(userId, { enabled, hour, minute });
      const permission = enabled
        ? await ensureEveningStretchPermission(userId)
        : null;
      const status =
        permission === "denied"
          ? "permission_denied"
          : await eveningStretchRuntime.refresh();
      setMessage(savedMessage(enabled, formatDeviceTime(hour, minute), status));
    } catch {
      setMessage("The evening stretch reminder could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.section}>
      <SectionHeader title="Evening stretch" />
      <ThemedText type="footnote" themeColor="textSecondary">
        On days you train, a reminder opens a 5-minute stretch built from the
        muscles you worked. No reminder on rest days or once you've stretched.
      </ThemedText>

      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading evening stretch reminder" />
      ) : (
        <>
          <ListGroup>
            <ListRow
              title="Evening stretch reminder"
              trailing={
                <Switch
                  accessibilityLabel="Evening stretch reminder"
                  value={enabled}
                  onValueChange={setEnabled}
                />
              }
            />
          </ListGroup>

          {enabled ? (
            <ListGroup>
              <View style={styles.pickerRow}>
                <NativeTimePicker
                  label="Reminder time"
                  hour={hour}
                  minute={minute}
                  onChange={(nextHour, nextMinute) => {
                    setHour(nextHour);
                    setMinute(nextMinute);
                  }}
                />
              </View>
            </ListGroup>
          ) : null}

          <Button
            label={saving ? "Saving…" : "Save reminder"}
            variant="tinted"
            block
            loading={saving}
            accessibilityLabel="Save evening stretch reminder"
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
