import { useRef } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { FontGrade } from "@mizyun/core";

import { ThemedText } from "@/components/themed-text";
import { MinTouchTarget, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { BOULDER_GRADES, gradeSpoken } from "./presentation";

/**
 * One horizontal row of Font grade chips. Each chip is at least 44 pt, the
 * selected state is announced, and the initially selected grade is scrolled
 * into view once it has been laid out.
 */
export function GradeChips({
  value,
  onChange,
  disabled = false,
}: {
  value: FontGrade;
  onChange: (grade: FontGrade) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const scroll = useRef<ScrollView | null>(null);
  const scrolledFor = useRef<FontGrade | null>(null);
  const initial = useRef(value);

  return (
    <ScrollView
      ref={scroll}
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="radiogroup"
      accessibilityLabel="Grade"
      contentContainerStyle={styles.row}
      keyboardShouldPersistTaps="handled"
    >
      {BOULDER_GRADES.map((grade) => {
        const selected = grade === value;
        return (
          <Pressable
            key={grade}
            accessibilityRole="radio"
            accessibilityLabel={`Font ${gradeSpoken(grade)}`}
            accessibilityState={{ selected, checked: selected, disabled }}
            disabled={disabled}
            onPress={() => onChange(grade)}
            onLayout={(event) => {
              if (grade !== initial.current || scrolledFor.current === grade)
                return;
              scrolledFor.current = grade;
              const { x } = event.nativeEvent.layout;
              scroll.current?.scrollTo({
                x: Math.max(0, x - Spacing.five * 2),
                animated: false,
              });
            }}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: selected
                  ? theme.primary
                  : theme.backgroundSelected,
                borderColor: selected ? theme.primary : theme.border,
              },
              pressed && styles.pressed,
              disabled && styles.disabled,
            ]}
          >
            <View style={styles.inner}>
              <ThemedText
                type="smallBold"
                style={{ color: selected ? theme.onPrimary : theme.text }}
              >
                {grade}
              </ThemedText>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.two, paddingVertical: Spacing.one },
  chip: {
    minWidth: MinTouchTarget + Spacing.two,
    minHeight: MinTouchTarget,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: "center",
    justifyContent: "center",
  },
  inner: { alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
});
