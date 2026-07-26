import { StyleSheet, View } from "react-native";
import SliderNative from "@react-native-community/slider";
import { ThemedText } from "@/components/themed-text";
import { Colors, Spacing } from "@/constants/theme";

interface SliderProps {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly label: string;
  readonly unit?: string;
  readonly formatValue?: (value: number) => string;
  readonly onChange: (value: number) => void;
}

export function Slider({
  value,
  min,
  max,
  step,
  label,
  unit = "",
  formatValue,
  onChange,
}: SliderProps) {
  const formatted = formatValue
    ? formatValue(value)
    : `${value}${unit ? ` ${unit}` : ""}`;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          {label}
        </ThemedText>
        <ThemedText type="smallBold" style={styles.valueText}>
          {formatted}
        </ThemedText>
      </View>

      <SliderNative
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={value}
        minimumTrackTintColor="#10B981"
        maximumTrackTintColor="rgba(148, 163, 184, 0.3)"
        thumbTintColor="#10B981"
        onValueChange={onChange}
        style={styles.nativeSlider}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.one,
    paddingVertical: Spacing.one,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  valueText: {
    color: "#10B981",
    fontSize: 15,
  },
  nativeSlider: {
    width: "100%",
    height: 40,
  },
});
