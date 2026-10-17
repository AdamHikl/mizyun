import {
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { MinTouchTarget, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { Icon, type IconName } from "./icon";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  /** Optional count shown after the label, e.g. "Routines 3". */
  count?: number;
  accessibilityLabel?: string;
};

/**
 * iOS-style segmented control for switching views of the same content
 * (filters, sub-sections). Wraps into rows at large text sizes instead of
 * truncating. Exposed to assistive technology as a tab list.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  style,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const wrap = fontScale > 1.35;
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.track,
        wrap && styles.wrap,
        { backgroundColor: theme.backgroundSelected },
        style,
      ]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const label =
          option.count === undefined
            ? option.label
            : `${option.label} ${option.count}`;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={option.accessibilityLabel ?? label}
            accessibilityState={{ selected }}
            onPress={() => {
              if (!selected) onChange(option.value);
            }}
            style={[
              styles.segment,
              wrap && styles.segmentWrapped,
              selected && [
                styles.selected,
                { backgroundColor: theme.backgroundElement },
              ],
            ]}
          >
            <ThemedText
              type="footnote"
              themeColor={selected ? "text" : "textSecondary"}
              style={styles.label}
            >
              {label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Compact pill for filters, tags and small inline actions. */
export function Chip({
  label,
  icon,
  selected = false,
  tone = "neutral",
  style,
  onPress,
  disabled,
  ...rest
}: Omit<PressableProps, "children" | "style"> & {
  label: string;
  icon?: IconName;
  selected?: boolean;
  tone?: "neutral" | "primary" | "warning" | "danger";
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const palette = selected
    ? { bg: theme.primary, fg: theme.onPrimary }
    : {
        neutral: { bg: theme.backgroundSelected, fg: theme.text },
        primary: { bg: theme.primaryLight, fg: theme.primary },
        warning: { bg: theme.warningLight, fg: theme.warning },
        danger: { bg: theme.dangerLight, fg: theme.danger },
      }[tone];
  const content = (
    <>
      {icon ? <Icon name={icon} size={13} tintColor={palette.fg} /> : null}
      <ThemedText
        type="footnote"
        style={[styles.chipLabel, { color: palette.fg }]}
      >
        {label}
      </ThemedText>
    </>
  );
  if (!onPress)
    return (
      <View style={[styles.chip, { backgroundColor: palette.bg }, style]}>
        {content}
      </View>
    );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      // 32pt pill + 8pt slop above and below = 48pt touch target.
      hitSlop={8}
      style={({ pressed }) => [
        styles.chip,
        styles.pressableChip,
        { backgroundColor: palette.bg },
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
      {...rest}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    borderRadius: Radius.md,
    padding: 2,
    gap: 2,
  },
  wrap: { flexWrap: "wrap" },
  segment: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: Spacing.two,
    paddingVertical: 6,
    borderRadius: Radius.sm + 2,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentWrapped: { flexBasis: "45%", minHeight: MinTouchTarget },
  selected: {
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  label: { fontWeight: "600", textAlign: "center" },
  // Long labels wrap inside the pill instead of overflowing its container.
  chipLabel: { fontWeight: "600", flexShrink: 1 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    maxWidth: "100%",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  pressableChip: { minHeight: 32 },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.45 },
});
