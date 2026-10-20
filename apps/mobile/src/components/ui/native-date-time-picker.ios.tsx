import { DatePicker, Host } from "@expo/ui/swift-ui";
import {
  datePickerStyle,
  disabled as disabledModifier,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { StyleSheet } from "react-native";

import { useTheme } from "@/hooks/use-theme";
import {
  localDateToPickerDate,
  pickerDateRange,
  pickerDateToLocalDate,
  pickerDateToTime,
  timeToPickerDate,
  type NativeDatePickerProps,
  type NativeTimePickerProps,
} from "./native-date-time-values";

export type { NativeDatePickerProps, NativeTimePickerProps };

/**
 * The system SwiftUI compact time picker: the label on the left and the
 * time on the right, which opens the iOS wheel popover when tapped.
 */
export function NativeTimePicker({
  label,
  hour,
  minute,
  onChange,
  disabled = false,
}: NativeTimePickerProps) {
  const theme = useTheme();
  return (
    <Host
      matchContents={{ vertical: true }}
      ignoreSafeArea="all"
      style={styles.host}
    >
      <DatePicker
        title={label}
        selection={timeToPickerDate(hour, minute)}
        displayedComponents={["hourAndMinute"]}
        onDateChange={(date) => {
          const next = pickerDateToTime(date);
          onChange(next.hour, next.minute);
        }}
        modifiers={[
          datePickerStyle("compact"),
          tint(theme.primary),
          disabledModifier(disabled),
        ]}
      />
    </Host>
  );
}

/**
 * The system SwiftUI compact date picker: the label on the left and the
 * date on the right, which opens the iOS calendar popover when tapped.
 */
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
    <Host
      matchContents={{ vertical: true }}
      ignoreSafeArea="all"
      style={styles.host}
    >
      <DatePicker
        title={label}
        selection={localDateToPickerDate(value, "ios")}
        displayedComponents={["date"]}
        range={pickerDateRange(minimumDate, maximumDate)}
        onDateChange={(date) => onChange(pickerDateToLocalDate(date, "ios"))}
        modifiers={[
          datePickerStyle("compact"),
          tint(theme.primary),
          disabledModifier(disabled),
        ]}
      />
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { width: "100%" },
});
