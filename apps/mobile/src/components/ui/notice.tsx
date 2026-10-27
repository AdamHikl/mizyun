import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useAnnouncement } from "@/lib/announce";
import { Icon, type IconName } from "./icon";

type Tone = "info" | "warning" | "danger" | "success";
const toneIcon: Record<Tone, IconName> = {
  info: "info",
  warning: "warning",
  danger: "warning",
  success: "checkCircle",
};

/** Inline status message (offline, refresh failed, saved, etc.). */
export function Notice({
  tone = "info",
  title,
  message,
  action,
}: {
  tone?: Tone;
  title?: string;
  message: string;
  action?: ReactNode;
}) {
  const theme = useTheme();
  // iOS ignores the alert role and live regions; speak new notices.
  useAnnouncement([title, message].filter(Boolean).join(". "));
  const tint = {
    info: theme.info,
    warning: theme.warning,
    danger: theme.danger,
    success: theme.success,
  }[tone];
  const fill = {
    info: theme.infoLight,
    warning: theme.warningLight,
    danger: theme.dangerLight,
    success: theme.successLight,
  }[tone];
  return (
    <View
      // Without an action, read the notice as one element so its alert role
      // is exposed; with an action, keep children separately focusable.
      accessible={!action}
      accessibilityLabel={
        !action ? [title, message].filter(Boolean).join(". ") : undefined
      }
      accessibilityRole={tone === "danger" ? "alert" : undefined}
      style={[styles.notice, { backgroundColor: fill }]}
    >
      <Icon name={toneIcon[tone]} size={18} tintColor={tint} />
      <View style={styles.text}>
        {title ? <ThemedText type="smallBold">{title}</ThemedText> : null}
        <ThemedText type="small">{message}</ThemedText>
        {action}
      </View>
    </View>
  );
}

/** Centered empty or first-use state with one optional action. */
export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: IconName;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      {icon ? <Icon name={icon} size={30} color="textTertiary" /> : null}
      <ThemedText type="headline" style={styles.center}>
        {title}
      </ThemedText>
      {message ? (
        <ThemedText
          type="small"
          themeColor="textSecondary"
          style={styles.center}
        >
          {message}
        </ThemedText>
      ) : null}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderRadius: Radius.md,
    alignItems: "flex-start",
  },
  text: { flex: 1, gap: 2 },
  empty: {
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.three,
  },
  center: { textAlign: "center" },
});
