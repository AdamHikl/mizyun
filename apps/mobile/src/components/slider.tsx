import { useCallback, useRef, useState } from "react";
import {
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  View,
} from "react-native";
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
  const [trackWidth, setTrackWidth] = useState(0);
  const trackWidthRef = useRef(0);
  trackWidthRef.current = trackWidth;

  const clampAndSnap = useCallback(
    (positionX: number) => {
      const width = trackWidthRef.current;
      if (width <= 0) return;
      const ratio = Math.max(0, Math.min(1, positionX / width));
      const rawValue = min + ratio * (max - min);
      const stepsCount = Math.round((rawValue - min) / step);
      const snapped = Math.max(min, Math.min(max, min + stepsCount * step));
      onChange(snapped);
    },
    [min, max, step, onChange],
  );

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        clampAndSnap(event.nativeEvent.locationX);
      },
      onPanResponderMove: (event, gestureState) => {
        // locationX in gestureState or event
        const touchX = event.nativeEvent.locationX;
        clampAndSnap(touchX);
      },
      onPanResponderRelease: (event) => {
        clampAndSnap(event.nativeEvent.locationX);
      },
    }),
  ).current;

  const handleLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setTrackWidth(width);
    trackWidthRef.current = width;
  };

  const percentage = Math.max(0, Math.min(1, (value - min) / (max - min)));
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

      <View
        style={styles.trackContainer}
        onLayout={handleLayout}
        {...panResponder.panHandlers}
      >
        <View style={styles.trackBackground} />
        <View style={[styles.trackFill, { width: `${percentage * 100}%` }]} />
        <View style={[styles.thumb, { left: `${percentage * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.two,
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
  trackContainer: {
    height: 44,
    justifyContent: "center",
    position: "relative",
  },
  trackBackground: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(148, 163, 184, 0.25)",
    width: "100%",
  },
  trackFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "#10B981",
    position: "absolute",
    left: 0,
  },
  thumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#10B981",
    borderWidth: 3,
    borderColor: "#000000",
    position: "absolute",
    top: 10,
    marginLeft: -12,
    elevation: 3,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
});
