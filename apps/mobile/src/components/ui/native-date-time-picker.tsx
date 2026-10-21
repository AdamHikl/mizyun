import DateTimePicker from "@expo/ui/community/datetime-picker";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { deviceUses24HourClock, formatDeviceTime } from "./device-clock";
import {
  formatPickerDate,
  localDateToPickerBound,
  localDateToPickerDate,
  pickerDateToLocalDate,
  pickerDateToTime,
  timeToPickerDate,
  type NativeDatePickerProps,
  type NativeTimePickerProps,
} from "./native-date-time-values";

export type { NativeDatePickerProps, NativeTimePickerProps };

/**
 * Android: a row showing the label and the current value. Tapping it
 * opens the system Material 3 dialog, which is unmounted again on
 * confirm or cancel as the Expo UI drop-in requires.
 * iOS uses `native-date-time-picker.ios.tsx`; web uses the `.web.tsx` file.
 */
function PickerRow({
  label,
  value,
  disabled,
  onPress,
}: {
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: theme.backgroundSelected },
        disabled && styles.disabled,
      ]}
    >
      <ThemedText style={styles.label}>{label}</ThemedText>
      <View
        style={[styles.value, { backgroundColor: theme.backgroundSelected }]}
      >
        <ThemedText type="smallBold" style={{ color: theme.primary }}>
          {value}
        </ThemedText>
      </View>
    </Pressable>
  );
}

export function NativeTimePicker({
  label,
  hour,
  minute,
  onChange,
  disabled = false,
}: NativeTimePickerProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View>
      <PickerRow
        label={label}
        value={formatDeviceTime(hour, minute)}
        disabled={disabled}
        onPress={() => setOpen(true)}
      />
      {open ? (
        <DateTimePicker
          mode="time"
          presentation="dialog"
          value={timeToPickerDate(hour, minute)}
          is24Hour={deviceUses24HourClock()}
          accentColor={theme.primary}
          onValueChange={(_event, date) => {
            setOpen(false);
            // The form may have locked while the dialog was open.
            if (disabled) return;
            const next = pickerDateToTime(date);
            onChange(next.hour, next.minute);
          }}
          onDismiss={() => setOpen(false)}
        />
      ) : null}
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
  const [open, setOpen] = useState(false);
  return (
    <View>
      <PickerRow
        label={label}
        value={formatPickerDate(value)}
        disabled={disabled}
        onPress={() => setOpen(true)}
      />
      {open ? (
        <DateTimePicker
          mode="date"
          presentation="dialog"
          value={localDateToPickerDate(value, "android")}
          minimumDate={
            minimumDate && localDateToPickerBound(minimumDate, "start")
          }
          maximumDate={
            maximumDate && localDateToPickerBound(maximumDate, "end")
          }
          accentColor={theme.primary}
          onValueChange={(_event, date) => {
            setOpen(false);
            // The form may have locked while the dialog was open.
            if (disabled) return;
            onChange(pickerDateToLocalDate(date, "android"));
          }}
          onDismiss={() => setOpen(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  label: { flexShrink: 1, fontSize: 16 },
  value: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.5 },
});
