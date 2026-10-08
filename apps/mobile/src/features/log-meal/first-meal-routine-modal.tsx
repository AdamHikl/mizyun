import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { IosTimePicker } from "@/components/ui/ios-time-picker";
import { Spacing } from "@/constants/theme";
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
      <View style={styles.overlay}>
        <ThemedView
          type="backgroundElement"
          style={[
            styles.card,
            {
              backgroundColor:
                theme.background === "#F8FAF9" ? "#FFFFFF" : "#1E293B",
            },
          ]}
        >
          <ThemedText type="smallBold" style={styles.title}>
            🌅 Build your first-meal routine
          </ThemedText>
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
              {
                backgroundColor:
                  theme.background === "#F8FAF9"
                    ? "rgba(0, 0, 0, 0.03)"
                    : "rgba(255, 255, 255, 0.05)",
                borderColor: theme.border,
              },
            ]}
          >
            <IosTimePicker
              label="First-meal time"
              hour={hour}
              minute={minute}
              onChange={(h, m) => {
                setHour(h);
                setMinute(m);
              }}
            />
          </View>

          <TextInput
            accessibilityLabel="Routine context"
            placeholder="Routine context (e.g. morning coffee, after workout)"
            placeholderTextColor="#8A8D91"
            value={routineLabel}
            onChangeText={setRoutineLabel}
            maxLength={60}
            style={[
              styles.routineInput,
              {
                color: theme.text,
                borderColor: theme.border,
                backgroundColor:
                  theme.background === "#F8FAF9"
                    ? "rgba(0, 0, 0, 0.03)"
                    : "rgba(255, 255, 255, 0.05)",
              },
            ]}
          />

          {errorMessage ? (
            <ThemedText type="small" style={styles.errorText}>
              {errorMessage}
            </ThemedText>
          ) : null}

          <View style={styles.buttonRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Not now"
              disabled={saving}
              onPress={handleSkip}
              style={[styles.button, styles.skipButton]}
            >
              <ThemedText type="smallBold" themeColor="textSecondary">
                Not now
              </ThemedText>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Set reminder"
              disabled={saving}
              onPress={() => void handleSave()}
              style={[styles.button, styles.saveButton]}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <ThemedText type="smallBold" style={styles.saveButtonText}>
                  Set reminder
                </ThemedText>
              )}
            </Pressable>
          </View>
        </ThemedView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.four,
  },
  card: {
    width: "100%",
    maxWidth: 400,
    borderRadius: 20,
    padding: Spacing.four,
    gap: Spacing.three,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: {
        elevation: 6,
      },
      default: {},
    }),
  },
  title: {
    fontSize: 18,
  },
  description: {
    lineHeight: 20,
  },
  pickerContainer: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.half,
  },
  routineInput: {
    height: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    fontSize: 14,
  },
  errorText: {
    color: "#EF4444",
  },
  buttonRow: {
    flexDirection: "row",
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  button: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  skipButton: {
    backgroundColor: "transparent",
  },
  saveButton: {
    backgroundColor: "#10B981",
  },
  saveButtonText: {
    color: "#FFFFFF",
  },
});
