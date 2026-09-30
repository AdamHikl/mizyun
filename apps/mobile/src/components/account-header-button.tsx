import { generateAvatarSymbol } from "@mizyun/core";
import { router, type Href } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { FeedbackHeaderButton } from "./feedback-header-button";
import { ThemedText } from "./themed-text";

export function AccountHeaderButton() {
  const { profile } = useAuth();
  const colors = useTheme();
  const symbol = profile?.displayName
    ? generateAvatarSymbol(profile.displayName)
    : "👤";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open Account"
      accessibilityHint="Manage your profile, settings and account"
      onPress={() => router.push("/settings" as Href)}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <View
        accessible={false}
        style={[
          styles.avatar,
          {
            backgroundColor: colors.backgroundElement,
            borderColor: colors.border,
          },
        ]}
      >
        <ThemedText accessible={false} type="smallBold">
          {symbol}
        </ThemedText>
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
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.7 },
});
