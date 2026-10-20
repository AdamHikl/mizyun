import { createElement } from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import {
  fromDateInputValue,
  fromTimeInputValue,
  toDateInputValue,
  toTimeInputValue,
  withinLocalDateRange,
  type NativeDatePickerProps,
  type NativeTimePickerProps,
} from "./native-date-time-values";

export type { NativeDatePickerProps, NativeTimePickerProps };

/**
 * Web: the browser's own date and time inputs, since the Expo UI picker
 * renders nothing on web.
 */
function inputStyle(theme: ReturnType<typeof useTheme>) {
  return {
    font: "inherit",
    fontSize: 16,
    color: theme.text,
    backgroundColor: theme.backgroundSelected,
    border: "none",
    borderRadius: 8,
    padding: "6px 10px",
    colorScheme: "light dark",
  };
}

export function NativeTimePicker({
  label,
  hour,
  minute,
  onChange,
  disabled = false,
}: NativeTimePickerProps) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <ThemedText style={styles.label}>{label}</ThemedText>
      {createElement("input", {
        type: "time",
        "aria-label": label,
        value: toTimeInputValue(hour, minute),
        disabled,
        style: inputStyle(theme),
        onChange: (event: { target: { value: string } }) => {
          const next = fromTimeInputValue(event.target.value);
          if (next) onChange(next.hour, next.minute);
        },
      })}
    </View>
  );
}

export function NativeDatePicker({
  label,
  value,
  onChange,
  minimumDate,
  maximumDate,
  disabled = false,
}: NativeDatePickerProps) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <ThemedText style={styles.label}>{label}</ThemedText>
      {createElement("input", {
        type: "date",
        "aria-label": label,
        value: toDateInputValue(value),
        min: minimumDate ? toDateInputValue(minimumDate) : undefined,
        max: maximumDate ? toDateInputValue(maximumDate) : undefined,
        disabled,
        style: inputStyle(theme),
        onChange: (event: { target: { value: string } }) => {
          const next = fromDateInputValue(event.target.value);
          if (next && withinLocalDateRange(next, minimumDate, maximumDate)) {
            onChange(next);
          }
        },
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  label: { flexShrink: 1, fontSize: 16 },
});
