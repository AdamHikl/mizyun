import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";

export default function AuthCallbackRoute() {
  useEffect(() => {
    // The DeepLinkBridge in _layout.tsx already consumes the URL fragment
    // and updates the auth session. Redirect back to the main route after a brief moment.
    const timer = setTimeout(() => {
      router.replace("/");
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <ThemedView style={styles.container}>
      <ActivityIndicator size="large" color="#10B981" />
      <ThemedText style={styles.text}>Completing authentication…</ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  text: {
    fontSize: 16,
    fontWeight: "600",
  },
});
