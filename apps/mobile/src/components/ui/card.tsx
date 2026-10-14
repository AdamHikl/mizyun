import { Children, Fragment, isValidElement, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { MinTouchTarget, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { Icon, IconBadge, type IconName } from "./icon";

/** Raised content surface on the grouped page background. */
export function Card({
  style,
  padded = true,
  children,
  ...rest
}: ViewProps & { padded?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        padded && styles.padded,
        { backgroundColor: theme.backgroundElement },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

/** Inset grouped list: rows share one card, separated by hairlines. */
export function ListGroup({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <Card padded={false} style={[styles.group, style]}>
      {rows.map((row, index) => (
        <Fragment key={row.key ?? index}>
          {index > 0 ? (
            <View
              style={[styles.separator, { backgroundColor: theme.separator }]}
            />
          ) : null}
          {row}
        </Fragment>
      ))}
    </Card>
  );
}

export type ListRowProps = Omit<PressableProps, "children" | "style"> & {
  title: string;
  subtitle?: string;
  icon?: IconName;
  iconTone?: Parameters<typeof IconBadge>[0]["tone"];
  /** Trailing value text, e.g. "2 saved". */
  value?: string;
  /** Show a disclosure chevron; defaults to true when the row is pressable. */
  chevron?: boolean;
  trailing?: ReactNode;
  destructive?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** One row of an inset grouped list (navigation, setting or action). */
export function ListRow({
  title,
  subtitle,
  icon,
  iconTone,
  value,
  chevron,
  trailing,
  destructive,
  onPress,
  style,
  ...rest
}: ListRowProps) {
  const theme = useTheme();
  const showChevron = chevron ?? Boolean(onPress);
  const content = (
    <>
      {icon ? <IconBadge name={icon} tone={iconTone} /> : null}
      <View style={styles.rowText}>
        <ThemedText type="default" themeColor={destructive ? "danger" : "text"}>
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {value ? (
        <ThemedText type="small" themeColor="textSecondary">
          {value}
        </ThemedText>
      ) : null}
      {trailing}
      {showChevron ? (
        <Icon name="chevronRight" size={14} color="textTertiary" />
      ) : null}
    </>
  );
  if (!onPress) return <View style={[styles.row, style]}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: theme.backgroundSelected },
        rest.disabled && styles.disabled,
        style,
      ]}
      {...rest}
    >
      {content}
    </Pressable>
  );
}

/** Title above a group of content, with an optional trailing action. */
export function SectionHeader({
  title,
  action,
  style,
}: {
  title: string;
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.sectionHeader, style]}>
      <ThemedText type="title3" accessibilityRole="header" style={styles.flex}>
        {title}
      </ThemedText>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.5 },
  card: {
    borderRadius: Radius.lg,
    borderCurve: "continuous",
  },
  padded: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  group: {
    overflow: "hidden",
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.three,
  },
  row: {
    minHeight: MinTouchTarget + 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
  },
  rowText: {
    flex: 1,
    gap: 1,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  flex: { flexShrink: 1 },
});
