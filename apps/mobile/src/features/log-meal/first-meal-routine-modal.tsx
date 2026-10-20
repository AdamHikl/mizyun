import { useCallback, useState } from "react";
import { Modal, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import {
  Button,
  Card,
  FormStatus,
  FormTextInput,
  IconBadge,
} from "@/components/ui";
import { NativeTimePicker } from "@/components/ui/native-date-time-picker";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  applyFirstMealReminders,
  markFirstMealPromptDismissed,
} from "./first-meal-reminders";

export interface FirstMealRoutineModalProps {
  readonly visible: boolean;
  readonly userId: string;
  readonly onDismiss: () => void;
  readonly onSaved: () => void;
}

export function FirstMealRoutineModal({
  visible,
  userId,
  onDismiss,
  onSaved,
}: FirstMealRoutineModalProps) {
  const theme = useTheme();
  const [hour, setHour] = useState(8);
  const [minute, setMinute] = useState(30);
  const [routineLabel, setRoutineLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setErrorMessage(null);
    const result = await applyFirstMealReminders(
      userId,
      {
        enabled: true,
        hour,
        minute,
        routineLabel:
          routineLabel.trim().length > 0 ? routineLabel.trim() : null,
      },
      { todayLogged: true },
    ).catch(() => ({ ok: false as const, reason: "unavailable" as const }));
    setSaving(false);
    if (!result.ok) {
      if (result.reason === "permission_denied") {
        setErrorMessage(
          "Notification permission was denied. You can enable it in device settings.",
        );
      } else {
        setErrorMessage("Could not schedule reminder. Please try again.");
      }
      return;
    }
    onSaved();
  }, [hour, minute, onSaved, routineLabel, userId]);

  const handleSkip = useCallback(async () => {
    try {
      await markFirstMealPromptDismissed(userId);
    } catch {
      // Best-effort
    }
    onDismiss();
  }, [onDismiss, userId]);

  if (!visible) return null;

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={handleSkip}
    >
      <View style={[styles.overlay, { backgroundColor: theme.overlay }]}>
        <Card style={styles.card}>
          <View style={styles.titleRow}>
            <IconBadge name="sunrise" tone="warning" />
            <ThemedText type="headline" style={styles.title}>
              Build your first-meal routine
            </ThemedText>
          </View>
          <ThemedText
            type="small"
            themeColor="textSecondary"
            style={styles.description}
          >
            Logging your first meal sets a positive rhythm for the day. Choose a
            reminder time that matches your schedule — whether breakfast,
            morning coffee, or midday.
          </ThemedText>

          <View
            style={[
              styles.pickerContainer,
              { backgroundColor: theme.backgroundSelected },
            ]}
          >
            <NativeTimePicker
              label="First-meal time"
              hour={hour}
              minute={minute}
              onChange={(h, m) => {
                setHour(h);
                setMinute(m);
              }}
            />
          </View>

          <FormTextInput
            accessibilityLabel="Routine context"
            placeholder="Routine context (e.g. morning coffee, after workout)"
            value={routineLabel}
            onChangeText={setRoutineLabel}
            maxLength={60}
          />

          {errorMessage ? (
            <FormStatus tone="error">{errorMessage}</FormStatus>
          ) : null}

          <View style={styles.buttonRow}>
            <Button
              label="Not now"
              variant="plain"
              disabled={saving}
              onPress={handleSkip}
              style={styles.button}
            />
            <Button
              label="Set reminder"
              variant="primary"
              loading={saving}
              disabled={saving}
              onPress={() => void handleSave()}
              style={styles.button}
            />
          </View>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.four,
  },
  card: {
    width: "100%",
    maxWidth: 400,
    borderRadius: Radius.xl,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  title: {
    flex: 1,
  },
  description: {
    lineHeight: 20,
  },
  pickerContainer: {
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.half,
  },
  buttonRow: {
    flexDirection: "row",
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  button: {
    flex: 1,
  },
});
