import { useEffect, useRef, useState } from "react";
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Colors, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  formatTime12,
  to12Hour,
  to24Hour,
  type Time12,
} from "./ios-time-picker-utils";

export { formatTime12, to12Hour, to24Hour, type Time12 };

const HOURS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MINUTES: readonly number[] = Array.from({ length: 60 }, (_, i) => i);
const PERIODS: readonly ("AM" | "PM")[] = ["AM", "PM"];

const ITEM_HEIGHT = 36;
const VISIBLE_ITEMS = 5;
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;
const PADDING_VERTICAL = ITEM_HEIGHT * Math.floor(VISIBLE_ITEMS / 2);

interface WheelColumnProps<T> {
  readonly items: readonly T[];
  readonly selectedValue: T;
  readonly onSelect: (value: T) => void;
  readonly formatLabel?: (item: T) => string;
  readonly width?: number;
  readonly accessibilityLabel: string;
}

function WheelColumn<T extends string | number>({
  items,
  selectedValue,
  onSelect,
  formatLabel,
  width = 54,
  accessibilityLabel,
}: WheelColumnProps<T>) {
  const scrollRef = useRef<ScrollView>(null);
  const theme = useTheme();
  const selectedIndex = Math.max(0, items.indexOf(selectedValue));

  useEffect(() => {
    scrollRef.current?.scrollTo({
      y: selectedIndex * ITEM_HEIGHT,
      animated: false,
    });
  }, [selectedIndex]);

  const handleScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetY = e.nativeEvent.contentOffset.y;
    const index = Math.round(offsetY / ITEM_HEIGHT);
    const clampedIndex = Math.max(0, Math.min(items.length - 1, index));
    const nextItem = items[clampedIndex];
    if (nextItem !== undefined && nextItem !== selectedValue) {
      onSelect(nextItem);
    }
  };

  return (
    <View style={[styles.wheelColumn, { width }]}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        nestedScrollEnabled
        contentContainerStyle={{
          paddingVertical: PADDING_VERTICAL,
        }}
        onMomentumScrollEnd={handleScrollEnd}
        onScrollEndDrag={handleScrollEnd}
        accessibilityLabel={accessibilityLabel}
      >
        {items.map((item, index) => {
          const isSelected = item === selectedValue;
          const label = formatLabel ? formatLabel(item) : String(item);
          return (
            <Pressable
              key={String(item)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${label} ${accessibilityLabel}`}
              onPress={() => {
                scrollRef.current?.scrollTo({
                  y: index * ITEM_HEIGHT,
                  animated: true,
                });
                onSelect(item);
              }}
              style={styles.wheelItem}
            >
              <ThemedText
                style={[
                  styles.wheelItemText,
                  isSelected
                    ? [styles.wheelItemTextSelected, { color: theme.text }]
                    : [styles.wheelItemTextDim, { color: theme.textSecondary }],
                ]}
              >
                {label}
              </ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export interface IosTimePickerProps {
  readonly hour: number;
  readonly minute: number;
  readonly onChange: (hour: number, minute: number) => void;
  readonly label?: string;
  readonly disabled?: boolean;
}

export function IosTimePicker({
  hour,
  minute,
  onChange,
  label = "Reminder time",
  disabled = false,
}: IosTimePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const theme = useTheme();
  const { hour12, period } = to12Hour(hour);
  const formatted = formatTime12(hour, minute);

  const setHour12 = (nextHour12: number) => {
    const nextHour24 = to24Hour(nextHour12, period);
    onChange(nextHour24, minute);
  };

  const setMinute = (nextMinute: number) => {
    onChange(hour, nextMinute);
  };

  const setPeriod = (nextPeriod: "AM" | "PM") => {
    const nextHour24 = to24Hour(hour12, nextPeriod);
    onChange(nextHour24, minute);
  };

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <ThemedText style={styles.label}>{label}</ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${formatted}`}
          accessibilityHint="Toggles time picker"
          accessibilityState={{ expanded: isOpen, disabled }}
          disabled={disabled}
          onPress={() => setIsOpen((prev) => !prev)}
          style={({ pressed }) => [
            styles.timePill,
            isOpen && styles.timePillActive,
            pressed && styles.pressed,
          ]}
        >
          <ThemedText
            type="smallBold"
            style={[styles.timePillText, isOpen && styles.timePillTextActive]}
          >
            {formatted}
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
            {/* Center Selection Highlight Bar */}
            <View
              pointerEvents="none"
              style={[
                styles.selectionHighlight,
                {
                  backgroundColor:
                    theme.background === Colors.light.background
                      ? "rgba(0, 0, 0, 0.05)"
                      : "rgba(255, 255, 255, 0.1)",
                },
              ]}
            />

            <View style={styles.wheelsContainer}>
              {/* Hours Column (1..12) */}
              <WheelColumn
                items={HOURS}
                selectedValue={hour12}
                onSelect={setHour12}
                width={56}
                accessibilityLabel="Hour"
              />

              <ThemedText
                type="smallBold"
                style={[styles.colonSeparator, { color: theme.textSecondary }]}
              >
                :
              </ThemedText>

              {/* Minutes Column (00..59) */}
              <WheelColumn
                items={MINUTES}
                selectedValue={minute}
                onSelect={setMinute}
                formatLabel={(m) => String(m).padStart(2, "0")}
                width={56}
                accessibilityLabel="Minute"
              />

              {/* AM / PM Column */}
              <WheelColumn
                items={PERIODS}
                selectedValue={period}
                onSelect={setPeriod}
                width={62}
                accessibilityLabel="Period"
              />
            </View>
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
  timePill: {
    minHeight: 34,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "rgba(148, 163, 184, 0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  timePillActive: {
    backgroundColor: "rgba(0, 122, 255, 0.15)",
  },
  timePillText: {
    fontSize: 15,
    fontVariant: ["tabular-nums"],
  },
  timePillTextActive: {
    color: "#007AFF",
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.75,
  },
  popoverWrapper: {
    alignItems: "flex-end",
    marginTop: Spacing.two,
    marginBottom: Spacing.one,
  },
  popoverCard: {
    width: 230,
    height: WHEEL_HEIGHT,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
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
  selectionHighlight: {
    position: "absolute",
    left: 8,
    right: 8,
    top: PADDING_VERTICAL,
    height: ITEM_HEIGHT,
    borderRadius: 8,
  },
  wheelsContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: WHEEL_HEIGHT,
  },
  wheelColumn: {
    height: WHEEL_HEIGHT,
    alignItems: "center",
  },
  wheelItem: {
    height: ITEM_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  wheelItemText: {
    fontSize: 19,
    fontVariant: ["tabular-nums"],
  },
  wheelItemTextSelected: {
    fontWeight: "700",
    fontSize: 20,
  },
  wheelItemTextDim: {
    opacity: 0.4,
    fontWeight: "400",
  },
  colonSeparator: {
    fontSize: 18,
    lineHeight: 20,
    marginHorizontal: 1,
    opacity: 0.6,
  },
});
