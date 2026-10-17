import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { LocalDate } from "@mizyun/core";

import { ThemedText } from "@/components/themed-text";
import { IconButton } from "@/components/ui";
import { MinTouchTarget, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  calendarMonth,
  compareLocalDates,
  sameLocalDate,
} from "./log-activity-form";

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * Month calendar for a past activity date. Future days are disabled; the
 * month arrows stop at the current month.
 */
export function ActivityDatePicker({
  value,
  today,
  disabled,
  onChange,
}: {
  readonly value: LocalDate;
  readonly today: LocalDate;
  readonly disabled?: boolean;
  readonly onChange: (date: LocalDate) => void;
}) {
  const theme = useTheme();
  const [shown, setShown] = useState({ year: value.year, month: value.month });
  // Follow a date set elsewhere, such as from a description.
  useEffect(() => {
    setShown({ year: value.year, month: value.month });
  }, [value.year, value.month]);
  const month = calendarMonth(shown.year, shown.month);
  const atCurrentMonth =
    shown.year > today.year ||
    (shown.year === today.year && shown.month >= today.month);
  const step = (delta: number) => {
    const next = new Date(shown.year, shown.month - 1 + delta, 1);
    setShown({ year: next.getFullYear(), month: next.getMonth() + 1 });
  };

  return (
    <View style={styles.calendar}>
      <View style={styles.header}>
        <IconButton
          variant="plain"
          icon="back"
          accessibilityLabel="Previous month"
          disabled={disabled}
          onPress={() => step(-1)}
        />
        <ThemedText
          type="headline"
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
        >
          {month.title}
        </ThemedText>
        <IconButton
          variant="plain"
          icon="chevronRight"
          accessibilityLabel="Next month"
          disabled={disabled || atCurrentMonth}
          onPress={() => step(1)}
        />
      </View>
      {/* Each day's label already names its weekday. */}
      <View
        style={styles.week}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {WEEKDAY_LABELS.map((label, index) => (
          <ThemedText
            key={index}
            type="footnote"
            themeColor="textSecondary"
            style={styles.cellText}
          >
            {label}
          </ThemedText>
        ))}
      </View>
      {month.weeks.map((week, row) => (
        <View key={row} style={styles.week}>
          {week.map((day, column) => {
            if (!day) return <View key={column} style={styles.cell} />;
            const future = compareLocalDates(day, today) > 0;
            const selected = sameLocalDate(day, value);
            const isToday = sameLocalDate(day, today);
            return (
              <Pressable
                key={column}
                accessibilityRole="button"
                accessibilityLabel={new Date(
                  day.year,
                  day.month - 1,
                  day.day,
                ).toLocaleDateString(undefined, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
                accessibilityState={{ selected, disabled: future || disabled }}
                disabled={future || disabled}
                onPress={() => onChange(day)}
                style={[
                  styles.cell,
                  styles.day,
                  selected && { backgroundColor: theme.primary },
                  !selected &&
                    isToday && { borderColor: theme.primary, borderWidth: 1 },
                ]}
              >
                <ThemedText
                  style={[
                    styles.cellText,
                    selected && { color: theme.onPrimary },
                    future && { color: theme.textTertiary },
                  ]}
                >
                  {day.day}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  calendar: { gap: Spacing.one },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  week: { flexDirection: "row" },
  cell: {
    flex: 1,
    minHeight: MinTouchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  day: { borderRadius: Radius.md },
  cellText: { textAlign: "center", flex: 1, textAlignVertical: "center" },
});
