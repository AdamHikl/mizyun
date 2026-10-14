import { SymbolView } from "expo-symbols";
import type { ComponentProps } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { Radius, type ThemeColor } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type SymbolName = ComponentProps<typeof SymbolView>["name"];

/**
 * The app's icon vocabulary: one SF Symbol on iOS and its Material Symbol
 * counterpart on Android/web. Add names here rather than using emoji or text
 * glyphs (→, ›, ＋) as icons in feature code.
 */
export const IconNames = {
  add: { ios: "plus", android: "add", web: "add" },
  addCircle: {
    ios: "plus.circle.fill",
    android: "add_circle",
    web: "add_circle",
  },
  appearance: {
    ios: "circle.lefthalf.filled",
    android: "contrast",
    web: "contrast",
  },
  arrowUp: { ios: "arrow.up", android: "arrow_upward", web: "arrow_upward" },
  back: { ios: "chevron.left", android: "arrow_back", web: "arrow_back" },
  bell: { ios: "bell", android: "notifications", web: "notifications" },
  calendar: {
    ios: "calendar",
    android: "calendar_today",
    web: "calendar_today",
  },
  camera: { ios: "camera", android: "photo_camera", web: "photo_camera" },
  chart: {
    ios: "chart.line.uptrend.xyaxis",
    android: "monitoring",
    web: "monitoring",
  },
  chat: {
    ios: "bubble.left.and.bubble.right",
    android: "forum",
    web: "forum",
  },
  check: { ios: "checkmark", android: "check", web: "check" },
  checkCircle: {
    ios: "checkmark.circle.fill",
    android: "check_circle",
    web: "check_circle",
  },
  chevronDown: {
    ios: "chevron.down",
    android: "expand_more",
    web: "expand_more",
  },
  chevronRight: {
    ios: "chevron.right",
    android: "chevron_right",
    web: "chevron_right",
  },
  chevronUp: { ios: "chevron.up", android: "expand_less", web: "expand_less" },
  close: { ios: "xmark", android: "close", web: "close" },
  cook: { ios: "frying.pan", android: "skillet", web: "skillet" },
  dumbbell: {
    ios: "dumbbell",
    android: "fitness_center",
    web: "fitness_center",
  },
  edit: { ios: "pencil", android: "edit", web: "edit" },
  energy: {
    ios: "flame",
    android: "local_fire_department",
    web: "local_fire_department",
  },
  externalLink: {
    ios: "arrow.up.right.square",
    android: "open_in_new",
    web: "open_in_new",
  },
  feedback: {
    ios: "exclamationmark.bubble",
    android: "feedback",
    web: "feedback",
  },
  fork: { ios: "fork.knife", android: "restaurant", web: "restaurant" },
  globe: { ios: "globe", android: "public", web: "public" },
  history: {
    ios: "clock.arrow.circlepath",
    android: "history",
    web: "history",
  },
  info: { ios: "info.circle", android: "info", web: "info" },
  more: { ios: "ellipsis", android: "more_horiz", web: "more_horiz" },
  person: {
    ios: "person.crop.circle",
    android: "account_circle",
    web: "account_circle",
  },
  photo: { ios: "photo", android: "image", web: "image" },
  reorder: {
    ios: "arrow.up.arrow.down",
    android: "swap_vert",
    web: "swap_vert",
  },
  privacy: { ios: "hand.raised", android: "shield", web: "shield" },
  repeat: { ios: "arrow.clockwise", android: "replay", web: "replay" },
  run: { ios: "figure.run", android: "directions_run", web: "directions_run" },
  scale: { ios: "scalemass", android: "monitor_weight", web: "monitor_weight" },
  search: { ios: "magnifyingglass", android: "search", web: "search" },
  settings: { ios: "gearshape", android: "settings", web: "settings" },
  share: { ios: "square.and.arrow.up", android: "share", web: "share" },
  sparkles: { ios: "sparkles", android: "auto_awesome", web: "auto_awesome" },
  steps: {
    ios: "figure.walk",
    android: "directions_walk",
    web: "directions_walk",
  },
  sunrise: { ios: "sunrise", android: "wb_twilight", web: "wb_twilight" },
  target: { ios: "target", android: "track_changes", web: "track_changes" },
  timer: { ios: "timer", android: "timer", web: "timer" },
  trash: { ios: "trash", android: "delete", web: "delete" },
  warning: {
    ios: "exclamationmark.triangle",
    android: "warning",
    web: "warning",
  },
} as const satisfies Record<string, SymbolName>;

export type IconName = keyof typeof IconNames;

export function Icon({
  name,
  size = 20,
  color = "text",
  tintColor,
  style,
}: {
  name: IconName;
  size?: number;
  color?: ThemeColor;
  /** Literal colour override, e.g. on a filled button. */
  tintColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <SymbolView
      accessible={false}
      name={IconNames[name] as SymbolName}
      size={size}
      tintColor={tintColor ?? theme[color]}
      style={[{ width: size, height: size }, style]}
    />
  );
}

/** A symbol on a tinted rounded square, used to lead list rows and tiles. */
export function IconBadge({
  name,
  tone = "primary",
  size = 30,
}: {
  name: IconName;
  tone?: "primary" | "warning" | "danger" | "info" | "neutral" | "fat";
  size?: number;
}) {
  const theme = useTheme();
  const palette = {
    primary: [theme.primaryLight, theme.primary],
    warning: [theme.warningLight, theme.warning],
    danger: [theme.dangerLight, theme.danger],
    info: [theme.infoLight, theme.info],
    neutral: [theme.backgroundSelected, theme.textSecondary],
    fat: [theme.backgroundSelected, theme.fat],
  }[tone];
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.badge,
        { width: size, height: size, backgroundColor: palette[0] },
      ]}
    >
      <Icon name={name} size={Math.round(size * 0.56)} tintColor={palette[1]} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
});
