import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useState, type ReactNode } from "react";
import {
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";

import { MaxContentWidth, PageGutter, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { AccountHeaderActions } from "./account-header-button";
import { ThemedText } from "./themed-text";

export function useTabHeaderLayout() {
  const [headerHeight, setHeaderHeight] = useState(64);
  const onHeaderLayout = useCallback((event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    if (Number.isFinite(height) && height > 0) setHeaderHeight(height);
  }, []);
  return { headerHeight, onHeaderLayout };
}

/**
 * Shared top bar for every tab: the tab's large title, optional tab-specific
 * actions and the settings button. Mount before the tab's scroller so the
 * actions stay available while content scrolls underneath.
 */
export function TabHeader({
  title,
  actions,
  onLayout,
  children,
}: {
  title?: string;
  /** Tab-specific icon buttons shown before the settings button. */
  actions?: ReactNode;
  onLayout?: (event: LayoutChangeEvent) => void;
  children?: ReactNode;
}) {
  const colors = useTheme();

  return (
    <View
      onLayout={onLayout}
      style={[styles.header, { backgroundColor: `${colors.background}F2` }]}
    >
      <View style={styles.row}>
        {title ? (
          <ThemedText
            type="largeTitle"
            accessibilityRole="header"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={styles.title}
          >
            {title}
          </ThemedText>
        ) : (
          <View style={styles.title} />
        )}
        <View style={styles.actions}>
          {actions}
          <AccountHeaderActions />
        </View>
      </View>
      {children}
      <LinearGradient
        pointerEvents="none"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        colors={[
          `${colors.background}F2`,
          `${colors.background}C0`,
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
    paddingLeft: PageGutter,
    paddingRight: PageGutter - 6,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  title: { flex: 1 },
  actions: { flexDirection: "row", alignItems: "center" },
  feather: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    height: Spacing.three,
  },
});
