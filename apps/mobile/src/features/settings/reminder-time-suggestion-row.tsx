import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import {
  suggestionMessage,
  type ReminderSuggestionKind,
  type ReminderTimeSuggestion,
} from "./reminder-time-suggestion";

/** One-line learned-time suggestion with explicit Apply / Dismiss actions. */
export function ReminderTimeSuggestionRow({
  kind,
  suggestion,
  busy,
  onApply,
  onDismiss,
}: {
  readonly kind: ReminderSuggestionKind;
  readonly suggestion: ReminderTimeSuggestion;
  readonly busy: boolean;
  readonly onApply: () => void;
  readonly onDismiss: () => void;
}) {
  return (
    <View style={styles.row} accessibilityRole="summary">
      <ThemedText type="footnote" themeColor="textSecondary">
        {suggestionMessage(kind, suggestion)}
      </ThemedText>
      <View style={styles.actions}>
        <Button
          label="Apply"
          variant="tinted"
          size="small"
          disabled={busy}
          accessibilityLabel={`Apply suggested ${kind === "first-meal" ? "first-meal" : "evening"} reminder time`}
          onPress={onApply}
        />
        <Button
          label="Dismiss"
          variant="plain"
          size="small"
          disabled={busy}
          accessibilityLabel="Dismiss suggested reminder time"
          onPress={onDismiss}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.two },
  actions: { flexDirection: "row", gap: Spacing.two },
});
