import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { MinTouchTarget, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { Icon, type IconName } from "./icon";

export type ButtonVariant =
  "primary" | "secondary" | "tinted" | "plain" | "destructive";

export type ButtonProps = Omit<PressableProps, "children" | "style"> & {
  label: string;
  variant?: ButtonVariant;
  size?: "regular" | "small";
  icon?: IconName;
  loading?: boolean;
  /** Stretch to the container width. */
  block?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * The single button component. `primary` is the one main action on a screen;
 * `tinted`/`secondary` are supporting actions, `plain` is a text button and
 * `destructive` is for irreversible actions.
 */
export function Button({
  label,
  variant = "primary",
  size = "regular",
  icon,
  loading = false,
  block = false,
  disabled,
  style,
  accessibilityState,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const inactive = Boolean(disabled || loading);
  const colors = {
    primary: { bg: theme.primary, fg: theme.onPrimary, border: undefined },
    tinted: { bg: theme.primaryLight, fg: theme.primary, border: undefined },
    secondary: {
      bg: theme.backgroundElement,
      fg: theme.text,
      border: theme.border,
    },
    plain: { bg: "transparent", fg: theme.primary, border: undefined },
    destructive: { bg: theme.dangerLight, fg: theme.danger, border: undefined },
  }[variant];
  const small = size === "small";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={inactive}
      accessibilityState={{
        ...accessibilityState,
        disabled: inactive,
        busy: loading || !!accessibilityState?.busy,
      }}
      style={({ pressed }) => [
        styles.base,
        small ? styles.small : styles.regular,
        variant === "plain" && styles.plain,
        block && styles.block,
        {
          backgroundColor: colors.bg,
          borderColor: colors.border ?? "transparent",
        },
        pressed && styles.pressed,
        inactive && styles.disabled,
        style,
      ]}
      {...rest}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator size="small" color={colors.fg} />
        ) : icon ? (
          <Icon name={icon} size={small ? 15 : 17} tintColor={colors.fg} />
        ) : null}
        <ThemedText
          type={small ? "smallBold" : "headline"}
          style={[styles.label, { color: colors.fg }]}
        >
          {label}
        </ThemedText>
      </View>
    </Pressable>
  );
}

/** A circular icon-only button (header actions, close, overflow). */
export function IconButton({
  icon,
  accessibilityLabel,
  variant = "filled",
  selected = false,
  disabled,
  accessibilityState,
  style,
  ...rest
}: Omit<PressableProps, "children" | "style"> & {
  icon: IconName;
  accessibilityLabel: string;
  variant?: "filled" | "plain";
  /** Toggled-on state (e.g. an open panel): tinted with the brand colour. */
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{
        ...accessibilityState,
        disabled: !!disabled || !!accessibilityState?.disabled,
        ...(selected ? { selected: true } : null),
      }}
      disabled={disabled}
      // 36pt circle + 6pt slop on each side = 48pt touch target.
      hitSlop={6}
      style={({ pressed }) => [
        styles.iconButton,
        variant === "filled" && { backgroundColor: theme.backgroundSelected },
        selected && { backgroundColor: theme.primaryLight },
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
      {...rest}
    >
      <Icon name={icon} size={19} color={selected ? "primary" : "text"} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  regular: {
    minHeight: 50,
    paddingHorizontal: Spacing.four,
    paddingVertical: 12,
  },
  small: {
    minHeight: MinTouchTarget,
    paddingHorizontal: 14,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
  },
  plain: {
    paddingHorizontal: Spacing.two,
  },
  block: {
    alignSelf: "stretch",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    flexShrink: 1,
  },
  label: {
    textAlign: "center",
    flexShrink: 1,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    // Keeps neighbouring 48pt touch areas from overlapping.
    margin: 6,
  },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.45 },
});
