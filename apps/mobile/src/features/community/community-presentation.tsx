import React from "react";
import { Colors } from "@/constants/theme";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";

/** Presentation only: these colors and illustrations never imply access or status. */
export function useCommunityPalette() {
  const theme = useTheme();
  return theme.background === Colors.dark.background
    ? {
        mint: "#12392F",
        mintText: "#C5F5DE",
        purple: "#2C2441",
        purpleText: "#E1D4FF",
        blue: "#17334A",
        blueText: "#C6E8FF",
        peach: "#3E2C24",
        peachText: "#FFDDC5",
      }
    : {
        mint: "#D7F5E5",
        mintText: "#14543B",
        purple: "#EEE6FF",
        purpleText: "#4C327A",
        blue: "#E0F1FF",
        blueText: "#244D72",
        peach: "#FFEBDD",
        peachText: "#74442A",
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
  const colors = useTheme();
  return (
    <View style={styles.intro}>
      <View style={styles.copy}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.text }]}
        >
          {title}
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {description}
        </Text>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  intro: {
    paddingVertical: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
  },
  copy: { flex: 1, minWidth: 160, gap: 6 },
  title: { fontSize: 22, lineHeight: 30, fontWeight: "700" },
  body: { fontSize: 15, lineHeight: 22 },
});
