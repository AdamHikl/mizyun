import { useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Colors, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { getWeekdayLabel, WEEKDAYS } from "./ios-time-picker-utils";

export { getWeekdayLabel, WEEKDAYS };

export interface IosWeekdayPickerProps {
  readonly weekday: number;
  readonly onChange: (weekday: number) => void;
  readonly label?: string;
  readonly disabled?: boolean;
}

export function IosWeekdayPicker({
  weekday,
  onChange,
  label = "Weekly review day",
  disabled = false,
}: IosWeekdayPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const theme = useTheme();
  const currentLabel = getWeekdayLabel(weekday, "full");

  const handleSelect = (id: number) => {
    onChange(id);
    setIsOpen(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <ThemedText style={styles.label}>{label}</ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${currentLabel}`}
          accessibilityHint="Toggles weekday selector"
          accessibilityState={{ expanded: isOpen, disabled }}
          disabled={disabled}
          onPress={() => setIsOpen((prev) => !prev)}
          style={({ pressed }) => [
            styles.dayPill,
            isOpen && styles.dayPillActive,
            pressed && styles.pressed,
          ]}
        >
          <ThemedText
            type="smallBold"
            style={[styles.dayPillText, isOpen && styles.dayPillTextActive]}
          >
            {currentLabel}
          </ThemedText>
        </Pressable>
      </View>

      {isOpen ? (
        <View style={styles.popoverWrapper}>
          <View
            style={[
              styles.popoverCard,
              {
                backgroundColor:
                  theme.background === Colors.light.background
                    ? "#FFFFFF"
                    : "#1F2937",
                borderColor: theme.border,
              },
            ]}
          >
            {WEEKDAYS.map((day, index) => {
              const isSelected = day.id === weekday;
              const isLast = index === WEEKDAYS.length - 1;
              return (
                <View key={day.id}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Select ${day.fullLabel}`}
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => handleSelect(day.id)}
                    style={({ pressed }) => [
                      styles.dayRow,
                      isSelected && styles.dayRowSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <ThemedText
                      style={[
                        styles.dayRowText,
                        isSelected && [
                          styles.dayRowTextSelected,
                          { color: "#007AFF" },
                        ],
                      ]}
                    >
                      {day.fullLabel}
                    </ThemedText>
                    {isSelected ? (
                      <ThemedText
                        type="smallBold"
                        style={[styles.checkmark, { color: "#007AFF" }]}
                      >
                        ✓
                      </ThemedText>
                    ) : null}
                  </Pressable>
                  {!isLast ? (
                    <View
                      style={[
                        styles.separator,
                        {
                          backgroundColor:
                            theme.background === Colors.light.background
                              ? "rgba(0, 0, 0, 0.06)"
                              : "rgba(255, 255, 255, 0.08)",
                        },
                      ]}
                    />
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
  },
  row: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label: {
    fontSize: 16,
    fontWeight: "500",
  },
  dayPill: {
    minHeight: 34,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "rgba(148, 163, 184, 0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  dayPillActive: {
    backgroundColor: "rgba(0, 122, 255, 0.15)",
  },
  dayPillText: {
    fontSize: 15,
  },
  dayPillTextActive: {
    color: "#007AFF",
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.75,
  },
  popoverWrapper: {
    marginTop: Spacing.two,
    marginBottom: Spacing.one,
  },
  popoverCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 10,
      },
      android: {
        elevation: 4,
      },
      default: {},
    }),
  },
  dayRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.three,
  },
  dayRowSelected: {
    backgroundColor: "rgba(0, 122, 255, 0.06)",
  },
  dayRowText: {
    fontSize: 16,
  },
  dayRowTextSelected: {
    fontWeight: "600",
  },
  checkmark: {
    fontSize: 16,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.three,
  },
});
