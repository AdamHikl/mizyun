import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";

/** Presentation only: these colors and illustrations never imply access or status. */
export function useCommunityPalette() {
  const theme = useTheme();
  return theme.background === "#0B0F12"
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
  icon,
  title,
  description,
  tone = "mint",
}: {
  icon: string;
  title: string;
  description: string;
  tone?: "mint" | "purple" | "blue" | "peach";
}) {
  const palette = useCommunityPalette();
  const ink = palette[`${tone}Text`];
  return (
    <View style={[styles.intro, { backgroundColor: palette[tone] }]}>
      <Text
        accessible={false}
        importantForAccessibility="no"
        style={styles.icon}
      >
        {icon}
      </Text>
      <View style={styles.copy}>
        <Text accessibilityRole="header" style={[styles.title, { color: ink }]}>
          {title}
        </Text>
        <Text style={[styles.body, { color: ink }]}>{description}</Text>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  intro: {
    padding: 18,
    borderRadius: 20,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
  },
  icon: { fontSize: 28 },
  copy: { flex: 1, minWidth: 160, gap: 6 },
  title: { fontSize: 22, lineHeight: 30, fontWeight: "700" },
  body: { fontSize: 15, lineHeight: 22 },
});
