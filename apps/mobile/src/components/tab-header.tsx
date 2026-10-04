import { LinearGradient } from "expo-linear-gradient";
import { Platform, StyleSheet, View } from "react-native";

import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { AccountHeaderActions } from "./account-header-button";
import { BrandWordmark } from "./brand-wordmark";

/** Mount before the tab's scroller so account actions stay available. */
export function TabHeader() {
  const colors = useTheme();

  return (
    <View style={[styles.header, { backgroundColor: colors.background }]}>
      <View style={styles.row}>
        <BrandWordmark />
        <AccountHeaderActions />
      </View>
      <LinearGradient
        pointerEvents="none"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        colors={[
          colors.background,
          `${colors.background}E6`,
          `${colors.background}70`,
          `${colors.background}00`,
        ]}
        locations={[0, 0.25, 0.65, 1]}
        style={styles.feather}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    zIndex: 10,
    flexShrink: 0,
    marginTop: Platform.OS === "web" ? 80 : 0,
  },
  row: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  feather: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    height: Spacing.four,
  },
});
