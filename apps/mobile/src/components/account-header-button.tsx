import { router, type Href } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Pressable, StyleSheet, View } from "react-native";

import { useTheme } from "@/hooks/use-theme";
import { FeedbackHeaderButton } from "./feedback-header-button";

export function AccountHeaderButton() {
  const colors = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open settings"
      accessibilityHint="Manage your profile, settings and account"
      onPress={() => router.push("/settings" as Href)}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <View
        accessible={false}
        style={[
          styles.iconContainer,
          {
            backgroundColor: colors.backgroundElement,
            borderColor: colors.border,
          },
        ]}
      >
        <SymbolView
          accessible={false}
          name={{ ios: "gearshape", android: "settings", web: "settings" }}
          size={22}
          tintColor={colors.text}
        />
      </View>
    </Pressable>
  );
}

export function AccountHeaderActions() {
  return (
    <View style={styles.actions}>
      <FeedbackHeaderButton />
      <AccountHeaderButton />
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", alignItems: "center", gap: 6 },
  button: {
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.7 },
});
