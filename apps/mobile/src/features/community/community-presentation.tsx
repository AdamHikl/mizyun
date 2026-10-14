import React from "react";
import { StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * Presentation only: these colors and illustrations never imply access or
 * status. Each tone maps onto semantic theme tokens, so light and dark
 * schemes come from the theme rather than literal colours.
 */
export function useCommunityPalette() {
  const theme = useTheme();
  return {
    mint: theme.primaryLight,
    mintText: theme.primary,
    purple: theme.backgroundSelected,
    purpleText: theme.fat,
    blue: theme.infoLight,
    blueText: theme.info,
    peach: theme.warningLight,
    peachText: theme.warning,
  };
}
export function CommunityIntro({
  icon: _icon,
  title,
  description,
  tone: _tone = "mint",
}: {
  icon?: string;
  title: string;
  description: string;
  tone?: "mint" | "purple" | "blue" | "peach";
}) {
  return (
    <View style={styles.intro}>
      <ThemedText type="title3" accessibilityRole="header">
        {title}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {description}
      </ThemedText>
    </View>
  );
}
const styles = StyleSheet.create({
  intro: { paddingVertical: Spacing.two, gap: Spacing.one },
});
